# CardioTwin: Devpost project story

**Tagline (≤ 200 characters):** An explainable coronary digital twin that predicts CAD and LAD, LCX and RCA stenosis
from routine clinical data and paints each vessel's risk onto an interactive 3D heart.

**Track:** A, Cardiovascular Risk Visualization & Prediction · **Team:** Mohammad Umar (solo;
[@Mohammad-Umar7](https://github.com/Mohammad-Umar7))

**Links:** code at [github.com/Mohammad-Umar7/CardioTwin](https://github.com/Mohammad-Umar7/CardioTwin) ·
demo video at `<YouTube link>` · [six-page technical report](TECHNICAL_REPORT.pdf)

<!-- SCREENSHOT: workstation → docs/media/screenshots/workstation.png (Devpost cover image; 3:2 crop of the workstation with LAD selected) -->

## The five numbers

| | |
| --- | --- |
| **0.858** (95 % CI 0.743–0.955) | CAD ROC-AUC on 61 patients the model never saw, with F1 0.871 and precision 0.902 |
| **0.934** | Median CAD ROC-AUC over 200 random re-splits with the whole recipe re-run (LAD 0.844). The locked test split was among the hardest 3 % |
| **+0.069** (95 % CI +0.024 to +0.115) | LAD ROC-AUC gained by adding ECG, labs and echo to bedside data |
| **2.2e-16** | Largest probability difference between the Python server and the in-browser engine, with identical SHAP values. The browser answers in 1.2 ms (p50) |
| **44 / 70** | Cited anatomical reference checks the 3D heart passes (up from 35 at baseline), across 41 structures and 18 SCCT coronary segments |

## Inspiration

Patients sent for coronary angiography already come with a history, an ECG, blood tests and an echo. Yet the numbers
clinicians get from them are whole-heart scores. The scores say nothing about *which* artery is likely narrowed, and
nothing about *why*. In the public cohort I worked with, every one of the 303 patients was referred for an invasive
angiogram, and 29 % of them turned out to have no significant stenosis.

I wanted a tool that answers three questions at a glance: how likely is disease, in which vessel, and what in this
patient's record drives it? It had to be honest about uncertainty, and it had to run on an ordinary laptop.

## What it does

- **Predicts four targets** from 53 routine inputs (demographics, history, symptoms, examination, ECG, labs, echo):
  overall CAD and ≥ 50 % stenosis of the LAD, LCX and RCA. The angiography columns are never inputs.
- **Explains every estimate exactly.** Each input's signed contribution is shown in percentage points, grouped by
  modality, with its reference range in a physiology view.
- **Maps risk onto real anatomy.** A 3D thorax and heart built from BodyParts3D colours each artery by its own
  probability. You can rotate, zoom and use C-arm projections. Selecting the LAD flies the camera to its angiographic
  best view and opens a vessel inspector. The heart can be peeled open, beats at the patient's pulse rate, shows blood
  flow along real centrelines, and tints each artery's perfusion territory.
- **What-if in real time.** Edit any input and all four probabilities, the explanations and the 3D colours update
  together. ICE strips show how the risk moves across an input's range.
- **Checks itself.** For the 61 unseen test patients you can reveal the actual angiogram result. A performance page
  shows every metric with its confidence interval, plus calibration, decision curves, robustness and subgroups.
- **Stays safe.** A clinical-safety disclaimer is always on screen and printed on the two-page report. Out-of-range
  inputs are refused rather than extrapolated.

## How I built it

- **ML (Python, scikit-learn, XGBoost).**
  - A 20 % test split was locked before any modelling. Eleven model families were compared with repeated, nested
    cross-validation tuned on log-loss.
  - Each target uses a margin ensemble of logistic regression and XGBoost with Platt calibration and a Youden
    threshold, all fitted on out-of-fold predictions.
  - The ensemble's CV estimate is cross-fitted, so no reported number helped choose the model it scores.
  - A separate analysis re-runs the whole recipe on 200 random splits and ablates each clinical modality with
    corrected-t intervals.
- **Exact explainability.**
  - Linear SHAP for the logistic part and my own float64 TreeSHAP for XGBoost, whose float32 output was not additive
    enough. The two combine linearly, and base + Σ SHAP equals the model output to 1.8e-15.
  - A calibrated-space copy of the SHAP values lets the UI speak in percentage points.
- **Portable model.**
  - The trained model is exported as one JSON file.
  - A line-by-line TypeScript port evaluates it in a Web Worker, mirroring XGBoost's float32 split comparisons.
  - The FastAPI server and the browser therefore agree to the last bit, and the app still works with no backend
    (the GitHub Pages build).
- **3D anatomy (Blender 5.1, headless, fully scripted).**
  - BodyParts3D meshes are cleaned, smoothed, decimated, and bisected so the heart can be opened.
  - Missing structures (aortic root and valve, epicardial fat, in-vivo vein calibres) are synthesised.
  - Perfusion territories are baked into vertex colours, blended with the AHA 17-segment map.
  - Coronary centrelines are extracted and labelled with SCCT 2014 segments, and the result is exported as a
    meshopt-compressed glTF.
- **Web app (React, TypeScript, React Three Fiber).**
  - One persistent WebGL canvas and a single risk colour ramp shared by shaders, charts and legend.
  - Adaptive quality tiers keep the app responsive on integrated GPUs, with a 2D fallback when WebGL is unavailable.
- **Engineering.**
  - One command starts everything (`dev.ps1` / `make`), and one process can serve app and API on one URL.
  - Docker with a hardened compose file.
  - CI covers all four subsystems, with byte-identical retraining, an end-to-end check against the running server
    and container, and a clean-checkout run on Windows and Linux.

## Challenges I ran into

- **The test set disagreed with cross-validation.** CAD and LAD scored 0.08–0.13 ROC-AUC lower on the locked test set
  than in CV. Rather than tune until it looked better, I re-ran the full recipe on 200 random splits. The locked
  split turned out to sit at the 3rd percentile for CAD and the 2nd for LAD, and the clinical baseline dropped on it
  too. The gap came from a hard split, not from overfitting, and I report both numbers.
- **A calibration bug found in review.** An independent review of v1.0 found that Platt scaling had been fitted on
  margins from differently tuned fold models. The fix was specified on development data only, the test set was scored
  exactly once more, and the change log is public in the model card.
- **Bit-exact parity across two languages.** XGBoost compares features in float32. One wrong rounding misroutes a
  patient at a split threshold. I built a bit-level oracle and probed all 444 thresholds (4,130 probes) until every
  one routed the same way in TypeScript and Python.
- **Anatomy that is actually right.** BodyParts3D comes from one cadaver: the veins are collapsed, and there is no
  aortic valve or root. I compiled a cited anatomical reference, turned it into 70 automated checks, and closed gaps
  one by one. Some checks still fail, and I list them.

## Accomplishments that I'm proud of

- Every number in the app, the README and the report comes from a generated artifact, and every test metric has a
  95 % CI.
- The same model gives the same answer to 2.2e-16 on a server and in a browser, with explanations that add up exactly.
- A 3D heart where the colour of the LAD can only ever show P(LAD). One registry drives the model, the API and the
  3D mapping, and the end-to-end check fails if they diverge.
- Honest reporting: the model does not significantly beat a 5-feature clinical baseline on the small test set, and
  the project says so.

## What I learned

- A single 61-patient test split is a noisy judge. Repeated re-splits are cheap insurance against both over- and
  under-claiming.
- Proper scoring rules matter for tuning. Tuning on ROC-AUC drove regularisation to the edge of its range, and
  log-loss did not.
- "Explainable" is only useful when the explanation is exact and uses the clinician's units (percentage points, with
  reference ranges), not raw log-odds.
- For medical 3D, anatomical correctness needs a written, cited reference and automated checks, just like model
  metrics.

## What's next

- External, multi-centre validation with recalibration to local prevalence, and decision thresholds set by the
  clinical costs of each setting.
- Imaging inputs (CT coronary angiography, perfusion) to move from vessel-level to lesion-level targets.
- Closing the remaining anatomical checks: the circumflex course, the aortic root down to the annulus, and territory
  shares.
- A FHIR import, so a real (de-identified) record can be opened in the workstation.

## Built with

`python` · `scikit-learn` · `xgboost` · `numpy` · `pandas` · `shap` (cross-checks) · `fastapi` · `pydantic` ·
`uvicorn` · `typescript` · `react` · `vite` · `three.js` · `react-three-fiber` · `zustand` · `d3` · `tailwindcss` ·
`web-workers` · `blender` · `gltf` · `meshoptimizer` · `bodyparts3d` · `docker` · `github-actions`

**Data and anatomy.** UCI *Extension of Z-Alizadeh Sani* dataset (CC BY 4.0, doi:10.24432/C5461K) · BodyParts3D,
© The Database Center for Life Science (CC BY-SA 2.1 JP). The code is MIT-licensed.

> **Clinical safety.** Research and educational decision support only. Not a diagnosis, and not a substitute for
> angiography, CT coronary angiography or clinical judgement.
