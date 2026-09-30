"""Validation analyses that put the single locked test set into context (``docs/CONTRACTS.md`` §7.2).

    ./.venv/Scripts/python -m cardiotwin_ml.analysis --jobs 8           # all analyses (~25 min)
    ./.venv/Scripts/python -m cardiotwin_ml.analysis --only modality     # one analysis

* :mod:`.robustness` - Monte-Carlo repeated hold-out of the frozen recipe (distribution of held-out ROC-AUC,
  F1, Brier, ... and the locked split's percentile).
* :mod:`.modality` - what each data modality (demographics ... ECG, labs, echo) adds: cumulative and
  leave-one-modality-out development-set CV with paired, variance-corrected confidence intervals.
* :mod:`.subgroups` - performance by sex, age band and diabetes on cross-fitted out-of-fold and test predictions.
* :mod:`.summary` - ``metrics.json`` merge and the small ``metrics_summary.json`` for the landing page.

The analyses are descriptive: they never refit, recalibrate or re-threshold the deployed model, and they only
*add* keys to ``metrics.json`` (``robustness``, ``modality_ablation``, ``subgroups``, ``analysis``).
"""

ANALYSIS_KEYS = ("robustness", "modality_ablation", "subgroups", "analysis")

__all__ = ["ANALYSIS_KEYS"]
