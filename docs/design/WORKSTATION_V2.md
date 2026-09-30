# CardioTwin Workstation V2: canvas-first redesign spec

**Status.** This spec binds the phase-2 polish of `frontend/`. `docs/design/DESIGN_SYSTEM.md` (LUMEN) stays the base: its tokens, the Ember v2 risk ramp, the 3D palette, the motion tokens, the accessibility rules and the clinical-safety rules all still apply. Where the two documents disagree, this one wins, and §2 lists every place it overrides LUMEN.

**Inputs.**
- The UX audit of the current build (at 1440×900 and 1280×720), including its inventory of every element on the workstation.
- Three reference studies:
  - cardiac-AI products (HeartFlow, Cleerly, Elucid, Caristo, Siemens, Philips, GE, Viz.ai, ACC/AHA conventions);
  - 3D anatomy viewers (BioDigital, Complete Anatomy, Visible Body, Zygote, Primal, Sketchfab);
  - calm, dense product UIs (Linear, Vercel, Stripe, Apple Health, Arc, Raycast, Figma UI3, Datawrapper/Observable).

**Owner's brief.** The left and right sides are bloated and do not look professional. Match the best products in the field.

**Target bar.** A HeartFlow/Cleerly report for clarity, BioDigital Human for the 3D stage, and Linear for calm.

---

## 0. The redesign in one page

The heart becomes the stage. Everything else becomes a small, opaque card that floats over the stage's edges and answers exactly one question. Detail moves one step away, into two drawers and a command palette.

| Region | Answers | Replaces |
|---|---|---|
| **Top bar** | Who is this, and where am I? | The top bar, plus the patient picker and TEST badges from the left rail |
| **Patient card** (left, collapsible to a 40 px rail) | What did the model see, and which inputs matter most? | The 320 px, 53-field form |
| **Edit inputs drawer** (left, on demand) | What if I change something? | The accordions, the Cohort/Custom switch and the WhatIfBar |
| **Stage** (full-bleed 3D) | Where is the risk? | The canvas and its 13 HUD overlays |
| **Canvas toolbar** (floating, bottom) | How do I look at it? | The projection buttons, 4 layer chips, Clay/Anat, the hint sentence and the C-arm readout |
| **Risk summary card** (right) | How likely is CAD, and which vessels are flagged? | The CAD hero, the vessel list and "≈ 1.7 of 3" |
| **Vessel inspector** (right, on selection) | Why this vessel? | The WHY tabs, the target tabs and the TopDrivers teaser |
| **Explain drawer** (right, on demand) | Show me all the evidence | The waterfall, Physiology and the model footnotes |
| **Command palette** (Ctrl K / ⌘K) | Take me to anything | Hunting for inputs across 7 accordions |

**Measured targets** (the rubric in §10 re-measures these):

| Metric (workstation, 1440×900, nothing selected) | Now (audit) | V2 target |
|---|---|---|
| Numerals visible at first paint, counted inside `#main` (top bar and status line excluded) | 62 (66 including chrome) | **≤ 16** (design count: 12) |
| Encodings of the CAD result | 5 in 181 px | **2**: numeral + band chip, with the track as its scale |
| Text size/weight combinations in the right-hand region | 12 | **≤ 6 per card**, ≤ 9 on the whole screen |
| Overlay groups on the canvas at rest | 13 | **4**: labels, legend chip, toolbar, one-time hint |
| Canvas share of the viewport | 736×824 (≈ 47 %) | 1440×824 full-bleed. **≥ 55 %** visible (not covered by cards) |
| Actions to reach any of the 53 inputs | Up to 3 plus scrolling | **≤ 2**: press I, then type; or Ctrl K, then type |
| Answers to "is the RCA diseased?" | 3 conflicting | **1**: "Flagged" against that vessel's own threshold |
| Blank canvas on a cold load | 6–10 s | **0 s**: poster plus hairline progress |

---

## 1. Principles

Each principle comes with a rule that a critic can check.

1. **Canvas-first.** The 3D stage is the largest and brightest thing on screen, and it never resizes. Chrome floats over its edges as opaque cards with a 12 px inset. Opening, closing or collapsing chrome moves the camera's view offset, never the canvas.
   *Check:* at 1440×900 at rest, the cards cover ≤ 45 % of the stage. The heart's bounding box is centred in the free area within ±16 px.
2. **One primary question per region.** Every region answers the question in the §0 table and nothing else. A region never holds controls for another region's job: no layer toggles in a results card, no results in the toolbar.
   *Check:* each region's content can be described in one sentence that begins with its question.
3. **Progressive disclosure: answer, then reason, then evidence.**
   - Level 1, at rest: the answer (Risk card), the location (stage) and the five inputs that matter most (Patient card).
   - Level 2, one click or hover: the vessel inspector, tooltips and popovers.
   - Level 3, a drawer or the palette: all 53 inputs, every SHAP value, physiology and model internals.
   - Nothing at level 3 is ever shown at level 1.
   *Check:* no log-odds number, raw dataset key, reference range or model id is visible at rest.
4. **Every number has one home.** Each quantity (§3.3) is rendered as a numeral in exactly one place in the viewport at any time. When a home is hidden (focus mode, an open drawer), the number moves to its fallback home and is not duplicated. Prose may cite a number, but never a probability that is already on screen as a numeral.
   *Check:* every probability numeral carries `data-prob="<target>"`. At most one visible element per target has it (probe in §10.3).
5. **Motion explains change.** Motion happens only when state changes, and it shows *what* changed and *where*:
   - a number tweens from its old value;
   - a vessel ripples in the direction of flow;
   - a panel slides from the edge it lives on.
   Motion obeys LUMEN §6: decelerate, no overshoot, no count-up, one attention animation at a time.
   *Check:* a still frame shows no ambient motion except the beat and the flow.
6. **Say it once, in plain words.** There is one vocabulary for decisions ("Flagged", §3), one name per input (the `schema.features[].label`, never a raw key) and one disclaimer line.
   *Check:* no screen shows two different words for the same concept.
7. **Nothing dead on screen.** A control appears only when it can act. Reset, Compare and the edit count exist only while edits exist. Isolate and Ghost exist only while a vessel is selected. Reveal exists only for TEST patients.
   *Check:* no disabled control is visible at rest.

---

## 2. Amendments to DESIGN_SYSTEM.md

Anything not listed here stays binding exactly as written.

| LUMEN § | Was | V2 | Why |
|---|---|---|---|
| §1.2, §4 layout | Docked opaque side panels, 320 + 384 px. The canvas is the middle column. | The canvas is full-bleed across the stage. Opaque **stage cards** float at a 12 px inset: `bg/panel` fill, 1 px `border/default` ring, `e-2`, `r-lg`, no blur. Drawers are docked sheets (`e-3`). LUMEN §4's "the canvas is never resized" still holds and now covers every chrome change. | Audit P1-1/P1-4/P1-8. BioDigital, Zygote, Sketchfab. |
| §4.2, §4.3 wireframes | 3-column workstation, 1280 rail + flyout | Replaced by §4 of this spec | Bloat |
| §5 CADHeroCard | Overline, numeral, BandChip + meter, RiskTrack with scale, verdict, microcopy | **CAD headline** (§5.8): numeral + BandChip without the meter, a thin track without scale numerals, and one verdict line. The microcopy becomes a "Model estimate" tag in the card header. | 5 encodings, down to 2 |
| §5 VesselRow | %, track, chip + meter + band word, ▸ | %, track with threshold tick, **verdict** ("Flagged"/"Not flagged"). The band word moves to the inspector. | Audit P0-3, P1-1 |
| §5 WhatIfBar, PatientPicker, GroupAccordion header | Permanent header row, Cohort/Custom, A/B, share bars and signed sums | WhatIfPill (only while edits exist), PatientSwitcher from the top-bar chip, group headers with count and edited dot only | Audit P1-5/6/7 |
| §5 NumericFeatureRow at rest | 52–80 px: ICE, slider, ref line, captions | 32 px at rest (28 at 1280). It expands to 60 px on **focus** with the slider, ICE strip, ± and ↺. | Figma UI3 "labels on demand", audit P1-4 |
| §5 BinaryToggle | 27 separate No/Yes rows | **FindingChips**: one wrapping chip cloud per group. Present = pressed. | ACC input pattern, audit P1-4 |
| §5 CanvasHUD, LayerToggles | Breadcrumb, C-arm readout, presets, watermark, legend + sentence, hint, 4 toggles, Clay/Anat, credits | One **canvas toolbar**, one **legend chip**, one **context slot** (selection chip or what-if pill), and a one-time hint | Audit P1-8 |
| §5 TargetTabs | In the right rail | Only in the Explain drawer. Selection drives the target everywhere else. | One selection model |
| §7.4 territories | On by default, all three tinted | Three states: **Off · Selected (default) · All**. With nothing selected the myocardium is plain clay; selecting a vessel tints its territory only. | Audit P1-9, HeartFlow Roadmap |
| §7.6 labels | Pip, code, %, band word, meter; far side → 25 % + "(posterior)" | Pip + code at rest. The **%** appears only when the Risk card is hidden (focus, landing). No band word or meter. The selected vessel's label is **never** posterior (§5.14). | Audit P0-2, P1-3; one home per number |
| §9 watermark | "NOT FOR DIAGNOSTIC USE" on the live canvas | Burned into every export as before. On the live canvas it is replaced by the "Model estimate" tag on the Risk card, next to the numbers it qualifies. | Illegible on anatomy (P1-8); Elucid's per-feature status tags |
| §9 credits | Bottom-right of the canvas | Right end of the status line (11 px, always visible, every route that shows anatomy) | Fewer overlays; still always visible |
| §9 status line | Includes "Vessel-level risk · no lesion localisation" | Kept at ≥ 1440. At < 1440 it moves into Details and into the legend chip's expanded state. | Width |
| §10.2 redundancy | Every value shows %, band word, meter and track | Every risk colour mark comes with the % numeral **and** one categorical word (band or verdict). For marks in a card, both are in the same card. For stage marks (vessels, label pips, territories), both are in the linked vessel row, which is always visible while the label leaves out the %. The meter is removed; the track is kept. | Meets WCAG 1.4.1 with half the ink |
| §10.3 keys | F = flow | F is still flow. **\\ = focus mode**, Ctrl K / ⌘K = palette, I = inputs, E = explain, L = labels, O = isolate, G = ghost others (§4.10) | Discoverable in tooltips and the palette |
| §5 TourCoachmark | 7 passive steps, step 1 is the disclaimer | **5 chapters** with actions (§6.3). The status line is referenced in chapter 1's caption; it is never spotlit as a step. | Audit P2 tour |

**New layout tokens.** These are sizes only; no colours are added.

```css
:root {                         /* ≥ 1440 */
  --stage-inset: 12px;
  --card-left-w: 280px;  --card-right-w: 352px;  --card-pad: 16px;  --card-gap: 8px;
  --drawer-inputs-w: 400px;  --drawer-explain-w: 440px;
  --toolbar-h: 40px;  --chip-h: 32px;  --rail-w: 40px;  --palette-w: 640px;
}
@media (max-width: 1439.98px) { :root {
  --card-left-w: 256px;  --card-right-w: 320px;  --card-pad: 12px;
  --drawer-inputs-w: 360px;  --drawer-explain-w: 400px;  --toolbar-h: 36px;  --palette-w: 600px;
} }
```

**Retired variables:** `--left-w`, `--right-w` and `--flyout-w`, once `GroupRail`/`panels.tsx` are deleted.

---

## 3. Semantics: one answer per question (fixes P0-3)

### 3.1 Two different things, never mixed

- **Probability `p`** answers "how likely?". It is shown as the numeral, the Ember colour and the position on the track.
- **Band** is a fixed magnitude bucket (25/50/75), the same for every target. It names the size of `p`: Low, Moderate, High, Very high.
- **Decision** is `p ≥ threshold[target]`, where the threshold is tuned per target on the development folds. The rule is Youden's J on out-of-fold predictions. Today the thresholds are CAD 0.75, LAD 0.55, LCX 0.33 and RCA 0.32. The decision is shown as the **verdict**.

Because the vessel thresholds sit far from the band edges, a vessel can be "Moderate" and flagged at the same time (RCA 47 % against a threshold of 32 %). V2 therefore shows **the verdict on the row and the band only in the inspector**, where one sentence reconciles the two: "Moderate probability (25–50 %). Flagged because RCA's decision threshold is 32 %."

### 3.2 Vocabulary

| Concept | UI copy | Where | Never write |
|---|---|---|---|
| `p ≥ thr` (vessel) | **● Flagged** | Vessel row, inspector | Likely, Positive, Diseased, Stenotic (as a prediction) |
| `p < thr` (vessel) | **○ Not flagged** | Vessel row, inspector | Negative, Healthy, Clear |
| `p ≥ thr` (CAD) | **Flagged — above the 75 % threshold** | CAD verdict line | CAD likely, Diagnosis, Positive |
| `p < thr` (CAD) | **Not flagged — below the 75 % threshold** | CAD verdict line | CAD unlikely, Ruled out |
| Band | Low · Moderate · High · **Very high** (+ "probability" in sentences) | CAD band chip, inspector sentence, legend | Critical, Severe |
| Vessel count | **"k of 3 flagged"**, where k counts the `label` fields | Vessel header, answer pill | "≈ 1.7 of 3 expected" (moves to Explain › Model, see below) |
| Cath truth | **Stenotic at cath ● / Not stenotic at cath ○**, then **agrees ✓ / disagrees ✕** | After Reveal only | Correct / Wrong |
| Uncertain / stale | **Updating** (achromatic `#4B5260`) | Any risk mark | A stale value shown as current |
| Status tag | **Model estimate** | Risk card header | Diagnosis, Result |

**Expected diseased vessels** (`summary.expected_diseased_vessels`) is only shown in Explain › Model, with this sentence: "The three probabilities add up to about 1.7 vessels. More vessels are flagged (3) because the LCX and RCA thresholds are about 33 %. Each threshold balances sensitivity and specificity (Youden's J on out-of-fold predictions)."

### 3.3 Where each number lives

