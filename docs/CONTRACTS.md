# CardioTwin — Interface Contracts

This document is the single source of truth for how the four subsystems of CardioTwin talk to each other:

```
 data/ ──► ml/ (training, evaluation, explainability) ──► artifacts ──┬──► backend/ (FastAPI)  ──► REST ──┐
                                                                      └──► frontend/public/model (edge) ──┤
 anatomy/ (BodyParts3D → Blender → glTF) ──► frontend/public/anatomy ─────────────────────────────────────┴──► frontend/ (React + R3F)
```

Every contract below is versioned. A subsystem may **add** fields; it must never rename or remove a field
without bumping the contract version and updating every consumer.

---

## 0. Global conventions

| Item | Convention |
| --- | --- |
| Targets | `CAD`, `LAD`, `LCX`, `RCA` (always this order in UIs and arrays) |
| Positive class | `CAD` ⇐ `Cath == "Cad"/"CAD"`; `LAD/LCX/RCA` ⇐ `"Stenotic"` |
| Leakage rule | `LAD`, `LCX`, `RCA`, `Cath` are **never** model inputs (enforced by a unit test) |
| Raw feature keys | Exact dataset column names (`"Typical Chest Pain"`, `"EF-TTE"`, `"Region RWMA"`, …) |
| Binary values | Always `0` / `1` at the API boundary (the dataset mixes `Y/N` and `0/1`; the ML preprocessing normalises) |
| Categorical values | Strings from the schema `options` list (e.g. `Sex ∈ {"Male","Female"}`, `BBB ∈ {"N","LBBB","RBBB"}`, `VHD ∈ {"N","mild","Moderate","Severe"}`) |
| Probabilities | Calibrated, in `[0,1]` |
| SHAP space | **log-odds (margin) space of the uncalibrated ensemble**; `base_value + Σ shap = output_value` must hold to 1e-6 |
| Risk bands | `low < 0.25 ≤ moderate < 0.50 ≤ high < 0.75 ≤ critical` |

---

## 1. ML artifacts (`ml/artifacts/`, mirrored to `frontend/public/model/`)

| File | Producer | Consumers | Purpose |
| --- | --- | --- | --- |
| `schema.json` | ml | backend, frontend | Feature metadata (see §2) |
| `model.json` | ml | frontend edge engine | Portable model: encoders + LR + XGBoost trees + calibration + thresholds (see §5) |
| `metrics.json` | ml | backend, frontend | Full evaluation report (see §4) |
| `cohort.json` | ml | backend, frontend | Demo patients with ground truth (see §3.3) |
| `fixtures.json` | ml | frontend tests, backend tests | 25+ `{features, expected}` pairs for cross-engine parity |
| `cardiotwin_models.joblib` | ml | backend | Native Python models (weights deliverable) |

The Python package exposes the in-process predictor used by the backend:

```python
from cardiotwin_ml.inference import CardioTwinPredictor
p = CardioTwinPredictor.load("ml/artifacts")   # loads joblib + schema
p.schema            -> dict                      # §2
p.predict(features: dict) -> dict                # §3.2 response body, engine="server"
p.metrics           -> dict                      # §4
p.cohort            -> dict                      # §3.3
p.version           -> str
```

---

## 2. Feature schema (`schema.json`, `GET /api/schema`)

```jsonc
{
  "version": "1.0.0",
  "groups": [ { "id": "demographics", "label": "Demographics", "order": 1, "icon": "user" } ],
  "features": [
    {
      "key": "Age",                 // raw dataset column
      "label": "Age",
      "group": "demographics",      // demographics | risk_factors | symptoms | exam | ecg | labs | echo
      "type": "numeric",            // numeric | binary | categorical
      "unit": "years",
      "min": 30, "max": 86, "step": 1,
      "default": 58,                // cohort median / mode
      "normal": { "low": null, "high": null },   // clinical reference range, null if n/a
      "description": "Plain-English explanation shown in tooltips.",
      "options": null               // categorical: [{ "value": "LBBB", "label": "Left bundle branch block" }]
    }
  ],
  "targets": [
    { "id": "CAD", "label": "Coronary artery disease", "short": "CAD",
      "anatomy": ["heart"], "description": "…" },
    { "id": "LAD", "label": "Left anterior descending artery", "short": "LAD",
      "anatomy": ["Coronary_LAD", "Coronary_LAD_Septal"],
      "territory": "Anterior wall, anterior septum, apex" }
  ],
  "risk_bands": [ { "id": "low", "max": 0.25 }, { "id": "moderate", "max": 0.5 },
                  { "id": "high", "max": 0.75 }, { "id": "critical", "max": 1.0 } ]
}
```

---

## 3. REST API (`backend/`, base path `/api`)

### 3.1 `GET /api/health`
`{ "status": "ok", "model_version": "1.0.0", "targets": ["CAD","LAD","LCX","RCA"], "engine": "server" }`

### 3.2 `POST /api/predict`
Request: `{ "features": { "<raw key>": <value>, … } }` — missing keys are filled with schema `default`
and reported back in `imputed`.

