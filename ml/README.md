# cardiotwin_ml — prediction pipeline

Predicts **overall coronary artery disease (CAD)** and **vessel-level stenosis (LAD, LCX, RCA)** from routine
clinical data, explains every prediction with **exact SHAP values**, and exports a **portable JSON model** that the
browser evaluates bit-for-bit. Headline results live in [`reports/results.md`](reports/results.md) (generated) and the
[model card](../docs/MODEL_CARD.md).

```
data/raw/*.xlsx ─► preprocess ─► locked split ─► ablations ─► nested-CV leaderboard ─► OOF ensemble/Platt/threshold
                                                                                           │
            docs/figures ◄─ report ◄─ metrics.json ◄─ single test evaluation ◄─ refit on dev ┘
                                         │
      ml/artifacts/{schema,model,metrics,cohort,fixtures}.json + cardiotwin_models.joblib ──► frontend/public/model
```

## Quick start

Prerequisites: Python 3.11, ~1 GB RAM, any CPU (no GPU).

```bash
python -m venv .venv
./.venv/Scripts/python -m pip install -r ml/requirements.txt     # exact versions used for the published artifacts
./.venv/Scripts/python -m pip install -e ml                        # editable install of cardiotwin_ml

./.venv/Scripts/python -m cardiotwin_ml.train                      # full deterministic run -> artifacts, figures, report
./.venv/Scripts/python -m pytest ml/tests -q                       # test-suite (uses the built artifacts)
```

(On macOS/Linux use `.venv/bin/python`.) Useful flags: `--fast` (reduced CV/search/bootstrap smoke run),
`--dev-only` (development-set CV only; never touches the test set), `--out DIR` (write artifacts elsewhere; skips
figures and the frontend mirror), `--jobs N`. Regenerate figures without retraining:
`python -m cardiotwin_ml.report`. Re-download and verify the dataset: `python -m cardiotwin_ml.data`.

## Package layout

| Module | Responsibility |
| --- | --- |
| `data.py` | UCI download, SHA-256 verification, raw loading |
| `config.py` + `configs/*.yaml` | feature registry (`features.yaml`), targets + anatomy (`targets.yaml`), protocol & model zoo (`training.yaml`) |
| `preprocess.py` | encoding normalisation, **leakage guard** (`LEAKAGE_COLUMNS`), derived features, `FeatureEncoder` |
| `splits.py` | locked hold-out split stratified on the joint CAD/LAD/LCX/RCA pattern |
| `models.py` | estimator factories + search spaces (all wrapped in scikit-learn pipelines) |
| `evaluate.py` | repeated stratified CV, nested RandomizedSearchCV, out-of-fold predictions |
| `ablation.py` | derived features / feature selection / classifier-chain ablations (paired, dev only) |
| `ensemble.py` | margin ensemble, Platt calibration, thresholds, deployed `TargetModel` |
| `xgb_trees.py` | float64 XGBoost leaf-sum margins and exact path-dependent TreeSHAP |
| `explain.py` | ensemble SHAP, one-hot aggregation, global importance, beeswarm, library cross-checks |
| `metrics.py` | metrics, stratified bootstrap CIs, ROC/PR/calibration/decision curves |
| `export.py`, `fixtures.py` | artifacts (`schema`, `model`, `cohort`, `fixtures`, joblib) and parity fixtures |
| `inference.py` | `CardioTwinPredictor` used by the FastAPI backend |
| `portable.py` | stdlib-only reference evaluator of `model.json` (spec for the TypeScript engine) |
| `report.py` | figures (`docs/figures`) and `reports/results.md` |
| `train.py` | one-command orchestration |

## Extending

* **New clinical feature** — add an entry to `configs/features.yaml` (key = dataset column, group, type, unit, normal
  range, description). Encoding, schema, portable model, explanations and UI tooltips follow automatically.
* **New derived feature** — add it under `derived:` with an existing `op` (`ratio`, `sum`, `ckd_epi_2021`). It is
  adopted only if the dev-CV ablation shows a gain; explanations report it as its own row with `derived_from`.
* **New target** (e.g. left main) — add an entry to `configs/targets.yaml` (`source_column`, `positive_values`,
  `kind`, `anatomy` node names). Every stage loops over the registry; the source column is automatically a
  leakage column (validated at load).
* **New model** — add a `models:` entry in `configs/training.yaml` (existing `kind`) or one factory in `models.py`;
  it joins the nested-CV leaderboard.

## Validation protocol (summary)

1. **Locked test set** — 20 % (61 patients), seed 42, stratified on the joint CAD/LAD/LCX/RCA pattern (the single
   `0100` patient is merged into `0000`). Scored **once**, after every decision is frozen; only the deployed
   ensemble and the pre-specified clinical baseline are evaluated on it.
