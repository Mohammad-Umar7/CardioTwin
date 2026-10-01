# CardioTwin: demo video script

**Target length:** 5:30–5:50 (the Devpost limit is 3–10 min) · **Language:** English narration with English
subtitles · **Viewport:** 1440 × 900 · **Demo patient:** `P-003`, a test patient the model never saw.

Why P-003: a 54-year-old man with typical angina who smokes. The model calls very high CAD risk, flags the LAD, and
leaves the LCX and RCA moderate but unflagged. The angiogram agrees on all four. Expected values, from the committed
`model.json` (confirm them on screen before recording):

| Target | Probability | Deployed threshold | Verdict | Angiogram |
| --- | --- | --- | --- | --- |
| CAD | ≈ 98 % (very high) | 0.747 | flagged | CAD |
| LAD | ≈ 91 % (very high) | 0.551 | flagged | stenotic |
| LCX | ≈ 33 % (moderate) | 0.327 | not flagged | normal |
| RCA | ≈ 31 % (moderate) | 0.318 | not flagged | normal |

What-if used in the video: turning *typical chest pain* off gives CAD ≈ 72 % (just below its threshold),
LAD ≈ 58 %, LCX ≈ 15 % and RCA ≈ 14 %. The top LAD drivers, largest first, are the regional wall-motion
abnormality on echo and typical angina (both raise the risk), a normal ESR (lowers it) and a reduced ejection
fraction of 40 % (raises it).

LCX is a hair below its threshold (32.64 % vs 32.65 %), so the inspector may show "33 %" next to a "33 %"
threshold. Keep the LCX unselected on camera, or say "just below its threshold" if it comes up.

## Before you record

1. Start one process with one URL: `.\scripts\dev.ps1 serve` (or `make serve`), then open `http://localhost:8000`.
2. Warm up. Open the workstation once so the GLB and the model are cached, then reload the landing page.
3. Check that the EngineBadge in the top bar shows the **server** engine.
4. Reset the view state. Close all drawers, set the Look to **Realistic** and territories to *Off*, and press `0` for
   the home view.
5. Use a clean browser profile. Hide the bookmarks bar and extensions, set zoom to 100 %, and turn on Windows Focus
   Assist so no notifications appear.
6. Keep this page open on a second screen. The keys used are `1` (LAD), `0` (home), `[` `]` (projections),
   `P` (dissect), `B` (heartbeat), `F` (flow), `T` (territories), `I` (Edit inputs), `E` (Explain), and `Ctrl K`
   (palette).

## Timeline

| # | Time | Segment | Screen |
| --- | --- | --- | --- |
| 1 | 0:00–0:20 | Problem hook | Landing hero, slow turntable |
| 2 | 0:20–0:40 | What CardioTwin is | Landing: headline, KPI strip, Open the workstation |
| 3 | 0:40–1:20 | Pick a patient and read the answer | Workstation, P-003, risk summary card, Reveal cath result |
| 4 | 1:20–2:30 | The 3D heart | Rotate and zoom, C-arm presets, select LAD, hover a segment, dissect, heartbeat, flow, territories |
| 5 | 2:30–3:10 | What-if in real time | Edit inputs drawer: typical chest pain off, ICE strip on EF, reset |
| 6 | 3:10–3:55 | Why: explanations | Explain drawer: Why (waterfall, modality), Physiology |
| 7 | 3:55–4:40 | How good is it | Performance page: tiles with CIs, calibration, robustness, modality, baseline |
| 8 | 4:40–5:25 | Technical implementation | Methodology page, `?engine=edge`, EngineBadge, anatomy renders |
| 9 | 5:25–5:50 | Safety and close | Status line, printable report, GitHub URL |

---

## 1 · Problem hook (0:00–0:20)

**On screen.** The landing page in its attract state: the heart turning slowly, and the status line visible at the
bottom. No mouse movement.

**Narration.**
Before an invasive coronary angiogram, doctors already have the patient's history, ECG, blood tests and echo. What
they don't get is a clear answer to two questions: which artery, and why? In the public cohort behind this project,
303 patients were sent for angiography, and 29 percent of them turned out not to have coronary disease.

**Subtitles.**
```
Before an invasive coronary angiogram,
doctors already have the history, ECG,
blood tests and echo.
What they don't get is a clear answer:
which artery, and why?
In the public cohort behind this project,
303 patients were sent for angiography,
and 29 percent turned out not to have coronary disease.
```

## 2 · What CardioTwin is (0:20–0:40)

**On screen.**

