# CardioTwin frontend — architecture

React 18 + TypeScript (strict) + Vite 6, Tailwind 3 mapped onto the LUMEN tokens, zustand stores,
React Three Fiber 8 for the 3D view. The design is specified in
[`docs/design/DESIGN_SYSTEM.md`](../docs/design/DESIGN_SYSTEM.md) (binding) and the data contracts in
[`docs/CONTRACTS.md`](../docs/CONTRACTS.md) (binding; mirrored in `src/types/contracts.ts`).

```
frontend/
  build/modelArtifacts.ts   Vite plugin: serves / emits ml/artifacts/*.json when public/model/ lacks them
  public/model/             ML artifacts (schema, cohort, metrics, model, fixtures) — written by ml/
  public/anatomy/           GLB + manifest + vessels — written by anatomy/
  src/
    main.tsx, App.tsx       fonts, global CSS, HashRouter (static hosting under any sub-path)
    router.tsx, routes.ts   code-split routes: / · /workstation[/:patientId] · /performance · /methodology
    styles/                 tokens.css (CSS variables, §2) + globals.css (base, .eyebrow, .num, .mono, motion)
    theme/                  risk.ts (Ember v2 ramp, bands, LUT — the ONLY risk colour source), tokens.ts (hex mirrors)
    lib/                    riskColor, format (clinical number rules §3), explain (SHAP/Platt/narrative), cn, colorScience, patients
    types/contracts.ts      TypeScript mirror of CONTRACTS.md (additive fields optional)
    services/               api.ts (REST client), staticData.ts (memoised artifact loaders), engine.ts (engines)
    state/                  patientStore, viewerStore, uiStore, engineStore (zustand)
    hooks/                  useData (schema/cohort/metrics/manifest…), useEngine, usePrediction, useMediaQuery, useHotkeys,
                            useAmbientEffects (LUMEN 2 cursor spotlight, scroll reveal, render-tier attribute)
    design/                 LUMEN primitives + risk marks (BandChip, RiskTrack, RiskLegend, Probability…)
    features/
      shell/                AppShell, TopNav, EngineBadge, PatientChip, StatusLine (DisclaimerBanner), DisclaimerModal,
                            Toaster, ShortcutSheet, AppBootstrap (engine + default patient + prediction sync)
      landing/              LandingPage, HeroHud, KpiStrip, Pillars, InfoCards
      workstation/          WorkstationPage (3 layouts), CanvasHud, GroupRail (1280 rail + flyout), panels
      patient/              PatientPicker (combobox), ClinicalForm + fields, WhatIfBar
      risk/                 CADHeroCard, VesselList/VesselRow, GroundTruthReveal, DeltaChip
      explain/              TargetTabs, NarrativeSentence, ShapWaterfall, PhysiologyTable, ExplainPanel
      performance/          PerformancePage, LineChart (neutral d3 charts)
      methodology/          MethodologyPage
      tour/                 TourLayer (spotlight coachmark), steps.ts
      vitals/               ecg.ts (schematic ECG on the cardiac phase), EcgMonitor (live strip locked to the 3D beat)
    three/                  SceneHost + CanvasSlot (persistent canvas), SceneCanvas, anatomy/, camera/, labels/, stage/
    test/                   setup.ts (jsdom polyfills), fixtures.ts (contract-shaped samples)
```

## Data flow

```
schema/cohort/metrics ──► services/staticData (static file → /api fallback, memoised) ──► hooks/useData
                                                                                          │
features ──setFeature──► patientStore.features ──► usePredictionSync (debounce 150 ms, abort stale)
                                                        │ engine.predict()
                                                        ▼
                                  patientStore.prediction (last good) ──► panels (React) + 3D (useFrame, no React state)
```

* **Engines** (`services/engine.ts`): `PredictionEngine { kind, available, description, predict(features, {signal}) }`.
  `resolveEngine()` health-checks `GET /api/health` (1.5 s, `VITE_API_HEALTH_TIMEOUT_MS`) → `ServerEngine`, else
  `EdgeEngine`. **`EdgeEngine` is a deliberate stub** that rejects with `EngineUnavailableError`; the UI then shows
  "Estimate unavailable" and achromatic vessels — never invented numbers.
* **Predictions** never wait for the GLB: panels fill as soon as the engine answers.
* **The 3D scene** reads the stores inside `useFrame` (`usePatientStore.getState()`), damps `p` (λ = 6) and samples
  the ramp every frame, so colours always sit on the legend ("animate p, not colour").

## One persistent canvas

`three/SceneHost.tsx` (mounted once in the shell) renders the R3F `<Canvas>` through a portal into a detached
host `<div>`. Pages render `<CanvasSlot stage="hero" | "workstation">`; the host element is appended to the active
slot (or parked off-screen, `inert`, with `frameloop="never"`). Route changes therefore move the canvas without
re-creating the WebGL context or re-parsing the GLB. `viewerStore.stage` tells the camera rig which pose to use.
Tier D (no WebGL2, two context losses, scene crash) swaps in `three/WebGLFallback.tsx` (2D SVG schematic with the
same selection behaviour).

## Ownership map (phase 2)