2. **Development CV** — repeated stratified 5-fold × 10 per target; the same folds for every model (paired).
   Imputation/scaling live inside pipelines, so they are fitted in-fold.
3. **Nested tuning** — LR (L2, L1, elastic net), SVM, kNN and XGBoost are tuned by `RandomizedSearchCV` on an inner
   stratified 5-fold split inside each outer training fold.
4. **Ablations** — derived features, in-fold selection and a leakage-free classifier chain are compared with the raw
   feature set on identical folds; adopted only if the mean ROC-AUC gain ≥ 0.005.
5. **Deployed model** — `m = w·m_LR + (1−w)·m_XGB`; `w` minimises pooled OOF log-loss after Platt calibration;
   `p = σ(a·m + b)` fitted on OOF margins; threshold = Youden's J on OOF probabilities (F1-optimal reported too).
   Components refitted on the full dev set; **the test set never influences the deployed model**.
6. **Test metrics** — accuracy, precision, recall, specificity, F1, ROC-AUC, PR-AUC, Brier, log-loss, MCC, balanced
   accuracy with 2000× stratified bootstrap 95 % CIs; confusion matrix; ROC (with bootstrap band), PR, reliability
   and decision curves; paired-bootstrap ΔAUC against the clinical baseline.

## Explainability

SHAP values are exact and live in the ensemble's **log-odds space**:

* logistic component — linear SHAP w.r.t. the development-set mean, `φ_j = β_j/σ_j · (x_j − x̄_j)`;
* XGBoost component — path-dependent TreeSHAP (Lundberg et al. 2018, Algorithm 2) with node covers, re-implemented
  in **float64** (`xgb_trees.py`) because XGBoost's own `pred_contribs` accumulates in float32 and misses the 1e-6
  additivity contract by up to ~1e-5. Agreement with `pred_contribs` and with the `shap` library is checked on every
  run (`metrics.json → explainability_checks`, typically ≤ 2e-6 = float32 precision);
* ensemble — `φ = w·φ_LR + (1−w)·φ_XGB`, `base = w·base_LR + (1−w)·base_XGB`, so `base + Σφ = margin` (asserted
  to 1e-6, observed ≈ 1e-15). One-hot columns (`BBB`) are summed back into their raw feature.

## Portable model format

`model.json` (`format = "cardiotwin-portable-model"`, `format_version = "1.0.0"`) contains everything needed to
predict and explain in the browser. Reference implementation: [`src/cardiotwin_ml/portable.py`](src/cardiotwin_ml/portable.py)
(standard library only; port it line by line). `fixtures.json` holds ≥ 30 request/response pairs the port must
reproduce to `|Δp| < 1e-6`, `|Δshap| < 1e-5` (the Python reference achieves < 1e-9).

### Top level

| Field | Type | Meaning |
| --- | --- | --- |
| `format`, `format_version` | string | format identifier / version of this layout |
| `model_version` | string | model release (matches the API `model_version`) |
| `margin_space` | `"log-odds"` | space of every margin, base value and SHAP value |
| `targets` | string[] | target ids in display order (`CAD`, `LAD`, `LCX`, `RCA`) |
| `vessel_targets` | string[] | targets summed into `summary.expected_diseased_vessels`; `highest_risk_vessel` = argmax |
| `features` | object[] | raw API inputs, in encoding order: `{key, type, default, options?, aliases?}` |
| `columns` | string[] | encoded model columns (length *d*); every vector below is indexed by this order |
| `encoding` | object[] | how each raw feature becomes columns (see below) |
| `derived` | object[] | derived columns appended after the encoded raw columns (may be empty) |
| `constants` | object | `ratio_min_denominator`, `ckd_epi_min_creatinine` used by derived ops |
| `attribution` | object[] | contribution rows: `{feature, columns, column_indices, derived_from?}` — SHAP of a row = Σ SHAP of its columns |
| `risk_bands` | object[] | `{id, max}` in ascending order; band = first with `p < max` (else the last) |
| `models` | object | per target id, see *Target model* |

### Input normalisation (`features`)

* Unknown keys → error. Missing or `null` keys → `default` and listed in `imputed` (in `features` order).
* `binary`: accepts `0/1`, `true/false`, and case-insensitive `"1"/"0"`, `"y"/"n"`, `"yes"/"no"`, `"true"/"false"`, `"t"/"f"`.
* `categorical`: case-insensitive match against `options`; `aliases` maps dataset spellings (e.g. `"Fmale" → "Female"`).
* `numeric`: any finite number or numeric string (no clamping — trees extrapolate flat, the logistic part linearly).

