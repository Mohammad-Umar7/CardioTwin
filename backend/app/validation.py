"""Validate and normalise raw clinical features against the feature schema (contract §2).

Every problem is reported at once, in FastAPI's error-item format, with enough context for a
client to fix the request: unknown keys come with "did you mean" suggestions, out-of-range values
with the allowed range and unit, categorical values with the allowed options.
"""

from __future__ import annotations

import difflib
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from app.models import LEAKAGE_KEYS, FeatureSchema, FeatureSpec

Loc = tuple[str | int, ...]

_BINARY_TRUE = frozenset({"1", "y", "yes", "true", "t"})
_BINARY_FALSE = frozenset({"0", "n", "no", "false", "f"})
# Spellings found in the raw dataset that map onto canonical schema options.
_OPTION_ALIASES: dict[str, str] = {"fmale": "female"}


@dataclass(frozen=True, slots=True)
class Issue:
    """One validation problem, serialisable as a FastAPI error item."""

    type: str
    loc: Loc
    msg: str
    input: Any = None
    ctx: dict[str, Any] | None = None

    def as_dict(self) -> dict[str, Any]:
        item: dict[str, Any] = {"type": self.type, "loc": list(self.loc), "msg": self.msg, "input": self.input}
        if self.ctx:
            item["ctx"] = self.ctx
        return item


class FeatureValidationError(Exception):
    """Raised when one or more feature values are invalid (rendered as HTTP 422)."""

    def __init__(self, issues: Sequence[Issue]) -> None:
        self.issues: list[Issue] = list(issues)
        super().__init__("; ".join(issue.msg for issue in self.issues))