| Path | Owner | Notes |
| --- | --- | --- |
| `styles/`, `theme/`, `design/`, `lib/`, `types/`, `services/api.ts`, `services/staticData.ts`, `state/`, `hooks/`, `features/shell/`, `router.tsx` | Foundation | Extend, do not fork. Add fields to stores rather than creating parallel stores. |
| `services/engine.ts` → `EdgeEngine` | Phase 2 · ML/edge | Replace the stub body with the portable-model evaluator (`model.json`: encoders, LR + XGBoost trees, Platt, TreeSHAP). Keep the class name / interface; `resolveEngine({ createEdge })` is the injection point. Parity target: `model/fixtures.json` (`fixturesResource`), \|Δp\| < 1e-6, \|Δshap\| < 1e-5. Then add the `Verifying` / `Engines disagree` pill states in `features/shell/EngineBadge.tsx`. |
| `features/risk/`, `features/explain/` | Phase 2 · dashboard | Real, minimal versions ship now. Next: ICE strips (`Slider.above` slot, Web Worker), counterfactual captions (`BinaryToggle.caption`, `SegmentedControl.onPreview`), group attribution strip, FLIP re-ordering, virtualised full list (`@tanstack/react-virtual` installed). |
| `features/landing/` | Phase 2 · landing | Hero HUD, KPIs and cards are data-driven already. |
| `features/performance/`, `features/methodology/` | Phase 2 · performance | Charts are real and neutral; add the linked what-if threshold (`curves.roc.thresholds`), "View as table", PNG/SVG export with watermark. |
| `features/tour/` | Phase 2 · tour | Steps in `steps.ts` (`target` = `[data-tour=…]` selector, optional `onEnter`). |
| `three/` | Phase 2 · 3D | See below. |
| `public/model/**`, `public/anatomy/**` | ml/, anatomy/ | Never edited by the frontend. |

### 3D plug-in points (`src/three/`)

| File | What it does now | Phase-2 extension |
| --- | --- | --- |
| `SceneCanvas.tsx` | Canvas (fov 30, no AA/alpha/stencil), tier DPR, frameloop policy, keyboard, PostFX (Bloom → Neutral → Vignette → SMAA) at tiers A/B, Neutral renderer tone mapping at C | 30 fps idle cap, particles, peel scrubber hooks |
| `anatomy/GlbAnatomy.tsx` | meshopt GLB, materials by node name, targets from `schema.targets[].anatomy`, data-driven peel from `manifest.layers[].explode` (translate + ghost swap), label anchors, heartbeat on `Layer_Heart`/`Layer_Coronary` | rib hinge (`pivot/hingeAxis`), wall hinge, `rides`, draw-in/ignition via `_ARCLEN` |
| `anatomy/ProceduralHeart.tsx` + `proceduralGeometry.ts` | Placeholder heart used when the GLB is absent / fails; same materials, anchors, events | — |
| `anatomy/materials.ts` | Myocardium (clay/anat, territory tint from `COLOR_0` via the LUT, fresnel rim), vessel (colour = emissive = ramp, rim, 0.5 mm display inflation), ghosts, neutral anatomy | inverted-hull outline, ripple uniform (`uRipple`) |
| `anatomy/useRiskAnimation.ts` | Damped p, pending/stale grey, selection dim/desaturate, hover lift, territory uniforms, demand-mode invalidation | ripple on commit |
| `camera/CameraRig.tsx`, `camera/presets.ts` | drei CameraControls (2.2–9, 20°–160°, Shift-drag pan), home/preset/focus commands, C-arm readout, landing turntable | view offset for the flyout, peel camera move |
| `labels/*` | DOM overlay + SVG leaders positioned in `useFrame`, radiological lanes, posterior dimming, compact mode | ring on band change |
| `riskLut.ts` | 256×1 sRGB `DataTexture` of the ramp | flow particles, tier-C dash shader |

Commands from the UI go through `viewerStore`: `select(target)`, `hover(target)`, `flyHome()`,
`flyToPreset('LAO45')`, `focusTarget(target)`, `setExplode(e)`, `toggle('heartbeat' | 'territories' | …)`,
`setTier(tier, lock)`.

## Conventions

* **Colour.** Risk colour only from `theme/risk.ts` (`riskHex`, `riskLinear`, `RISK_BAND_STYLES`, LUT). Never for text.
  `critical` is shown as "Very high". Performance charts are neutral. Status colours never encode risk.
* **Numbers.** Use `lib/format.ts` ("72 %" with U+2009, "<1 %", "+0.94"/"−0.18" with U+2212, "▲ +12 pts").
* **Type.** `.eyebrow` is the overline token (Tailwind's `overline` utility is a text decoration). Numerals use
  `font-numeral` / `.num` (tabular). 11 px only for overlines and credits.
* **Accessibility.** Every interactive primitive is keyboard operable; tooltips open on focus; sliders expose
  `aria-valuetext`; the canvas has a text summary (`SceneSummary`); the status line is never removed.
* **Tests.** `vitest` + Testing Library (`src/**/*.test.ts(x)`); `theme/risk.test.ts` is the colour-vision gate.