| Quantity | Home (default chrome) | Fallback home when the default is hidden | Never |
|---|---|---|---|
| P(CAD) | Risk card headline (`numeral-xl`) | Answer pill (focus); Explain drawer title (drawer covers the card) | Stage, patient card, toolbar |
| P(vessel) | Risk card vessel row (`numeral-l`) | 3D label (focus mode, landing hero) | Inspector as a numeral (prose may cite it only when the row is hidden) |
| Decision threshold | Drawn as a tick on every track. Written: CAD in its verdict line; vessel in the inspector sentence. | Tooltips | Legend numerals |
| Band | CAD band chip; vessel in the inspector sentence | Expanded legend (the ladder) | Vessel rows, 3D labels |
| Feature values | Patient card (top 5), Inputs drawer, Explain › Why rows | Inspector drivers **only when the patient card is collapsed** | Narrative prose (uses words: "normal ejection fraction") |
| SHAP (log-odds) | Explain › Why only | none | Cards, labels, palette |
| Patient ID, split | Top-bar chip | none | Anywhere else. The TEST badge appears exactly once. |
| Sex, age | Patient card header ("Male · 58 y") | Chip tooltip | The patient card's ranked list (Age and Sex are excluded from it) |
| What-if deltas | CAD "was" line; Δ column in the vessel rows | none | 3D (the ripple shows change without a number) |
| Heart rate | Beat toggle tooltip ("70 bpm from the patient's pulse") | none | On-canvas text |
| C-arm angles | Selection chip (`mono-s`), live during the flight | View menu shows the preset name | Canvas corners |
| Engine, version, latency, tier | Engine dot popover; Explain › Model | none | Cards |

---

## 4. Layout

### 4.1 Stage model

- **Stack, bottom to top:**
  1. canvas (z 0);
  2. 3D labels (z 20);
  3. stage cards, toolbar, legend and context slot (z 30);
  4. drawers (z 40);
  5. popovers and menus (z 50);
  6. toasts (z 60);
  7. palette scrim (z 70);
  8. tour (z 80);
  9. status line (z 90).

  These are LUMEN's z tokens, unchanged.
- **Free area** is the rectangle of the stage not covered by chrome. The layout publishes it as `uiStore.stageInsets = {left, right, top, bottom}`, measured with a ResizeObserver on the cards and drawers.
  - The 3D agent uses the insets for two things: `camera.setViewOffset`, which centres the heart in the free area, and the label lanes, so labels never sit under a card.
  - Any change glides over `flyout` (360 ms). The canvas element itself never changes size.
- **Heart framing.** In the workstation, the home pose puts the heart's bounding box at **62 % of the free-area height**, centred. This replaces today's thorax-wide home.
- **Chrome presets** (`uiStore.chrome`), after BioDigital's embed flags:

| Preset | Top bar | Cards | Toolbar and legend | Labels | Used by |
|---|---|---|---|---|---|
| `workstation` | ✓ | ✓ | ✓ | Code + pip | Default |
| `focus` | ✓ | ✕ (answer pill instead) | ✕ | Code + pip + % | Key \\ |
| `tour` | ✓ | ✓ | ✕ | Per chapter | Guided demo |
| `landing` | ✓ | ✕ (hero copy) | ✕ | Code + pip + % | `#/` |

### 4.2 Workstation 1440×900, at rest

Not to scale; §4.7 has the binding geometry. Nothing is selected, there are no edits, and it is the first visit (the hint is showing).

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◆ CardioTwin  Workstation  Performance  Method    ⌕ Search or jump to…  Ctrl K    P-011 · TEST ▾  ●  ▶ Guided demo  ?│
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌ Male · 58 y ────────────── ⇤ ┐                                    ┌ CORONARY ARTERY DISEASE (i) ─ Model estimate ┐ │
│ │ DRIVES CAD MOST              │                                    │ 98 %                              ▌VERY HIGH │ │
│ │ Typical angina       Yes  ━▶ │                                    │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┃━●━━━━       │ │
│ │ Hypertension         Yes   ▶ │                                    │ ● Flagged — above the 75 % threshold         │ │
│ │ Wall-motion abn. 0 regions ◀ │            .-~~~~~~~-.             │ Driven mostly by typical angina and          │ │
│ │ Ejection fraction  50 % ▼  ▶ │          .'  ┏━━┓ ┏━━ '.           │ hypertension; normal wall motion pulls it    │ │
│ │ Fasting blood sugar 101 ▲  ▶ │  ● RCA ──(    ┃  ┗━━━━━  )── ● LAD │ down. A typical cohort patient: 83 %.        │ │
│ │ + 4 abnormal findings  ›     │           (  ┏┛  ┃     )           ├──────────────────────────────────────────────┤ │
│ │ [ ✎ Edit inputs          I ] │            '.┗━━┓ ┃  .'──── ● LCX  │ VESSELS                       3 of 3 flagged │ │
│ └──────────────────────────────┘              '-._┗━┛.-'            │ ● LAD   65 %  ━━━━━━┃━●━━━━   ● Flagged      │ │
│                                                                     │ ● LCX   56 %  ━━━┃━━━●━━━━━   ● Flagged      │ │
│                                                                     │ ● RCA   47 %  ━━━┃━●━━━━━━━   ● Flagged      │ │
│                                                                     │ [ Explain        E ]  [ Reveal cath result ] │ │
│                                                                     └──────────────────────────────────────────────┘ │
│                                                                                                                      │
│                                         Drag to rotate · Scroll to zoom · Click an artery   (first visit only)       │
│ ┌──────────────────────┐        ┌ AP ▾  ⌂ │ Peel ○━━━●━━━━ ▶ │ Layers ▾  ♥  ≋ │ ⤢  ⋯ ┐                               │
│ │ Low ▁▂▃▅▆▇ Very high │        └────────────────────────────────────────────────────┘                               │
│ └──────────────────────┘                                                                                             │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ (i) Decision support & education only — not a diagnosis; not a substitute for CTCA   BodyParts3D © DBCLS · Details › │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Numerals at rest inside `#main`:** 4 in the patient card (58, 0, 50, 101), 8 in the Risk card (98, 75, 83, 65, 56, 47 and "3 of 3") and 0 on the stage. That is 12 in total, against 62 today.

### 4.3 Workstation 1440×900, LAD selected

The trigger is a click on the LAD label, a click on the LAD row, key 1, or "Focus LAD" in the palette. All four behave identically (§8.2).

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◆ CardioTwin  Workstation  Performance  Method    ⌕ Search or jump to…  Ctrl K    P-011 · TEST ▾  ●  ▶ Guided demo  ?│
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌ Male · 58 y ────────────── ⇤ ┐      ┌ ● LAD · RAO 30° CRA 25° ✕ ┐ ┌ CORONARY ARTERY DISEASE (i) ─ Model estimate ┐ │
│ │ DRIVES LAD MOST              │      └───────────────────────────┘ │ 98 %                              ▌VERY HIGH │ │
│ │ Typical angina       Yes  ━▶ │                                    │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┃━●━━━━       │ │
│ │ ST depression        Yes   ▶ │                                    │ ● Flagged — above the 75 % threshold         │ │
│ │ Hypertension         Yes   ▶ │            .-~~~~~~~-.             ├──────────────────────────────────────────────┤ │
│ │ Ejection fraction  50 % ▼  ▶ │          .'  ┏━━┓ ┏━━ '.           │ VESSELS                       3 of 3 flagged │ │
│ │ Wall-motion abn. 0 regions ◀ │  ◌ RCA ┄┄(    ┃  ┗━━━━━  )━━ ● LAD │ ▌● LAD  65 %  ━━━━━━┃━●━━━━   ● Flagged      │ │
│ │ + 4 abnormal findings  ›     │           (  ┏┛  ┃     )  selected │   LCX   56 %  ━━━┃━━━●━━━━━   ● Flagged      │ │
│ │ [ ✎ Edit inputs          I ] │            '.┗━━┓ ┃  .'┄┄┄┄ ◌ LCX  │   RCA   47 %  ━━━┃━●━━━━━━━   ● Flagged      │ │
│ └──────────────────────────────┘              '-._┗━┛.-'            │ [ Explain        E ]  [ Reveal cath result ] │ │
│                                   unselected labels 40 %, dashed    └──────────────────────────────────────────────┘ │
│                                                                                                                      │
│                                                                     ┌ ● LAD  Left anterior descending ────────── ✕ ┐ │
│                                                                     │ High probability band (50–75 %).             │ │
│                                                                     │ Flagged: above LAD's 55 % threshold. ›       │ │
│                                                                     │ Typical angina and an ST depression push     │ │
│                                                                     │ it up; normal wall motion pulls it down.     │ │
│                                                                     │ Cohort ·····•·:··•••●··· higher than 71 %    │ │
│                                                                     │ [ Isolate O ] [ Ghost others G ] [ Why E ]   │ │
│                                                                     └──────────────────────────────────────────────┘ │
│ ┌──────────────────────┐      ┌ RAO 30 ▾  ⌂ │ Peel ○━━━●━━━━ ▶ │ Layers ▾  ♥  ≋ │ ⤢  ⋯ ┐                             │
│ │ Low ▁▂▃▅▆▇ Very high │      └────────────────────────────────────────────────────────┘                             │
│ └──────────────────────┘                                                                                             │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ (i) Decision support & education only — not a diagnosis; not a substitute for CTCA   BodyParts3D © DBCLS · Details › │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- The Risk card drops its CAD narrative and context line, so only one "why" sentence is on screen: the inspector's.
- The patient card re-ranks for LAD ("Drives LAD most") with a FLIP animation.
- The unselected labels drop to 40 % with dashed leaders. The selected label stays at full strength with an accent ring, whatever the camera angle.

### 4.4 Workstation 1440×900, Edit inputs drawer open, with 2 edits

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◆ CardioTwin  Workstation  Performance  Method    ⌕ Search or jump to…  Ctrl K    P-011 · TEST ▾  ●  ▶ Guided demo  ?                │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│┌ EDIT INPUTS · 53 ─────────────────────── ✕ Esc ┐ ┌ ● What-if · 2 changes · Reset ┐ ┌ CORONARY ARTERY DISEASE (i) ─ Model estimate ┐ │
││ ⌕ Find an input — e.g. ejection fraction   /   │ └───────────────────────────────┘ │ 91 %                              ▌VERY HIGH │ │
│├ CHANGED · 2 ──────────────────────── Reset all ┤                                   │ was 98 %  ▼ −7 pts                           │ │
││ ● Typical angina         [ No | Yes ]  was Yes │                                   │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┃◦━●━━━━        │ │
││ ● Age                            70 y   was 58 │                                   │ ● Flagged — above the 75 % threshold         │ │
││   ▁▂▂▃▄▅▆▇▇  ━━━━━━━━━━━━●━━━━━━━━  −  +  ↺    │             .-~~~~~-.             ├──────────────────────────────────────────────┤ │
│├ OUTSIDE NORMAL RANGE · 5 ──────────────────────┤  ● RCA ──(  ┏━┓ ┏━━  )── ● LAD    │ VESSELS                       3 of 3 flagged │ │
││ Ejection fraction                      50 %  ▼ │           '.┗━┓ ┃ .'── ● LCX      │ ● LAD  58 % ▼7  ━━━━┃━●◦━━━  ● Flagged       │ │
││ Fasting blood sugar               101 mg/dL  ▲ │             '-┗━┛-'               │ ● LCX  52 % ▼4  ━━┃━━●◦━━━━  ● Flagged       │ │
││ Body-mass index                  26.6 kg/m²  ▲ │                                   │ ● RCA  47 %  ·  ━━┃━●━━━━━━  ● Flagged       │ │
││ Present: [✓ Hypertension] [✓ Dyslipidaemia]    │ Stage framed by a 1 px accent     │ [ Explain        E ]  [ Reveal cath result ] │ │
│├ MOST INFLUENTIAL FOR CAD · 4 ──────────────────┤ line (40 %) while edits exist.    └──────────────────────────────────────────────┘ │
││ Wall-motion abnormality              0 regions │                                                                                    │
││ Blood pressure                        130 mmHg │                                                                                    │
││ [ Atypical angina ] [ Shortness of breath ]    │                                                                                    │
│├ ALL INPUTS · 53 ───────────────────────────────┤                                                                                    │
││ ▸ Demographics            5                    │                                                                                    │
││ ▸ Risk factors & history 11   ● 0              │                                                                                    │
││ ▸ Symptoms                6   ● 1              │                                                                                    │
││ ▸ Physical examination    7                    │                                                                                    │
││ ▸ ECG · Laboratory · Echocardiography …        │                                                                                    │
│├────────────────────────────────────────────────┤                                                                                    │
││ 2 changes · applied instantly         [ Done ] │                                                                                    │
│└────────────────────────────────────────────────┘                                                                                    │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ (i) Decision support & education only — not a diagnosis; not a substitute for CTCA   BodyParts3D © DBCLS · Details ›                 │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- The drawer docks over the patient card's position. The Risk card stays visible, so the what-if loop reads left → heart → right without anything moving out of view.
- The stage gets a 1 px accent frame at 40 % opacity while edits exist (the Stripe test-mode pattern, using the interaction colour, never `warn`).
- Every changed number shows its "was" value and its delta.

### 4.5 Workstation 1440×900, Explain drawer open

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◆ CardioTwin  Workstation  Performance  Method    ⌕ Search or jump to…  Ctrl K    P-011 · TEST ▾  ●  ▶ Guided demo  ?│
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌──┐                                                         ┌ EXPLAIN ────────────────────────────────────── ✕ Esc ┐│
│ │◧ │                                                         │ [ CAD ]  LAD   LCX   RCA                             ││
│ │✎ │                                                         │ CAD 98 % is driven mostly by typical angina          ││
│ │⌕ │                                                         │ A typical cohort patient scores 83 %.                ││
│ └──┘                            .-~~~~~~-.                   │ [ Why ]  What-if   Physiology   Model                ││
│ record card             ● RCA (  ┏━┓ ┏━━  )── ● LAD          ├ RAISING RISK ────────────────────────────────────────┤│
│ auto-collapsed                 '.┗━┓ ┃ .'── ● LCX            │ ▶ Typical angina        Yes            ██████▶ +1.34 ││
│ while Explain                    '-┗━┛-'                     │ ▶ Hypertension          Yes                ██▶ +0.62 ││
│ is open                                                      │ ▶ Age                   58 y               ██▶ +0.41 ││
│                         heart re-centred in the              │ ▶ Blood pressure   130 mmHg                 █▶ +0.25 ││
│                         free area (view offset)              ├ LOWERING RISK ───────────────────────────────────────┤│
│                                                              │ ◀ Wall-motion abn. 0 regions           ◀███    −0.52 ││
│                                                              │ ◀ Ejection fraction    50 %              ◀█    −0.20 ││
│                                                              ├──────────────────────────────────────────────────────┤│
│                                                              │ + 45 smaller contributions                Show all ▾ ││
│                                                              │ By feature | By group                                ││
│                                                              │ Bars are log-odds contributions; they add up         ││
│                                                              │ from the cohort baseline to this estimate.           ││
│                                                              └──────────────────────────────────────────────────────┘│
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ (i) Decision support & education only — not a diagnosis; not a substitute for CTCA   BodyParts3D © DBCLS · Details › │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

The Explain drawer covers the right column. Its title carries the CAD numeral: this is the fallback home, and there is no duplicate.

Opening it auto-collapses the patient card to its rail, because both would otherwise answer "why". Closing the drawer restores the card to the state the user left it in.

### 4.6 Workstation 1280×720

