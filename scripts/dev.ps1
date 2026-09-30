<#
.SYNOPSIS
    CardioTwin developer entry point for Windows (PowerShell 5.1 or 7+).

.DESCRIPTION
    One command per workflow; the same targets as the Makefile / scripts/dev.sh:

      setup     create .\.venv (Python 3.11), install the pinned ML stack, the API, test and lint tools; npm ci
      dev       API (uvicorn --reload) + Vite dev server with /api proxied to the API; Ctrl+C stops both
      serve     one process: uvicorn serving frontend\dist and the API on one URL (builds dist if missing)
      build     production build of the SPA into frontend\dist (-Base /CardioTwin/ for GitHub Pages)
      test      ML, anatomy, API and tooling tests + frontend typecheck, lint and unit tests
      lint      ruff + mypy (backend, scripts) and eslint (frontend)
      train     retrain the models (python -m cardiotwin_ml.train, extra arguments passed through)
      anatomy   rebuild the 3D anatomy assets (needs Blender 5.1, see anatomy\README.md)
      e2e       end-to-end check of a running API (scripts\e2e_check.py)

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\dev.ps1 setup
.EXAMPLE
    .\scripts\dev.ps1 dev -BackendPort 8010 -FrontendPort 5180
.EXAMPLE
    .\scripts\dev.ps1 dev -BackendPort 8010 -FrontendPort 5180 -Smoke     # start, verify, stop (exit 0/1)
.EXAMPLE
    .\scripts\dev.ps1 serve -Port 8012 -Smoke                              # one-process server + e2e check
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('help', 'setup', 'dev', 'serve', 'build', 'test', 'lint', 'train', 'anatomy', 'e2e')]
    [string] $Command = 'help',

    [ValidateRange(1, 65535)] [int] $BackendPort = 8000,
    [ValidateRange(1, 65535)] [int] $FrontendPort = 5173,
    [ValidateRange(1, 65535)] [int] $Port = 8000,
    [string] $BindHost = '127.0.0.1',
    [string] $Base = '',
    [string] $Python = '',
    [switch] $Smoke,
    [switch] $Rebuild,

    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $Rest = @()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$VenvPython = Join-Path $Root '.venv\Scripts\python.exe'
$script:Started = New-Object System.Collections.Generic.List[System.Diagnostics.Process]
$script:SavedEnv = @{}

function Write-Step([string] $Message) { Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Ok([string] $Message) { Write-Host "  ok $Message" -ForegroundColor Green }
function Fail([string] $Message) { throw "error: $Message" }

# Run a native command and stop on a non-zero exit code (PowerShell 5.1 does not do that by itself).
function Invoke-Native {
    param([Parameter(Mandatory)] [string] $FilePath, [string[]] $Arguments = @())
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) { Fail "'$FilePath $($Arguments -join ' ')' failed with exit code $LASTEXITCODE" }
}

function Set-TempEnv([string] $Name, [string] $Value) {
    if (-not $script:SavedEnv.ContainsKey($Name)) {
        $script:SavedEnv[$Name] = [Environment]::GetEnvironmentVariable($Name, 'Process')
    }
    [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
}

function Restore-Env {
    foreach ($name in @($script:SavedEnv.Keys)) {
        [Environment]::SetEnvironmentVariable($name, $script:SavedEnv[$name], 'Process')
    }
    $script:SavedEnv.Clear()
}

# ---------------------------------------------------------------------------------------------
# Toolchain
# ---------------------------------------------------------------------------------------------

function Find-BasePython {
    $candidates = @()
    if ($Python) { $candidates += , @($Python) }
    $candidates += , @('py', '-3.11')
    $candidates += , @('python3.11')
    $candidates += , @('python')
    foreach ($candidate in $candidates) {
        $exe = $candidate[0]
        $prefix = @($candidate | Select-Object -Skip 1)
        if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) { continue }
        try {
            & $exe @prefix -c 'import sys; sys.exit(0 if sys.version_info[:2] >= (3, 11) else 1)' 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) { return , $candidate }
        } catch { continue }
    }
    return $null
}