1. Let the headline "An explainable coronary digital twin." sit on screen for a beat.
2. Move the cursor slowly along the KPI strip.
3. Hover **Open the workstation** and pause on the line "Opens on a patient the model never saw. No login."

**Narration.**
This is CardioTwin, an explainable coronary digital twin. From 53 routine clinical inputs it predicts coronary artery
disease, and narrowing of each major artery: the LAD, the circumflex and the right coronary. It explains every
estimate exactly and maps it onto a real 3D heart. Let's open a patient the model has never seen.

**Subtitles.**
```
This is CardioTwin,
an explainable coronary digital twin.
From 53 routine clinical inputs,
it predicts coronary artery disease
and narrowing of each major artery:
LAD, circumflex and right coronary.
It explains every estimate exactly,
and maps it onto a real 3D heart.
```

## 3 · Pick a patient and read the answer (0:40–1:20)

**On screen.**

1. Click **Open the workstation**.
2. Press `Ctrl K`, type `P-003`, and press Enter. (Alternatively, open the patient chip in the top bar and search.)
3. Hold on the **risk summary card**: CAD very high, with the LAD flagged and LCX and RCA moderate.
4. Point at the LAD row, then at the LCX and RCA rows.
5. Click **Reveal cath result** and hold for 2 s on the agreement.

**Narration.**
Here's patient P-003, a 54-year-old man with typical angina who smokes. The answer comes first. Coronary artery
disease: very high, about 98 percent. One vessel is flagged, the LAD, at 91 percent. The circumflex and the right
coronary are moderate but below their decision thresholds, so they're not flagged. Those thresholds were set on
development data only. Because this is a test patient, I can reveal the real catheterisation result, and it agrees:
disease in the LAD alone, and all four calls are right.

**Subtitles.**
```
Here's patient P-003: a 54-year-old man
with typical angina, who smokes.
The answer comes first.
Coronary artery disease: very high,
about 98 percent.
One vessel is flagged: the LAD, at 91.
The circumflex and right coronary
are moderate, but below their thresholds.
Because this is a test patient,
I can reveal the real cath result.
It agrees: disease in the LAD alone,
and all four calls are right.
```

## 4 · The 3D heart (1:20–2:30)

**On screen.**

1. Drag to rotate slowly left and right, then scroll to zoom in a little.
2. Press `]` twice to step through the C-arm presets and point at the readout (e.g. "LAO 45°").
3. Press `1`. The camera flies to the LAD's best view and the **vessel inspector** opens. Read the C-arm readout
   (expected RAO 30 · CRA 25).
4. Hover the middle of the LAD until the tooltip shows *Segment 7 · Mid LAD (mLAD)*.
5. Press `P` (Dissect). The chest wall, lungs and heart separate and the heart opens. Hold for 3 s, then press `P`
   again to assemble.
6. Press `B` (heartbeat) and then `F` (blood flow). Hold for 4 s.
7. Press `T` until the territories show **All**. Rotate slightly to show the anterior wall tinted by the LAD's risk.
8. Press `0` to return home, and `T` to turn territories off.

**Narration.**
The heart is the stage. I can rotate and zoom, or step through the standard C-arm projections used in the cath lab.
Selecting the LAD flies the camera to its angiographic best view and opens the vessel inspector. Hovering names the
anatomy. This is the mid LAD, SCCT segment 7. The colour *is* the probability, drawn from the same colour scale as
the legend and the charts. Risk is per vessel: the model never claims where in the artery a lesion sits. Now the
dissection. The chest wall, lungs and heart peel apart, and the heart opens along its long axis. The heartbeat
follows this patient's pulse, and blood flows along centrelines extracted from the real vessels. Territories tint the
muscle each artery supplies. And all of this runs on a laptop's integrated graphics.

**Subtitles.**
```
The heart is the stage.
I can rotate, zoom, or step through
the C-arm projections of the cath lab.
Selecting the LAD flies the camera
to its angiographic best view,
and opens the vessel inspector.
Hovering names the anatomy:
the mid LAD, SCCT segment 7.
The colour is the probability,
on the same scale as the legend.
Risk is per vessel. The model never claims
where in the artery a lesion sits.
Now the dissection:
chest wall, lungs and heart peel apart,
and the heart opens along its long axis.
The heartbeat follows this patient's pulse,
and blood flows along real centrelines.
Territories tint the muscle
each artery supplies.
All of this runs on integrated graphics.
```

## 5 · What-if in real time (2:30–3:10)

**On screen.**

