# CardioTwin — model results

Dataset: Extension of Z-Alizadeh Sani (n = 303; development 242, locked test 61). Test metrics are point estimates with 95% stratified-bootstrap CIs (2000 resamples) at the deployed threshold (Youden's J on out-of-fold development predictions). CV = development-set repeated stratified 5-fold × 10 (mean ± sd over folds).

## Held-out test set (deployed LR + XGBoost ensemble)

| Target | ROC-AUC | PR-AUC | F1 | Sensitivity | Specificity | Accuracy | Balanced acc. | MCC | Brier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CAD | 0.858 (0.741–0.955) | 0.937 (0.883–0.984) | 0.874 (0.800–0.933) | 0.864 (0.750–0.955) | 0.706 (0.471–0.884) | 0.820 (0.721–0.902) | 0.785 (0.669–0.907) | 0.560 (0.345–0.781) | 0.126 (0.078–0.177) |
| LAD | 0.742 (0.611–0.858) | 0.823 (0.738–0.902) | 0.712 (0.600–0.811) | 0.722 (0.583–0.861) | 0.560 (0.360–0.760) | 0.656 (0.541–0.770) | 0.641 (0.519–0.763) | 0.284 (0.039–0.526) | 0.214 (0.151–0.280) |
| LCX | 0.808 (0.683–0.909) | 0.753 (0.618–0.892) | 0.702 (0.586–0.807) | 0.800 (0.640–0.920) | 0.667 (0.500–0.806) | 0.721 (0.607–0.836) | 0.733 (0.619–0.835) | 0.460 (0.246–0.667) | 0.182 (0.144–0.225) |
| RCA | 0.735 (0.593–0.851) | 0.689 (0.546–0.819) | 0.618 (0.537–0.689) | 0.913 (0.783–1.000) | 0.368 (0.211–0.526) | 0.574 (0.475–0.673) | 0.641 (0.544–0.733) | 0.310 (0.103–0.484) | 0.211 (0.196–0.226) |

## Development-set cross-validation (same ensemble, out-of-fold)

| Target | ROC-AUC | PR-AUC | F1 | Sensitivity | Specificity | Accuracy | Brier |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CAD | 0.942 ± 0.034 | 0.975 ± 0.017 | 0.920 ± 0.036 | 0.893 ± 0.053 | 0.883 ± 0.077 | 0.890 ± 0.047 | 0.085 ± 0.029 |
| LAD | 0.872 ± 0.055 | 0.904 ± 0.046 | 0.833 ± 0.047 | 0.840 ± 0.065 | 0.755 ± 0.097 | 0.804 ± 0.055 | 0.143 ± 0.031 |
| LCX | 0.743 ± 0.052 | 0.620 ± 0.074 | 0.641 ± 0.055 | 0.772 ± 0.091 | 0.596 ± 0.088 | 0.664 ± 0.054 | 0.202 ± 0.017 |
| RCA | 0.738 ± 0.064 | 0.612 ± 0.079 | 0.632 ± 0.060 | 0.806 ± 0.102 | 0.554 ± 0.096 | 0.648 ± 0.061 | 0.204 ± 0.020 |

## What the full panel adds over a clinical baseline (test set)

Baseline = logistic regression on age, sex, typical angina, diabetes and hypertension.

| Target | Full model ROC-AUC | Baseline ROC-AUC | Δ ROC-AUC (paired bootstrap 95% CI) |
| --- | --- | --- | --- |
| CAD | 0.858 (0.741–0.955) | 0.823 (0.691–0.941) | +0.035 (-0.023 to +0.100) |
| LAD | 0.742 (0.611–0.858) | 0.736 (0.597–0.862) | +0.006 (-0.077 to +0.092) |
| LCX | 0.808 (0.683–0.909) | 0.805 (0.693–0.903) | +0.003 (-0.074 to +0.074) |
| RCA | 0.735 (0.593–0.851) | 0.746 (0.612–0.860) | -0.011 (-0.122 to +0.096) |

## Cross-validation leaderboard (top 5 by ROC-AUC per target)

**CAD**

| Rank | Model | CV ROC-AUC | CV F1 @ 0.5 | CV Brier |
| --- | --- | --- | --- | --- |
| 1 | LR (lr_l2) + XGBoost margin ensemble, Platt-calibrated | 0.942 ± 0.034 | 0.917 | 0.085 |
| 2 | Random forest | 0.937 ± 0.037 | 0.914 | 0.107 |
| 3 | Logistic regression (L2) | 0.935 ± 0.034 | 0.881 | 0.121 |
| 4 | Extra trees | 0.935 ± 0.039 | 0.919 | 0.097 |
| 5 | XGBoost | 0.931 ± 0.037 | 0.907 | 0.095 |

**LAD**

| Rank | Model | CV ROC-AUC | CV F1 @ 0.5 | CV Brier |
| --- | --- | --- | --- | --- |
| 1 | LR (lr_l1) + XGBoost margin ensemble, Platt-calibrated | 0.872 ± 0.055 | 0.835 | 0.143 |
| 2 | Random forest | 0.866 ± 0.053 | 0.830 | 0.158 |
| 3 | XGBoost | 0.865 ± 0.058 | 0.842 | 0.147 |
| 4 | Logistic regression (L1) | 0.860 ± 0.055 | 0.812 | 0.154 |
| 5 | Logistic regression (elastic net) | 0.856 ± 0.061 | 0.813 | 0.163 |

**LCX**

| Rank | Model | CV ROC-AUC | CV F1 @ 0.5 | CV Brier |
| --- | --- | --- | --- | --- |
| 1 | LR (lr_core) + XGBoost margin ensemble, Platt-calibrated | 0.743 ± 0.052 | 0.525 | 0.202 |
| 2 | Random forest | 0.731 ± 0.056 | 0.419 | 0.207 |
| 3 | Histogram gradient boosting | 0.727 ± 0.058 | 0.519 | 0.224 |
| 4 | Logistic regression (clinical core) | 0.726 ± 0.047 | 0.376 | 0.213 |
| 5 | XGBoost | 0.723 ± 0.058 | 0.511 | 0.218 |

**RCA**

| Rank | Model | CV ROC-AUC | CV F1 @ 0.5 | CV Brier |
| --- | --- | --- | --- | --- |
| 1 | LR (lr_core) + XGBoost margin ensemble, Platt-calibrated | 0.738 ± 0.064 | 0.436 | 0.204 |
| 2 | Logistic regression (clinical core) | 0.733 ± 0.070 | 0.357 | 0.210 |
| 3 | Logistic regression (L2) | 0.725 ± 0.063 | 0.122 | 0.222 |
| 4 | Extra trees | 0.713 ± 0.067 | 0.437 | 0.207 |
| 5 | Logistic regression (L1) | 0.706 ± 0.071 | 0.494 | 0.222 |

## Deployed configuration

| Target | Logistic variant | w (LR) | Platt a, b | Threshold (Youden) | Threshold (F1) | Top-3 features (mean \|SHAP\|) |
| --- | --- | --- | --- | --- | --- | --- |
| CAD | lr_l2 | 0.60 | 1.845, -0.611 | 0.685 | 0.582 | Typical Chest Pain, Age, EF-TTE |
| LAD | lr_l1 | 0.60 | 1.236, 0.098 | 0.525 | 0.450 | Typical Chest Pain, Region RWMA, Age |
| LCX | lr_core | 0.60 | 0.917, 0.048 | 0.356 | 0.295 | Typical Chest Pain, Age, Sex |
| RCA | lr_core | 0.75 | 0.960, 0.025 | 0.330 | 0.306 | Typical Chest Pain, Age, ESR |

## Ablations (development CV, paired folds)

| Variant | Mean Δ ROC-AUC | Adopted |
| --- | --- | --- |
| derived | +0.0015 | no |
| selection | -0.0065 | no |
| chain | +0.0015 | no |

_Generated from `ml/artifacts/metrics.json` (2026-09-30T04:13:46+00:00)._