class FeatureValidator:
    """Schema-driven validator; build once per loaded model."""

    def __init__(self, schema: FeatureSchema) -> None:
        self.schema = schema
        self.specs: dict[str, FeatureSpec] = {f.key: f for f in schema.features}
        self._lower_keys = {k.lower(): k for k in self.specs}
        self._options: dict[str, dict[str, str | int]] = {}
        for spec in schema.features:
            if spec.type == "categorical" and spec.options:
                lookup: dict[str, str | int] = {}
                for opt in spec.options:
                    lookup[str(opt.label).lower()] = opt.value
                for opt in spec.options:  # exact values win over labels
                    lookup[str(opt.value).lower()] = opt.value
                self._options[spec.key] = lookup

    @property
    def keys(self) -> list[str]:
        return list(self.specs)

    def normalize(self, features: Mapping[str, Any], loc: Loc = ("body", "features")) -> dict[str, Any]:
        """Return API-normalised features or raise :class:`FeatureValidationError`.

        ``None`` values are dropped so the predictor imputes them (and lists them in ``imputed``).
        """
        clean: dict[str, Any] = {}
        issues: list[Issue] = []
        for key, value in features.items():
            here = (*loc, key)
            spec = self.specs.get(key)
            if spec is None:
                issues.append(self._unknown(key, value, here))
                continue
            if value is None:
                continue
            result = self._coerce(spec, value, here)
            if isinstance(result, Issue):
                issues.append(result)
            else:
                clean[key] = result
        if issues:
            raise FeatureValidationError(issues)
        return clean

    # -- per-type coercion ----------------------------------------------------------------

    def _coerce(self, spec: FeatureSpec, value: Any, loc: Loc) -> Any:
        if spec.type == "binary":
            return self._binary(spec, value, loc)
        if spec.type == "categorical":
            return self._categorical(spec, value, loc)
        return self._numeric(spec, value, loc)

    def _numeric(self, spec: FeatureSpec, value: Any, loc: Loc) -> Any:
        number: int | float
        if isinstance(value, bool) or not isinstance(value, (int, float, str)):
            return self._type_error(spec, value, loc, "a number")
        if isinstance(value, str):
            text = value.strip()
            try:
                number = int(text)
            except ValueError:
                try:
                    number = float(text)
                except ValueError:
                    return self._type_error(spec, value, loc, "a number")
        else:
            number = value
        if isinstance(number, float) and not math.isfinite(number):
            return Issue("finite_number", loc, f"'{spec.key}' must be a finite number", value)

        lo, hi = spec.min, spec.max
        if (lo is not None and number < lo) or (hi is not None and number > hi):
            return Issue(
                "out_of_range",
                loc,
                f"{spec.key}={_fmt(number)} is outside the allowed range {_range(lo, hi, spec.unit)}",
                value,
                {"min": lo, "max": hi, "unit": spec.unit},
            )
        return number

    def _binary(self, spec: FeatureSpec, value: Any, loc: Loc) -> Any:
        if isinstance(value, bool):
            return int(value)
        if isinstance(value, (int, float)) and value in (0, 1):
            return int(value)
        if isinstance(value, str):
            text = value.strip().lower()
            if text in _BINARY_TRUE:
                return 1
            if text in _BINARY_FALSE:
                return 0
        return Issue(
            "binary_value",
            loc,
            f"'{spec.key}' is a yes/no feature: expected 0 or 1 (true/false and \"Y\"/\"N\" are also accepted)",
            value,
            {"allowed": [0, 1]},
        )

    def _categorical(self, spec: FeatureSpec, value: Any, loc: Loc) -> Any:
        lookup = self._options.get(spec.key, {})
        if isinstance(value, (str, int)) and not isinstance(value, bool):
            text = str(value).strip().lower()
            match = lookup.get(text)
            if match is None and text in _OPTION_ALIASES:
                match = lookup.get(_OPTION_ALIASES[text])
            if match is not None:
                return match
        allowed = [opt.value for opt in spec.options or []]
        return Issue(
            "invalid_option",
            loc,
            f"'{spec.key}' must be one of {', '.join(map(str, allowed))}",
            value,
            {"allowed": allowed},
        )

    # -- helpers --------------------------------------------------------------------------

    def _unknown(self, key: str, value: Any, loc: Loc) -> Issue:
        if key in LEAKAGE_KEYS:
            return Issue(
                "leakage_feature",
                loc,
                f"'{key}' is an angiography outcome (a prediction target), never a model input - remove it "
                "(target leakage)",
                value,
            )
        suggestions = self._suggest(key)
        hint = f"; did you mean {' or '.join(repr(s) for s in suggestions)}?" if suggestions else ""
        return Issue(
            "unknown_feature",
            loc,
            f"Unknown feature '{key}'{hint} (GET /api/schema lists the {len(self.specs)} accepted keys)",
            value,
            {"suggestions": suggestions} if suggestions else None,
        )

    def _suggest(self, key: str) -> list[str]:
        exact_case = self._lower_keys.get(key.lower())
        if exact_case:
            return [exact_case]
        lowered = difflib.get_close_matches(key.lower(), list(self._lower_keys), n=3, cutoff=0.6)
        return [self._lower_keys[k] for k in lowered]

    @staticmethod
    def _type_error(spec: FeatureSpec, value: Any, loc: Loc, expected: str) -> Issue:
        ctx: dict[str, Any] = {"expected": expected}
        if spec.min is not None or spec.max is not None:
            ctx |= {"min": spec.min, "max": spec.max, "unit": spec.unit}
        return Issue("type_error", loc, f"'{spec.key}' must be {expected}, got {type(value).__name__}", value, ctx)


def _fmt(number: float | int) -> str:
    if isinstance(number, float) and number.is_integer():
        return str(int(number))
    return f"{number:g}"


def _range(lo: float | None, hi: float | None, unit: str | None) -> str:
    suffix = f" {unit}" if unit else ""
    if lo is not None and hi is not None:
        return f"{_fmt(lo)}–{_fmt(hi)}{suffix}"
    if lo is not None:
        return f">= {_fmt(lo)}{suffix}"
    return f"<= {_fmt(hi)}{suffix}"  # type: ignore[arg-type]


def issues_from(items: Sequence[Issue]) -> list[dict[str, Any]]:
    return [issue.as_dict() for issue in items]