1. Press `I` to open **Edit inputs**.
2. Find *Typical angina* and switch it off. Hold for 2 s on the risk card and the heart (CAD ≈ 72 %, LAD ≈ 58 %).
3. Point at the **what-if pill** above the stage, and press and hold **Hold to compare** for 2 s to flash the recorded values.
4. Expand *Ejection fraction* to show its ICE strip, then move the slider slowly from 40 to 60 and back.
5. Click **Reset** in the what-if pill and close the drawer with `Esc`.

**Narration.**
What if? I open Edit inputs and switch off typical chest pain. Every number, every explanation and every colour
updates together. CAD falls to about 72 percent, just below its decision threshold, and the LAD to about 58. The
what-if pill reminds me that these are edited values. For a numeric input like ejection fraction, the strip shows how
the risk moves across its whole range. One click restores the record.

**Subtitles.**
```
What if?
I switch off typical chest pain.
Every number, explanation and colour
updates together.
CAD falls to about 72 percent,
just below its decision threshold,
and the LAD to about 58.
The pill marks these as edited values.
For ejection fraction, the strip shows
how risk moves across its whole range.
One click restores the record.
```

## 6 · Why: explanations (3:10–3:55)

**On screen.**

1. With the LAD selected, press `E` to open the **Explain** drawer on **Why**.
2. Point at the top bars: *Regional wall-motion abnormality* (raises), *Typical angina* (raises), *ESR* (lowers)
   and *Ejection fraction 40 %* (raises).
3. Switch the grouping to **modality** and hold on the modality strip.
4. Open **Physiology**. Scroll slowly past the values, reference ranges and contributions.
5. Briefly open **Model**, then close the drawer with `Esc`.

**Narration.**
Why does the model think so? The Explain drawer answers with numbers. For the LAD, the regional wall-motion
abnormality on echo and the typical angina push the risk up, a normal ESR pulls it down, and a reduced ejection
fraction adds to it. These are exact SHAP values, shown in percentage points that add up exactly from a typical
patient's risk to this patient's. Grouped by modality, you see how much comes from symptoms, from echo and from labs.
The physiology tab puts every measurement next to its reference range and its contribution. These are associations
the model learned, not causes.

**Subtitles.**
```
Why does the model think so?
For the LAD, the wall-motion abnormality
on echo and the typical angina
push the risk up;
a normal ESR pulls it down,
and a reduced ejection fraction adds to it.
These are exact SHAP values,
in percentage points that add up exactly.
Grouped by modality: symptoms, echo, labs.
Physiology puts every measurement
next to its reference range.
These are associations, not causes.
```

## 7 · How good is it (3:55–4:40)

**On screen.**

1. Go to **Performance** in the top bar (`#/performance`).
2. Hold on the summary tiles (CAD ROC-AUC 0.86 with its CI).
3. Scroll to **Calibration and clinical usefulness** and pause.
4. Scroll to **Robustness** and point at the locked-split marker (3rd percentile for CAD).
5. Scroll to **Multimodal value** (LAD +0.069), then to the baseline comparison.

**Narration.**
How good is it? The performance page reports every metric with its 95 percent confidence interval. On 61 patients
the model never saw, CAD discrimination is 0.86, with an F1 of 0.87. Calibration and decision curves are here too.
Honesty matters, and that test split turned out to be a hard one. When I re-ran the entire recipe on 200 random
splits, the median CAD ROC-AUC was 0.93, and our locked split sat at the third percentile. ECG, labs and echo add
real value for the LAD. On this small test set, the model does not significantly beat a simple five-feature
baseline, and the page says so.

**Subtitles.**
```
How good is it?
Every metric comes with its 95% CI.
On 61 patients the model never saw,
CAD ROC-AUC is 0.86, F1 0.87.
Calibration and decision curves, too.
That test split turned out to be hard:
over 200 random re-splits,
the median CAD ROC-AUC was 0.93,
and our split sat at the 3rd percentile.
ECG, labs and echo add real value for the LAD.
On this small test set, the model doesn't
significantly beat a 5-feature baseline,
and the page says so.
```

## 8 · Technical implementation (4:40–5:25)

**On screen.**

1. Open **Method** in the top bar (`#/methodology`) and scroll over the pipeline and validation diagrams.
2. Change the URL to `http://localhost:8000/#/workstation/P-003?engine=edge` and press Enter. Point at the
   EngineBadge (now **edge**). The numbers are unchanged.
3. Optional cut-in (3 s each): `docs/media/renders/exploded_torso.jpg` and `territories.jpg`.
4. Optional cut-in (3 s): the green CI run on GitHub.