At rest, the structure matches 1440 with smaller sizes:

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◆ CardioTwin  Workstation  Performance  Method        ⌕ Ctrl K     P-011 · TEST ▾   ●   ▶ Demo   ?     │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌ Male · 58 y ──────────── ⇤ ┐                                ┌ CORONARY ARTERY DISEASE (i) ─────────┐ │
│ │ DRIVES CAD MOST            │                                │ 98 %                      ▌VERY HIGH │ │
│ │ Typical angina      Yes ━▶ │                                │ ━━━━━━━━━━━━━━━━━━━━━━━━━━┃━●━━━     │ │
│ │ Hypertension        Yes  ▶ │          .-~~~~~-.             │ ● Flagged — above the 75 % threshold │ │
│ │ Wall-motion abn.       0 ◀ │ ● RCA ─(  ┏━┓ ┏━━  )─ ● LAD    │ Driven mostly by typical angina and  │ │
│ │ Ejection fraction 50 % ▼ ▶ │         '.┗━┓ ┃ .'── ● LCX     │ hypertension; normal wall motion     │ │
│ │ Fasting blood sugar 101 ▲▶ │           '-┗━┛-'              │ pulls it down. Typical patient: 83 %.│ │
│ │ + 4 abnormal  ›            │                                ├──────────────────────────────────────┤ │
│ │ [ ✎ Edit inputs        I ] │                                │ VESSELS               3 of 3 flagged │ │
│ └────────────────────────────┘                                │ ● LAD  65 %  ━━━━━┃━●━━  ● Flagged   │ │
│                                                               │ ● LCX  56 %  ━━┃━━━●━━━  ● Flagged   │ │
│                                                               │ ● RCA  47 %  ━━┃━●━━━━━  ● Flagged   │ │
│                                                               │ [ Explain    E ]  [ Reveal cath ]    │ │
│                                                               └──────────────────────────────────────┘ │
│ ┌──────────────────┐            ┌ AP ▾ ⌂ │ Peel ○━━●━━ ▶ │ Layers ▾ ♥ ≋ │ ⤢ ⋯ ┐                        │
│ │ Low ▁▂▃▅▇ V.high │            └─────────────────────────────────────────────┘                        │
│ └──────────────────┘                                                                                   │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ (i) Decision support & education only — not a diagnosis                BodyParts3D © DBCLS · Details › │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

With LAD selected and the patient card collapsed by the user:

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◆ CardioTwin  Workstation  Performance  Method        ⌕ Ctrl K     P-011 · TEST ▾   ●   ▶ Demo   ?     │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌──┐        ┌ ● LAD · RAO 30° CRA 25° ✕ ┐                     ┌ CORONARY ARTERY DISEASE (i) ─────────┐ │
│ │◧ │        └───────────────────────────┘                     │ 98 %                      ▌VERY HIGH │ │
│ │✎•│                                                          │ ● Flagged — above the 75 % threshold │ │
│ │⌕ │                                                          ├──────────────────────────────────────┤ │
│ └──┘                 .-~~~~~-.                                │ ▌● LAD 65 %  ━━━━━┃━●━━  ● Flagged   │ │
│            ◌ RCA ┄(  ┏━┓ ┏━━  )━━ ● LAD                       │    LCX 56 %  ━━┃━━━●━━━  ● Flagged   │ │
│                    '.┗━┓ ┃ .'┄┄ ◌ LCX                         │    RCA 47 %  ━━┃━●━━━━━  ● Flagged   │ │
│                      '-┗━┛-'                                  └──────────────────────────────────────┘ │
│                                                                                                        │
│                                                               ┌ ● LAD  Left anterior descending ── ✕ ┐ │
│                                                               │ High band (50–75 %) · flagged:       │ │
│                                                               │ above LAD's 55 % threshold ›         │ │
│                                                               │ TOP DRIVERS (record card collapsed)  │ │
│                                                               │ ▶ Typical angina                 Yes │ │
│                                                               │ ▶ ST depression                  Yes │ │
│                                                               │ ◀ Wall-motion abn.         0 regions │ │
│                                                               │ [Isolate] [Ghost] [Why E] [Reveal]   │ │
│                                                               └──────────────────────────────────────┘ │
│                ┌ RAO 30 ▾ ⌂ │ Peel ○━━●━━ ▶ │ Layers ▾ ♥ ≋ │ ⤢ ⋯ ┐                                     │
│                └─────────────────────────────────────────────────┘                                     │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ (i) Decision support & education only — not a diagnosis                BodyParts3D © DBCLS · Details › │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

When the patient card is collapsed, the inspector adds a "Top drivers" block with three rows: direction mark, label and value. This is the fallback home for those values (§3.3).

At 1280 the Risk card **compacts whenever a vessel is selected**. It keeps the header, the headline, the verdict and the three rows, and hides the narrative, the context line, the track, the vessels header and the footer. Explain moves to the inspector's "Why", and Reveal joins the inspector's action row. This keeps the right column under the stage height:

`12 + 256 (compact card) + 8 + 314 (inspector with drivers) = 590 ≤ 632`

### 4.7 Binding geometry

The stage is the area between the top bar and the status line. Coordinates are CSS px.

| Element | 1440×900 | 1280×720 |
|---|---|---|
| Top bar | h 48 | h 40 |
| Status line | h 28 | h 24 |
| Stage = canvas | 1440 × 824 at y 48 | 1280 × 656 at y 40 |
| Patient card | x 12, y 60, w 280, h hugs content (≈ 336), max h 800, scrolls inside | x 12, y 52, w 256, h ≈ 300, max 632. **Open by default at both widths**; the collapsed state is remembered. |
| Patient rail (collapsed) | x 12, y 60, 40 × 116 (3 buttons of 32 + 4 gaps + 8 padding) | same at y 52 |
| Risk summary card | x 1076, y 60, w 352, h ≈ 452 at rest, ≈ 364 while a vessel is selected (narrative and context line hidden) | x 948, y 52, w 320, h ≈ 444 at rest, compact ≈ 256 while a vessel is selected |
| Vessel inspector | Right column, 8 px below the Risk card, w 352, h ≈ 244 (≈ 276 with the cohort strip) | w 320, h ≈ 216, or ≈ 314 with drivers |
| Right column overflow | The column scrolls as one unit if it exceeds the stage minus 24; cards never overlap | same |
| Context slot | Top 12, centred on the free area's x, h 32; holds up to 2 chips with an 8 px gap | same, y 52 |
| Canvas toolbar | h 40, bottom 12 (y 820–860), centred on the free area's x, w ≈ 560 | h 36, bottom 12, w ≈ 520 |
| Legend chip | x 12, bottom 12, 212 × 40 | 184 × 36 |
| Inputs drawer | x 0, y 48, 400 × 824, docked, e-3 | 360 × 656 |
| Explain drawer | right 0, y 48, 440 × 824, docked, e-3 | 400 × 656 |
| Command palette | 640 wide, ≤ 440 tall, top at y 144 (96 below the top bar), centred on the viewport | 600 × ≤ 400, top y 112 |
| Free area at rest | x 304–1064, y 60–808. Centre (684, 434). | x 280–936, y 52–636. Centre (608, 344). |
| View offset at rest | (−36, −26) from the canvas centre (720, 460) | (−32, −24) from (640, 368) |

**Below 1100 px (compact).** The canvas takes 50vh at the top with a floating toolbar (icons only). Under it are tabs: **Summary** (the Risk card, then the inspector inline), **Record** (the patient card) and **Why** (the Explain drawer content inline). Drawers become full-screen sheets. The palette is 100 % wide minus 16.

### 4.8 Focus mode (key \\, or ⤢ in the toolbar)

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◆ CardioTwin  Workstation  Performance  Method    ⌕ Search or jump to…  Ctrl K    P-011 · TEST ▾  ●  ▶ Guided demo  ?│
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                    ┌ CAD 98 % ▌VERY HIGH · 3 of 3 flagged   Exit \ ┐ │
│                                                                    └───────────────────────────────────────────────┘ │
│                                                                                                                      │
│                                 .-~~~~~~~~~~~~-.                                                                     │
│                              .'   ┏━━━┓  ┏━━━━  '.                                                                   │
│           ● RCA 47 % ────────(     ┃   ┗━━━━━━━━  )──────── ● LAD 65 %                                               │
│                               (   ┏┛    ┃        )                                                                   │
│                                '. ┗━━━┓ ┃     .'─────────── ● LCX 56 %                                               │
│                                  '-.__┗━┛__.-'                                                                       │
│                                                                                                                      │
│           Cards, toolbar and legend slide off; the canvas does not resize. Labels now carry the vessel numbers       │
│           because the Risk card is hidden (one home per number). Top bar and status line stay.                       │
│                                                                                                                      │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ (i) Decision support & education only — not a diagnosis; not a substitute for CTCA   BodyParts3D © DBCLS · Details › │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Hidden:** the patient card or rail, the Risk card, the inspector, the toolbar, the legend and the context slot.
- **Kept:** the top bar and the status line (patient identity and the disclaimer never go away).
- **Answer pill** (top-right): `CAD 98 % ▌VERY HIGH · 3 of 3 flagged · Exit \`. It is h 40 and uses the same card material as the stage cards.
- **Labels** switch to pip + code + %, which is the fallback home for the vessel probabilities.
- **Clicking a vessel in focus mode** opens only the inspector card (Figma's "selection brings the inspector back"). Esc closes it and stays in focus mode.
- **Leaving focus:** Esc (when nothing else is open), \\, or the pill button.

### 4.9 Command palette (Ctrl K on Windows/Linux, ⌘K on macOS, or /)

```
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│  canvas + cards dimmed by a 40 % scrim (no blur); palette 640 px wide, 96 px below the top bar │
│                                                                                                │
│             ┌────────────────────────────────────────────────────────────────────┐             │
│             │ ⌕ flip ang                                                     Esc │             │
│             ├────────────────────────────────────────────────────────────────────┤             │
│             │ SUGGESTED                                                          │             │
│             │ ↺  Flip typical angina  (Yes → No)                 CAD 98 % → 91 % │             │
│             │ ◎  Focus LAD                                                     1 │             │
│             │ INPUTS                                                             │             │
│             │ ✎  Typical angina · Symptoms                                   Yes │             │
│             │ ✎  Atypical angina · Symptoms                                   No │             │
│             │ ACTIONS                                                            │             │
│             │ ▶  Start guided demo                                               │             │
│             ├────────────────────────────────────────────────────────────────────┤             │
│             │ ↑↓ move   ↵ run   Tab actions for this row                  Ctrl K │             │
│             └────────────────────────────────────────────────────────────────────┘             │
│                                                                                                │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Material.** `surface/3`, `e-3`, `r-lg`, on a 40 % `scrim` with no blur. The input is h 48, 14/20. Rows are h 36: a 16 px icon, the title at 13/18 `text/primary`, a subtitle at 12/16 `text/tertiary`, and a right-aligned shortcut (`Kbd`) or current value.
- **Groups**, in a fixed order that never changes between keystrokes:
  1. Suggested (empty query and context only)
  2. Vessels & targets
  3. Patients
  4. Inputs
  5. Views
  6. Actions
  7. Pages
- **Empty query.** Shows 3 recents plus these suggestions:
  - Focus LAD
  - Flip typical angina
  - Dissect the thorax
  - Reveal cath result
  - Open a low-risk patient
  - Start guided demo
- **Context first.** With a vessel selected, "Explain LAD", "Isolate LAD" and "Show LAD territory" come first.
- **Inputs.**
  - Binary inputs toggle in place; the row's right side previews the effect, e.g. "CAD 98 % → 91 %" (P2).
  - Numeric and categorical inputs open the Inputs drawer with that row focused.
  - Aliases cover raw keys and abbreviations ("EF", "EF-TTE", "RWMA", "LAD"), so a search finds them, but the result shows the human label.
