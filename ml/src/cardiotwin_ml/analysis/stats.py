"""Small, dependency-light statistical helpers for the validation analyses.

* :func:`distribution` / :func:`percentile_rank` - summaries of a Monte-Carlo distribution.
* :func:`corrected_t` - Nadeau & Bengio (2003) corrected resampled t-interval for repeated k-fold CV. Fold
  estimates share training data, so the naive standard error ``sd / sqrt(J)`` is far too small; the correction
  inflates the variance by ``1/J + n_test/n_train`` (Bouckaert & Frank 2004, "corrected repeated k-fold CV test").
* :func:`holm` - Holm step-down adjustment of a family of p-values.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Any

import numpy as np
from scipy import stats

from ..metrics import round_float

#: Quantiles reported for every Monte-Carlo distribution (keys are ``p05`` ... ``p95``).
QUANTILES = (0.05, 0.25, 0.50, 0.75, 0.95)


def _q_key(q: float) -> str:
    return f"p{round(q * 100):02d}"


def percentile_rank(values: Sequence[float] | np.ndarray, x: float) -> float:
    """Mid-rank percentile of ``x`` within ``values`` (0-100): share below plus half the ties."""
    v = np.asarray(values, dtype=np.float64)
    v = v[np.isfinite(v)]
    if v.size == 0 or not math.isfinite(x):
        return float("nan")
    below = np.sum(v < x)
    ties = np.sum(v == x)
    return float(100.0 * (below + 0.5 * ties) / v.size)


def distribution(values: Sequence[float] | np.ndarray) -> dict[str, float]:
    """Mean, sd and quantiles (``p05``, ``p25``, ``p50``, ``p75``, ``p95``), min and max of the finite values."""
    v = np.asarray(values, dtype=np.float64)
    v = v[np.isfinite(v)]
    if v.size == 0:
        return {"n": 0}
    out: dict[str, Any] = {"n": int(v.size), "mean": round_float(v.mean()), "sd": round_float(v.std(ddof=1) if v.size > 1 else 0.0)}
    for q, val in zip(QUANTILES, np.quantile(v, QUANTILES), strict=True):
        out[_q_key(q)] = round_float(val)
    out["min"] = round_float(v.min())
    out["max"] = round_float(v.max())
    return out


def corrected_t(
    values: Sequence[float] | np.ndarray, test_train_ratio: float, confidence: float = 0.95
) -> dict[str, Any]:
    """Nadeau-Bengio corrected resampled t statistics for the mean of ``J`` fold-level estimates.

    ``values`` are per-fold estimates (e.g. ROC-AUC, or paired ROC-AUC differences) from repeated k-fold CV and
    ``test_train_ratio`` is ``n_test / n_train`` of one fold (``1 / (k - 1)`` for k-fold). Returns the mean, the
    corrected standard error, a two-sided ``confidence`` interval (t with ``J - 1`` df) and the two-sided p-value
    of ``mean == 0`` (meaningful for paired differences).
    """
    v = np.asarray(values, dtype=np.float64)
    v = v[np.isfinite(v)]
    j = v.size
    if j < 2:
        raise ValueError("need at least two fold estimates")
    mean = float(v.mean())
    var = float(v.var(ddof=1))
    se = math.sqrt((1.0 / j + test_train_ratio) * var)
    tcrit = float(stats.t.ppf(0.5 + confidence / 2, df=j - 1))
    if se > 0:
        t_stat = mean / se
        p = float(2 * stats.t.sf(abs(t_stat), df=j - 1))
    else:
        t_stat = math.copysign(math.inf, mean) if mean else 0.0
        p = 0.0 if mean else 1.0
    return {
        "mean": round_float(mean),
        "se": round_float(se),
        "ci": [round_float(mean - tcrit * se), round_float(mean + tcrit * se)],
        "p_value": round_float(p),
        "n_folds": j,
    }


def holm(p_values: Sequence[float]) -> list[float]:
    """Holm (1979) step-down adjusted p-values (family-wise error control), in the input order."""
    p = np.asarray(p_values, dtype=np.float64)
    m = p.size
    order = np.argsort(p, kind="mergesort")
    adjusted = np.empty(m)
    running = 0.0
    for rank, idx in enumerate(order):
        running = max(running, min(1.0, (m - rank) * p[idx]))
        adjusted[idx] = running
    return [round_float(a) for a in adjusted]


def percentile_ci(samples: np.ndarray, confidence: float = 0.95) -> list[float] | None:
    """Percentile interval of bootstrap ``samples`` (NaNs ignored); ``None`` when nothing is finite."""
    s = np.asarray(samples, dtype=np.float64)
    s = s[np.isfinite(s)]
    if s.size == 0:
        return None
    alpha = (1 - confidence) / 2
    lo, hi = np.quantile(s, [alpha, 1 - alpha])
    return [round_float(lo), round_float(hi)]
