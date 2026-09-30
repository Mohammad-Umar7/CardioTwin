# Datasheet — Extension of Z-Alizadeh Sani dataset

| | |
| --- | --- |
| **Name** | Extension of Z-Alizadeh Sani dataset (UCI Machine Learning Repository, id **411**) |
| **Creators** | Roohallah Alizadehsani, Mohamad Roshanzamir, Zahra Sani (Rajaie Cardiovascular Medical and Research Center, Tehran) |
| **Source page** | https://archive.ics.uci.edu/dataset/411/extention+of+z+alizadeh+sani+dataset |
| **Download** | https://archive.ics.uci.edu/static/public/411/extention+of+z+alizadeh+sani+dataset.zip |
| **DOI** | [10.24432/C5461K](https://doi.org/10.24432/C5461K) |
| **Licence** | Creative Commons Attribution 4.0 International (CC BY 4.0) |
| **File in this repo** | `data/raw/extention of Z-Alizadeh sani dataset.xlsx` (sheet `Sheet 1 - Table 1`; the second sheet is empty) |
| **SHA-256** | `739343245c2ba578b541370217531750d8e936022f928b83e0d91756caa3ff0b` (131 137 bytes) |
| **Size** | 303 patients × 59 columns (55 candidate inputs + 4 angiography labels), no missing values |

**Citation.** Alizadehsani R., Roshanzamir M., Sani Z. (2013). *Extension of Z-Alizadeh Sani dataset* [Dataset].
UCI Machine Learning Repository. https://doi.org/10.24432/C5461K. Feature definitions follow Alizadehsani R. *et al.*,
"A data mining approach for diagnosis of coronary artery disease", *Computer Methods and Programs in Biomedicine*
2013;111(1):52–61.

## Reproducible acquisition

The spreadsheet is committed (131 KB) so every run is offline and bit-identical. To re-fetch and verify it:

```bash
./.venv/Scripts/python -m cardiotwin_ml.data      # downloads only if missing; always checks SHA-256
```

`cardiotwin_ml.data` refuses to continue if the spreadsheet digest or its 303 × 59 shape ever changes.

## Collection & labels

* **Population.** 303 consecutive adults referred for **invasive coronary angiography** at a single tertiary centre in
  Tehran, Iran. This is a *referred, symptomatic* population (CAD prevalence 71 %), not a screening population.
* **Label definition.** A vessel is `Stenotic` when angiography shows ≥ 50 % diameter narrowing. `Cath = CAD` when at
  least one of LAD, LCX, RCA is stenotic, otherwise `Normal`.
* **Label counts.** `Cath`: CAD 216 / Normal 87 · `LAD` stenotic 177 · `LCX` stenotic 119 · `RCA` stenotic 114.
* **Known inconsistency.** `Cath = CAD` ⇔ ≥ 1 stenotic vessel holds for 302 / 303 patients; one patient
  (spreadsheet row 95, 0-based index 93) is `Cath = Normal` with a stenotic LAD. Labels are used exactly as published.
* **Joint label patterns** (CAD, LAD, LCX, RCA): `0000` 86 · `1111` 63 · `1100` 56 · `1110` 33 · `1101` 24 ·
  `1001` 17 · `1010` 13 · `1011` 10 · `0100` 1.

## Target leakage

`LAD`, `LCX`, `RCA` and `Cath` are all angiography results. The UCI page states that only one of them may be kept
for classification. CardioTwin **never** uses any of the four as a model input
(`cardiotwin_ml.preprocess.LEAKAGE_COLUMNS`, guarded by a runtime assertion and `ml/tests/test_leakage.py`).

## Encoding quirks handled by `cardiotwin_ml.preprocess`

* Binary columns mix `"Y"/"N"` strings and `0/1` integers → normalised to integers `0/1`.
* `Sex` uses the typo `Fmale` → mapped to `Female`.
* `BBB` ∈ {`N`, `LBBB`, `RBBB`} → one-hot. `VHD` ∈ {`N`, `mild`, `Moderate`, `Severe`} → ordinal 0–3.
* `Exertional CP` is `N` for all 303 patients → dropped automatically as a constant column (logged).
* `Obesity` is defined by the authors as BMI > 25 (it agrees with BMI for 302 / 303 patients).

## Column dictionary

Units follow the source paper's feature table, corrected to conventional clinical notation where the paper's notation
is ambiguous (noted). "Values" are observed ranges (median) or category counts in the 303 patients. Full
plain-English descriptions and clinical reference ranges live in [`ml/configs/features.yaml`](../ml/configs/features.yaml).

| Column | Meaning | Group | Raw encoding | Unit | Values |
| --- | --- | --- | --- | --- | --- |
| `Age` | Age | demographics | integer | years | 30 – 86 (58) |
| `Weight` | Body weight | demographics | integer | kg | 48 – 120 (74) |
| `Length` | Height | demographics | integer | cm | 140 – 188 (165) |
| `Sex` | Sex | demographics | `Male` / `Fmale` | — | Male 176, Female 127 |
| `BMI` | Body-mass index (= weight / height², exact) | demographics | real | kg/m² | 18.1 – 40.9 (26.8) |
| `DM` | Diabetes mellitus | risk factors | 0/1 | — | 90 yes |
| `HTN` | Hypertension | risk factors | 0/1 | — | 179 yes |
| `Current Smoker` | Current smoker | risk factors | 0/1 | — | 63 yes |
| `EX-Smoker` | Former smoker | risk factors | 0/1 | — | 10 yes |
| `FH` | Family history of heart disease | risk factors | 0/1 | — | 48 yes |
| `Obesity` | BMI > 25 flag | risk factors | Y/N | — | 211 yes |
| `CRF` | Chronic renal failure | risk factors | Y/N | — | 6 yes |
| `CVA` | Cerebrovascular accident (stroke) | risk factors | Y/N | — | 5 yes |
| `Airway disease` | Chronic airway disease | risk factors | Y/N | — | 11 yes |
| `Thyroid Disease` | Thyroid disease | risk factors | Y/N | — | 7 yes |
| `CHF` | Congestive heart failure | risk factors | Y/N | — | 1 yes |
| `DLP` | Dyslipidaemia | risk factors | Y/N | — | 112 yes |
| `BP` | Blood pressure (single value; most likely systolic — not specified by the source) | exam | integer | mmHg | 90 – 190 (130) |
| `PR` | Pulse rate (paper: "ppm") | exam | integer | beats/min | 50 – 110 (70) |
| `Edema` | Peripheral oedema | exam | 0/1 | — | 12 yes |
| `Weak Peripheral Pulse` | Weak peripheral pulse | exam | Y/N | — | 5 yes |
| `Lung rales` | Pulmonary rales | exam | Y/N | — | 11 yes |
| `Systolic Murmur` | Systolic murmur | exam | Y/N | — | 41 yes |
| `Diastolic Murmur` | Diastolic murmur | exam | Y/N | — | 9 yes |
| `Typical Chest Pain` | Typical angina | symptoms | 0/1 | — | 164 yes |
| `Dyspnea` | Dyspnoea | symptoms | Y/N | — | 134 yes |
| `Function Class` | Functional class (paper: 1–4; scale NYHA vs CCS not stated; 0 = none recorded) | symptoms | integer | class | 0: 211, 1: 1, 2: 73, 3: 18 |
| `Atypical` | Atypical angina | symptoms | Y/N | — | 93 yes |
| `Nonanginal` | Non-anginal chest pain | symptoms | Y/N | — | 16 yes |
| `Exertional CP` | Exertional chest pain | symptoms | Y/N | — | 0 yes (constant → dropped) |
| `LowTH Ang` | Low-threshold angina | symptoms | Y/N | — | 2 yes |
| `Q Wave` | Pathological Q waves | ECG | 0/1 | — | 16 yes |
| `St Elevation` | ST-segment elevation | ECG | 0/1 | — | 14 yes |
| `St Depression` | ST-segment depression | ECG | 0/1 | — | 71 yes |
| `Tinversion` | T-wave inversion | ECG | 0/1 | — | 90 yes |
| `LVH` | Left ventricular hypertrophy | ECG | Y/N | — | 20 yes |
| `Poor R Progression` | Poor R-wave progression | ECG | Y/N | — | 9 yes |
| `BBB` | Bundle branch block | ECG | `N`/`LBBB`/`RBBB` | — | N 282, LBBB 13, RBBB 8 |
| `FBS` | Fasting blood sugar | labs | integer | mg/dL | 62 – 400 (98) |
| `CR` | Serum creatinine | labs | real | mg/dL | 0.5 – 2.2 (1.0) |
| `TG` | Triglycerides | labs | integer | mg/dL | 37 – 1050 (122) |
| `LDL` | LDL cholesterol | labs | integer | mg/dL | 18 – 232 (100) |
| `HDL` | HDL cholesterol | labs | real | mg/dL | 15.9 – 111 (39) |
| `BUN` | Blood urea nitrogen | labs | integer | mg/dL | 6 – 52 (16) |
| `ESR` | Erythrocyte sedimentation rate | labs | integer | mm/h | 1 – 90 (15) |
| `HB` | Haemoglobin | labs | real | g/dL | 8.9 – 17.6 (13.2) |
| `K` | Potassium | labs | real | mEq/L | 3.0 – 6.6 (4.2) |
| `Na` | Sodium | labs | integer | mEq/L | 128 – 156 (141) |
| `WBC` | White blood cell count (paper: "cells/ml"; values are per µL) | labs | integer | cells/µL | 3 700 – 18 000 (7 100) |
| `Lymph` | Lymphocytes | labs | integer | % of WBC | 7 – 60 (32) |
| `Neut` | Neutrophils | labs | integer | % of WBC | 32 – 89 (60) |
| `PLT` | Platelet count (paper: "1000/ml"; values are ×10³/µL) | labs | integer | ×10³/µL | 25 – 742 (210) |
| `EF-TTE` | LV ejection fraction, transthoracic echo | echo | integer | % | 15 – 60 (50) |
| `Region RWMA` | Regional wall-motion abnormality (coded 0–4; coding not documented; **not** a lesion map) | echo | integer | regions | 0: 217, 1: 26, 2: 32, 3: 14, 4: 14 |
| `VHD` | Valvular heart disease severity | echo | `N`/`mild`/`Moderate`/`Severe` | — | N 116, mild 149, Moderate 27, Severe 11 |
| `LAD` | **Label** — left anterior descending stenosis | label | `Stenotic`/`Normal` | — | 177 stenotic |
| `LCX` | **Label** — left circumflex stenosis | label | `Stenotic`/`Normal` | — | 119 stenotic |
| `RCA` | **Label** — right coronary artery stenosis | label | `Stenotic`/`Normal` | — | 114 stenotic |
| `Cath` | **Label** — angiography result | label | `CAD`/`Normal` | — | 216 CAD |

## Limitations

Single centre, single country, angiography-referred patients (strong selection bias); modest size (303); several
binary findings are very rare (e.g. `CHF` = 1 patient, `LowTH Ang` = 2), so their learned effects are unreliable;
some coding (functional-class scale, `Region RWMA`, blood-pressure component) is not documented by the authors.