**Narration.**
Under the hood, the methodology page shows the pipeline. The test set was locked first, tuning is nested, and
calibration and thresholds only ever see out-of-fold data. The same model runs twice: in Python on the server, and in
TypeScript inside the browser. The two agree to two times ten to the minus sixteen, with identical explanations, so
the app keeps working with no server at all. The anatomy comes from BodyParts3D, processed by a scripted Blender
pipeline and checked against seventy cited anatomical criteria. Everything reproduces with one command and is tested
in CI.

**Subtitles.**
```
Under the hood: the test set was locked first,
tuning is nested, and calibration
only ever sees out-of-fold data.
The same model runs in Python on the server
and in TypeScript in the browser.
They agree to 2 × 10⁻¹⁶,
with identical explanations,
so the app works with no server at all.
The anatomy comes from BodyParts3D,
through a scripted Blender pipeline,
checked against 78 cited anatomical criteria.
One command to run. Tested in CI.
```

## 9 · Safety and close (5:25–5:50)

**On screen.**

1. Go back to the workstation (engine back on the server) and point at the status line: "Decision support &
   education only — not a diagnosis…".
2. Press `Ctrl K`, type `report`, and open the printable report. Scroll to show the disclaimer on the page.
3. End card for 4 s: the hero render, "CardioTwin", and `github.com/Mohammad-Umar7/CardioTwin`.

**Narration.**
CardioTwin is a research and education prototype. It is not a diagnosis, and it does not replace angiography or
clinical judgement. That's on screen at all times and on every page of the printable report. The code, the models
and the documentation are open on GitHub. Thanks for watching.

**Subtitles.**
```
CardioTwin is a research and education prototype.
It is not a diagnosis,
and it doesn't replace angiography
or clinical judgement.
That's on screen at all times,
and on every page of the report.
Code, models and docs are open on GitHub.
Thanks for watching.
```

---

## Recording tips

| Topic | Setting |
| --- | --- |
| Browser | Chrome or Edge with a 1440 × 900 viewport (DevTools → device toolbar → Responsive 1440 × 900, then hide the toolbar), or a window sized so the page is exactly 1440 × 900. Keep Windows display scaling at 100 %; at 150 or 200 %, set the OBS canvas to the physical pixel size |
| OBS scene | One *Window Capture* (or *Display Capture*, cropped) of the browser. Canvas **1440 × 900**, output 1440 × 900 (YouTube pillarboxes 16:10). Use 2880 × 1800 if the screen is HiDPI |
| OBS video | **60 fps** (camera flights and the heartbeat look smoother), recording format **MKV** (remux to MP4 afterwards: File → Remux), encoder NVENC or x264 with CQP/CRF **18**, keyframe interval 2 s |
| OBS audio | 48 kHz. Microphone filters in this order: Noise Suppression (RNNoise), Compressor (ratio 3:1, threshold −18 dB), Limiter (−1 dB). Aim for peaks around −6 dB |
| Cursor | PowerToys **Mouse Highlighter** (`Win` + `Shift` + `H`) for click rings and **Find My Mouse** if needed. Move the cursor slowly, and park it off the stage while narrating numbers |
| Keys | Optionally show key presses with a small overlay, so viewers can see `1`, `P`, `B`, `F`, `T`, `I`, `E` |
| Pace | About 145 words per minute. Record segment by segment and cut on the section boundaries above |
| Retakes | Re-select P-003 and press `0` before each take. Close drawers with `Esc` |
| Performance | Record with the laptop on mains power. If the frame rate drops, the app lowers its render tier by itself. Do not force tier A |

## YouTube upload checklist

- **Title:** *CardioTwin: explainable coronary risk on an interactive 3D heart (Multimodal AI Hackathon 2026, Track A)*
- **Visibility:** Unlisted is fine. Then paste the link into `docs/DEVPOST.md` and the Devpost form.
- **Subtitles:** YouTube Studio → Subtitles → Add language: English → **Upload file**, *without timing*. Paste the
  subtitle blocks above, one caption per line, and let YouTube auto-sync them.
- **Chapters** (paste into the description):

```
0:00 The problem
0:20 What CardioTwin is
0:40 Patient P-003: the answer
1:20 The 3D heart
2:30 What-if in real time
3:10 Why: exact SHAP explanations
3:55 Performance and robustness
4:40 Under the hood
5:25 Clinical safety
```

- **Description:** a one-paragraph summary, the repository URL, the dataset credit (UCI #411, CC BY 4.0,
  doi:10.24432/C5461K), the anatomy credit (BodyParts3D, © The Database Center for Life Science, CC BY-SA 2.1 JP), and
  the clinical-safety sentence.