- **Keys.** ↑↓ move, ↵ runs, Tab opens the action list for the row (Raycast's action panel), Backspace on an empty query goes back a level, Esc closes. Focus stays in the input (`aria-activedescendant`).
- **States:**
  - **Empty:** suggestions.
  - **Typing:** fuzzy subsequence scoring over the title and aliases.
  - **No results:** "No match for 'xyz'", with two ways out: "Search all 53 inputs in the drawer" and "Show keyboard shortcuts".
  - **Loading:** patient pips arrive later; skeleton rows keep their final height.

### 4.10 Keyboard shortcuts

Single-key shortcuts are suspended while focus is in a text field, a number field, a select, a slider, or while the palette is open (Esc still works). Every tooltip and palette row prints its shortcut. Show `⌘` on macOS and `Ctrl` elsewhere.

| Key | Action | Status |
|---|---|---|
| Ctrl K / ⌘K, `/` | Command palette (`/` focuses the drawer search instead while the Inputs drawer is open) | New |
| `?` | Shortcut sheet | Existing |
| `\` | Focus mode on/off | New |
| `I` | Edit inputs drawer (toggle); `/` focuses its search while it is open | New |
| `E` | Explain drawer for the current target (toggle) | New |
| `1` `2` `3` | Select LAD / LCX / RCA (the camera flies, the inspector opens) | Existing |
| `0` or `H` | Home view (clears the selection) | Existing |
| `O` | Isolate the selected vessel (heart + that artery + its territory); Esc returns the camera | New, selection only |
| `G` | Ghost the other structures | New, selection only |
| `[` `]` | Previous / next projection | Existing |
| `P` | Dissect / assemble | Existing (spec) |
| `T` | Territories: Off → Selected → All | Changed (was on/off) |
| `L` | Labels on/off | New |
| `B` / `F` | Beat / flow | Existing |
| `C` | Calm mode | Existing |
| Arrows, `+` `−` | Orbit 15° and zoom while the canvas has focus | Existing |
| Double-click a vessel | Frame it | New |
| **Esc** | Closes the topmost layer, in this order: palette → popover/menu → drawer → isolate/ghost → selection → focus mode | Extended |

---

## 5. Components

Every state below must render at the listed sizes without layout shift. Type tokens are LUMEN §3's: `overline` 11/16 600 +0.08em, `label` 12/16 500, `body-s` 13/18, `narrative` 14/21, `title-2` 16/22 600, `numeral-l` 20/24, `numeral-xl` 48/48 at 1440 and 40/40 at 1280, `mono-s` 12/16. Motion tokens are LUMEN §6's.

**Type budget per region.** The Risk card uses at most 6 styles: `overline`, `numeral-xl`, `numeral-l`, `body-s` 400, `body-s` 600, `label` 400. The patient card uses at most 5: `overline`, `body-s` 400, `body-s` 500, `body-s` 600, `label`. The whole workstation at rest uses at most 9. **11 px is allowed only for `overline`, `Kbd` and credits.** Every `text-[0.6875rem]` caption is removed.

### 5.1 Top bar v2 (`features/shell/TopNav.tsx`)

- **Layout.** h 48 (40), `bg/app`, bottom hairline. From left to right:
  - brand;
  - nav: `Workstation · Performance · Method`, 13/18 500, with a 2 px accent underline on the active item;
  - flexible space;
  - **search field**: 280 × 32, `surface/1`, `⌕ Search or jump to…` plus a `Ctrl K` Kbd. At 1280 it collapses to a 32 px icon button;
  - flexible space;
  - **PatientChip**;
  - **EngineDot**;
  - **Guided demo** (ghost button, ▶ icon; "Demo" at 1280);
  - `?` icon button.
- **Landing.** The patient chip, search and Guided demo are hidden. The hero owns the tour CTA.
- **Removed:** the "Tour" label (renamed); the patient summary text in the chip; the edit count text (now a dot); the separate TEST badge in the picker.

### 5.2 PatientChip and PatientSwitcher (`features/shell/PatientChip.tsx` trigger, `features/patient/PatientSwitcher.tsx` content)

- **Chip.** h 32, r-sm, ghost button. It reads `P-011` (mono-s, primary), then the split tag (`TEST` as an accent outline badge, or `DEV` as an outline badge), then a ▾. It adds a 6 px accent dot while edits exist.
  - Tooltip: "Male · 58 y · Held-out test patient: never seen in training".
- **States:**
  - Default.
  - Hover: `surface/1`.
  - Open: `surface/2` + `border/strong`.
  - Edited: dot.
  - Blank patient: reads `Blank patient` with no split tag.
  - Loading: 64 px skeleton.
- **Switcher popover.** 420 × ≤ 520, `surface/3`, `e-3`, anchored below the chip. Contents:
  1. A search field, autofocused. It filters by ID, sex, age and summary.
  2. **Curated cases**: 4–6 IDs from `features/patient/curated.ts`. Each row (h 44) has a mono ID, a feature-based line ("61 y F · atypical angina · diabetic"), and, once predicted, a CAD pip + %. The curated set never reveals cath labels in its descriptions.
  3. **Held-out test (61)** and **Development (242)**. Row h 36: ID, compact summary and CAD pip. Pips are shown only if cohort predictions exist (§9, ML request).
  4. Footer actions: **New blank patient** (schema defaults, 0 edits) and **Random test patient**.
- **Motion.** Popover: fade + y 4 over `fast`. Rows keep their final height while loading.
- **Removed:** the left-panel combobox, the Cohort/Custom switch, the truncated "Custom patient — pick a cohort patie…" placeholder, and "cath hidden" on every row.

### 5.3 EngineDot (`features/shell/EngineBadge.tsx`)

- An 8 px dot inside a 24 px hit area. Colours:
  - `success` for Server ✓;
  - `accent` for Edge;
  - `text/tertiary` for resolving or offline;
  - `danger` for Error.
- **Popover:** "Server ✓ · matches edge (|Δp| < 1e-6)", model version, last latency, render tier and fps, plus a "Model card ›" link.
- It keeps every LUMEN EnginePill state. Only the resting representation shrinks. `Verifying` keeps the 1 px indeterminate hairline under the top bar (> 150 ms only).

### 5.4 Primitives (`design/`)

**StageCard.** `bg/panel`, 1 px ring `border/default`, `e-2`, `r-lg`, padding `--card-pad`, `overflow: clip`, and `position: relative` (the audit's P0-1 class of bug cannot recur). The header is optional: h 24–32, with the overline on the left and actions on the right. Headers use no icons.

| State | Behaviour |
|---|---|
| enter | y 8 → 0 and opacity 0 → 1 over `base`, staggered 60 ms |
| exit | toward the nearest edge by 12 px and fade, over `exit` (170 ms) |
| compact | height animates over `base`; content crossfades over `fast` |
| loading | skeleton at the final height |

**Drawer.** Docked to the stage edge, full stage height, `bg/panel`, `e-3`, 1 px `border/default` on its inner edge, `role="dialog"`, `aria-modal="false"`. Focus moves to the first field on open and returns to the opener on close. Esc closes it.

- **Motion:** translateX from −100 % (or +100 %) to 0 over `flyout` (360 ms); exit over 250 ms with `exit` easing. Content fades in over `fast` after an 80 ms delay.
- **URL:** `?panel=inputs|explain&tab=…`.
- **Rule:** only one drawer is open at a time. Opening the second one closes the first.

**Menu / Popover.** `surface/3`, `e-3`, `r-lg`, items h 32, 13/18. The shortcut is right-aligned as a `Kbd`. Radio and checkbox items show a 16 px check.

**Kbd.** h 18, padding 0 4, r-xs, 1 px `border/default`, mono 11/16 `text/tertiary`.

**Tooltip fix (P1-11).** A tooltip closes on `pointerdown` and on `click` of its trigger, and it never reopens until the pointer leaves and re-enters. Delay 120 ms; opens immediately on focus.

**Scroll containers.** Every scrolling element gets `position: relative`, and every clipping ancestor uses `overflow: clip`, not `hidden`. A unit test asserts that focusing any field does not change `scrollTop` on a non-scrolling ancestor.

### 5.5 Patient card (`features/patient/PatientCard.tsx`)

This region answers "What did the model see, and which inputs matter most for the current target?"

**Anatomy at 1440** (w 280, padding 16):

1. **Header, h 32.** "Male · 58 y" in `body-s` 600 `text/primary`. On the right, a ⇤ icon button (28 px): "Collapse (to rail)".
2. **Overline, h 24.** `DRIVES CAD MOST`. It changes to `DRIVES LAD MOST` etc. when a vessel is selected; the text crossfades over `fast`.
3. **Ranked rows** (5 rows, h 32 each, 28 at 1280).
   - **Contents.** The top five features by |SHAP| for the current target, excluding Age and Sex (they are in the header). Ties break by schema order. The list re-ranks only on a committed prediction, never mid-drag.
   - **Label.** `body-s` 400 `text/secondary`. The label column is 150 px (136 at 1280); a longer label truncates with an ellipsis and a tooltip, never mid-word under 12 characters.
   - **Value.** `body-s` 500 `text/primary`, tabular, right-aligned, with the unit in `label` `text/tertiary`. Binary values read "Yes" or "No".
   - **Out-of-range glyph.** ▲/▼ in `text/secondary`, only when the value is outside `schema.normal`.
   - **Direction mark** (24 px column). A 2-cell mini diverging bar in the SHAP raise (`#FB9167`) or lower (`#7374BD`) colour, ending in a ▶ or ◀ tip, with its length in 3 steps by |SHAP| share.
   - **aria-label:** "Typical angina, yes, raises CAD risk strongly."
4. **Abnormal link, h 32.** `+ 4 abnormal findings ›` in `label` 500 `text/secondary`. It opens the Inputs drawer scrolled to "Outside normal range". It is hidden when the count is 0.
5. **Footer.** `[✎ Edit inputs  I]`: a secondary button, full width, h 32.

| State | Behaviour |
|---|---|
| default | as above |
| row hover | `surface/1`. Sets `highlightedFeature`, which highlights the matching SHAP row and narrative phrase. **Never anatomy.** |
| row click | Opens the Inputs drawer with that field focused and expanded |
| edited row | 6 px accent dot before the label; tooltip "was Yes" |
| target change | Rows FLIP to their new order over `base`. A row entering the top 5 fades in; one leaving fades out. |
| loading | 5 skeleton rows at 32 px |
| no prediction | The ranking falls back to the schema order of the key groups (symptoms, ECG, echo), and the direction marks are hidden |
| collapsed → **rail** | 40 × 116: ◧ Record (expand), ✎ Edit inputs (I, shows the accent dot when edited) and ⌕ (palette). Tooltips print the shortcuts. |
| auto-collapsed | While the Explain drawer is open; restored when it closes |

**Removed from the left side** (audit inventory): the "PATIENT" eyebrow; the Cohort/Custom switch; the combobox and its TEST badge; "Recorded values" and "n edits"; the A/B button; the always-disabled Reset; the 7 accordions at rest; the group share bars and signed sums; the "ref …" and "▲ above normal" lines; "recorded X"; "♥ sets beat"; the 27 No/Yes rows; and the 80 px numeric rows.

### 5.6 Edit inputs drawer (`features/patient/InputsDrawer.tsx`)

This region answers "What if I change something?" (see the wireframe in §4.4).

**Structure** (w 400, padding 16, scroll body with `position: relative`):

1. **Header, h 40.** Overline `EDIT INPUTS · 53` and ✕ (Esc).
2. **Search, h 32.** `surface/1`, ⌕, placeholder "Find an input — e.g. ejection fraction". Matches the label, aliases and raw key. While there is a query, the sections flatten into a ranked result list, and the group name shows as a `label` `text/tertiary` suffix.
3. **Sections.** Each section header is sticky, h 32, overline plus count; the right side is empty or holds an action.
   1. **Changed · n**, only when n > 0. Header action: "Reset all".
   2. **Outside normal range · n**: numeric values outside `schema.normal`, plus **present findings** (binary = Yes).
   3. **Most influential for {target} · n**: the top 8 by |SHAP| that are not already listed.
   4. **All inputs · 53**: the 7 schema groups as collapsed accordions (h 32 header: name, count, an accent dot if edited, and "n imputed" in `label` `text/tertiary` when relevant). No share bars and no sums.
4. **Footer, h 56, sticky.** With edits: "2 changes · applied instantly" + `[Done]` (primary, the only filled button on screen). Without edits: "Changes apply instantly" + `[Done]`.

**FieldRow (numeric).**
- **At rest:** h 32 (28 at 1280). Grid: label 1fr (`body-s` 400 `text/secondary`) · value field 72 px (`numeral-m` right-aligned, transparent at rest, `surface/1` + `border/default` on hover or focus) · unit 56 px (`label` `text/tertiary`) · flag 16 px (▲/▼).
- **Focused (expanded):** h 60, animated over `base`, and **only one row is expanded at a time**. It adds:
  - a 4 px track with the normal band in white at 6 %;
  - a hollow ghost tick at the recorded value;
  - a 16 px ICE strip above the track when available;
  - ± step buttons (24 px) and a per-field ↺ when changed;
  - "ref 52–72 %" in `label` `text/tertiary` on the right of the track.
- **Other states:** hover (`surface/1`, and after 400 ms a tooltip with the description and reference range); edited (accent dot + value in 600 + "was 58" at `label` `text/tertiary` on the right, replacing the unit column's padding); imputed (dashed underline + `IMP` tag + tooltip "filled with the cohort median"); invalid (`danger` border + message below; the row grows to 52 and stays expanded); disabled.
- **Keyboard:** ↑↓ nudge by a step, PgUp/PgDn by 10 steps, Enter commits, Esc reverts the uncommitted text.
- **Expand on focus, not hover.** Hover-expansion would move the rows under the cursor.

**FieldRow (categorical).** Label + SegmentedControl h 24 (up to 5 options; Region RWMA is numeric and uses the numeric row). The option tooltip gives the full term (BBB, VHD).

**FindingChips (binary).** One cloud per section or group, wrapping, with a 6 px gap. Each chip is h 28, r-sm, `label` 500.

| State | Look |
|---|---|
| absent | transparent, 1 px `border/default`, `text/secondary` |
| present | `accent/subtle` fill, 1 px accent border, `text/primary`, 12 px ✓ |
| edited | accent dot on the leading edge |
| hover (P2) | after 300 ms, tooltip "If present: CAD 99 % (▲ +1 pt)" from a cached counterfactual prediction |
| focus | ring |
| pending | 40 % opacity while its own counterfactual computes |
| disabled | as LUMEN |

Chips are `aria-pressed` toggle buttons. The group's accessible name is "Symptoms findings".

**Motion.**
- Drawer: §5.4.
- Row expand/collapse: `base`.
- A section count changing crossfades over `fast`.
- A field moving into "Changed" does **not** move instantly. The row flashes a 1.2 s accent rule where it is, and "Changed" appears at the top with FLIP after commit.

**Removed here:** the per-row ICE strip, slider, ref line and captions at rest; the "recorded X" caption; the counterfactual captions under toggles (they move to hover tooltips, P2); and the GroupRail with its 9 unlabelled icons.

### 5.7 WhatIfPill and stage frame (`features/patient/WhatIfPill.tsx`)

- **Shown only while edits > 0.** It sits in the context slot, h 32, r-full, `bg/panel` + `border/default` + `e-2`:
  `● What-if · 2 changes · [Hold to compare] · [Reset]`
- **Hold to compare.** A press-and-hold button. With keyboard focus on it, holding Space does the same. While it is held:
  - the whole app shows the **recorded** prediction;
  - numbers tween over `data`, and the 3D vessels re-sample the LUT;
  - on release it returns to the what-if state.
  - `aria-pressed` reflects the state, and keyboard Space-hold works.
- **Reset** asks for nothing and has undo: a toast "Inputs reset · Undo" for 6 s.
- **Stage frame.** A 1 px accent inset outline at 40 % around the stage, fading in over `base`.
- **Baseline is automatic.** The prediction for the recorded inputs is kept as the baseline from the first edit onward. The A/B pin button is removed.

### 5.8 Risk summary card (`features/risk/RiskSummaryCard.tsx`)

This region answers "How likely is CAD, and which vessels are flagged?" (`data-region="risk-card"`)

**Anatomy at 1440** (w 352, padding 16):

1. **Header, h 24.** Overline `CORONARY ARTERY DISEASE` (`text/secondary`), then an (i) button (16 px; tooltip = target description), then on the right a **Model estimate** tag (h 20, r-sm, 1 px `border/default`, overline `text/tertiary`).
2. **Headline, h 56** (margin-top 8).
   - **Left:** `98 %` in `numeral-xl`, `data-prob="CAD"`.
   - **Right:** the BandChip (sm: 8 px pip + band word as overline, 2 px band rule, **no meter**).
   - **While edits exist,** a line under the numeral reads "was 98 % · ▼ −7 pts" (`label` `text/secondary`), and the headline grows to 76 px. The "was" value is a different quantity (the baseline), so it carries `data-baseline`, not `data-prob`.
3. **Track, h 16.** A 4 px `border/default` track with 1 px band ticks at 25/50/75. The threshold tick is 2 × 12 px `text/primary`. The value marker is 10 px `riskHex(p)` with a 1 px bg ring, plus a hollow accent ghost marker at the baseline while edits exist. **No scale numerals.** Hover or focus shows a tooltip "0 · 25 · 50 · 75 · 100 % · threshold 75 %".
4. **Verdict, h 20.** `● Flagged — above the 75 % threshold` in `body-s` 600 `text/primary`. When it flips, it slides 6 px over `fast` and is announced politely.
5. **Narrative** (margin-top 8). `body-s` 400 `text/secondary`, 13/20, at most 3 lines. It comes from the template (§5.10 grammar). Phrases have a dotted underline: hover highlights the input row, click opens the Inputs drawer at that field.
6. **Context line.** "A typical patient in this cohort scores 83 %." in `label` `text/tertiary`. It comes from `platt(base_value)`.
7. **Hairline** (margin 16 0).
8. **Vessels header, h 24.** Overline `VESSELS`; on the right "3 of 3 flagged" (`label` `text/secondary`).
9. **VesselRow × 3** (below).
10. **Footer, h 32** (margin-top 12):
    - `[Explain  E]`: secondary, flex 1.
    - `[Reveal cath result]`: ghost, TEST patients only. After reveal it becomes the text "Cath agrees on 3 of 4 targets", which opens a tooltip listing each target.

**VesselRow v2** (`data-prob="LAD"` on the numeral):
- **Size.** h 36, padding 0 8, r-sm. The whole row is one button (`aria-pressed`).
- **Columns:** pip 8 + code (`body-s` 600, 36 px) · % (`numeral-l`, 56 px, right-aligned) · Δ (40 px, `label`; only while edits exist; "▼7") · track (flex, min 72) · verdict (84 px: "● Flagged" `label` 500 `text/primary`, or "○ Not flagged" `text/secondary`).

| State | Look |
|---|---|
| default | as above |
| hover | `surface/1`; drives `viewerStore.hover`, which lights the 3D vessel |
| selected | `surface/2` + 2 px accent left rule. **The other rows stay at full opacity**, so the list remains readable. |
| pending | numeral at 50 % + "Updating" in place of the verdict |
| unavailable | "–" and "Estimate unavailable" in the verdict column |
| revealed | a second line, h 16: "● Stenotic at cath · agrees ✓" in `label`. The row grows to 52. |

**Selected variants.** These keep one "why" sentence on screen and keep the right column inside the stage.
- **At 1440 with a vessel selected:** the narrative and context line are hidden (≈ 364 px tall).
- **Compact, at 1280 or any stage ≤ 680 px tall, with a vessel selected:** the header, headline, verdict and the three rows remain (≈ 256 px). The track, vessels header and footer are also hidden. Explain moves to the inspector's `Why` button; Reveal joins the inspector's action row. The numeral stays `numeral-xl`.

**Card states:**
- skeleton (pixel-matched: 48 px numeral block, 16 px track, 3 × 36 rows);
- value;
- updating (stale after 150 ms: numerals at 50 %, band chip "Updating", marks `#4B5260`);
- error ("Estimate unavailable", with one line of reason and the server hint; vessel rows show "–");
- threshold crossed;
- revealed;
- compact.

**Removed:** the 4-segment meter; the RiskTrack scale "0 / thr 75 % / 100"; the "Model estimate, not a diagnosis" line (now the header tag); the "P(stenosis)" aside; "≈ 1.7 of 3"; the vessel chevrons; the band word on the rows; the TEST badge and caption on Reveal; the WHY section; the target tabs; the Physiology section.

### 5.9 Vessel inspector card (`features/risk/VesselInspector.tsx`)

This region answers "Why this vessel?" (`data-region="inspector"`). It **exists only while a vessel is selected.**

**Anatomy** (w 352, padding 16):

1. **Header, h 32.** 8 px pip, then `LAD` in `title-2`, then "Left anterior descending" in `body-s` `text/secondary`, then ✕ ("Clear selection · Esc").
2. **Reconciling sentence** (`body-s` 400 `text/primary`, 2 lines): "High probability band (50–75 %). Flagged: above LAD's 55 % threshold." The "threshold ›" link opens Explain › Model.
3. **Narrative for the vessel** (`body-s` `text/secondary`, ≤ 3 lines). It uses the same grammar as the CAD narrative.
4. **Top drivers.** 3 rows of h 28 (direction tip, label, value). **Rendered only while the patient card is collapsed**, because otherwise the patient card is their home.
5. **Cohort position** (P2, h 24). A strip of 303 dots, with this patient as a 6 px `riskHex(p)` dot, and "higher than 71 % of cohort patients". It needs the cohort predictions artifact (§9); if that is missing, the row is hidden.
6. **Actions, h 32.** `[Isolate O]`, `[Ghost others G]` and `[Why E]`, as ghost buttons, plus `[Reveal]` while the Risk card is compact (TEST patients only). The pressed state is accent. At 320 px the labels shorten to Isolate · Ghost · Why · Reveal.
7. **After reveal,** a line: "Stenotic at cath ● · agrees ✓".

**States:**
- Entering: y 8 → 0 + fade over `base`, starting at t = 0 of the selection. It never waits for the camera.
- Switching vessel: content crossfades over `fast` and height animates over `base`.
- Pending: "Updating".
- Isolate or ghost active: the button is pressed and the selection chip reads "LAD · Isolated ✕".
- Exit: over 170 ms, when the selection is cleared.

The inspector title and pip replace the canvas breadcrumb ("Heart › Coronary › LAD").

### 5.10 Explain drawer (`features/explain/ExplainDrawer.tsx`)

This region answers "Show me all the evidence" (see the wireframe in §4.5).

**Header** (h 88, sticky):
- The target SegmentedControl (`CAD · LAD · LCX · RCA`, h 28). Changing it calls `select()`, so the camera, rows and inspector follow.
- ✕.
- **Title as takeaway** (`title-2`), one per tab:
  - Why: "CAD 98 % is driven mostly by typical angina". This is the fallback home for the numeral while the drawer covers the Risk card.
  - What-if: "2 changes lowered CAD by 7 points".
  - Physiology: "5 values outside the normal range".
  - Model: "How this estimate is made".
- Subtitle (Why tab only): "A typical cohort patient scores 83 %."
- Tabs (h 32, 2 px accent underline): **Why · What-if · Physiology · Model**.

**Why** (default):
- Two groups, **Raising risk** and **Lowering risk**. Rows h 28:
  - direction tip ▶/◀ in the SHAP raise/lower colour;
  - label (`body-s` `text/secondary`);
  - value + unit (`label` `text/tertiary`);
  - diverging bar (max 120 px, scale shared per target);
  - signed log-odds (`numeral-m`, decimal-aligned, U+2212).
- Default: the top 5 in each group, then "+ n smaller contributions · Show all ▾" (virtualised).
- `[By feature | By group]` toggle.
- Footnote in `label` `text/tertiary`: "Bars are log-odds contributions; they add up from the cohort baseline to this estimate. Probability ticks: 10 · 25 · 50 · 75 · 90 %."
- Row states: hover links to the input (`highlightedFeature`); changed row gets an accent rule for 1.2 s; negligible rows (|shap| < 0.02) at 40 % opacity; FLIP reorder.

**What-if:**
- P1: the baseline versus what-if comparison: "Recorded 98 % │ What-if 91 %" for each target, as bar pairs (ACC "now vs after"). The title carries no probability on this tab, so these rows are the only home of the numbers.
- P2: **Biggest levers**. For the top 8 modifiable features, show the counterfactual p if the value is flipped or moved to normal ("Typical angina Yes → No · CAD 98 % → 91 %"). These are computed by the server (batched, cached per input state), and each row has an "Apply" button.

**Physiology:** the table (value · reference mini-bar · abnormal ▲/▼). "Abnormal only" is on by default. Row hover links to the input.

**Model:**
- the model's human name (from `lib/modelNames.ts`: "Logistic regression + gradient-boosted trees, calibrated");
- the threshold with one sentence on how it was tuned;
- **test ROC-AUC with CI and n** ("0.86 [0.74–0.95] · n = 61 · single centre");
- the calibration note;
- the expected-vessels explanation (§3.2);
- the engine, model version and prediction hash;
- a "Model performance ›" link.
- P3: the band ladder with the observed stenosis rate per band on the test set.

**Removed from the main surfaces into this drawer:** "log-odds · base E[f(x)] → f(x)"; SHAP numbers; the Physiology table; the "+45 more" list; the "Show all" controls; the model and Platt footnotes.

**Narrative grammar (C, `lib/explain.ts`).**
- Template: `{Driven mostly by} {up₁} and {up₂}; {down₁} pulls it down.`
- Phrase rules:
  - binary present → the phrase ("typical angina");
  - binary absent and lowering → "no {phrase}";
  - numeric within normal → "a normal {phrase}";
  - numeric outside normal → "a {high|low} {phrase}";
  - count 0 → "no {phrase}" ("no regional wall-motion abnormality").
- No numbers in the narrative except the context line.
- The narrative never reads "0 regions pulls it down".

### 5.11 Canvas toolbar (`features/workstation/hud/CanvasToolbar.tsx`)

This region answers "How do I look at it?" (`data-region="toolbar"`).

**Material.** h 40 (36), r-lg, `bg/panel`, 1 px `border/default`, `e-2`, padding 4. Groups are separated by 1 × 20 `border/hairline`. Icon buttons are 32 × 32 (28 at 1280), 16 px lucide at stroke 1.5, r-sm. The pressed state is `surface/2` + an accent icon. Every tooltip reads "Name · key".

| Group | Control | Spec |
|---|---|---|
| View | **View menu** `AP ▾` (a text button with the current preset name; "Custom" after a free orbit) | Menu: AP, LAO 45, RAO 30, LAO 45 / CRA 20, RAO 30 / CAU 25, Posterior (`[` `]` to cycle), a divider, then Home view (H) and "Frame selection · double-click" |
| | ⌂ Home | Flies home and clears the selection |
| Anatomy | **Peel slider** 144 px | Detents: Closed · Skin off · Ribs open · **Lungs aside ◆** · Open heart. It is magnetic within ±0.02, and the detent name shows in a tooltip above the thumb while dragging. Keys: ←/→ step between detents. |
| | ▶ Dissect / ■ / ⟲ Assemble | P |
| Layers | **Layers ▾** popover (280 px) | Look: `Clay · Anatomical` (+ X-ray, P2) · Territories: `Off · Selected · All` (T) · Labels switch (L) · Anatomy layers: Skin, Chest muscles, Rib cage, Lungs & airway, Diaphragm, each with an eye toggle and a hand-changed dot · Ghost removed layers switch · a "Territory tint = approximate supplied territory, not a perfusion scan" note · Reset layers |
| Physiology | ♥ Beat (B) | Tooltip "Heartbeat · 70 bpm from the patient's pulse". Pressed = on. |
| | ≋ Flow (F) | Tooltip "Illustrative coronary flow" |
| Chrome | ⤢ Focus (\\) | |
| | ⋯ More | Calm mode (C) · Quality: Auto (tier B · 60 fps) › A/B/C · Free orbit (unclamped) · Full screen · Keyboard shortcuts (?) |

**States:** default; a control disabled by the render tier (the tooltip says why); peel playing (the thumb is locked and a click cancels); menu open.

**Removed:** the always-visible AP/LAO/RAO segmented control; the Territories/Beat/Labels/Calm chips; Clay|Anat on the canvas floor; the "Drag to rotate…" sentence; the "Beat 70" label; the fullscreen button in the top-right corner.

### 5.12 Context slot: selection chip (`features/workstation/hud/SelectionChip.tsx`)

- h 32, r-full, stage-card material. It reads `● LAD · RAO 30° CRA 25° ✕`: pip, code in `body-s` 600, and angles in `mono-s` `text/tertiary`.
- The angles tick live during the camera flight (the C-arm readout, now inside a legible chip) and then settle.
- Variants: "LAD · Isolated ✕" and "LAD · Others ghosted ✕".
- It is centred in the free area. If the WhatIfPill is also shown, the two sit side by side: selection first.
- Enter/exit: fade + y −4 over `fast`.

### 5.13 Legend chip (`features/workstation/hud/LegendChip.tsx`)

- **Collapsed:** 212 × 40, stage-card material. It shows "Low", a 120 × 6 Ember ramp (r-xs) with the current target's threshold tick, then "Very high", all in `label` `text/tertiary` and `text/secondary`.
- **Expanded** on hover or focus: a popover (280 px, upward) containing:
  - the band ladder (4 rows: pip · band word · range);
  - "Tick = decision threshold for {target} ({thr} %)";
  - LM as a grey swatch: "Left main · not predicted";
  - "Territory tint = approximate supplied territory, not a perfusion scan";
  - "Flow is illustrative";
  - "Vessel-level risk · no lesion localisation".
- **Removed:** the 0/25/50/75/100 scale numerals, "P(stenosis) · thr LAD" and the caption sentence at rest.

### 5.14 3D vessel labels v2 (`three/labels/*`)

**Content.**
- At rest (`chrome = workstation`): an 8 px pip + code (overline) on a `surface/3` chip at 88 % with a 1 px `border/default`. h 24.
- With `chrome ∈ {focus, landing}`: add `numeral-label` "65 %" (`data-prob`). h 28.
- No band word or meter in any state.

**Lanes** are computed inside `stageInsets`: never under a card, never clipped at the canvas edge. They follow the radiological convention (RCA on viewer-left, LAD and LCX on viewer-right) and swap when |azimuth| > 90°. Labels are at least 28 px apart and leaders never cross.

**Selection (fixes P0-2).**
- The selected vessel's label is **always at full strength**, with an accent 1 px ring and a solid leader.
- Its anchor is re-chosen every 200 ms. The anchor is the centreline sample (from `vessels.json`) in the vessel's proximal–mid 60 % that faces the camera most. It moves only when that choice is stable for 200 ms, so it never jitters.
- Unselected labels go to 40 % with a dashed leader. A far-side unselected label adds "(behind)" in `label` `text/tertiary`.

**Hover.** The border becomes `border/strong` and the 3D outline appears (LUMEN §7.5).

**States:** default · hover · selected · dimmed · behind · pending (grey pip) · compact (canvas < 640 px: pip + code only).

**Motion.** Labels fade in LAD → LCX → RCA (`fast`, 60 ms apart) after ignition. The switch to showing % crossfades over `fast`. The band-change ring (LUMEN §6) plays on the pip.

### 5.15 Scene defaults in the workstation (fixes P1-9)

Figure/ground: the coronary tree is the only saturated thing, and the heart is the only solid thing.

- **Lungs & airway** are hidden in the workstation stage by default (Layers can show them). The landing hero keeps them as a Fresnel ghost.
- **Intrapulmonary trees.** The pulmonary artery and pulmonary vein nodes are clipped to a sphere around the heart (a `uClipRadius` uniform, with a 0.15-unit alpha fade). Only the proximal trunks remain, so the "dead branches" disappear.
- **Ribs, skin and muscle** stay at the peel rest state (e = 0.60) as ghosts at α ≤ 0.12.
- **Territories** default to **Selected**: plain clay at rest; with a vessel selected, only its territory is tinted at `0.10 + 0.25·p`.
- **No emissive on the myocardium.** Bloom `luminanceThreshold` is tuned so that only vessels with p ≥ 0.70 glow. This removes the magenta wash.
- **Orbit.** The polar angle is clamped to 35°–145° and the distance to 2.4–7 in the default mode, so judges cannot lose the heart. Free orbit is available in ⋯.

### 5.16 Answer pill (focus mode, `features/risk/AnswerPill.tsx`)

- h 40, stage-card material, r-full. It reads `CAD 98 %` (`numeral-l`, `data-prob="CAD"`), then the BandChip, then "3 of 3 flagged", then `[Exit \]`.
- Click on the numeral: exits focus mode and focuses the Risk card.
- Enters over `base` after a 120 ms delay; exits over 170 ms.

### 5.17 Status line v2 (`features/shell/DisclaimerBanner.tsx`)

- **Left:** (i) and the LUMEN wording. "Not a diagnosis" is set in `text/primary` 500.
- **Right:** "BodyParts3D © DBCLS · CC BY-SA 2.1 JP" (11 px `text/tertiary`, on every route that shows anatomy), then "Details ›".
- **At ≥ 1440** it also carries "Vessel-level risk · no lesion localisation".
- Every LUMEN §9 hard rule still holds.

### 5.18 Loading (fixes P0-4)

- **Poster.** The workstation slot shows a poster (`public/posters/workstation.webp`, rendered at the workstation home pose, ≤ 120 KB) from first paint. A 1 px accent hairline progress bar runs across the top of the stage, and "Loading anatomy 3.1 / 7.8 MB" appears in `label` `text/tertiary` at the stage's bottom-left.
- **Crossfade.** The canvas crossfades in over 300 ms **on its first rendered frame**, not on GLB load.
- **Timing.** The loader waits 200 ms before showing and then stays for at least 400 ms, so it never flashes.
- **No blank frame is ever visible.** Panels show real numbers before the GLB, as LUMEN already requires.

### 5.19 Shortcut sheet v2 (`features/shell/ShortcutSheet.tsx`)

- A 560 px modal with two columns: **Navigate** and **Inspect** · **Edit** and **View**.
- It is generated from the same registry as the palette, so the two can never drift apart.

### 5.20 Removal ledger (the audit's inventory, row by row)

| Area | Element | V2 fate | New home |
|---|---|---|---|
| Top bar | Brand, nav | Kept | Nav shortened to Workstation · Performance · Method |
| Top bar | PatientChip | **Merged**: the only identity, and the switcher trigger | §5.2 |
| Top bar | EngineBadge "Server ✓" | Kept as a dot; details behind a popover | §5.3 |
| Top bar | Tour | Renamed **Guided demo**; runs as 5 chapters | §6.3 |
| Left | "PATIENT" eyebrow | **Removed** | |
| Left | Cohort/Custom switch | **Removed**; "New blank patient" lives in the switcher | §5.2 |
| Left | Combobox + TEST badge | **Merged** into the top-bar chip | §5.2 |
| Left | "Recorded values" / "n edits" | **Removed**; the WhatIfPill appears only while edits exist | §5.7 |
| Left | A/B pin | **Removed**; the baseline is automatic, plus hold-to-compare | §5.7 |
| Left | 7 accordions | Kept, **behind the drawer**, collapsed | §5.6 |
| Left | Group share bar + signed sum | **Removed** | |
| Left | Group edited / imputed marks | Kept (dot, "n imputed") | §5.6 |
| Left | Numeric label/value/unit | Kept, 32 px | §5.6 |
| Left | Slider | **On focus only** | §5.6 |
| Left | "ref …", "▲ above normal" | **Merged**: a ▲/▼ glyph at rest; the range in the tooltip and the expanded row | §5.6 |
| Left | "recorded X" | **Removed**; the ghost tick and a "was" value while edited | §5.6 |
| Left | ± nudge, per-row ↺ | Kept, focus only | §5.6 |
| Left | "♥ sets beat" | **Removed**; the Beat tooltip says it | §5.11 |
| Left | 27 No/Yes pairs | **Merged** into FindingChips | §5.6 |
| Canvas | Breadcrumb | **Merged** into the selection chip | §5.12 |
| Canvas | C-arm readout | **Moved into** the selection chip | §5.12 |
| Canvas | AP/LAO 45/RAO 30, Home, Fullscreen | **Merged** into the toolbar's View menu, ⌂, and ⋯ | §5.11 |
| Canvas | Watermark | **Removed from the live canvas**; the "Model estimate" tag; still burned into exports | §2 |
| Canvas | Vessel labels + leaders | Kept, slimmer, margin lanes | §5.14 |
| Canvas | Legend | Kept as a chip | §5.13 |
| Canvas | Legend caption sentence | **Moved** into the expanded legend and the Layers popover | §5.13 |
| Canvas | Interaction hint line | **Once per browser**, fades on the first drag | §8.7 |
| Canvas | Territories/Beat/Labels/Calm/Clay·Anat | **Behind** Layers ▾ and ⋯, except Beat and Flow | §5.11 |
| Canvas | Credits | **Moved** to the status line | §5.17 |
| Right | "OVERALL · CAD" + ⓘ | Kept, as "Coronary artery disease (i)" | §5.8 |
| Right | 98 % numeral, band word | Kept | §5.8 |
| Right | 4-segment meter | **Removed** | |
| Right | RiskTrack + scale | **Merged**: a thin track with a threshold tick and no numerals | §5.8 |
| Right | Verdict line | Kept, with the new vocabulary | §3.2 |
| Right | "Model estimate, not a diagnosis" | **Merged** into the header tag | §5.8 |
| Right | DeltaChip | Kept, as the "was … · ▼ −7 pts" line | §5.8 |
| Right | "P(stenosis)" aside | **Removed** | |
| Right | Vessel rows | Kept: code, %, track, verdict. No meter and no chevron. | §5.8 |
| Right | "≈ 1.7 of 3 expected" | **Moved** to Explain › Model with an explanation | §3.2 |
| Right | Reveal + TEST + caption | **Condensed** into one ghost button; the caption becomes the chip tooltip | §5.8 |
| Right | WHY target tabs | **Merged** with selection; tabs exist only in the drawer | §5.10 |
| Right | Narrative | **Promoted** under the verdict | §5.8 |
| Right | "log-odds · base E[f(x)]…" | **Moved** to the drawer footnote | §5.10 |
| Right | SHAP rows ×8 + "+45" | **Moved** to the drawer; the patient card shows the top 5 values | §5.5, §5.10 |
| Right | "typical 83 % → this patient 98 %" | **Promoted** as the context line (without repeating 98) | §5.8 |
| Right | Physiology | **Moved** to the drawer tab | §5.10 |
| Footer | Status line | Kept, plus the credits | §5.17 |

---

## 6. Landing page, tour and secondary pages

### 6.1 Landing (`#/`, 1440×900): the heart unboxed

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◆ CardioTwin   Workstation  Performance  Method                                                                   ●  │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                          full-bleed canvas behind the copy, no frame                 │
│   CORONARY RISK, VESSEL BY VESSEL                                                                                    │
│                                                                                                                      │
│   An explainable                                                          .-~~~~~~~-.                                │
│   coronary digital twin.            (display-1)                         .'  ┏━━┓ ┏━━ '.                              │
│                                                           ● RCA 47 % ──(    ┃  ┗━━━━━  )──── ● LAD 65 %              │
│   Predicts CAD and LAD · LCX · RCA stenosis from                        (  ┏┛  ┃     )                               │
│   53 routine clinical inputs, explains every                             '.┗━━┓ ┃  .'──────── ● LCX 56 %             │
│   estimate with exact SHAP, and maps it onto                               '-._┗━┛.-'                                │
│   real anatomy.                                                                                                      │
│                                                                                                                      │
│   [ Open the workstation → ]   ▶ Guided demo · 90 s      P-011 · held-out test patient · Next ↻                      │
│   Opens on a patient the model never saw. No login.                               Interactive 3D · drag              │
│                                                                                                                      │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 303 patients           │ 53 clinical inputs     │ 4 targets              │ CAD test ROC-AUC 0.86 [0.74–0.95] · n = 61│
│ single centre          │ routine clinical data  │ CAD · LAD · LCX · RCA  │ ✓ targets never inputs ✓ test scored once │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 01 PREDICT   98 % ▌VH      │ 02 EXPLAIN   ▶▶▶ ▶▶ ◀      │ 03 MAP   ● ● ●             │ 04 VALIDATE   ╱‾ ROC curve    │
│ one sentence + live number │ 3 direction marks          │ vessel pips, deep link     │ ROC thumbnail → Performance   │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ (i) Decision support & education only — not a diagnosis; not a substitute for CTCA   BodyParts3D © DBCLS · Details › │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Hero.**
- The canvas is **full-bleed** behind the copy: no bordered frame, no rounded box. The frame is `chrome = landing`.
- A left-to-right `bg/app` → transparent gradient (0–45 % of the width) guarantees the text contrast. This is chrome, not glass.
- The heart is framed on the **coronaries**, not the pulmonary tangle: the `heart` pose from the manifest, lungs as a Fresnel ghost, and the intrapulmonary trees clipped (§5.15). The heart's height is ≥ 55 % of the hero height, with its centre at 66 % of the viewport width (view offset).
- **Labels show %.** The Risk card is absent here, so the label is the number's home.
- The turntable runs at 6°/s, stops on pointer-down and resumes after 8 s idle.
- An "Interactive 3D · drag to rotate" tag sits at the bottom-right.
- The patient caption reads "P-011 · held-out test patient · Next ↻" (`label`).

**Copy.**
- One overline, one H1 (`display-1`), one sub-line (15/24), one **primary** CTA ("Open the workstation →") and one **ghost** CTA ("▶ Guided demo · 90 s").
- Remove the top-bar "Start 90-s tour" on landing; there is one tour entry.
- Caption: "Opens on a patient the model never saw. No login."

**KPI strip.**
- Four tiles: patients, inputs, targets and CAD test AUC with CI and n. Values come from `metrics.json` and `schema.json`, never hard-coded, and never count up.
- **Remove "0 leaked labels."** Replace it with a protocol line under the AUC tile: "✓ Targets never used as inputs · ✓ Test set scored once · ✓ Server/edge parity". Each item links to its Methodology anchor.

**Pillars become verbs:** 01 Predict → 02 Explain → 03 Map → 04 Validate. Each card has one sentence and a live micro-visual taken from the hero patient:
- Predict: numeral + band chip.
- Explain: 3 direction marks.
- Map: 3 pips.
- Validate: a ROC thumbnail with the operating point and no number, because the AUC already lives in the KPI strip.

Each card deep-links into that state of the workstation (`?t=`, `?panel=explain`) or into Performance.

**Stretch (P3).**
- **Attract mode.** Numbered hotspots ① LAD ② LCX ③ RCA cycle every 4 s, each with a one-line caption. It stops on the first pointer-down and resumes after 20 s idle.
- **Annotated product still.** A still of the workstation with 5 `+` hotspots: Record, Risk card, Stage, Inspector, Explain.
- **Live lever.** One toggle, "Typical angina: No | Yes", that ripples the vessel colours live on the hero.

**Reduced motion or tier D:** the poster, with no turntable.

### 6.2 Landing → workstation

The glide from LUMEN §6 is kept. The copy exits (240 ms, y −8), the camera glides from the hero pose to the workstation home and the view offset moves to the free-area centre (900 ms). The stage cards then enter (§8.1).

The labels crossfade from "code + %" to "code" at the moment the Risk card appears, so the number hands over from the label to the card in one beat (the one-home rule, made visible).

### 6.3 Guided demo: 5 chapters (`features/tour/*`)

The chapter rail (1–5 with progress) sits top-centre. The caption card (360 px, `surface/3`, `e-3`) is anchored to the spotlit region. The controls are Back · Next · Esc to exit. The CTA copy is "Guided demo · 5 chapters · 90 s". It runs with `chrome = tour`, is resumable from `?`, and restores the prior state on exit. Captions are templates filled from live values, so they are right for any patient.

| # | Chapter | onEnter (the tour does it for the judge) | Spotlight | Caption (one line) |
|---|---|---|---|---|
| 1 | The answer | Load the curated high-risk TEST patient; clear the selection | Risk card | "A patient the model never saw: CAD {p} %, {verdict}. Every estimate is decision support, not a diagnosis (bottom line)." |
| 2 | On the heart | `select('LAD')`: the C-arm flight to RAO 30 / CRA 25 | Stage + inspector | "Each artery has its own model. Colour is probability; the flag uses that vessel's own threshold." |
| 3 | Why | Open Explain › Why | Drawer | "Exact SHAP: what pushes this estimate up and what pulls it down." |
| 4 | Pull a lever | Open Inputs; flip *Typical angina* Yes → No; hold 1.5 s; flip it back on exit | Drawer + Risk card | "Change an input: numbers, colours and reasons update within a frame." |
| 5 | Check against the cath | Close the drawers; **Reveal cath result** | Vessel rows | "The truth from angiography, including where the model is wrong. See how it performs ›" (→ Performance, Protocol strip spotlit) |

### 6.4 Performance page: density rules (`features/performance/*`)

1. **Title = takeaway.** Every chart title states the finding: "Separates CAD from no CAD well on unseen patients: AUC 0.86". The method goes in a `label` `text/tertiary` "How to read" line.
2. **Summary first.**
   - Row 1: the target segmented control, the split control and one sentence that reconciles test and CV: "Test AUC 0.86 (n = 61, CI 0.74–0.95) is below cross-validation (0.94 ± 0.03). That is expected with a small held-out set, and the CI includes the CV value."
   - Row 2: **4 KPI tiles** (ROC-AUC, Sensitivity, Specificity, Brier), each with its CI and n.
   - PR-AUC, F1 and MCC move into a "More metrics" disclosure.
3. **Human names only.**
   - Features use `schema.features[].label` (Typical angina, Regional wall-motion abnormality, Ejection fraction), never dataset keys ("Typical Chest Pain", "Region RWMA", "EF-TTE", "HTN", "Tinversion", "FBS").
   - Models use `lib/modelNames.ts` ("Logistic regression (elastic net)", "Ensemble: logistic + gradient-boosted trees"), never `lr_elasticnet`, `lr_l2`, `lr_core` or `svm_rbf`.
   - The name map is shared with Methodology, so the two pages never disagree about which model this is.
4. **Leaderboard.** Highlight the row whose id equals the deployed model (the ensemble), not `i === 0`. When another model ties or beats it in CV, add one line saying why it was not deployed. Examples: CAD, where random forest ties the ensemble at 0.94; RCA, where logistic regression scores 0.74 against the ensemble's 0.73.
5. **Axes.**
   - Use `d3.scale.nice()` with 4–5 round ticks. No tick values like 0.71, 0.42, −0.17.
   - Axis titles sit outside the tick labels, with ≥ 8 px clearance. Rotated y titles are replaced by a horizontal title at the top-left of the plot.
   - Gridlines at 4–5 per axis, white at 6 %.
6. **Fixed chart height.** 240 px at 1440 (200 at 1280). The skeleton, empty, error and ready states all have the same height.
7. **At most 2 text sizes per chart module.** Title (`title-2`) and body/axis (`label`). Values in tooltips use `numeral-m`.
8. **Neutral charts** as in LUMEN: the operating point is the only accent mark, with a permanent annotation "deployed thr 0.75" and live metrics on hover (a crosshair on the axes, not an occluding tooltip).
9. **Section rhythm** on a 12-column grid with 24 px gutters. Sections are 32 px apart. The order:
   - Summary;
   - Discrimination: ROC + PR;
   - Calibration: reliability + decision curve;
   - Decisions: confusion + linked threshold;
   - Models: leaderboard + global drivers;
   - Protocol strip.
10. **No false precision.** Metrics use 2 decimals, percentages are integers, and SHAP bars carry no numbers except on hover.
11. **Every chart** keeps "View as table" and export with the watermark (LUMEN).
12. **Numerals at first paint ≤ 30** above the fold at 1440×900.

**Methodology.**
- Layout: a sticky 200 px table of contents, a 680 px text column, and a 280 px margin for definitions and small diagrams, so the right 40 % is no longer empty.
- Add three diagrams: the data split, the per-target pipeline, and how SHAP adds up.
- Internal ids are replaced through the same name map.

---

## 7. Premium cues (what makes it read as a product)

These are cheap and global. Every agent applies them in their own files.

- **One material.** Every floating element uses the stage-card material: `bg/panel`, 1 px `border/default`, `e-2`, r-lg 8. Chips use r-full. Nested controls use r-sm 4, since child radius ≤ parent radius.
- **One rhythm.** 12 px stage inset, 16 px card padding (12 at 1280), 8 px card gap, 4 px grid. Hairlines replace most dividers; each card has at most one divider.
- **One filled button per screen.** The workstation has none at rest; the Inputs drawer's "Done" is the only one when it is open. The landing page has one.
- **Numerals.** `tabular-nums` everywhere. U+2009 before %. No false precision. Numbers tween from their old value and never from 0.
- **Quiet chrome.** Labels and headers at rest use `text/secondary` or `text/tertiary`. Only the answer is `text/primary` at size. No icons in card headers. No coloured icon tiles.
- **Status in the tab.** `document.title = "P-011 · CAD 98 % Very high — CardioTwin"` (P2).
- **Shareable state.** `#/workstation/P-011?t=LAD&view=RAO30&panel=explain&tab=why&focus=1` restores the exact view (P2). The tour and the landing pillars deep-link through it.

---

## 8. Motion and micro-interactions

All durations and easings are LUMEN §6 tokens: `instant` 90, `fast` 160, `base` 240, `data` 420 (120 while dragging), `flyout` 360, `exit` = 0.7 × enter. No overshoot, no bounce, no count-up.

### 8.1 Chrome transitions

| Transition | Choreography |
|---|---|
| Workstation first paint | Status line and top bar at full opacity from t = 0. The stage cards enter (y 8 → 0 + fade, `base`) in this order: Risk card 0 ms, patient card 60, toolbar 120, legend 180. The poster sits under them until the first 3D frame (§5.18). Ignition then runs as in LUMEN §6. |
| Patient card ⇄ rail | The card exits toward the left (x −12, fade, 170 ms); the rail fades in (`fast`, 60 ms delay). The view offset glides over `flyout`, so the heart slides left toward the new centre. |
| Drawer open | The drawer slides from its edge (`flyout`, ease-out). The card it covers fades out over `fast`. The view offset glides over the same 360 ms. Content fades in after 80 ms. Focus moves to the first field. |
| Drawer close | 250 ms with `exit` easing; the covered card fades back in over `fast` at 120 ms; focus returns to the opener |
| Focus mode on | Cards and toolbar exit toward their nearest edge (12 px + fade, 170 ms, 30 ms stagger). The view offset goes to 0 over `flyout`. The answer pill enters (`base`, +120 ms). The labels crossfade to show % (`fast`). |
| Focus mode off | The exact reverse: the pill exits first, then the cards enter with the same stagger |
| Popover / menu | Fade + y 4 over `fast`; exit 110 ms |
| Palette | Scrim fades over `fast`; the panel goes from opacity 0 and scale 0.98 to 1 over `fast`, ease-out; exit 110 ms. No overshoot. |
| Tooltip | 120 ms delay, 90 ms fade; closes on pointerdown |
| Right column compact ⇄ full | Height animates over `base`; hidden lines fade over `fast`, with no reflow jump below them |

### 8.2 Selection sync: one beat (the signature interaction)

Any selection source (3D click, label, row, key 1–3, palette, drawer target tab) calls `viewerStore.select(target)`. Everything below keys off that one event, with no per-source code.

| t (ms) | What moves |
|---|---|
| 0 | Row: `surface/2` + accent rule (`instant`). Label: accent ring; the others fade to 40 % (`fast`). The selection chip enters (`fast`). The inspector enters (`base`). The Risk card switches to its selected variant (`base`). |
| 0 → 800 | The camera flies along the C-arm arc to the vessel's best view (LUMEN camera). The chip's angles tick live. Unselected vessels desaturate and dim (damped, λ 8). |
| 0 → 600 | The selected territory tints in (λ 4); the others stay clay |
| 160 | The patient card overline crossfades to "Drives LAD most"; the rows FLIP (`base`) |
| 800 | The camera settles. The anchor of the selected label is re-evaluated; it never goes posterior. |

**Clear** (Esc, ✕, or a click on empty space) reverses the sequence, and the camera returns to the pose it had before the selection (Primal's reversible modes). `H` also clears, but flies to the home pose instead. **Hover** (row ↔ vessel ↔ label) is `instant` and never moves the camera.

### 8.3 Prediction update (the what-if loop)

1. **Commit.** On slider release or chip toggle, the edge engine predicts in the same frame (when available). The server check is debounced 300 ms, and the engine dot goes Edge → Verifying → ✓. The UI never blocks or dims while the server verifies (optimistic update).
2. **Numbers** tween over `data` from their old value, and the track marker slides. A 1 px ghost of the previous marker stays for 1.5 s. While edits exist, the "was" line and the Δ column persist.
3. **Band or verdict change.** The band chip crossfades over `fast`. The verdict slides 6 px over `fast` and is announced politely, debounced 1 s. The pip ring plays once, throttled to once per 1.2 s.
4. **3D.** `uP` damps (λ 6) and the colour is sampled from the LUT. The **ripple** runs root to tip, in the direction of flow, over 600 ms, only if |Δp| ≥ 0.03, at most once per vessel per 1.2 s (LUMEN).
5. **Explanations.** The patient card rows re-rank with FLIP after commit. The narrative crossfades over `fast`. In the drawer, the changed SHAP row gets an accent rule for 1.2 s and the rows FLIP.
6. **Stale state.** If a request runs longer than 150 ms, the numerals go to 50 % with "Updating", and the marks turn `#4B5260`. A stale colour is never shown as current.

### 8.4 What-if mode entry and exit

- **First edit:** the pill enters (fade + y −4, `fast`), the stage frame fades in (`base`), the "was" lines appear (`fast`), and the chip gets its dot.
- **Reset:** everything tweens back over `data`; the pill and frame exit after the tween ends. A toast with Undo appears.
- **Hold to compare:** the app tweens to the recorded state over `fast`; the 3D vessels re-sample the LUT with λ 12 (fast). On release it reverses.

### 8.5 Drawer internals

- **Field focus-expand:** height over `base`. The ICE strip fades in over `fast` after the height settles.
- **Section count change:** crossfade over `fast`.
- **Search typing:** results re-rank without animation (stable, per the palette rules). The group headers collapse.

### 8.6 Loading and skeletons

- Skeletons match the final boxes to the pixel.
- The loader waits 200 ms before showing and stays at least 400 ms.
- The poster crossfades to the canvas over 300 ms on the first frame.
- CLS after first paint = 0.

### 8.7 First-run hint

- "Drag to rotate · Scroll to zoom · Click an artery" is a chip centred above the toolbar. It fades in 1.5 s after ignition and fades out over `base` on the first drag or after 8 s.
- It is remembered in `localStorage` (inside try/catch) and never shown again.

### 8.8 Reduced motion (OS setting or Calm mode)

- All translations become opacity-only over 120 ms.
- Camera moves and the peel become 200 ms crossfades.
- Numbers update instantly.
- No ripple, beat or flow.
- The layout, the content and every state are identical.

---

## 9. Implementation plan

### 9.1 Owners (phase-2 map from `frontend/ARCHITECTURE.md`)

| Agent | Owns (write access) | V2 scope |
|---|---|---|
| **A · Workstation, shell and design layout** | `features/workstation/WorkstationPage.tsx`, new `features/workstation/StageLayout.tsx`, `panels.tsx` and `GroupRail.tsx` (to delete), `features/shell/**`, `design/**`, `styles/**`, `state/**`, `hooks/**`, `router.tsx`, `routes.ts` | Stage model, primitives, stores, palette + registry, top bar, status line, focus orchestration, URL state, compact layout |
| **B · Patient** | `features/patient/**` | Patient card + rail, Inputs drawer, FieldRow v2, FindingChips, PatientSwitcher, curated cases, WhatIfPill, palette commands for patients and inputs |
| **C · Risk and explain dashboard** | `features/risk/**`, `features/explain/**`, the narrative functions in `lib/explain.ts` (exception) | Semantics (P0-3), Risk summary card, VesselRow v2, inspector, Explain drawer, answer pill, palette commands for vessels and explain |
| **D · 3D, HUD and toolbar** | `three/**`, `features/workstation/CanvasHud.tsx` → `features/workstation/hud/**`, `public/posters/**` | P0-2, P0-4, toolbar, selection chip, legend chip, first-run hint, labels v2, view offset, scene defaults, isolate/ghost, palette commands for views and layers |
| **E · Landing and tour** | `features/landing/**`, `features/tour/**` | Full-bleed hero, KPI/protocol strip, verb pillars, 5-chapter tour |
| **F · Performance** | `features/performance/**`, `features/methodology/**`, new `lib/modelNames.ts` (exception) | Density rules, name maps, leaderboard fix, axes, methodology layout |

### 9.2 Wave 0 (agent A, blocking, ~2–3 h): contracts first

A lands these in one commit before the others start on V2 files. Until then, B–F work on their P0 items, which do not depend on it.

1. **P0-1 fix now:** `relative` on every `.panel-scroll`, `overflow: clip` on the grid, and the regression test from §5.4.
2. **Store additions.** These are additive; no existing field is renamed.
   ```ts
   // uiStore
   chrome: 'workstation' | 'focus' | 'tour' | 'landing';           setChrome(c)
   drawer: null | 'inputs' | 'explain';
   openDrawer(d, opts?: { tab?: ExplainTab; field?: string; section?: 'changed'|'abnormal'|'key'|'all' }); closeDrawer()
   explainTab: 'why' | 'whatif' | 'physiology' | 'model';
   focusField: string | null;                                      // Inputs drawer row to expand
   patientCardOpen: boolean;                                       // persisted (try/catch)
   paletteOpen: boolean;                                           setPaletteOpen(b)
   stageInsets: { left: number; right: number; top: number; bottom: number };  // published by StageLayout
   hintSeen: boolean;                                              // persisted
   // viewerStore
   territoryMode: 'off' | 'selected' | 'all';                      // `territories` boolean kept in sync (≠ 'off') until D migrates
   isolate: boolean; ghostOthers: boolean;                         setIsolate / setGhostOthers
   cameraReturn: CameraPose | null;                                // pose before select/isolate, for Esc
   // patientStore
   startBlank(defaults): recorded = features = defaults (0 edits); `mode` gains 'blank' ('custom' is retired once B's switcher lands)
   recordedPrediction: PredictResponse | null;                     // automatic baseline, captured on load
   comparing: boolean;                                             // hold-to-compare
   ```
3. **`StageLayout`** with named slots: `left`, `right`, `top` (context slot), `bottom` (toolbar), `bottomLeft` (legend), `drawers`, `overlay` (answer pill and hint). It publishes `stageInsets`, sets `data-region` on every slot, and applies the chrome presets.
   - A creates **stub files** with their final export names in the owners' folders: `PatientCard`, `InputsDrawer`, `WhatIfPill`, `PatientSwitcher` (B); `RiskSummaryCard`, `VesselInspector`, `ExplainDrawer`, `AnswerPill` (C); `hud/CanvasToolbar`, `hud/SelectionChip`, `hud/LegendChip`, `hud/FirstRunHint` (D).
   - **Ownership transfers on creation.** A never edits them again.
4. **Primitives:** StageCard, Drawer, Menu, Kbd, and the Tooltip close-on-press fix.
5. **Command registry and palette shell.**
   ```ts
   interface Command { id: string; group: 'suggested'|'vessels'|'patients'|'inputs'|'views'|'actions'|'pages';
     title: string; subtitle?: string; keywords?: string[]; shortcut?: string; icon?: LucideIcon;
     when?: () => boolean; preview?: () => string | Promise<string>; run: () => void; actions?: Command[] }
   useRegisterCommands(source: string, commands: Command[], deps: unknown[]): void
   ```
   Shortcuts register through the same registry, so the ShortcutSheet and tooltips print from it. The hotkey scoping rules are in §4.10.
6. **Probability contract.** Every probability numeral renders `data-prob="<target>"`. The `Probability` primitive (`design/risk/RiskMarks.tsx`) does it automatically. The 3D labels (D) and the answer pill (C) add it themselves.

### 9.3 Prioritised backlog per agent

P0 breaks the demo · P1 is the redesign's structure · P2 is craft and "wow" · P3 is stretch. Each agent works top-down.

**A · Workstation, shell and design layout**
- P0: Wave 0 (§9.2).
- P1: StageLayout replaces the 3-column grid at every desktop width (delete `GroupRail`, `LeftPanel`, `RightPanel`, `TabbedRightPanel` once B–D land). Also:
  - Top bar v2 (§5.1), with the chip trigger mounting B's `PatientSwitcher`;
  - EngineDot (§5.3);
  - StatusLine v2 (§5.17);
  - focus mode orchestration (§4.8, §8.1);
  - CommandPalette UI (§4.9);
  - ShortcutSheet v2;
  - the `Esc` priority chain;
  - compact < 1100 layout (§4.7).
- P2: URL state (`t`, `view`, `panel`, `tab`, `focus`); document title; a lint check that fails on `text-[0.6875rem]` outside the overline, Kbd and credits.
- *Accept:* no canvas resize on any chrome change (a ResizeObserver test); CLS 0; every region carries `data-region`; the palette opens in < 50 ms with ≥ 60 commands registered.

**B · Patient**
- P1:
  - PatientCard + rail (§5.5) with `useKeyInputs(target, 5, { exclude: ['Age','Sex'] })`;
  - InputsDrawer (§5.6) with search, the 4 sections, sticky headers and footer;
  - FieldRow v2 (numeric, categorical) and FindingChips;
  - PatientSwitcher + `curated.ts` (4–6 TEST ids chosen by feature diversity, with no cath labels in the copy);
  - WhatIfPill + hold-to-compare;
  - `startBlank` in the UI;
  - palette commands: every patient, all 53 inputs (with aliases), "Reset all edits", "New blank patient", "Random test patient";
  - delete WhatIfBar, PatientModeSwitch, PatientHeader, GroupHeader sums and share bars, and the 11 px captions.
- P2: ICE strip in the expanded row (worker); counterfactual tooltips on chips (server, cached per input hash, ≤ 2 in flight); inline binary toggle from the palette with a live "CAD 98 % → 91 %" preview; CAD pips in the switcher.
- *Accept:* any input is reachable in ≤ 2 actions; editing never scrolls or shifts any ancestor; the drawer is fully keyboard-operable; the ranked list never reorders mid-drag.

**C · Risk and explain dashboard**
- P0: the verdict vocabulary (§3), the "k of 3 flagged" header, and removing "≈ 1.7 of 3" from the rows. Unit-test that the verdict equals `label` for every target.
- P1:
  - RiskSummaryCard + VesselRow v2 + compact variant (§5.8);
  - VesselInspector (§5.9, including the drivers-when-collapsed rule);
  - ExplainDrawer with 4 tabs (§5.10), with the existing ShapWaterfall and PhysiologyTable restyled inside it;
  - AnswerPill;
  - Reveal condensed;
  - palette commands: Focus/Explain for each target, Reveal cath result, Open Explain tabs;
  - delete the CADHeroCard meter, scale and microcopy, the VesselList chevron, the ExplainPanel rail usage and TopDrivers.
- P2: narrative grammar (§5.10); phrase links; What-if "Biggest levers"; cohort dot strip (when the artifact exists); the Model tab with AUC/CI/n from `metrics.json`.
- P3: band ladder with observed rates.
- *Accept:* ≤ 6 type styles in the Risk card; at most 1 visible `data-prob` per target; the right column fits 1280×720 with a vessel selected.

**D · 3D, HUD and toolbar**
- P0:
  - **P0-2:** the selected label is never posterior, using dynamic anchors (§5.14). Verify that each of the three best views shows a camera-facing segment of its vessel.
  - **P0-4:** poster + hairline + first-frame crossfade in the workstation (§5.18), with the poster rendered from the workstation home pose.
- P1:
  - CanvasToolbar with the View menu, Peel slider, Layers popover and ⋯ (§5.11); SelectionChip; LegendChip; FirstRunHint;
  - delete Breadcrumb, Projections, LayerToggles, the canvas watermark and credits, and the hint sentence;
  - labels v2 (content by chrome preset, lanes inside `stageInsets`);
  - `setViewOffset` from `stageInsets` with a 360 ms glide;
  - heart framing at 62 % of the free-area height;
  - scene defaults (§5.15: lungs hidden, clipped pulmonary trees, territory mode, bloom, orbit clamp);
  - isolate (O) and ghost (G) with camera return;
  - palette commands: projections, home, peel detents, dissect, layers, look, territories, labels, beat, flow, calm, quality.
- P2: hover outline + tooltip (§7.5); pip ring on band change; X-ray look; camera history (Back/Forward in ⋯).
- *Accept:*
  - ≥ 45 fps at tier B on Iris Xe with the **full-bleed** 1440×824 canvas. If it misses, cap the workstation's DPR at 1.0 and let PerformanceMonitor drop to C.
  - The heart is centred in the free area within ±16 px in every chrome state.
  - No label ever sits under a card or is clipped.

**E · Landing and tour**
- P1: full-bleed hero (§6.1) with numeric labels and the coronary framing (consume D's `chrome = landing`); copy and CTAs; remove the duplicate tour button; KPI strip + protocol line; verb pillars with micro-visuals and deep links; the landing → workstation label handover (§6.2); the 5-chapter tour with `onEnter`/`onExit` and state restore (§6.3).
- P3: attract mode; annotated product still; live lever.
- *Accept:* the hero heart height is ≥ 55 % of the hero; above the fold at 1440×900 there is exactly one primary button; the tour completes in ≤ 100 s and leaves no residual state.

**F · Performance and methodology**
- P1: density rules 1–12 (§6.4); `lib/modelNames.ts` shared with C's Model tab; the leaderboard highlights the deployed row (id `ensemble`), not row 0; round axis ticks and axis-title clearance; fixed chart heights.
- P2: Methodology 3-column layout and the three diagrams; crosshair metrics.
- *Accept:* no raw dataset key and no internal model id is visible on any route (a grep-based test against the rendered DOM); ≤ 30 numerals above the fold.

**ML request (additive, optional).** `cohort.json` gains `patients[].predictions: Record<TargetId, number>` (or a sibling `cohort_predictions.json`). It enables the switcher pips (B) and the cohort strip (C). Without it, both are hidden. Nothing else depends on it.

### 9.4 Order, conflicts and done

1. **Order.**
   - A: Wave 0.
   - Then B, C and D in parallel (their P0s can start immediately, since they do not touch A's files).
   - E and F in parallel from the start: they do not depend on Wave 0, except E's tour, which needs `chrome`.
   - Integration pass by A.
   - Polish loop scored with §10 until every criterion is ≥ 8.
2. **Write only inside your ownership.** Need a store field that is not in §9.2? Ask A. A batches store changes and lands them within one cycle. Never fork a parallel store.
3. **Commit only your own paths** with `python .git/gitc.py "<type(scope): message>" <paths…>`. Never `git add -A`. Keep `npm run typecheck`, `npm run lint` and `npm test` green before each commit.
4. **Interfaces are the export names and props in §9.2.** If you must change one, say so in the commit message. A reconciles the spec.
5. **Definition of done for V2:**
   - the §0 targets are met;
   - P0-1…P0-4 are closed with tests;
   - the rubric mean is ≥ 8.5 and no criterion is below 8 at both 1440×900 and 1280×720;
   - the axe-core serious count is 0 on all four routes;
   - the LUMEN acceptance gate (§10 of DESIGN_SYSTEM.md) still passes.

---

## 10. Scoring rubric for the polish loop

Critics score each criterion from 1 to 10 on every route at **1440×900 and 1280×720**. Screenshots are taken after the load settles, with the first-run hint dismissed. The overall score is the mean.

**Hard caps:**
- Any P0 regression caps the overall score at 4.
- Any clinical-safety violation caps it at 3. Violations are: risk colour used on text; the disclaimer missing or animated; "diagnosis" wording; a stale value shown as current; `warn` or `danger` used for risk.

### 10.1 Criteria

| # | Criterion | What it measures | Probes | 3 = poor | 6 = acceptable | 9 = excellent |
|---|---|---|---|---|---|---|
| 1 | **5-second answer** | Can a first-time viewer state the CAD %, which vessels are flagged, the top driver, and that this is not a diagnosis, after 5 s? | Ask the 4 questions of a fresh viewer or critic; time it | Needs to search or scroll; contradictions | All 4 answerable, but slowly or with one hesitation | All 4 instant; the eye path is Risk card → heart → patient card |
| 2 | **Restraint and hierarchy** | Bloat: how much competes at rest | Numeral count (§10.3); overlay groups; type styles per card; filled buttons | > 30 numerals, or > 8 overlays, or > 8 styles in a card | ≤ 20 numerals, ≤ 6 overlays, ≤ 7 styles | ≤ 16 numerals, 4 overlay groups, ≤ 6 styles, 0 filled buttons at rest |
| 3 | **Canvas-first stage** | The heart is the protagonist; figure/ground | Stage coverage by cards; heart centring error; is the coronary tree the only saturated element? Anatomy clutter | Heart cropped or off-centre, pink wash, dead branches | Centred; some background clutter | Centred within ±16 px at 62 % of the free-area height; only the vessels carry colour; clean silhouette |
| 4 | **Semantic integrity** | One vocabulary, one home per number, no contradictions | Visible `data-prob` duplicates; the band vs verdict wording; raw keys or ids; count consistency ("k of 3 flagged" = the rows) | Two answers to one question | Consistent, but one echo or jargon leak | Zero duplicates, zero leaks; the inspector reconciles band and threshold in plain words |
| 5 | **Progressive disclosure** | Answer → reason → evidence; nothing dead | Actions to reach any input; level-3 content at rest; disabled controls at rest | Everything at once, or buried beyond 3 actions | ≤ 3 actions; a few leaks | ≤ 2 actions to anything; zero level-3 content at rest; no dead controls |
| 6 | **Linked selection** | The workstation feels like one instrument | Select via each of the 6 sources: do all views sync in one beat? Hover links (row ↔ vessel, driver ↔ input); Esc restores the camera | Sources disagree; the label vanishes (P0-2) | Syncs, but the steps are visibly sequential or one source is missing | Every source is identical; one 240 ms beat; hover links both ways; reversible |
| 7 | **What-if loop** | Change → consequence, legibly | Flip typical angina: the time to a visible effect; where the delta shows; the ripple; Reset/Undo; hold-to-compare | Effect off-screen or ambiguous; the layout jumps | Effect visible; the delta is small or far away | Same-frame numbers; the "was" line and Δ column; the ripple; the pill; compare works; zero layout shift |
| 8 | **Motion and stability** | Motion explains change, never decorates | CLS; overshoot; count-ups; simultaneous attention animations; loader flashes; reduced-motion parity | Jumps, blank frames, bouncy easing | Calm, with one or two rough transitions | Every transition uses the tokens; 0 CLS; poster → frame is seamless; reduced motion is equivalent |
| 9 | **Craft** | Typography, spacing, numerals, alignment | 4 px grid; one card material; 11 px misuse; tabular numerals; truncations; icon consistency; radii | Mixed materials, truncations, 11 px captions | Mostly consistent; a few off-grid values | Pixel-consistent; no truncation at 1280; numerals aligned on decimals; one material |
| 10 | **Trust and access** | Clinical safety, provenance, accessibility | Status line; "Model estimate" tag; engine and version one hover away; exports watermarked; keyboard-only run-through; focus rings; axe; contrast; `aria-live` on verdict flips | A missing safety cue, or keyboard traps | Safe; some a11y gaps | Every LUMEN §9/§10 rule holds; the whole demo is doable by keyboard via the palette; axe 0 serious |

### 10.2 Page-specific checks (these feed the same 10 criteria)

- **Landing:**
  - The heart is unboxed and framed on the coronaries (criterion 3).
  - There is one primary CTA and one tour entry (criterion 2).
  - No "0 leaked labels" (criterion 4).
  - The labels carry the %, and hand over to the Risk card on the glide (criteria 4 and 6).
- **Performance:**
  - Takeaway titles (criterion 1).
  - Human names only (criterion 4).
  - Round ticks and no axis-title overlap (criterion 9).
  - The deployed model is highlighted (criterion 4).
  - The test/CV gap is explained (criterion 10).
- **Tour:**
  - Each chapter performs its own action (criterion 6).
  - ≤ 100 s (criterion 1).
  - It restores the prior state (criterion 8).

### 10.3 Probes (paste into the DevTools console)

```js
// 1. Numerals visible inside #main (top bar and status line excluded; sr-only and aria-hidden ignored)
(() => { let n = 0; const seen = [];
  const w = document.createTreeWalker(document.getElementById('main'), NodeFilter.SHOW_TEXT);
  while (w.nextNode()) { const t = w.currentNode, el = t.parentElement;
    if (!el || !/\d/.test(t.textContent) || el.closest('.sr-only,[aria-hidden="true"]')) continue;
    const r = el.getBoundingClientRect(); if (!r.width || r.bottom < 0 || r.top > innerHeight) continue;
    let o = 1; for (let p = el; p; p = p.parentElement) o *= +getComputedStyle(p).opacity; if (o < 0.05) continue;
    const m = t.textContent.match(/\d+(?:[.,]\d+)?/g); n += m.length; seen.push(t.textContent.trim()); }
  return { n, seen }; })();

// 2. Duplicate probability numerals (must be ≤ 1 per target)
[...document.querySelectorAll('[data-prob]')].filter(e => e.getClientRects().length && e.getBoundingClientRect().bottom > 0)
  .reduce((a, e) => (a[e.dataset.prob] = (a[e.dataset.prob] || 0) + 1, a), {});

// 3. Type styles inside a region (≤ 6 per card)
(r => [...new Set([...document.querySelectorAll(`[data-region="${r}"] *`)]
  .filter(e => [...e.childNodes].some(c => c.nodeType === 3 && c.textContent.trim()))
  .map(e => { const s = getComputedStyle(e); return `${s.fontSize}/${s.fontWeight}`; }))])('risk-card');

// 4. Layout shift since load (must be 0 after first paint)
new PerformanceObserver(l => l.getEntries().forEach(e => !e.hadRecentInput && console.log('CLS', e.value)))
  .observe({ type: 'layout-shift', buffered: true });
```

### 10.4 Report format for critics

For each route and viewport, the report has three parts:
- **Scores:** one line per criterion, as the score plus the single worst issue, e.g. "6 · the LCX label is clipped at the right edge at 1280".
- **Top 3 fixes:** each gives the file owner (A–F), the section of this spec it violates, and the expected effect on the score.
- **Probe output:** the raw results from §10.3.

---

## Appendix: where each pattern came from

| V2 decision | Reference pattern |
|---|---|
| Full-bleed stage, cards over the edges, chrome presets | BioDigital one-column tools and embed flags; Zygote minimal chrome; Sketchfab clean embed |
| Opaque cards, no gaps under the panels themselves, docked drawers | Figma UI3's floating-panel rollback; Stripe drawer / FocusView; LUMEN "no glass" |
| Answer card + verdict per vessel, positive or negative | HeartFlow patient summary; Cleerly ISCHEMIA "likely/unlikely" per vessel; Viz.ai triage wording ("flagged") |
| Plain anatomy, colour only on findings, LM "not predicted" | HeartFlow Roadmap / FFRct; "non-reportable" categories |
| Inspector on selection with verbs (Isolate, Ghost) | Complete Anatomy info box; Primal Inspect/Examine with camera return; Visible Body H/V/O keys |
| Ranked "drives risk most" record; deviations only | Figma UI3 property ordering; Siemens deviation highlighting; ACC input pattern |
| Command palette, shortcuts in tooltips, footer hints | Raycast action panel; Linear ⌘K and shortcut tooltips; Visible Body single search |
| Focus mode + answer pill; selection restores the inspector | Arc hidden sidebar; Figma minimise UI |
| What-if pill + stage frame; automatic baseline; hold to compare | Stripe test-mode banner; Cleerly COMPARE; Arc split view |
| Takeaway titles, direct labelling, fewer colours | Datawrapper / Observable; WWDC22 chart guidance; Apple Health highlights |
| Poster, loader timing, tabular numerals, state in the URL and title | Vercel Web Interface Guidelines and dashboard |
| Chaptered tour that performs actions | BioDigital multi-chapter tours; Sketchfab annotation autopilot |
| Cohort position strip | Caristo CaRi-Heart per-vessel percentiles; HeartFlow percentile |