Response:
```jsonc
{
  "model_version": "1.0.0",
  "engine": "server",                      // "server" | "edge" (browser)
  "imputed": ["ESR"],
  "predictions": {
    "CAD": { "probability": 0.87, "label": 1, "threshold": 0.46, "risk_band": "critical",
             "logit": 1.93 }               // logit = uncalibrated ensemble margin
    /* LAD, LCX, RCA identical shape */
  },
  "explanations": {
    "CAD": {
      "space": "log-odds",
      "base_value": 0.52,                  // E[f(x)] in margin space
      "output_value": 1.93,                // == predictions.CAD.logit
      "contributions": [                   // one per RAW feature (one-hot columns summed), sorted by |shap| desc
        { "feature": "Typical Chest Pain", "value": 1, "shap": 0.94 }
      ]
    }
  },
  "summary": { "expected_diseased_vessels": 1.72, "highest_risk_vessel": "LAD" }
}
```

### 3.3 `GET /api/cohort`
```jsonc
{ "patients": [ { "id": "P-017", "split": "test",            // test | dev
                  "summary": "62 y · Male · typical angina · DM",
                  "features": { /* raw, API-normalised */ },
                  "labels": { "CAD": 1, "LAD": 1, "LCX": 0, "RCA": 1 } } ] }
```

### 3.4 `GET /api/metrics` → §4 · `GET /api/schema` → §2 · `GET /api/model-card` → markdown string

---

## 4. Evaluation report (`metrics.json`)

```jsonc
{
  "version": "1.0.0",
  "generated_at": "ISO-8601",
  "dataset": { "name": "Extension of Z-Alizadeh Sani", "n": 303, "n_dev": 242, "n_test": 61,
               "prevalence": { "CAD": 0.713, "LAD": 0.584, "LCX": 0.393, "RCA": 0.376 } },
  "protocol": { "holdout": "…", "cv": "…", "tuning": "…", "calibration": "…", "threshold": "…", "seed": 42 },
  "targets": {
    "CAD": {
      "selected_model": "LR+XGB margin ensemble (Platt-calibrated)",
      "cv":   { "roc_auc": { "mean": 0.93, "std": 0.03 }, "f1": {…}, "accuracy": {…}, "precision": {…}, "recall": {…} },
      "test": { "roc_auc": { "value": 0.94, "ci": [0.88, 0.98] }, "accuracy": {…}, "precision": {…},
                "recall": {…}, "specificity": {…}, "f1": {…}, "pr_auc": {…}, "brier": {…}, "mcc": {…} },
      "threshold": 0.46,
      "confusion_matrix": { "tn": 14, "fp": 3, "fn": 2, "tp": 42 },
      "curves": {
        "roc": { "fpr": [], "tpr": [] },
        "pr":  { "recall": [], "precision": [] },
        "calibration": { "mean_predicted": [], "fraction_positive": [], "count": [] },
        "dca": { "thresholds": [], "model": [], "treat_all": [], "treat_none": [] }
      },
      "leaderboard": [ { "model": "xgboost", "roc_auc_mean": 0.92, "roc_auc_std": 0.03, "f1_mean": 0.88 } ],
      "global_importance": [ { "feature": "Typical Chest Pain", "mean_abs_shap": 1.21 } ],
      "beeswarm": [ { "feature": "Age", "points": [ { "v": 0.43, "s": -0.12 } ] } ]   // v = min-max-normalised value
    }
  }
}
```

---

## 5. Portable model (`model.json`) — edge inference

Owned by `ml/`; the exact field layout is documented in `ml/README.md#portable-model-format`
once written. Required semantics:

* `columns` — ordered list of encoded model columns.
* `encoding` — per raw feature: `numeric` (identity), `binary` (0/1), `onehot` (`categories` → `columns`), `ordinal` (`map`).
* Per target: `components` (margin-space ensemble; `logistic` with scaler + coef + intercept + background mean;
  `xgboost` with trees in XGBoost JSON-dump form **including `cover`** so TreeSHAP can be reproduced),
  component `weight`s, `calibration` (`platt`: `p = 1/(1+exp(-(a·m + b)))`), `threshold`, `base_value`.
* The browser engine must reproduce `fixtures.json` to |Δp| < 1e-6 and |Δshap| < 1e-5.

---

## 6. Anatomy assets (`frontend/public/anatomy/`)

### 6.1 Scene conventions
* **Units:** 1 scene unit = 10 cm. **Origin:** centre of the heart-wall bounding box.
* **Axes:** `+Y` superior (head), `+Z` anterior (patient faces the default camera), `+X` patient's **left**
  (i.e. radiological display: patient-left appears on viewer-right).

### 6.2 `cardiotwin_anatomy.glb` node names