function Assert-Node {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'Node.js 22 (>= 20.19) is required: https://nodejs.org' }
    $version = (& node --version).TrimStart('v').Split('.')
    $major = [int] $version[0]; $minor = [int] $version[1]
    if ($major -lt 20 -or ($major -eq 20 -and $minor -lt 19)) { Fail "Node.js >= 20.19 is required (found v$($version -join '.')); CI uses Node 22" }
}

function Confirm-Python {
    if (-not (Test-Path $VenvPython)) {
        Write-Step 'No .venv yet - running setup'
        Invoke-Setup
    }
}

function Confirm-NodeModules {
    Assert-Node
    if (-not (Test-Path (Join-Path $Root 'frontend\node_modules'))) {
        Write-Step 'Installing frontend dependencies (npm ci)'
        Invoke-Native 'npm.cmd' @('ci', '--prefix', 'frontend', '--no-audit', '--no-fund')
    }
}

# ---------------------------------------------------------------------------------------------
# Process management
# ---------------------------------------------------------------------------------------------

# Network probes run through scripts\probe.py (Python, stdlib): identical behaviour to dev.sh, and some Windows
# antivirus products quarantine PowerShell scripts that download content with Invoke-WebRequest.
$Probe = Join-Path $PSScriptRoot 'probe.py'

function Test-PortInUse([int] $PortNumber) {
    & $VenvPython $Probe port $PortNumber
    return ($LASTEXITCODE -eq 0)
}

function Assert-PortFree([int] $PortNumber, [string] $Label, [string] $Option) {
    if (Test-PortInUse $PortNumber) {
        Fail "port $PortNumber for the $Label is already in use; stop that process or pick another port, e.g. $Option $($PortNumber + 10)"
    }
}

# True on HTTP 2xx (and, with -Field, when the JSON body has that top-level field value, e.g. status=ok).
function Test-Url([string] $Url, [string] $Field = '') {
    $arguments = @('get', $Url, '--quiet')
    if ($Field) { $arguments += @('--json-field', $Field) }
    & $VenvPython $Probe @arguments
    return ($LASTEXITCODE -eq 0)
}

function Wait-Ready([string] $Url, [string] $Label, [int] $TimeoutSeconds, [System.Diagnostics.Process] $Process) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while (-not (Test-Url $Url)) {
        if ($Process.HasExited) { Fail "$Label exited during startup (exit code $($Process.ExitCode))" }
        if ((Get-Date) -gt $deadline) { Fail "$Label did not answer $Url within $TimeoutSeconds s" }
        Start-Sleep -Milliseconds 700
    }
    Write-Ok "$Label ready: $Url"
}