### `encoding[]`

| `kind` | Fields | Columns produced |
| --- | --- | --- |
| `numeric` | `feature`, `column` | `float(value)` |
| `binary` | `feature`, `column` | `0.0` / `1.0` |
| `ordinal` | `feature`, `column`, `map` | `map[value]` (e.g. `VHD`: N 0, mild 1, Moderate 2, Severe 3; `Sex`: Female 0, Male 1) |
| `onehot` | `feature`, `categories`, `columns` | one column per category, `1.0` for the matching category |

`derived[]` entries are `{feature, column, op, inputs}` with `op` ∈ `ratio` (`inputs[0] / max(inputs[1], ratio_min_denominator)`),
`sum` (Σ inputs), `ckd_epi_2021` (race-free CKD-EPI 2021 eGFR from creatinine, age, sex — see `portable.derived_value`).

### Target model (`models[target]`)

| Field | Meaning |
| --- | --- |
| `components` | list of margin models; ensemble margin `m = Σ_k weight_k · m_k` (weights sum to 1) |
| `calibration` | `{method: "platt", a, b}` → `p = 1 / (1 + exp(−(a·m + b)))` |
| `threshold` | decision threshold on `p` (Youden's J on out-of-fold dev predictions); `label = p ≥ threshold` |
| `threshold_f1` | F1-optimal alternative threshold (informational) |
| `base_value` | `Σ_k weight_k · components[k].base_value` — the SHAP base value `E[m]` |

**Logistic component** (`type = "logistic"`): `name`, `weight`, `intercept`, `coef[d]`, `scaler.mean[d]`,
`scaler.scale[d]`, `background_mean[d]`, `base_value`.

```
m_LR    = intercept + Σ_j coef[j] · (x[j] − mean[j]) / scale[j]          (sum j = 0..d−1 in order)
φ_LR[j] = (x[j] − background_mean[j]) · (coef[j] / scale[j])
```

**XGBoost component** (`type = "xgboost"`): `name`, `weight`, `objective` (`binary:logistic`), `base_score`
(probability space, as stored by XGBoost 3.x), `n_trees`, `base_value`, `trees[]` in XGBoost JSON-dump form:

| Node field | Meaning |
| --- | --- |
| `nodeid` | node id, unique within the tree (root = 0) |
| `split`, `split_index` | column name / index into `columns` |
| `split_condition` | threshold (a float32 value stored as the exact double) |
| `yes`, `no`, `missing` | child node ids: `x < split_condition` → `yes`, otherwise `no`; NaN → `missing` |
| `cover` | sum of hessians of training rows reaching the node (TreeSHAP weights) |
| `leaf` | leaf value (present only on leaves; already scaled by the learning rate) |
| `children` | nested child nodes (internal nodes only) |

```
compare:  fround(x[split_index]) < fround(split_condition)      // float32, like XGBoost; fround = Math.fround
m_XGB   = log(base_score / (1 − base_score)) + Σ_trees leaf      // float64, trees in order
φ_XGB   = path-dependent TreeSHAP over all trees (portable.xgboost_shap), zero/one fractions from `cover`
```

### Response assembly

For each target: `margin = Σ w_k m_k`, `p = σ(a·margin + b)`, `label`, `risk_band`, `logit = margin`,
`explanations.base_value = Σ w_k base_value_k`, `output_value = margin`, and `contributions` = one row per
`attribution` entry (`{feature, value, shap}` + `derived_from` for derived rows) sorted by `|shap|` descending (ties by
name). Numeric `value`s are emitted as integers when integral. `summary.expected_diseased_vessels = Σ_vessels p`,
`summary.highest_risk_vessel = argmax_vessels p`.

## Artifacts

| File | Consumer | Content |
| --- | --- | --- |
| `schema.json` | backend, frontend | feature metadata (labels, groups, units, ranges, defaults, reference ranges, descriptions), targets + anatomy + thresholds, risk bands |
| `model.json` | frontend edge engine | portable model (above) |
| `metrics.json` | backend, frontend | protocol, dataset, ablations, per-target CV + test metrics with CIs, curves, leaderboard, SHAP importance and beeswarm, checks |
| `cohort.json` | backend, frontend | all 61 test patients (unseen by the model) + 20 dev demo patients with ground truth |
| `fixtures.json` | parity tests | request → expected response pairs, with encoded vectors |
| `cardiotwin_models.joblib` | backend | native scikit-learn / XGBoost models (weights deliverable) |

All JSON artifacts are deterministic; a rerun changes only `metrics.json → generated_at`.