| Layer group | Nodes |
| --- | --- |
| `Layer_Skin` | `Skin_Torso` |
| `Layer_Muscle` | `Pectoralis_L`, `Pectoralis_R` |
| `Layer_Skeleton` | `Ribs_L`, `Ribs_R`, `CostalCartilage`, `Sternum`, `Clavicle_L`, `Clavicle_R`, `Spine_Thoracic` |
| `Layer_Lungs` | `Lung_L`, `Lung_R`, `Trachea_Bronchi` |
| `Layer_Diaphragm` | `Diaphragm` |
| `Layer_Heart` | `Heart_Wall_Anterior`, `Heart_Wall_Posterior`, `Valve_Mitral`, `Valve_Tricuspid`, `Valve_Pulmonary`, `Papillary_Muscles`, `GreatVessel_Aorta`, `GreatVessel_PulmonaryArtery`, `GreatVessel_PulmonaryVeins`, `GreatVessel_SVC`, `GreatVessel_IVC`, `CardiacVeins` |
| `Layer_Coronary` | `Coronary_LM`, `Coronary_LAD`, `Coronary_LAD_Septal`, `Coronary_LCX`, `Coronary_RCA`, `Coronary_RCA_Marginal`, `Coronary_RCA_PDA`, `Coronary_RCA_PL`, `Coronary_RCA_Septal` |

Heart-wall meshes carry `COLOR_0` = perfusion-territory weights `(R=LAD, G=LCX, B=RCA)` derived from
geodesic/Euclidean proximity to the coronary tree (documented approximation, **not** a lesion map).

### 6.3 `manifest.json`
```jsonc
{
  "version": "1.0.0",
  "glb": "cardiotwin_anatomy.glb",
  "credits": "BodyParts3D, © The Database Center for Life Science, licensed under CC BY-SA 2.1 Japan",
  "layers": [ { "id": "skin", "node": "Layer_Skin", "label": "Skin", "explode": [0, 0, 2.2], "order": 0 } ],
  "structures": [
    { "id": "lad", "node": "Coronary_LAD", "label": "Left Anterior Descending", "layer": "coronary",
      "target": "LAD", "explode": [0.1, 0, 0.35], "description": "…", "territory": "…" }
  ],
  "camera": { "home": { "position": [0, 0.3, 6], "target": [0, 0, 0] },
              "focus": { "lad": { "position": [], "target": [] } } }
}
```

### 6.4 `vessels.json` (centrelines for blood-flow particles)
```jsonc
{ "version": "1.0.0", "units": "scene",
  "vessels": [ { "id": "LAD", "target": "LAD", "node": "Coronary_LAD",
                 "segments": [ { "points": [[x,y,z], …], "radius": [r, …] } ] } ] }
```
Points are ordered **proximal → distal** (direction of blood flow).

---

## 7. Contract v1.1 additions (additive — every field optional for consumers)

### 7.1 Anatomy realism & precise anatomy
* **Baked realism.** Any GLB mesh MAY carry `TEXCOORD_0` plus glTF PBR textures (`baseColorTexture`,
  `normalTexture`, `metallicRoughnessTexture`, `occlusionTexture`; WebP inside the GLB). The web app's
  **Realistic** view mode uses them; the **Clinical** (achromatic "clay") mode ignores them. `COLOR_0`
  (territory weights) is always preserved on the heart walls. GLB size budget rises to **≤ 16 MB**.
* **SCCT coronary segments.** Coronary meshes carry a scalar vertex attribute **`_SEGMENT`**
  (three.js exposes it as `geometry.attributes._segment`); value = SCCT segment number (1–18), `0` = unassigned.
  Risk remains **vessel-level** — segments are anatomical labels for inspection, never lesion locations.
* `manifest.json` gains:
  ```jsonc
  "segments": [ { "scct": 7, "code": "mLAD", "name": "Mid LAD", "vessel": "LAD", "target": "LAD",
                  "node": "Coronary_LAD", "definition": "From D1 (or first septal) to D2 / half-way to the apex",
                  "source": "SCCT 2014 (Leipsic et al.)" } ]
  ```
  and every `structures[]` item may add `fma_id`, `definition` (precise anatomical definition),
  `clinical_relevance`, and for veins `accompanies` (artery structure ids, e.g. `["lad","lcx"]`).
* `vessels.json` segments may add `scct` (number) and `code` (e.g. `"pLAD"`).

### 7.2 ML evaluation extras (`metrics.json`)
Top-level additive keys: `robustness` (Monte-Carlo repeated hold-out distribution of the frozen recipe per
target: `{ "n_splits", "roc_auc": {"mean","sd","p05","p50","p95"}, "f1": {…}, "fixed_split_percentile" }`),
`modality_ablation` (per target, CV ROC-AUC when using cumulative feature groups
demographics → +risk_factors → +symptoms → +exam → +ecg → +labs → +echo, and leave-one-group-out),
`subgroups` (per target, test/OOF metrics by sex, age band, diabetes).

### 7.3 Calibrated-space explanations (ml v1.1.0, additive to §3.2)
Each `explanations.<target>` object also carries `calibrated_base_value`, `calibrated_output_value`
(== `predictions.<target>.probability`) and, per contribution, `shap_calibrated` — attributions rescaled so that
`calibrated_base_value + Σ shap_calibrated == probability` exactly. The log-odds fields remain the primary SHAP
values; the calibrated fields let the UI speak in percentage points. The edge engine must reproduce them.