function Start-DevProcess([string] $Label, [string] $FilePath, [string[]] $Arguments) {
    # Start-Process takes one argument string on Windows PowerShell 5.1: quote anything with spaces.
    $argumentLine = ($Arguments | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' '
    $process = Start-Process -FilePath $FilePath -ArgumentList $argumentLine -WorkingDirectory $Root -NoNewWindow -PassThru
    $script:Started.Add($process)
    Write-Host "  started $Label (pid $($process.Id))" -ForegroundColor DarkGray
    return $process
}

function Stop-Services {
    if ($script:Started.Count -eq 0) { return }
    $ErrorActionPreference = 'Continue'   # taskkill reports already-exited children on stderr
    Write-Step "Stopping $($script:Started.Count) process tree(s)"
    foreach ($process in $script:Started) {
        if (-not $process.HasExited) {
            # /T: uvicorn's reload worker and npm -> node (Vite) are child processes.
            & taskkill.exe /PID $process.Id /T /F *> $null
        }
    }
    foreach ($process in $script:Started) {
        try { [void] $process.WaitForExit(10000) } catch { }
    }
    $script:Started.Clear()
}

function Watch-Services {
    Write-Step 'Press Ctrl+C to stop'
    while ($true) {
        foreach ($process in $script:Started) {
            if ($process.HasExited) { Fail "a service exited (pid $($process.Id), exit code $($process.ExitCode)); stopping the others" }
        }
        Start-Sleep -Milliseconds 700
    }
}

function Write-Urls([int] $AppPort, [int] $ApiPort) {
    Write-Host ''
    Write-Host "  App  http://${BindHost}:$AppPort" -ForegroundColor White
    Write-Host "  API  http://${BindHost}:$ApiPort/docs" -ForegroundColor White
    Write-Host ''
}

# ---------------------------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------------------------

function Invoke-Setup {
    if (-not (Test-Path $VenvPython)) {
        $base = Find-BasePython
        if ($null -eq $base) { Fail 'Python 3.11 is required (install it, or pass -Python C:\path\to\python.exe)' }
        $exe = $base[0]; $prefix = @($base | Select-Object -Skip 1)
        Write-Step "Creating .venv with $($base -join ' ')"
        Invoke-Native $exe ($prefix + @('-m', 'venv', (Join-Path $Root '.venv')))
    }
    & $VenvPython -c 'import sys; v = sys.version_info[:2]; v == (3, 11) or print(''warning: artifacts and pins were produced with Python 3.11; found %d.%d'' % v)'
    Write-Step 'Installing Python dependencies (pinned ML stack, API, test and lint tools)'
    Invoke-Native $VenvPython @('-m', 'pip', 'install', '--disable-pip-version-check', '--upgrade', 'pip')
    Invoke-Native $VenvPython @('-m', 'pip', 'install', '--disable-pip-version-check', '-r', 'scripts\requirements-dev.txt')
    Invoke-Native $VenvPython @('-m', 'pip', 'install', '--disable-pip-version-check', '-e', 'ml', '-c', 'scripts\constraints.txt')
    Assert-Node
    Write-Step 'Installing frontend dependencies (npm ci)'
    Invoke-Native 'npm.cmd' @('ci', '--prefix', 'frontend', '--no-audit', '--no-fund')
    Write-Step 'Installing anatomy QA tooling (npm ci)'
    Invoke-Native 'npm.cmd' @('ci', '--prefix', 'anatomy', '--no-audit', '--no-fund')
    Write-Ok 'setup complete - next: .\scripts\dev.ps1 dev'
}

function Invoke-Dev {
    Confirm-Python
    Confirm-NodeModules
    Assert-PortFree $BackendPort 'API' '-BackendPort'
    Assert-PortFree $FrontendPort 'Vite dev server' '-FrontendPort'
    Write-Step "Starting API on http://${BindHost}:$BackendPort and Vite on http://${BindHost}:$FrontendPort"
    if (-not $env:CARDIOTWIN_LOG_FORMAT) { Set-TempEnv 'CARDIOTWIN_LOG_FORMAT' 'text' }
    if (-not $env:CARDIOTWIN_SERVE_FRONTEND) { Set-TempEnv 'CARDIOTWIN_SERVE_FRONTEND' '0' }
    if (-not $env:CARDIOTWIN_CORS_ORIGINS) {
        Set-TempEnv 'CARDIOTWIN_CORS_ORIGINS' "http://${BindHost}:$FrontendPort,http://localhost:$FrontendPort"
    }
    Set-TempEnv 'VITE_API_PROXY' "http://${BindHost}:$BackendPort"
    $api = Start-DevProcess 'API' $VenvPython @('-m', 'uvicorn', 'app.main:app', '--app-dir', 'backend', '--host', $BindHost,
        '--port', "$BackendPort", '--reload', '--reload-dir', 'backend\app', '--reload-dir', 'ml\src')
    $vite = Start-DevProcess 'Vite' 'npm.cmd' @('--prefix', 'frontend', 'run', 'dev', '--', '--host', $BindHost,
        '--port', "$FrontendPort", '--strictPort')
    Wait-Ready "http://${BindHost}:$BackendPort/api/health" 'API' 180 $api
    Wait-Ready "http://${BindHost}:$FrontendPort/" 'Vite' 120 $vite
    if (-not (Test-Url "http://${BindHost}:$FrontendPort/api/health" 'status=ok')) { Fail 'Vite does not proxy /api to the API' }
    Write-Ok 'Vite proxies /api -> API'
    Write-Urls $FrontendPort $BackendPort
    if ($Smoke) { Write-Ok 'smoke test passed'; return }
    Watch-Services
}

function Invoke-Build {
    Confirm-NodeModules
    if ($Base) {
        Write-Step "Building the SPA with base $Base"
        Invoke-Native 'npm.cmd' @('--prefix', 'frontend', 'run', 'build', '--', '--base', $Base)
    } else {
        Write-Step 'Building the SPA'
        Invoke-Native 'npm.cmd' @('--prefix', 'frontend', 'run', 'build')
    }
    Write-Ok 'frontend\dist'
}

function Invoke-Serve {
    Confirm-Python
    if ($Rebuild -or -not (Test-Path (Join-Path $Root 'frontend\dist\index.html'))) { Invoke-Build }
    Assert-PortFree $Port 'server' '-Port'
    Write-Step "Serving the app and the API from one process on http://${BindHost}:$Port"
    Set-TempEnv 'CARDIOTWIN_SERVE_FRONTEND' '1'
    if (-not $env:CARDIOTWIN_LOG_FORMAT) { Set-TempEnv 'CARDIOTWIN_LOG_FORMAT' 'text' }
    $server = Start-DevProcess 'server' $VenvPython @('-m', 'uvicorn', 'app.main:app', '--app-dir', 'backend', '--host', $BindHost, '--port', "$Port")
    Wait-Ready "http://${BindHost}:$Port/api/health" 'server' 180 $server
    Write-Urls $Port $Port
    if ($Smoke) {
        Invoke-Native $VenvPython @('scripts\e2e_check.py', '--url', "http://${BindHost}:$Port", '--wait', '120', '--latency-n', '20')
        return
    }
    Watch-Services
}

function Invoke-Test {
    Confirm-Python
    Confirm-NodeModules
    Write-Step 'ML tests';       Invoke-Native $VenvPython @('-m', 'pytest', 'ml\tests', '-q')
    Write-Step 'Anatomy tests';  Invoke-Native $VenvPython @('-m', 'pytest', 'anatomy', '-q')
    Write-Step 'API tests';      Invoke-Native $VenvPython @('-m', 'pytest', 'backend', '-q')
    Write-Step 'Tooling tests';  Invoke-Native $VenvPython @('-m', 'pytest', 'scripts\tests', '-q')
    Write-Step 'Frontend typecheck'; Invoke-Native 'npm.cmd' @('--prefix', 'frontend', 'run', 'typecheck')
    Write-Step 'Frontend lint';      Invoke-Native 'npm.cmd' @('--prefix', 'frontend', 'run', 'lint')
    Write-Step 'Frontend tests';     Invoke-Native 'npm.cmd' @('--prefix', 'frontend', 'test')
    Write-Ok 'all tests passed'
}

function Invoke-Lint {
    Confirm-Python
    Confirm-NodeModules
    Write-Step 'ruff'
    Invoke-Native $VenvPython @('-m', 'ruff', 'check', 'backend', 'scripts')
    Push-Location (Join-Path $Root 'ml'); try { Invoke-Native $VenvPython @('-m', 'ruff', 'check', '.') } finally { Pop-Location }
    Write-Step 'mypy'
    Push-Location (Join-Path $Root 'backend'); try { Invoke-Native $VenvPython @('-m', 'mypy', 'app') } finally { Pop-Location }
    Invoke-Native $VenvPython @('-m', 'mypy', '--strict', '--ignore-missing-imports', 'scripts\e2e_check.py', 'scripts\probe.py',
        'scripts\runtime_requirements.py')
    Write-Step 'eslint'
    Invoke-Native 'npm.cmd' @('--prefix', 'frontend', 'run', 'lint')
    Write-Ok 'lint clean'
}

Push-Location $Root
try {
    switch ($Command) {
        'setup' { Invoke-Setup }
        'dev' { Invoke-Dev }
        'serve' { Invoke-Serve }
        'build' { Invoke-Build }
        'test' { Invoke-Test }
        'lint' { Invoke-Lint }
        'train' { Confirm-Python; Invoke-Native $VenvPython (@('-m', 'cardiotwin_ml.train') + $Rest) }
        'anatomy' { Confirm-Python; Invoke-Native $VenvPython (@('anatomy\build.py') + $Rest) }
        'e2e' { Confirm-Python; Invoke-Native $VenvPython (@('scripts\e2e_check.py', '--url', "http://${BindHost}:$BackendPort") + $Rest) }
        default { Get-Help $PSCommandPath -Detailed }
    }
    $exitCode = 0
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    $exitCode = 1
} finally {
    Stop-Services
    Restore-Env
    Pop-Location
}
exit $exitCode
