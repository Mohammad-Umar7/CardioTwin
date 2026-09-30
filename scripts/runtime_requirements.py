#!/usr/bin/env python3
"""Exact requirements of the CardioTwin server runtime (FastAPI service + ML inference), e.g. for the Docker image.

    python scripts/runtime_requirements.py                          # print the pinned list
    python scripts/runtime_requirements.py --xgboost-cpu -o /tmp/runtime.txt
    python -m pip install -r /tmp/runtime.txt -c scripts/constraints.txt

Nothing is duplicated here; the list is derived from the files each layer owns:

* ``backend/requirements.txt``  the API requirements (ranges, extras such as ``uvicorn[standard]``),
                                pinned with ``scripts/constraints.txt``;
* ``ml/pyproject.toml``         the runtime dependencies of ``cardiotwin_ml`` (``[project].dependencies``;
                                test-only extras are left out), pinned with ``ml/requirements.txt`` - the
                                versions the published artifacts were built with.

``--xgboost-cpu`` swaps ``xgboost`` for the ``xgboost-cpu`` distribution of the same version: the same
``xgboost`` module and model format without the CUDA kernels, and without the ~350 MB NCCL wheel the Linux
``xgboost`` wheel depends on. Inference here always runs on the CPU.

Exit status 1 (and nothing written) when a runtime requirement has no exact pin, so an unpinned dependency can
never slip into the image; ``--allow-unpinned`` keeps the declared range instead.
"""

from __future__ import annotations

import argparse
import re
import sys
import tomllib
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_REQUIREMENTS = REPO_ROOT / "backend" / "requirements.txt"
ML_PYPROJECT = REPO_ROOT / "ml" / "pyproject.toml"
PIN_FILES: tuple[Path, ...] = (REPO_ROOT / "ml" / "requirements.txt", REPO_ROOT / "scripts" / "constraints.txt")

_REQUIREMENT = re.compile(
    r"""^\s*(?P<name>[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)\s*
        (?:\[(?P<extras>[^\]]*)\])?\s*
        (?P<spec>[^;]*?)\s*
        (?:;\s*(?P<marker>.+?))?\s*$""",
    re.VERBOSE,
)
_EXACT_PIN = re.compile(r"^==\s*(?P<version>[A-Za-z0-9.+!_-]+)$")


class RequirementsError(ValueError):
    """A requirements file could not be parsed, or a runtime requirement is not pinned."""


def canonical(name: str) -> str:
    """PEP 503 normalised project name (``PyYAML`` -> ``pyyaml``, ``pydantic_core`` -> ``pydantic-core``)."""
    return re.sub(r"[-_.]+", "-", name).lower()


@dataclass(frozen=True)
class Requirement:
    name: str
    extras: tuple[str, ...] = ()
    spec: str = ""
    marker: str = ""

    @classmethod
    def parse(cls, line: str) -> Requirement:
        match = _REQUIREMENT.match(line)
        if match is None:
            raise RequirementsError(f"cannot parse requirement {line!r}")
        extras = tuple(e.strip() for e in (match["extras"] or "").split(",") if e.strip())
        return cls(match["name"], extras, match["spec"].replace(" ", ""), (match["marker"] or "").strip())

    @property
    def key(self) -> str:
        return canonical(self.name)

    def render(self, *, name: str | None = None, spec: str | None = None) -> str:
        text = name or self.name
        if self.extras:
            text += f"[{','.join(self.extras)}]"
        text += self.spec if spec is None else spec
        if self.marker:
            text += f" ; {self.marker}"
        return text


def requirement_lines(text: str) -> Iterable[str]:
    """Requirement lines of a pip requirements file: comments, blanks and ``-r``/``-c``/``--`` options skipped."""
    for raw in text.splitlines():
        line = raw.split(" #", 1)[0].split("\t#", 1)[0].strip()
        if not line or line.startswith(("#", "-")):
            continue
        yield line


def read_requirements(path: Path) -> list[Requirement]:
    return [Requirement.parse(line) for line in requirement_lines(path.read_text(encoding="utf-8"))]


def read_project_dependencies(pyproject: Path) -> list[Requirement]:
    with pyproject.open("rb") as handle:
        project = tomllib.load(handle).get("project", {})
    return [Requirement.parse(entry) for entry in project.get("dependencies", [])]


def read_pins(paths: Sequence[Path]) -> dict[str, str]:
    """``{canonical name: version}`` of every exact ``==`` pin; conflicting pins are an error."""
    pins: dict[str, str] = {}
    origin: dict[str, Path] = {}
    for path in paths:
        for requirement in read_requirements(path):
            exact = _EXACT_PIN.match(requirement.spec)
            if exact is None:
                continue
            version = exact["version"]
            if requirement.key in pins and pins[requirement.key] != version:
                raise RequirementsError(
                    f"{requirement.name} is pinned to {pins[requirement.key]} in {origin[requirement.key].name} "
                    f"and to {version} in {path.name}"
                )
            pins[requirement.key] = version
            origin[requirement.key] = path
    return pins


def pin_requirements(
    requirements: Sequence[Requirement],
    pins: Mapping[str, str],
    *,
    xgboost_cpu: bool = False,
    allow_unpinned: bool = False,
) -> list[str]:
    """One ``name[extras]==version ; marker`` line per requirement (first occurrence wins, order kept)."""
    lines: list[str] = []
    seen: set[str] = set()
    unpinned: list[str] = []
    for requirement in requirements:
        if requirement.key in seen:
            continue
        seen.add(requirement.key)
        version = pins.get(requirement.key)
        if version is None:
            if not allow_unpinned:
                unpinned.append(requirement.render())
                continue
            spec = requirement.spec
        else:
            spec = f"=={version}"
        name = "xgboost-cpu" if xgboost_cpu and requirement.key == "xgboost" else None
        lines.append(requirement.render(name=name, spec=spec))
    if unpinned:
        raise RequirementsError(
            "no exact pin for " + ", ".join(unpinned) + " - add one to ml/requirements.txt (ML stack) "
            "or scripts/constraints.txt (API stack), or pass --allow-unpinned"
        )
    return lines


def runtime_requirements(*, xgboost_cpu: bool = False, allow_unpinned: bool = False) -> list[str]:
    requirements = read_requirements(BACKEND_REQUIREMENTS) + read_project_dependencies(ML_PYPROJECT)
    return pin_requirements(requirements, read_pins(PIN_FILES), xgboost_cpu=xgboost_cpu, allow_unpinned=allow_unpinned)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("-o", "--output", type=Path, default=None, help="write here instead of stdout")
    parser.add_argument("--xgboost-cpu", action="store_true", help="use the CPU-only xgboost-cpu distribution")
    parser.add_argument("--allow-unpinned", action="store_true", help="keep declared ranges for unpinned packages")
    args = parser.parse_args(argv)
    try:
        lines = runtime_requirements(xgboost_cpu=args.xgboost_cpu, allow_unpinned=args.allow_unpinned)
    except (OSError, RequirementsError, tomllib.TOMLDecodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    text = "".join(f"{line}\n" for line in lines)
    if args.output is None:
        sys.stdout.write(text)
    else:
        args.output.write_text(text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
