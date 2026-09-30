# CardioTwin — model results

Dataset: Extension of Z-Alizadeh Sani (n = 303; development 242, locked test 61). Test metrics are point estimates with 95% stratified-bootstrap CIs (2000 resamples) at the deployed threshold (Youden's J on out-of-fold development predictions). CV = development-set repeated stratified 5-fold × 10 with nested tuning (mean ± sd over folds).

## Held-out test set (deployed LR + XGBoost ensemble)

| Target | ROC-AUC | PR-AUC | F1 | Sensitivity | Specificity | Accuracy | Balanced acc. | MCC | Brier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CAD | 0.858 (0.743–0.955) | 0.937 (0.884–0.983) | 0.871 (0.791–0.940) | 0.841 (0.727–0.932) | 0.765 (0.588–0.941) | 0.820 (0.721–0.918) | 0.803 (0.687–0.914) | 0.578 (0.371–0.793) | 0.123 (0.068–0.182) |
| LAD | 0.742 (0.612–0.858) | 0.824 (0.738–0.901) | 0.694 (0.580–0.800) | 0.694 (0.556–0.833) | 0.560 (0.360–0.760) | 0.639 (0.525–0.754) | 0.627 (0.504–0.753) | 0.254 (0.008–0.514) | 0.217 (0.150–0.288) |
| LCX | 0.814 (0.701–0.907) | 0.761 (0.634–0.888) | 0.712 (0.600–0.808) | 0.840 (0.680–0.960) | 0.639 (0.472–0.778) | 0.721 (0.607–0.820) | 0.739 (0.626–0.837) | 0.474 (0.247–0.671) | 0.177 (0.142–0.215) |
| RCA | 0.759 (0.627–0.866) | 0.702 (0.560–0.833) | 0.610 (0.491–0.714) | 0.783 (0.609–0.913) | 0.526 (0.368–0.684) | 0.623 (0.508–0.738) | 0.654 (0.537–0.764) | 0.304 (0.073–0.513) | 0.183 (0.150–0.221) |

## Calibration on the held-out test set

Calibration slope/intercept: logistic recalibration of the test outcomes on the predicted log-odds (ideal 1 / 0); ECE over quantile bins of ~10 patients.

| Target | Brier | Log-loss | Calibration slope | Calibration intercept | Calibration-in-the-large | ECE |
| --- | --- | --- | --- | --- | --- | --- |
| CAD | 0.123 (0.068–0.182) | 0.428 (0.236–0.635) | 0.62 | +0.07 | -0.016 | 0.079 |
| LAD | 0.217 (0.150–0.288) | 0.653 (0.464–0.854) | 0.47 | +0.13 | -0.001 | 0.133 |
| LCX | 0.177 (0.142–0.215) | 0.529 (0.453–0.612) | 1.47 | +0.26 | +0.018 | 0.116 |
| RCA | 0.183 (0.150–0.221) | 0.540 (0.464–0.624) | 1.30 | +0.15 | +0.003 | 0.055 |

## Development-set cross-validation (ensemble recipe, cross-fitted)

For every outer fold the logistic variant, ensemble weight, Platt calibration and threshold are re-chosen on the other folds of that repeat only, so the scored fold never influences a choice (no selection optimism).

| Target | ROC-AUC | PR-AUC | F1 | Sensitivity | Specificity | Accuracy | Brier |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CAD | 0.937 ± 0.034 | 0.972 ± 0.018 | 0.900 ± 0.047 | 0.860 ± 0.072 | 0.881 ± 0.095 | 0.866 ± 0.057 | 0.091 ± 0.028 |
| LAD | 0.867 ± 0.057 | 0.899 ± 0.050 | 0.824 ± 0.054 | 0.835 ± 0.088 | 0.736 ± 0.131 | 0.794 ± 0.061 | 0.150 ± 0.034 |
| LCX | 0.738 ± 0.053 | 0.609 ± 0.076 | 0.628 ± 0.056 | 0.755 ± 0.128 | 0.591 ± 0.128 | 0.655 ± 0.056 | 0.205 ± 0.017 |
| RCA | 0.727 ± 0.071 | 0.601 ± 0.087 | 0.605 ± 0.086 | 0.757 ± 0.156 | 0.565 ± 0.113 | 0.637 ± 0.063 | 0.210 ± 0.029 |

## What the full panel adds over a clinical baseline (test set)

Baseline = logistic regression on age, sex, typical angina, diabetes and hypertension.

| Target | Full model ROC-AUC | Baseline ROC-AUC | Δ ROC-AUC (paired bootstrap 95% CI) |
| --- | --- | --- | --- |
| CAD | 0.858 (0.743–0.955) | 0.822 (0.688–0.943) | +0.037 (-0.023 to +0.100) |
| LAD | 0.742 (0.612–0.858) | 0.743 (0.608–0.866) | -0.001 (-0.082 to +0.087) |
| LCX | 0.814 (0.701–0.907) | 0.805 (0.693–0.903) | +0.009 (-0.043 to +0.057) |
| RCA | 0.759 (0.627–0.866) | 0.744 (0.606–0.858) | +0.015 (-0.023 to +0.054) |

## Cross-validation leaderboard (top 5 by ROC-AUC per target)

**CAD**

| Rank | Model | CV ROC-AUC | CV F1 @ 0.5 | CV Brier |
| --- | --- | --- | --- | --- |
| 1 | Random forest | 0.937 ± 0.037 | 0.914 | 0.107 |
| 2 | LR (lr_elasticnet) + XGBoost margin ensemble, Platt-calibrated | 0.937 ± 0.034 | 0.913 | 0.091 |
| 3 | Extra trees | 0.935 ± 0.039 | 0.919 | 0.097 |
| 4 | XGBoost | 0.929 ± 0.036 | 0.910 | 0.095 |
| 5 | Logistic regression (elastic net) | 0.929 ± 0.037 | 0.908 | 0.096 |

**LAD**

| Rank | Model | CV ROC-AUC | CV F1 @ 0.5 | CV Brier |
| --- | --- | --- | --- | --- |
| 1 | LR (lr_l1) + XGBoost margin ensemble, Platt-calibrated | 0.867 ± 0.057 | 0.829 | 0.150 |
| 2 | Random forest | 0.866 ± 0.053 | 0.830 | 0.158 |
| 3 | XGBoost | 0.863 ± 0.059 | 0.838 | 0.148 |
| 4 | Logistic regression (L1) | 0.857 ± 0.057 | 0.811 | 0.156 |
| 5 | Extra trees | 0.855 ± 0.058 | 0.836 | 0.153 |

**LCX**

| Rank | Model | CV ROC-AUC | CV F1 @ 0.5 | CV Brier |
| --- | --- | --- | --- | --- |
| 1 | LR (lr_core) + XGBoost margin ensemble, Platt-calibrated | 0.738 ± 0.053 | 0.533 | 0.205 |
| 2 | Random forest | 0.731 ± 0.056 | 0.419 | 0.207 |
| 3 | Logistic regression (clinical core) | 0.728 ± 0.047 | 0.506 | 0.205 |
| 4 | Histogram gradient boosting | 0.727 ± 0.058 | 0.519 | 0.224 |
| 5 | XGBoost | 0.721 ± 0.054 | 0.491 | 0.211 |

**RCA**

| Rank | Model | CV ROC-AUC | CV F1 @ 0.5 | CV Brier |
| --- | --- | --- | --- | --- |
| 1 | Logistic regression (clinical core) | 0.736 ± 0.070 | 0.497 | 0.201 |
| 2 | LR (lr_core) + XGBoost margin ensemble, Platt-calibrated | 0.727 ± 0.071 | 0.467 | 0.210 |
| 3 | Logistic regression (L2) | 0.723 ± 0.063 | 0.457 | 0.207 |
| 4 | Logistic regression (elastic net) | 0.720 ± 0.066 | 0.461 | 0.209 |
| 5 | Logistic regression (L1) | 0.720 ± 0.067 | 0.505 | 0.209 |

## Deployed configuration

| Target | Logistic variant | w (LR) | Platt a, b | Threshold (Youden) | Threshold (F1) | Top-3 features (mean \|SHAP\|) |
| --- | --- | --- | --- | --- | --- | --- |
| CAD | lr_elasticnet | 0.40 | 1.284, -0.207 | 0.747 | 0.501 | Typical Chest Pain, Age, Region RWMA |
| LAD | lr_l1 | 0.55 | 1.278, 0.080 | 0.551 | 0.427 | Typical Chest Pain, Region RWMA, Age |
| LCX | lr_core | 0.60 | 1.063, 0.048 | 0.327 | 0.325 | Typical Chest Pain, Age, Sex |
| RCA | lr_core | 0.70 | 1.026, 0.026 | 0.318 | 0.265 | Typical Chest Pain, DM, Sex |

## Use of the locked test set

* **1.0.0** — First and only evaluation of the v1.0.0 models.
* **1.1.0** — Re-scored after an independent code review found a calibration defect (Platt scaling, ensemble weight and thresholds had been fitted on out-of-fold margins of differently tuned fold models, so the map did not match the scale of the deployed components). The same review switched hyper-parameter tuning from ROC-AUC to log-loss (a proper scoring rule; ROC-AUC tuning had driven C to the edge of its range). Both changes and the cross-fitted CV estimate were specified and checked on the development set only; no feature, model family, search space or selection rule was changed in response to test results.

## Ablations (development CV, paired folds)

| Variant | Mean Δ ROC-AUC | Adopted |
| --- | --- | --- |
| derived | +0.0015 | no |
| selection | -0.0065 | no |
| chain | +0.0015 | no |

_Generated from `ml/artifacts/metrics.json` (2026-09-30T05:48:46+00:00)._
