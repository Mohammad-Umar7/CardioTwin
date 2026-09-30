| Concept | Wow | Clinical credibility | Clarity | R3F feasibility (iGPU, hackathon) | Accessibility | Total /50 |
|---|---|---|---|---|---|---|
| 1 · LUMEN "clinical precision" | 7 | 10 | 9 | 9 | 9 | **44 (base)** |
| 2 · LUMEN "cinematic hologram" | 9 | 6 | 7 | 6 | 8 | 36 |
| 3 · LUMEN "editorial gallery" | 8 | 8 | 9 | 7 | 8 | 40 |

# CardioTwin final design spec: LUMEN

*"The only light in the room is the data."* This spec is binding for `frontend/`. It follows `docs/CONTRACTS.md` v1.0.0: target order CAD·LAD·LCX·RCA, band edges 0.25/0.50/0.75, SHAP in log-odds (margin) space, and radiological display, so patient-left (+X) appears on viewer-right.

## 0. Decision record

**Base: Concept 1.** It has the reading-room look, graphite chrome, one interaction colour, provenance on every number, and C-arm conventions. Its peel, tiers and 2D fallback are the most buildable on an integrated GPU.

**Taken from Concept 3**
- ICE strips inside every numeric slider, and counterfactual captions on toggles.
- A template-built "why" sentence.
- Khronos PBR **Neutral** tone mapping instead of AgX, so hues match the legend.
- A darker clay myocardium, so vessels always read lighter than the wall and get brighter as risk rises.
- A dark inverted-hull rim on vessels.
- One 256-px LUT feeding CSS, SVG and the shaders.
- Predictions never wait for the GLB.
- The canvas never resizes; flyouts overlay it.
- A dot-product test for labels on the far side of the heart.
- `three-mesh-bvh` picking, a 30 fps cap when idle, and a colour-vision (CVD) unit test.
- A "typical → this patient" footer.
- The disclaimer sits above the tour scrim, and fullscreen applies to the whole app.

**Taken from Concept 2**
- The UI shows "**Very high**" for the contract id `critical`.
- A 4-segment band meter.
- "Ignition": vessels trace in a neutral colour, then take their risk colour all at once along their whole length.
- Invisible hit tubes at 3× vessel radius.
- A `Verifying` engine state.
- A pinned baseline (A/B) that shows "was → now".
- Tier-C halo-tube glow.
- `aria-valuetext`, "View as table" on every chart, and camera flights on a sphere around the heart.

**New in this spec (checked numerically)**
- Risk ramp "Ember v2": the floor is raised to ≥ 3:1 on panels.
- `text/secondary` and `text/tertiary` are brightened so every text token passes AA on every surface.
- The left main (LM) is a neutral mid-grey, so a vessel the model does not predict never looks alarming.

**Rejected**
- Holo floor, projector cone and scan-plane sweep: they read as sci-fi, and every transparent layer costs overdraw.
- Space Grotesk and Newsreader: a fourth type family splits the voice.
- Numbers counting up from 0 on load: that implies a change that never happened.
- Glass blur.
- SSAO, depth of field, SSR, god rays, chromatic aberration, grain, shadow maps and transmission.

## 1. Principles

1. **Only data is coloured.** Chrome is graphite, Signal Cyan means "you can touch this", and Ember means "this is risk". There is no third kind of colour. Anatomy is achromatic clay.
2. **The image comes first.** The canvas is the largest element. Panels are opaque and never blurred.
3. **Every number shows its provenance.** Engine, model version, threshold, data split and CI are always one glance or one hover away.
4. **The geometry stays honest.**
   - Each vessel is one colour from root to tip.
   - Territories are labelled "approximate".
   - LM is shown as "not predicted".
   - Clinical features never light up anatomy.
5. **Motion stays calm.** Only physiology loops (the beat and the flow). Everything else moves once, decelerates and stops, with no overshoot.

## 2. Tokens

### 2.1 Surfaces, text, interaction, status

Contrast values were measured (WCAG) in this order: bg/app, bg/panel, surface/1, surface/2, surface/3.

| Token | Hex | Role | Contrast |
|---|---|---|---|
| `bg/void` | `#07090C` | Scene edge, behind everything | n/a |
| `bg/app` | `#0B0E12` | Top bar, status line, landing page | n/a |
| `bg/panel` | `#10141A` | Side panels | n/a |
| `surface/1` | `#151A21` | Cards, inputs, chips | n/a |
| `surface/2` | `#1B212A` | Hover, selected rows | n/a |
| `surface/3` | `#232A35` | Popovers, menus, tooltips, 3D callouts | n/a |
| `border/hairline` | `#1C222B` | Dividers between panels and sections | n/a |
| `border/default` | `#262E39` | Inputs, cards, e-2 ring | n/a |
| `border/strong` | `#36404D` | Pressed state, e-3 ring, risk-pip ring | n/a |
| `text/primary` | `#EDF1F5` | Values, headings, band words | 17.0 / 16.3 / 15.4 / 14.3 / 12.7 |
| `text/secondary` | `#A3ADBA` | Labels, body copy, status line | 8.5 / 8.1 / 7.7 / 7.1 / 6.4 |
| `text/tertiary` | `#8792A1` | Units, reference ranges, captions. The dimmest readable text. | 6.1 / 5.9 / 5.5 / 5.1 / 4.6 |
| `text/disabled` | `#4D5663` | Disabled or decorative only | n/a |
| `accent` (Signal Cyan) | `#56C2E6` | **Interaction only**: focus, selection, slider thumbs, active tab, edited dot, draggable chart handles, primary button | 9.4 / 9.0 / 8.5 / 7.9 / 7.1 |
| `accent/hover` | `#7FD3EE` | Hover on accent elements | n/a |
| `accent/pressed` | `#3E9FC2` | Pressed accent | n/a |
| `accent/subtle` | `rgba(86,194,230,.14)` | Selected-row and correct-cell wash | n/a |
| `accent/ink` | `#07090C` | Text on an accent fill (9.7:1) | n/a |
| `success` | `#3FB68B` | Server ✓, parity ✓, "agrees" | 7.3 on panel |
| `warn` | `#E3C35A` | System messages only. **Banned in any risk-bearing component** (ΔE_OK to Ember top is 0.056, and 0.02 under deuteranopia). | 10.8 on panel |
| `danger` | `#FF5F6D` | Errors and invalid input only. **Never used for risk.** | 6.3 on panel |
| `scrim` | `rgba(7,9,12,.60)` | Tour spotlight | n/a |

### 2.2 Risk scale "Ember v2" (P(stenosis) and P(CAD), 0 → 1)

The five anchors sit at p = 0, .25, .5, .75 and 1: `#386695`, `#7374BD`, `#BF7DB0`, `#FB9167`, `#FFCB77`. Colours between anchors are **interpolated in OKLab**. The 9-step list below is exact.

| p | Hex | OKLab L | L under deutan / protan / tritan | vs `bg/panel` | vs clay wall `#62574F` |
|---|---|---|---|---|---|
| 0.000 | `#386695` | 0.50 | 0.49 / 0.52 / 0.50 | 3.1:1 | 1.17 |
| 0.125 | `#576DA9` | 0.54 | 0.53 / 0.56 / 0.54 | 3.7:1 | 1.39 |
| 0.250 | `#7374BD` | 0.59 | 0.58 / 0.60 / 0.58 | 4.4:1 | 1.66 |
| 0.375 | `#9A7AB7` | 0.63 | 0.63 / 0.62 / 0.63 | 5.1:1 | 1.95 |
| 0.500 | `#BF7DB0` | 0.67 | 0.67 / 0.64 / 0.67 | 6.0:1 | 2.26 |
| 0.625 | `#DC8890` | 0.72 | 0.72 / 0.67 / 0.72 | 7.0:1 | 2.66 |
| 0.750 | `#FB9167` | 0.76 | 0.77 / 0.70 / 0.74 | 8.2:1 | 3.12 |
| 0.875 | `#FEAE6F` | 0.82 | 0.83 / 0.77 / 0.80 | 10.1:1 | 3.84 |
| 1.000 | `#FFCB77` | 0.87 | 0.88 / 0.84 / 0.86 | 12.4:1 | 4.69 |

**Verification** (Machado 2009 simulation at severity 1.0, applied in linear RGB)
- OKLab L rises strictly at every step under normal vision, deuteranopia, protanopia and tritanopia.
- Minimum ΔE_OK×100 between adjacent anchors: 10.7 normal, 9.2 deutan, 6.9 protan, 9.7 tritan.
- Minimum between band chips: 11.1, 9.8, 6.5 and 8.0 respectively. The just-noticeable difference is about 2.
- Every stop is ≥ 3:1 against `bg/panel` and `bg/void`, which meets the WCAG 1.4.11 minimum for non-text marks.
- Hue runs blue → violet → mauve → coral → apricot. There is no red-green axis, and there is no alternative traffic-light palette.

**Bands** (the id comes from API `risk_band`; the edge engine uses `schema.risk_bands`)

| Contract id | UI label | Range | Chip/pip colour (band midpoint) | Meter |
|---|---|---|---|---|
| `low` | Low | p < 0.25 | `#576DA9` | ▮▯▯▯ |
| `moderate` | Moderate | 0.25 ≤ p < 0.50 | `#9A7AB7` | ▮▮▯▯ |
| `high` | High | 0.50 ≤ p < 0.75 | `#DC8890` | ▮▮▮▯ |
| `critical` | **Very high** | p ≥ 0.75 | `#FEAE6F` | ▮▮▮▮ |

**Implementation.** Everything else must read from this one file.

```ts
// src/theme/risk.ts
import { interpolate, formatHex } from 'culori';
export const RISK_ANCHORS = ['#386695', '#7374BD', '#BF7DB0', '#FB9167', '#FFCB77'];
const ramp = interpolate(RISK_ANCHORS, 'oklab');
export const riskHex = (p: number) => formatHex(ramp(Math.min(1, Math.max(0, p))))!;
// riskLUT: 256×1 RGBA8 THREE.DataTexture of riskHex(i/255); colorSpace = SRGBColorSpace,
// Linear filtering, ClampToEdge. Shaders sample texture(uRiskLUT, vec2(p, .5)).
```

`risk.test.ts` must pass three checks:
1. Simulated L is non-decreasing over all 256 LUT samples, for all four vision types.
2. Band-chip ΔE_OK ≥ 0.06.
3. Every 9-step stop is ≥ 3.0:1 against `bg/panel`.

**Rules**
1. **Risk colour is for marks, never for text.** Allowed marks: vessels, territories, bars, pips, the 2 px band rule, the legend, ICE-strip fills and 3D label pips. Numbers and band words are always `text/primary`.
2. **Colour never stands alone.** Every coloured element also shows the % value, the band word, the meter and a marker position on a track.
3. **Only patient-level probabilities use Ember.** Performance charts stay neutral.
4. **Animate p, not colour.** Animating p and sampling the LUT keeps every intermediate frame on the legend. Never interpolate RGB between two endpoint colours.
5. **SHAP direction reuses the ramp.** "Raises risk" is `#FB9167` and "lowers risk" is `#7374BD`, always with ▶/◀ and a sign.
6. **Pending or stale state is achromatic `#4B5260`**, labelled "updating". A stale colour is never shown as current.
7. **Out-of-range clinical values** get a ▲/▼ glyph and the words "above normal" / "below normal" in `text/secondary`. They are never shown in red.

### 2.3 3D palette (anatomy is achromatic by rule)

| Token | Hex | Token | Hex |
|---|---|---|---|
| `anat/clay` myocardium | `#62574F` | `anat/clay-wrap` (fake SSS tint) | `#C98B80` |
| `anat/flesh` ("Anat" look) | `#6A302C` | `anat/flesh-wrap` | `#D06A5A` |
| `anat/cut-face` | `#3A2A2A` | `anat/great-vessel` | `#6B5E57` |
| `anat/valve-papillary` | `#9A8F86` | `anat/vein` (hidden by default, never blue) | `#4F4542` |
| `anat/left-main` | `#8A7D76` | `vessel/pending` | `#4B5260` |
| `vessel/trace` (Ignition) | `#E3DCCF` | `vessel/hull-rim` | `#07090C` |
| `anat/bone` | `#B8B0A3` | `anat/bone-ghost` | `#9FB4C8` |
| `anat/lung` | `#C7A9A6` | `anat/skin` | `#A9B8C8` |
| `anat/muscle` | `#8B5E58` | `anat/diaphragm` | `#6B5F5A` |
| `scene/bg-centre` | `#11161C` | `scene/bg-edge` | `#06080A` |
| `flow/particle` | `#F2F5F8` | `outline/hover` | `#EDF1F5` at 70% |

### 2.4 Scales

```css
:root {
  /* spacing, 4 px grid */
  --sp-0-5: 2px; --sp-1: 4px;  --sp-2: 8px;  --sp-3: 12px; --sp-4: 16px; --sp-5: 20px;
  --sp-6: 24px;  --sp-8: 32px; --sp-10: 40px; --sp-12: 48px; --sp-16: 64px; --sp-20: 80px;
  /* radius: instrument-like, not bubbly */
  --r-xs: 2px;  /* ticks, meter segments */
  --r-sm: 4px;  /* controls, chips, 3D callouts */
  --r-md: 6px;  /* cards, tooltips */
  --r-lg: 8px;  /* popovers, sheets, flyout, coachmark */
  --r-full: 9999px; /* engine pill, thumbs, pips */
  /* elevation: depth comes from surface steps; shadows only on floating layers */
  --e-0: none;                                                   /* panels, separated by hairlines */
  --e-1: inset 0 1px 0 rgba(255,255,255,.03);                    /* cards */
  --e-2: 0 0 0 1px #262E39, 0 8px 24px rgba(0,0,0,.45);          /* tooltips, menus */
  --e-3: 0 0 0 1px #36404D, 0 16px 48px rgba(0,0,0,.60);         /* popovers, flyout, sheets, coachmark */
  --e-hud: 0 2px 8px rgba(0,0,0,.50);                            /* HUD chips on the canvas */
  --focus-ring: 0 0 0 2px #0B0E12, 0 0 0 4px #56C2E6;            /* 2 px ring, 2 px offset */
  /* control heights */
  --h-xs: 24px; --h-sm: 28px; --h-md: 32px; --h-lg: 40px;
  /* z-index */
  --z-canvas: 0; --z-hud: 10; --z-labels: 20; --z-panels: 30; --z-flyout: 40; --z-popover: 50;
  --z-toast: 60; --z-scrim: 70; --z-coachmark: 80; --z-status: 90; --z-skip: 100;
}
```

**Usage**
- **Padding and gaps:** panel padding 16; gap between sections 20; card padding 12 (1280) or 16 (1440); inline gap 8; label-to-control 4.
- **Row heights:** form rows 32 at 1440 and 28 at 1280; numeric rows with an ICE strip are 52.
- **Borders:** always 1 px. The only 2 px borders are the active-tab underline, the selected-row left rule (accent), the band rule on chips (band colour) and the focus ring.
- **Icons:** `lucide-react`, 16 px, stroke 1.5.

## 3. Typography

**Install**
```
npm i @fontsource-variable/inter @fontsource-variable/inter-tight @fontsource-variable/jetbrains-mono
```

**Import**
```ts
import '@fontsource-variable/inter';
import '@fontsource-variable/inter-tight';
import '@fontsource-variable/jetbrains-mono';
```

**CSS**
```css
--font-ui: 'Inter Variable', system-ui, 'Segoe UI', Roboto, sans-serif;
--font-display: 'Inter Tight Variable', 'Inter Variable', system-ui, sans-serif;
--font-mono: 'JetBrains Mono Variable', ui-monospace, Consolas, monospace;
body { font-family: var(--font-ui); font-feature-settings: 'cv05', 'cv08'; } /* tailed l and serifed I, so Il1 / LBBB never blur */
.num { font-variant-numeric: tabular-nums lining-nums; }
.mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums slashed-zero; }
```

**Scale** (size/line-height px · weight · letter-spacing)

| Token | Spec | Use |
|---|---|---|
| `display-1` | 56/60 · Inter Tight 600 · −0.035em | Landing hero only |
| `display-2` | 40/44 · Inter Tight 600 · −0.03em | Page titles |
| `title-1` | 22/28 · 600 · −0.02em | Section heroes |
| `title-2` | 16/22 · 600 · −0.01em | Card and chart titles |
| `body` | 14/20 · 400 · −0.006em | Default text |
| `narrative` | 14/21 · 400 | "Why" sentence |
| `body-s` | 13/18 · 400 | Dense panels (most of the workstation) |
| `label` | 12/16 · 500 · +0.005em | Field labels, chips, status line |
| `overline` | 11/16 · 600 · +0.08em · UPPERCASE | Section headers, band words in 3D labels. **11 px is the smallest size allowed**, used for overlines and credits only. |
| `numeral-xl` | 48/48 at 1440, 40/40 at 1280 · Inter Tight 600 · tnum · −0.04em | CAD hero value |
| `numeral-l` | 20/24 · Inter Tight 600 · tnum | Vessel rows, KPI tiles |
| `numeral-label` | 15/20 · Inter Tight 600 · tnum | 3D callout labels |
| `numeral-m` | 13/18 · Inter 500 · tnum | Tables, SHAP values |
| `mono-s` | 12/16 · JetBrains Mono 450 | Raw keys (`EF-TTE`), patient IDs, version, hashes, C-arm readout |

**Numeric treatment**
- **Patient probabilities** are integers with a thin space (U+2009). The % sign is set at 0.6 em in `text/secondary`: "72 %". Values below 1% show as "<1 %" and above 99% as ">99 %". The exact value (p = 0.719) is in the tooltip only.
- **Metrics** use two decimals, with the CI in `text/tertiary` and an en-dash: "0.94 [0.88–0.98]". The n is always visible.
- **Deltas** are in percentage points: "▲ +12 pts" or "▼ −4 pts".
- **SHAP values** are signed log-odds to two decimals, using the true minus U+2212: "+0.94", "−0.18".
- **Units** come after a thin space, in `text/tertiary`: "140 mmHg · ref 90–120".
- **Alignment.** Numeric columns are right-aligned. The SHAP column is aligned on the decimal point.
- **Dataset quirks never reach the screen.** 'Fmale' shows as "Female" and Y/N as "Yes/No". BBB and VHD show codes with a tooltip for the full term.

## 4. Layout and wireframes

| Viewport | Top bar | Left | Canvas | Right | Status line |
|---|---|---|---|---|---|
| ≥ 1440 | 48 | 320 panel | fluid (736 at 1440; 736×824) | 384 panel, scrolls; CAD card pinned | 28 |
| 1280–1439 | 40 | 56 rail + 296 flyout **over** the canvas | fluid (888×656 at 1280) | 336, tabs Risk / Why / Physiology | 24 |
| 1100–1279 | 40 | same as 1280 | fluid | 320, tabs | 24 |
| < 1100 or 200% zoom | 40 | drawer | 55vh on top | tabs Inputs / Risk / Why below | 24, wraps to 2 lines |

- The landing page uses 12 columns with 24 px gutters, 1200 px max width and a 5/7 hero split. It fits above the fold at 1440×900.
- **One persistent `<Canvas>` lives in the app shell.** Routes change the camera pose and `setViewOffset`, and never remount the GLB. The canvas is never resized by a flyout.
- When the flyout opens, the view offset shifts by 148 px over 360 ms, so the heart stays centred in the visible area.

### 4.1 Landing (1440×900)
```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◆ CardioTwin          Workstation    Model performance    Methodology                       [ Start 90-s tour ]     │
├──────────────────────────────────────────────┬──────────────────────────────────────────────────────────────────────┤
│                                              │       live R3F scene · tier B · ghost-glass torso, clay heart        │
│  CORONARY RISK, VESSEL BY VESSEL             │       turntable 6°/s, stops on pointer-down · beats at patient PR    │
│                                              │                          .-~~~~~~~-.                                 │
│  An explainable coronary digital twin.       │      RCA 61 % ▮▮▮· ─────( ━━┓  ┏━━━ )────── LAD 72 % ▮▮▮·            │
│                                              │                          (  ┃  ┗━━━ )                                │
│  Predicts overall CAD and LAD · LCX · RCA    │                           '-.┗━┛_.-'─────── LCX 38 % ▮▮··            │
│  stenosis from 54 routine clinical inputs,   │                                                                      │
│  explains every estimate with exact SHAP,    │       RISK ░▒▒▓▓█  0 ─ 25 ─ 50 ─ 75 ─ 100 %   P(stenosis)            │
│  and maps it onto real BodyParts3D anatomy.  │                                                                      │
│                                              │       P-017 · held-out test patient           [ next ↻ ]             │
│  [ Open workstation → ]   [ ▶ 90-s tour ]    │       poster.webp shown until GLB ready (no blank frame)             │
│                                              │                                                                      │
│  Opens on a held-out test patient. No login. │                                                                      │
│                                              │                                                                      │
├──────────────────────┬───────────────────────┼───────────────────────┬───────────────────────┬──────────────────────┤
│ 303                  │ 54                    │ 4 targets             │ 0                     │ 0.xx [0.xx–0.xx]     │
│ patients · UCI #411  │ clinical inputs       │ CAD·LAD·LCX·RCA       │ leaked labels         │ CAD test ROC-AUC     │
├──────────────────────┴───────────────┬───────┴───────────────────────┴──────┬────────────────┴──────────────────────┤
│ 01  PREDICT                          │ 02  EXPLAIN                          │ 03  MAP                               │
│ Calibrated LR + XGBoost ensemble,    │ Exact TreeSHAP per target, summed    │ Vessel colour = its probability;      │
│ one head per target, tuned           │ per clinical feature; additive in    │ supplied territories tinted           │
│ thresholds, held-out test split.     │ log-odds, reproducible.              │ (approximate, never lesions).         │
├──────────────────────────────────────┴───────────────────┬──────────────────┴───────────────────────────────────────┤
│ INTENDED USE                                             │ DATA & ANATOMY                                           │
│ Education and decision-support research only. Not a      │ Z-Alizadeh Sani extension, UCI #411 · CC BY 4.0          │
│ diagnosis; not a substitute for angiography, CTCA or     │ BodyParts3D © DBCLS · CC BY-SA 2.1 JP                    │
│ other formal imaging. Single centre, n = 303.            │ Code MIT · GitHub ›   Model card ›                       │
├──────────────────────────────────────────────────────────┴──────────────────────────────────────────────────────────┤
│ (i) Decision support & education only — not a diagnosis; not a substitute for formal diagnostic imaging.   Details ›│
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
- **KPI values** are read from `metrics.json` and are never hard-coded.
- **"54 inputs"** is 59 columns, minus the 4 targets, minus `Exertional CP` (which is constant).
- **The hero** is the real engine at tier B, at peel rest state e = 0.60.
- **"Open workstation"** keeps the same patient and the same canvas, and glides the camera to the workstation home pose (§6).

### 4.2 Workstation (1440×900)
```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◆ CardioTwin  Workstation · Performance · Methodology    P-017 ▾ 62 y · M · TEST    ● Edge 3 ms · Server ✓   ? Tour  │
├────────────────────────────┬────────────────────────────────────────────────────────┬────────────────────────────────┤
│PATIENT                     │ Heart › Coronary › LAD    [AP][LAO45][RAO30][⌂]        │ OVERALL · CAD              (i) │
│[⌕ P-017 · 62 y · M  TEST ▾]│ C-arm  RAO 30° · CRA 25°       NOT FOR DIAGNOSTIC USE  │ 87 %            ▮▮▮▮ VERY HIGH │
│● Cohort  ○ Custom          │                                                        │ ├──────┼──────┼──────┼───●─┤   │
│3 edits vs recorded  ↺  A/B │                                                        │ 0       ┃thr 46 %         100  │
│────────────────────────────│                      .-~~~~~~~~~-.                     │ CAD likely · above threshold   │
│▾ DEMOGRAPHICS   ▮▮··  +0.31│ RCA 61 % ▮▮▮·      .'  ┏━━━┓ ┏━━━ '.                   │ Model estimate, not a diagnosis│
│  Age         62 y ▁▂▃▄▅▆▇  │ HIGH  ────────────(   ┃    ┗━━━━━  )─── LAD 72 % ▮▮▮·  │────────────────────────────────│
│              ━━━━━●━━━━━━  │                    (  ┃     ┃     )     HIGH · selected│ VESSELS            P(stenosis) │
│  Sex   [ Male | Female ]   │                     '.┗━━┓  ┃   .'                     │ ▌LAD  72 %  ━━━━━━━━┿━─   HIGH │
│        Female → 58 %       │                       '-._┗━━┛_.-'───── LCX 38 % ▮▮··  │  LCX  38 %  ━━━━━┿────    MOD  │
│▸ RISK FACTORS •2 ▮▮▮· +0.22│                      LM · not predicted   MODERATE     │  RCA  61 %  ━━━━━━━┿━─   HIGH  │
│▸ SYMPTOMS       ▮▮▮▮  +0.88│                                                        │ ≈ 1.7 of 3 vessels  ▲ +12 pts  │
│▾ EXAM           ▮···  +0.04│                                                        │ [ Reveal cath result ]   TEST  │
│  BP   140 mmHg ▲ ref 90–120│                                                        │────────────────────────────────│
│       ▁▁▁▂▂▂▃▃▃ ━━━━━━━●━━ │                                                        │ WHY    CAD  [LAD]  LCX  RCA    │
│  PR    72 bpm  ♥ sets beat │                                                        │ LAD 72 %, high. Typical chest  │
│▸ ECG            ▮···  +0.12│ ┌─────┐  RISK ░▒▒▓▓█  0 · 25 · 50 · 75 · 100 %         │ pain and age push it up; a     │
│▸ LABS 1 imputed ▮▮··  −0.05│ │  S  │       thr ┃46   territory tint = approximate   │ normal FBS pulls it down.      │
│▾ ECHO           ▮▮··  −0.30│ │R ◎ L│                                                │ base −0.21 ──────────▶ +1.26   │
│  EF-TTE   45 % ▼ ▇▆▅▄▃▂▁   │ │  I  │  PEEL ▶ ○━━━━━━━●━━━━━━━━━━━━━━━━━━━●          │ Typical CP  Yes    ████▶ +0.94 │
│                ━━━━●━━━━━  │ └─────┘  skin · muscle · ribs · lungs · open heart     │ Age         62 y     ██▶ +0.41 │
│  Region RWMA [0|1|2|3|4]   │ [Territories][Flow][Beat 72][Labels]   Clay | Anat     │ Region RWMA 2         █▶ +0.30 │
│────────────────────────────│                  BodyParts3D © DBCLS · CC BY-SA 2.1 JP │ FBS    98 mg/dL     ◀█   −0.18 │
│[ ◐ Compare to recorded ]   │                                                        │ + 50 more           Show all ▾ │
│[ ↺ Reset to recorded   ]   │                                                        │ typical 45 % → this patient 72%│
│                            │                                                        │────────────────────────────────│
│                            │                                                        │ ▸ PHYSIOLOGY value · ref · SHAP│
├────────────────────────────┴────────────────────────────────────────────────────────┴────────────────────────────────┤
│ (i) Decision support & education only — not a diagnosis; not a substitute for angiography, CTCA or formal imaging.   │
│     Vessel-level risk · no lesion localisation                                                          Details ›    │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Left panel**
- Groups follow the `schema.groups` order. Each header shows a mini-bar with that group's share of |SHAP| for the selected target, plus the signed group sum.
- ▁▂▃ above each slider track is the **ICE strip** for the selected target. Toggles show the counterfactual ("Female → 58 %").
- `PR` drives the heartbeat.

**Canvas.** The breadcrumb and C-arm readout sit top-left, projections top-right, the orientation cube bottom-left, and the legend, PEEL scrubber, layer toggles and credits along the bottom.

**Right panel**
- The WHY tabs stay in sync with the 3D selection.
- The narrative sentence comes first, then the waterfall.
- The footer shows `platt(base_value)` → `predictions[t].probability`, using the model's Platt `a` and `b`.

### 4.3 Workstation (1280×720): rail with the Exam flyout open
```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◆ CardioTwin  Workstation · Performance · Method   P-017 ▾ 62 y M TEST   ● Edge 3 ms ✓   ? Tour     │
├─────┬────────────────────────────────────────────────────────────────┬──────────────────────────────┤
│ Pt  │┌ EXAM ─────────────── ✕ ┐ Heart › LAD  [Projection ▾][⌂]       │ [ Risk ][ Why ][ Physiology ]│
│ ─── ││ BP     140 mmHg ▲      │      C-arm RAO 30° · CRA 25°         │ OVERALL · CAD             (i)│
│ Dem ││ ▁▁▂▂▃▃ ━━━━━━━━●━━     │               NOT FOR DIAGNOSTIC USE │ 87 %          ▮▮▮▮ VERY HIGH │
│ Rsk•││ PR      72 bpm  ♥      │          .-~~~~~~~-.                 │ ├─────┼─────┼─────┼──●─┤     │
│ Sym ││ ━━━━━●━━━━━━━━━━       │         ( ━━┓  ┏━━━ )── LAD 72 % ▮▮▮·│ CAD likely · thr 46 %        │
│▌Exm ││ Edema  [ No | Yes ]    │          (  ┃  ┗━━━ )    HIGH        │ ─────────────────────────────│
│ ECG ││        Yes → 76 %      │  RCA ────'-.┗━┛_.-'──── LCX 38 % ▮▮··│ ▌LAD  72 %  ━━━━━━━┿━─  HIGH │
│ Lab ││ Murmur [ No | Yes ]    │  61 % ▮▮▮·   LM · not predicted      │  LCX  38 %  ━━━━┿────    MOD │
│ Eco ││ flyout 296 px, overlays│  HIGH                                │  RCA  61 %  ━━━━━━┿━─   HIGH │
│ ─── ││ canvas; canvas never   │                                      │ ≈ 1.7 of 3 · ▲ +12 pts       │
│  3  ││ resizes; Esc closes    │                                      │ ─────────────────────────────│
│ ↺   │└────────────────────────┘                                      │ TOP DRIVERS · LAD     Why ›  │
│ ⇤⇥  │                                                                │ Typical CP  Yes   ████▶ +0.94│
│     │ ┌─────┐ ░▒▓█ 0·25·50·75·100 % ┃46   territory = approx.        │ Age         62 y    ██▶ +0.41│
│     │ │R ◎ L│ PEEL ▶ ○━━━━●━━━━━━━━━━━━━━●     [Terr][Flow][Beat] ⋯  │ EF-TTE      45 %    █▶  +0.33│
│     │ └─────┘                     BodyParts3D © DBCLS CC BY-SA 2.1 JP│ FBS     98 mg/dL   ◀█   −0.18│
├─────┴────────────────────────────────────────────────────────────────┴──────────────────────────────┤
│ (i) Decision support & education only · not a diagnosis · not a substitute for formal imaging   ›   │
└─────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
- **Rail.** The rail has one icon per schema group. • marks a group with edits, `3` counts the what-if edits, ↺ resets them, and ⇤⇥ pins the flyout.
- **Risk tab.** It keeps a teaser of the top 4 drivers, so the answer and its explanation are never more than one click apart.
- **Canvas HUD.** The layer toggles overflow into ⋯, and the projection presets collapse into a dropdown.
- **Labels.** RCA's label moves to the right lane when the flyout covers the left lane.

### 4.4 Model performance (1440, scrolls)
```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◆ CardioTwin  Workstation · Performance · Methodology                             ● Server · model v1.0.0 · seed 42 │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ MODEL PERFORMANCE   Target [ CAD ][ LAD ][ LCX ][ RCA ]   Split [ Held-out test n=61 ][ 5-fold CV · dev n=242 ]     │
│ How well does it separate diseased from healthy, on patients it never saw?   (all numbers: placeholders)            │
│ LR + XGBoost margin ensemble, Platt-calibrated · threshold tuned on dev folds, frozen before test                   │
├───────────────────┬───────────────────┬──────────────────┬───────────────────┬───────────────────┬──────────────────┤
│ ROC-AUC           │ PR-AUC            │ F1 @ thr 0.46    │ Sensitivity       │ Specificity       │ Brier            │
│ 0.xx [0.xx–0.xx]  │ 0.xx [0.xx–0.xx]  │ 0.xx [0.xx–0.xx] │ 0.xx [0.xx–0.xx]  │ 0.xx [.xx–.xx]    │ 0.xx lower=better│
│ CV 0.xx ± 0.0x    │ prevalence 0.71   │ prec 0.xx        │ FN 2 of 44        │ FP 3 of 17        │ MCC 0.xx         │
├───────────────────┴───────────────────┴──────────────────┼───────────────────┴───────────────────┴──────────────────┤
│ ROC · 95% bootstrap band                  (i) How to read│ PRECISION–RECALL · baseline = prevalence    (i)          │
│ 1 ┤      ▁▂▄▆▇████●  ← operating point (thr 0.46)        │ 1 ┤████████▇▇▆▅▄▃▂●                                      │
│   │   ▂▅▇█      ╱ chance                                 │   │                ▀▀▄                                   │
│   │ ▂▆█     ╱                                            │   │- - - - - - - - - - - - - 0.71 baseline               │
│ 0 ┼──────────────────── FPR 1                            │ 0 ┼──────────────────── recall 1                         │
├──────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────┤
│ CALIBRATION · reliability + counts         (i)           │ DECISION CURVE · net benefit                 (i)         │
│ 1 ┤          ●╱   ● 10 quantile bins, size = n           │   ┤ ━━━━━━━━━━━━━━━━━━━━━━━  model                       │
│   │     ●  ╱●     ╱ perfect                              │   │ ╲╲╲╲─────────────────  treat all                     │
│   │  ●  ╱         ▁▃▅▇ count histogram                   │   │ ───────────────────────  treat none                  │
│ 0 ┼────────────── predicted 1                            │   ┼──────────┃───────────── threshold prob.              │
├──────────────────────────────────────┬───────────────────┴──────────────────┬───────────────────────────────────────┤
│ CONFUSION @ thr 0.46      (i)        │ LEADERBOARD · 5-fold CV ROC-AUC      │ GLOBAL DRIVERS · mean |SHAP|          │
│             pred −    pred +         │ ▸ Ensemble LR+XGB  0.xx ± 0.0x ●     │ Typical CP     ██████████             │
│  actual −   TN 14     FP 3 ▨         │   XGBoost          0.xx ± 0.0x       │ Age            ██████                 │
│  actual +   FN 2 ▨    TP 42          │   Logistic (L2)    0.xx ± 0.0x       │ Atypical       █████                  │
│ thr ◀──●──▶ exploring · ↺ 0.46       │   Random forest    0.xx ± 0.0x       │ Region RWMA    ████  beeswarm ▸       │
├──────────────────────────────────────┴──────────────────────────────────────┴───────────────────────────────────────┤
│ PROTOCOL  ✓ LAD/LCX/RCA/Cath never inputs (unit-tested)  ✓ Stratified 80/20 hold-out, seed 42  ✓ Test scored once   │
│           ✓ Label check: Cath = CAD ⇔ ≥1 stenotic vessel  ✓ Edge/server parity |Δp| < 1e-6          Methodology ›   │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ (i) Decision support & education only · single-centre cohort (n = 303), not externally validated · not a diagnosis  │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
- **One linked threshold.** Dragging the confusion-card handle, or the dot on the ROC curve, moves the ROC, PR and DCA markers and recomputes the tiles live. This needs `curves.roc.thresholds[]` (§7.12).
- **"Exploring" badge.** While the threshold differs from the deployed one, a dashed "exploring · deployed 0.46 ↺" badge offers a snap back. The what-if threshold never changes the deployed one.
- **Charts are neutral:**
  - the main series is `text/primary` at 1.5 px;
  - the CI band is white at 8%;
  - CV folds are white at 12%, 1 px;
  - reference lines are `text/tertiary`, dashed `4 3`;
  - the operating point is an 8 px `accent` dot.
- **Confusion cells.** Correct cells use `accent/subtle`. Error cells use `surface/2` with a 45° 1 px hatch in `text/disabled`, spaced 6 px (▨). No red.
- **Every chart** has a one-line "How to read this", a "View as table" toggle and a PNG/SVG export with the watermark burned in.

## 5. Components

Every panel is schema-driven: groups and features come from `schema.json`; vessel rows and 3D labels come from `schema.targets` joined to `manifest.structures`.

| Component | Spec | States |
|---|---|---|
| **Button** | h 32 (40 on landing CTA), r-sm, 13/18 600, padding 0 12. **Primary:** `accent` fill, `accent/ink` text. **Secondary:** surface/1 + border/default. **Ghost:** transparent, text/secondary. **Icon:** 24 or 28 square. | default · hover (accent/hover or surface/2) · pressed (accent/pressed or border/strong) · focus (ring) · disabled (surface/2, text/disabled) · loading (inline 12 px bar) |
| **AppBar / NavTab** | h 48/40, bg/app, bottom hairline. Tabs 13/18 500, padding 0 12. Patient chip: mono ID + summary + TEST/DEV tag. | default (text/secondary) · hover (text/primary) · active (text/primary + 2 px accent underline) · focus. The patient chip is hidden on landing. |
| **EnginePill** | h 24, r-full, surface/1, border/default, 12/16, 6 px dot. Tooltip: model version, fixture parity ✓, render tier, fps. | `Edge 3 ms` (◐ accent) · `Verifying` (1 px indeterminate accent bar under the top bar, only if > 150 ms) · `Server ✓` (success; "matches edge, \|Δp\| < 1e-6") · `Edge only · server offline` (neutral, fully functional) · `Engines disagree` (warn icon + toast; server value shown) · `Error` (danger icon; "estimate unavailable"; vessels switch to pending grey) |
| **PatientPicker** (combobox) | h 32. List grouped *Held-out TEST* / *Dev*. Row h 40: mono ID, 12/16 summary, split tag. The default patient is a TEST patient. | closed · open · filtering · no results · keyboard-highlighted · selected · Custom · Edited·n (accent dot + ↺) |
| **WhatIfBar** | "n edits vs recorded", ↺ Reset, ◐ Compare, A/B pin | clean (hidden count, disabled buttons) · dirty · **pinned** (every track shows a hollow ghost tick at the recorded value; deltas persist as "was 41 % → 63 %") |
| **GroupAccordion header** | h 32, 16 px chevron, overline title, •n edited badge (accent), "n imputed" tag, 4-segment \|SHAP\|-share mini-bar (text/secondary), signed sum in numeral-m | collapsed · expanded · hover · focus · has-edits · has-imputed. At 1280, only one group is open at a time. |
| **NumericFeatureRow** | h 52. Label 12/16. Editable value field (64×24, numeral-m) + unit. **ICE strip** 16 px above the track: 32 samples of p(target) across [min, max], 1 px text/secondary line over an Ember-gradient fill at 60%. Track 4 px surface/2 with the `schema.normal` band as white 6%. 14 px accent thumb in a 24 px hit area. ▲/▼ glyph when outside normal. ±step buttons appear on focus. | default · hover (thumb 16) · focus · dragging (data tween 120 ms; the thumb rides its own ICE curve) · edited (accent dot + hollow ghost tick at the recorded value + per-field ↺) · imputed (dashed underline + `IMP` tag + tooltip "filled with cohort median 20") · out-of-range ("above normal", text/secondary) · invalid (danger border + message) · ICE computing (strip at 40%) · disabled |
| **BinaryToggle** | Segmented No \| Yes, h 28. Counterfactual caption 12/16 text/tertiary: "Yes → 76 %" (the target p if flipped). | off · on · edited · focus · pending · disabled |
| **CategoricalSegment** | Segmented control up to 5 options (Sex, BBB, VHD, Region RWMA 0–4), a select menu above that. Each option has a full-label tooltip, and hovering an option shows its counterfactual p. | same as BinaryToggle |
| **CADHeroCard** | Overline, numeral-xl, BandChip + meter, RiskTrack, verdict line, microcopy "Model estimate, not a diagnosis" | skeleton · value · updating (tween + delta chip) · threshold crossed (verdict swaps) · stale (value at 50% + "updating") · error ("estimate unavailable"; never a stale number presented as current) · ground truth revealed |
| **RiskTrack** | 2 px border/default track 0–100; 1 px band ticks at 25/50/75; 2 px text/primary threshold tick labelled "thr 46 %"; 10 px value marker in `riskHex(p)` with a 1 px bg ring; optional hollow accent ghost marker | static · animating · comparing |
| **BandChip + meter** | h 20, r-sm, surface/1, 2 px left rule in band colour, 8 px pip, band word as overline in text/primary, 4 segments 6×10 (filled text/secondary, empty border/default). **Never a filled colour background.** | low · moderate · high · very high · pending |
| **VesselRow** | h 36: name 13/18 600, % numeral-l, track with threshold tick, chip, ▸ focus button | default · hover (lights the 3D vessel) · selected (2 px accent left rule + surface/2; 3D focus) · dimmed · pending · ground truth (● stenotic / ○ not at cath, plus "agrees ✓" or "disagrees ✕" in text) |
| **GroundTruthReveal** | "Reveal cath result", TEST patients only. Caption: "This patient was never seen in training." | hidden · revealed-agree · revealed-disagree (shown, never hidden) · unavailable (Custom; disabled with tooltip) |
| **TargetTabs** | CAD · LAD · LCX · RCA, h 28, 2 px accent underline | synced with 3D selection. Clicking the heart background returns to CAD. |
| **NarrativeSentence** | narrative 14/21. Template: `{T} {p} %, {band}. {up₁} and {up₂} push it up; {down₁} pulls it down.` Built from contributions and `schema.features[].phrase`. No LLM. Phrases have a dotted underline. | default · phrase hover (highlights the input row and the SHAP row) · updating (160 ms crossfade) |
| **ShapWaterfall** | Header "log-odds · base E[f(x)] → f(x)". Rows h 24: feature, value + unit (text/tertiary), diverging bar (max 96 px, scale shared per target), signed numeral-m. Top 8 + "+n more". Secondary axis shows probability ticks 10/25/50/75/90 % placed through inverse Platt. Footer "typical X % → this patient Y %". [Size \| Group] toggle. | default · expanded (all 54, virtualised) · row hover (tooltip: value, ref range, description, "raises LAD log-odds by 0.41"; **highlights the form row, never anatomy**) · focus · reordering (FLIP) · changed row (accent rule 1.2 s) · negligible (\|shap\| < 0.02: text/tertiary, bar 40%) · grouped (subtotals) |
| **GroupAttributionStrip** | Diverging stacked bar, h 8, summed SHAP per group | hover (total) · click opens that accordion group |
| **PhysiologyTable** | Feature · value · reference mini-bar (normal band white 8% + value dot) · SHAP bar | sort by \|SHAP\| or group · "abnormal only" filter · row hover linked to the form |
| **CanvasHUD** | Breadcrumb 12/16. Projection presets (segmented h 24). **C-arm readout** in mono-s, live during flights. ⌂ home. Orientation cube 56 px (S/I/R/L/A/P, radiological, faces clickable). Legend: ramp 160×8, band ticks, threshold tick of the selected target, "territory tint = approximate". Watermark. Credits 11 px. HUD chips use surface/3 at 88% + e-hud, **no backdrop-filter**. | presets default / active / animating · cube face hover / snap |
| **PeelScrubber** | 240 px track. Detents: Closed 0 · Skin off .25 · Ribs open .45 · **Lungs aside .60 (rest ◆)** · Open heart 1.0. Magnetic ±0.02. ▶ Dissect / ⟲ Assemble. | idle · hover · dragging · playing (thumb locked, click cancels) · at detent (label in text/primary) · hidden in tier D |
| **LayerToggles** | Chips h 24: Territories · Flow · Beat (shows bpm) · Labels · Ghost layers · Clay \| Anat | on · off · disabled by tier (tooltip says why) |
| **VesselLabel (3D)** | See §7.7 | default · hover · selected · posterior · compact · dimmed |
| **Tooltip** | surface/3, e-2, r-md, padding 8×10, max-width 280, 12/16. Opens after 120 ms of hover, or immediately on focus. | shown · hidden. Esc dismisses. Never holds the only copy of any information. |
| **StatusLine** | §9 | one state by design |
| **TourCoachmark** | Spotlight cut-out, scrim 60%, 320 px card on surface/3 with e-3, step n/7, Back / Next / Skip, focus trapped. Steps: ① status line ② held-out patient picker ③ CAD card + vessels ④ click LAD → C-arm ⑤ narrative + waterfall ⑥ flip *Typical chest pain* (the ripple, ICE strips) ⑦ ▶ Dissect, then "See how well it performs ›" → Performance with the Protocol strip spotlit. | per step · skipped · done · resumable from ? Tour |
| **Toast** | Bottom-right above the status line, 360 px, icon + one line + optional action | info / success / warn: 4 s, pause on hover · danger: persists |
| **KPITile** | Metric overline, numeral-l value, CI in text/tertiary, CV mean ± sd, definition tooltip | test / CV mode · loading |
| **ChartFrame** | title-2, "How to read" line, SVG (d3-scale / d3-shape), table toggle, export | skeleton · ready · crosshair · table view · error |
| **Leaderboard / ProtocolStrip** | Sortable rows with a ±sd whisker; each ✓ links to a Methodology anchor | sorted asc / desc · selected model pinned (accent rule) |
| **WebGLFallback** | 2D SVG anterior coronary schematic: same `riskHex`, same labels, hover / click / keyboard, over a poster.webp | shown when WebGL2 is missing, the GLB fails to load, or the context is lost twice |

## 6. Motion

**Tokens**

| Token | Duration | Easing | Use |
|---|---|---|---|
| `instant` | 90 ms | `cubic-bezier(.2,0,0,1)` | Hover, press |
| `fast` | 160 ms | `cubic-bezier(.22,1,.36,1)` | Toggles, chips, tooltips, label fades |
| `base` | 240 ms | `cubic-bezier(.22,1,.36,1)` | Panels, popovers, FLIP reorders, bars |
| `data` | 420 ms (120 ms while dragging) | `cubic-bezier(.16,1,.3,1)` | Numbers, markers |
| `flyout` | 360 ms | `cubic-bezier(.22,1,.36,1)` | Flyout and view-offset shift |
| `camera` | about 700–900 ms | drei `CameraControls` `smoothTime 0.35`, `draggingSmoothTime 0.12`; interruptible; spherical path around the target | All camera moves |
| `peel` | 1400 ms forward / 1100 ms assemble | `cubic-bezier(.65,0,.35,1)` inside each layer window | Dissection |
| `exit` | 0.7 × enter | `cubic-bezier(.55,0,1,.45)` | Anything leaving |
| 3D damping | `maath/easing.damp`, λ: p 6 (about 450 ms), territory 4 (about 600 ms), emissive 8, label opacity 12 | n/a | Shader uniforms |

**Hard rules**
- No overshoot, bounce or shake anywhere.
- The disclaimer never animates.
- Only one attention animation runs at a time.
- No auto-orbit in the workstation. The landing turntable runs at 6°/s, stops on pointer-down and resumes after 8 s idle.
- Numbers never count up from 0.

**Workstation load.** Input is never blocked, and the user can orbit from T.

| t | Event |
|---|---|
| 0 | Chrome and status line paint at full opacity. `model.json` loads and the edge engine predicts, so **panels show real numbers before the GLB arrives**. Panel sections rise 4 px and fade in (240 ms, 40 ms stagger). The canvas shows a 1 px accent progress hairline under the breadcrumb and "Loading anatomy 3.1 / 7.8 MB" in text/tertiary. No spinner. |
| T (GLB ready) → +500 | Exposure goes 0 → 1. The camera dollies from 6.6 to 6.0 over 900 ms. |
| +200 → +900 | **Draw-in.** The coronary tree appears in `vessel/trace` from the ostia outward, driven by `_ARCLEN` against a `uReveal` uniform with a 0.02 soft edge. Branches follow automatically because arc length is measured per tree. |
| +900 → +1300 | **Ignition.** Every vessel crossfades from trace to `riskLUT(p)` at the same time and **uniformly along its length** (400 ms, `data` easing). Emissive and bloom reach their targets and the territory tint fades in. At the same moment, each VesselRow's pip plays one 240 ms ring, so the eye links each colour to its number. |
| +1300 | Labels fade in (160 ms) in LAD → LCX → RCA order, 60 ms apart. Leader lines draw over 200 ms. |
| +1500 | The heartbeat starts and flow particles fade in over 300 ms. |

- The sequence plays once per session (`sessionStorage`). Any input jumps to the end state within 150 ms.
- **From the landing CTA** (the canvas is shared): landing copy exits (240 ms, y −8); the camera glides from the hero pose to home and the view offset moves the heart to the canvas centre (900 ms, in-out); panels slide in by 16 px (240 ms, 60 ms stagger); the canvas is resized **once**, at 900 ms, hidden under opaque panels. Ignition does not replay.

**Peel.** One scalar `e ∈ [0,1]` drives every layer. The translation vectors come from `manifest.layers[].explode`.

| Layer | e window | Motion | End state |
|---|---|---|---|
| Skin | 0.00–0.25 | +Z along `explode`, scale 1.00 → 1.03 | Fresnel ghost (α × 0.2) if Ghost layers is on, else 0 |
| Pectorals | 0.05–0.30 | ±X out, +Z | Ghost 0.06 |
| Sternum + costal cartilage | 0.15–0.45 | +Z lift | Bone ghost |
| Ribs_L / Ribs_R | 0.15–0.45 | **Hinge ±18° (range 14–22°)** about a vertical axis through the costovertebral line (manifest `pivot`), **like a book opening** | Bone ghost α 0.10–0.20 |
| Lungs + trachea | 0.30–0.60 | ±X by 1.4 units (1.2–1.6) | Fresnel α max 0.30 |
| Diaphragm | 0.45–0.65 | −Y by 0.6 | 0.08 |
| `Heart_Wall_Anterior` + the coronaries riding on it | 0.70–1.00 | Hinge 16° (12–20°) about the AV-groove `hingeAxis`, then +Z 0.35 | Opaque; cut faces `#3A2A2A`; valves and papillary muscles revealed |
| Great vessels | 0.70–1.00 | +Y 0.15 | Opaque |

- **Rest state is e = 0.60.**
- **▶ Dissect** plays 0 → 1 in 1400 ms. If e > 0, it first snaps to 0 with a 200 ms crossfade. During ▶ only, the camera dollies from 6.0 to 3.6 and orbits +20° in azimuth for parallax.
- **⟲ Assemble** returns to 0.60 in 1100 ms and restores the camera. Scrubbing never moves the camera; the user owns it.
- A layer drops out of raycasting below 0.2 opacity. Layer tags (overline, 160 ms fade) appear once a layer is more than 50% separated.
- Coronary nodes inherit the transform of the wall named in manifest `rides`, so **a vessel never detaches from the myocardium it supplies.**

**Prediction update**
1. **Compute.** The edge engine runs once per animation frame while a control is dragged. The server check is debounced 300 ms after release, and the pill goes `Edge → Verifying → Server ✓`.
2. **Numbers and markers** use `data`. Bars use `base`, with a 1 px ghost of the previous value for 1.5 s. The delta chip "▲ +12 pts" fades in over 160 ms, holds until 2 s after the last change, then fades over 240 ms. With a pinned baseline it persists as "was → now".
3. **Vessel and territory.** `uP` is damped (λ 6) and colour is sampled from the LUT, so every frame stays on the legend.
4. **Ripple.** It runs on commit (release or toggle) when |Δp| ≥ 0.03:
   - a band 12% of the vessel's length (range 8–15%) at +0.35 emissive (0.25–0.40);
   - it travels **the full length, root to tip**, in the direction of flow, in 600 ms (500–700), then resolves to uniform;
   - its shape is identical whatever changed, it fires at most once per vessel per 1.2 s, and it never stops at a point.
5. **Band change.** The chip crossfades over 160 ms and the 3D label pip plays one ring (scale 1.0 → 1.4, opacity .6 → 0, 240 ms).
6. **Threshold crossing.** The verdict slides 6 px over 160 ms and is announced through aria-live.
7. **SHAP rows** use FLIP over 240 ms. A bar that changes sign animates through zero. The changed row gets an accent rule for 1.2 s. The narrative sentence crossfades over 160 ms.
8. **ICE strips** recompute in a Web Worker 150 ms after commit (54 features × 32 samples for the selected target) and crossfade over 160 ms. The dragged feature's own strip does not change.

**Physiology loops**
- **Heartbeat.** HR comes from `PR`, clamped to 40–140 bpm. Systole takes 35% of the RR interval and scales radially toward the heart centre from 1 → 0.97 (range 0.965–0.975), ease-in-out. Diastole takes 65%, ease-out. A new rate takes effect at the next beat boundary.
  - The same `uBeat` vertex function runs in the heart and coronary materials, so vessels never detach.
  - Labels are anchored in a group that does not beat.
  - The beat changes scale only, never luminance.
- **Flow.** Particles are faster in diastole (×1.6) than in systole (×0.6), because coronary flow is mostly diastolic. Speed is identical for every vessel.

**Reduced motion** (`prefers-reduced-motion`, or the in-app **Calm mode**, key C)
- No draw-in, ignition, ripple, heartbeat or particles.
- Camera moves and the peel become 150–200 ms crossfades between states.
- Numbers update instantly.

## 7. 3D art direction

### 7.1 Stage, camera, renderer
- **Background.** A full-screen quad at `renderOrder −1` with `depthWrite: false`. It draws a radial gradient from `#11161C` (centre at 50% width, 40% height) to `#06080A` (corners), with a ±1/255 dither from a 64² blue-noise texture generated in code. No floor, grid or HDRI.
- **Camera.** `PerspectiveCamera` fov 30°, near 0.1, far 50. Home pose comes from `manifest.camera.home`.
- **`<CameraControls>`:**
  - distance 2.2–9;
  - polar angle 20°–160°;
  - pan off (Shift-drag pans, within bounds);
  - `smoothTime 0.35`, `draggingSmoothTime 0.12`.
- **`<Canvas>`:**
  - `gl={{ antialias: false, alpha: false, stencil: false, powerPreference: 'high-performance' }}`, output sRGB.
  - Tiers A/B: `flat` (NoToneMapping); tone mapping happens in post.
  - Tier C: `gl.toneMapping = THREE.NeutralToneMapping`, exposure 1.0.
- **Tone mapping.** Khronos PBR Neutral is applied exactly once. It is the identity below about 0.76, so base colours match the legend and only emissive highlights are compressed.

### 7.2 Lighting rig (no shadow maps)

The key and fill lights are **children of the camera**, so the lit side always faces the viewer and colours stay true to the legend at any orbit angle.

| Light | Colour | Intensity (range) | Position (camera space unless stated) |
|---|---|---|---|
| Hemisphere | sky `#DDE7F2`, ground `#2A2220` | 0.6 (0.4–0.8) | World space |
| Key, directional | `#FFF1E6` | 2.2 (1.8–2.6) | (−3, 4, 5): upper viewer-left, anterior |
| Rim, directional | `#8CB8FF` | 1.6 (1.2–2.0) | (2.5, 2, −4): separates the silhouette from the dark background |
| Fill, directional | `#FFFFFF` | 0.4 (0.3–0.6) | (4, −1, 3) |
| Environment | RoomEnvironment → PMREM, 128 px (64 px in tiers B/C), generated once, no network | `envMapIntensity` 0.35 (0.25–0.45) on opaque tissue and vessels; 0 on transparent layers | n/a |

Ambient occlusion is baked into the vertex attribute `COLOR_1` and multiplied into diffuse at strength 0.75 (0.6–0.9).

### 7.3 Materials

All materials are `MeshStandardMaterial` with small `onBeforeCompile` patches, plus one custom `ShaderMaterial` for the skin. No transmission and no physical sheen.

| Structure | Parameters (range) |
|---|---|
| **Myocardium, Clay look (default)** | Colour `#62574F` (OKLab L 0.45–0.50). Roughness 0.62 (0.55–0.70), metalness 0. Wrap-diffuse 0.25 (0.15–0.30) tinted `#C98B80`, which fakes subsurface scattering. Fresnel rim `#8CB8FF` × 0.10 (0.05–0.15). Territory tint per §7.4. **Rule:** at the home pose, the wall's lit on-screen value must stay below the p = 0 vessel. |
| **Myocardium, Anatomical look** | `#6A302C`, wrap tint `#D06A5A`, same parameters otherwise. Risk colouring stays identical. |
| **Cut and inner faces** | A `!gl_FrontFacing` branch renders `#3A2A2A`. DoubleSide on `Heart_Wall_Anterior` only. |
| **Coronary targets** (LAD + LAD_Septal; LCX; RCA + Marginal / PDA / PL / Septal, as in `schema.targets[].anatomy`) | `color = emissive = LUT(uP)`. Roughness 0.30 (0.25–0.40). `emissiveIntensity = 0.35 + 1.25·smoothstep(0.40, 1.00, p)` (floor 0.25–0.45, gain 1.0–1.5). Fresnel rim `#E8ECF1` + 0.25 (0.20–0.35). Radius inflated 1.3× (1.2–1.4) along normals, and documented. Inverted-hull rim `#07090C` at +1.2% (1.0–1.5%, BackSide), so the silhouette reads even where vessel and wall have similar lightness. **One uniform colour per target, root to tip.** |
| **Left main** | `#8A7D76`, roughness 0.45, no emissive. Labelled "LM · not predicted". Never coloured by max(LAD, LCX). |
| **Pending or error** | `#4B5260`, no emissive |
| **Great vessels** | `#6B5E57`, roughness 0.45 |
| **Valves / papillary muscles** | `#9A8F86`, roughness 0.5. Visible when the heart is opened. |
| **Cardiac veins** | `#4F4542`, hidden by default. If shown: 20% opacity, tag "not modelled". |
| **Bone** | Opaque `#B8B0A3`, roughness 0.85, while e < 0.15. Becomes a ghost: fresnel additive `#9FB4C8`, α = 0.10–0.20 · F². |
| **Lungs** | `#C7A9A6`, α = 0.05 + 0.30·F², `depthWrite: false` |
| **Skin** | Custom shader, `#A9B8C8`, α = 0.03 + 0.22·F³, no diffuse, `depthWrite: false`. Reads like an X-ray outline. |
| **Muscle / diaphragm** | `#8B5E58` roughness 0.7 / `#6B5F5A` at 0.5 opacity |
| **Render order** | Background → opaque heart → vessels → great vessels → diaphragm → lungs → bone ghost → muscle → skin |

### 7.4 Mapping risk onto anatomy
- **One lookup for everything.** `riskOf(structure.target)` drives the vessel uniforms, the panel rows, the labels and the legend. Adding a structure only needs a manifest entry.
- **Uniforms.** Each target has one material instance with `uP`, `uRipple`, `uBeat`, `uSelected` and `uDim`. The LUT texture is shared. Uniforms are animated through refs; React state is never set inside `useFrame`.
- **Glow.** Tune bloom so the onset of visible glow sits at p ≈ 0.70 on the lit side at the home pose. Only high and very-high vessels glow, which adds a lightness cue alongside hue.
- **Territories.** The shader reads `COLOR_0` (R = LAD, G = LCX, B = RCA):
  1. Sharpen and normalise: `w = normalize(pow(rgb, 2.0))` (exponent 1.5–3.0).
  2. `tint = Σ wᵢ·LUT(pᵢ)`.
  3. `strength = 0.10 + 0.40·Σ wᵢpᵢ` (0.10–0.50), multiplied by 0.25 for non-selected territories while a vessel is selected.
  4. `albedo = mix(clay, tint, strength)`, with no emissive, so a vessel always outshines its own territory.
  5. Draw a 1 px contour darkened 25%, anti-aliased with `fwidth`, where the top two weights are within 0.04 of each other.
  - The legend and tooltip say "supplied territory, approximate, not a perfusion scan".
  - **Region RWMA is never painted on the wall.**
- **Blood-flow particles.**
  - One `THREE.Points` draw call. The `vessels.json` centrelines are packed into a DataTexture and positions advance in the vertex shader, so there is no CPU cost per frame.
  - Particles are `#F2F5F8` at 70%, additive, 2.5 px (2–3.5) × DPR, and **not risk-coded**.
  - Speed is identical for every vessel, and a tooltip says "illustrative flow".

### 7.5 Hover and selection
- **Picking.** `three-mesh-bvh` raycasts only against invisible proxy tubes (built from `vessels.json` at **3× radius**) and the heart wall.
- **Hover.**
  - The cursor becomes a pointer.
  - An inverted-hull outline appears in `#EDF1F5` at 70% (about 1.5 px) and emissive rises 20%.
  - The linked panel row lights up.
  - After 120 ms a tooltip appears: "LAD · 72 % · High · supplies anterior wall, anterior septum, apex (approx.)".
  - Hovering the wall shows "LAD territory (approx.) · LAD 72 %".
- **Select** (click, keys 1/2/3, or ▸ on a row):
  - a 2 px **accent** hull appears;
  - other structures desaturate 60% and dim to 55%, but stay opaque;
  - territory isolation (§7.4) applies;
  - the camera flies to the manifest `bestView`: LAD RAO 30/CRA 25, LCX RAO 30/CAU 25, RCA LAO 40;
  - the WHY tab switches to that target and the row gets its accent rule.
- **Clear.** Esc or a click on empty space clears the selection. Double-clicking empty space also flies home.
- **Projection presets:** AP, LAO 45, RAO 30, LAO 45/CRA 20, RAO 30/CAU 25, Posterior.
  - Positive azimuth = LAO (toward +X, the patient's left). Positive elevation = cranial.

### 7.6 Labels
- **Rendering.** One DOM overlay plus one SVG for leader lines, repositioned inside `useFrame` via refs. This is not one drei `<Html>` per label.
- **Content.**
  - 8 px risk pip with a 1 px `border/strong` ring;
  - overline code ("LAD");
  - numeral-label "72 %";
  - band word and meter;
  - on surface/3 at 88% opacity, 1 px border/default, r-sm, padding 4×8.
- **Placement.**
  - Anchors come from manifest `labelAnchor`.
  - Radiological lanes: RCA on viewer-left, LAD and LCX on viewer-right. The lanes swap when |azimuth| > 90°.
  - Labels stack by Y with at least 28 px between them, and leader lines never cross.
- **Far side of the heart.** When `dot(labelNormal, viewDir) < 0`, the label drops to 25% opacity, gets a dashed leader and the suffix "(posterior)".
- **Compact mode** (pip + % only) is used when crowded or when the canvas is narrower than 640 px.
- **Anatomy labels** appear only with Labels on, on hover, in text/tertiary, with no numbers.

### 7.7 Post-processing budget and adaptive quality

Post-processing is one `@react-three/postprocessing` `<EffectComposer multisampling={0} frameBufferType={HalfFloatType}>` with, in order:
- `Bloom` (mipmapBlur, `luminanceThreshold` 0.80 (0.75–0.90), smoothing 0.10, intensity 0.55 (0.4–0.8), radius 0.6);
- `ToneMapping` (mode NEUTRAL);
- `Vignette` (offset 0.3, darkness 0.5);
- `SMAA` (preset MEDIUM).

Everything else from the rejected list in §0 is banned.

**Frame budget on Intel Iris Xe at 1440×900** (target 60 fps, floor 45)

| Item | Budget |
|---|---|
| Opaque scene | ≤ 6 ms |
| Transparent layers | ≤ 1.5 ms |
| Particles | ≤ 0.5 ms |
| Bloom | ≤ 1.5 ms |
| Tone mapping + vignette + SMAA | ≤ 1 ms |
| React per frame | ≤ 2 ms |
| Label DOM | ≤ 1 ms |

| Tier | Entry | DPR | Post | Particles | Other |
|---|---|---|---|---|---|
| **B Balanced** | Start tier everywhere; always used for the landing hero | 1.0–1.25 | Full composer, bloom at 0.5 resolution, 4 levels | 300 | PMREM 64 |
| **A Full** | Promoted after 3 s at ≥ 58 fps | [1, 1.5] | Composer, bloom at 0.5 resolution, 5 levels | 600 | PMREM 128. While orbiting, DPR regresses to 1.0 (`performance={{min: .5}}` + `AdaptiveDpr`) |
| **C Lite** | Below 45 fps average for 2 s at B, or no `EXT_color_buffer_half_float`, or chosen manually | 1.0 | **No composer.** Renderer uses NeutralToneMapping. Glow is faked with a back-face halo tube at 1.6× radius in the vessel colour, α 0.15 (0.10–0.20), only where p ≥ 0.5. | 0: flow becomes an arc-length dash shader on the vessels (`fract(_ARCLEN·40 − t·speed)`) | Heartbeat stays on |
| **D Static** | No WebGL2, GLB fails to load, or the context is lost twice | n/a | n/a | n/a | 2D SVG schematic + poster.webp (§5) |

- **Tier switching:** drei `<PerformanceMonitor ms={250} iterations={8} bounds={() => [45, 58]} flipflops={3} onIncline={up} onDecline={down} onFallback={lockC}>`. The current tier and fps appear in the EnginePill tooltip.
- **Asset budget:**
  - ≤ 400k triangles in total: heart ≤ 150k, coronaries ≤ 60k, skin ≤ 40k, ribs + sternum + cartilage ≤ 80k, lungs ≤ 50k, other ≤ 20k;
  - ≤ 45 draw calls: merged per layer, except one node per coronary target;
  - meshopt-compressed GLB ≤ 8 MB, loaded with `useGLTF(url, false, true)` and preloaded on the landing page;
  - **zero image textures**: only the LUT and the blue-noise texture, both generated in code.
- **Render loop:**
  - `frameloop="always"` only while Beat or Flow is on, the tab is visible and the canvas is on screen;
  - otherwise `"demand"` with `invalidate()`;
  - after 20 s without input, capped at 30 fps;
  - stopped when the tab is hidden.

### 7.8 Additive contract requests (additions only; no field is renamed or removed)
- **GLB:** a per-vertex `_ARCLEN` attribute on coronary meshes, 0 → 1 per tree (left tree measured from the LM ostium, right from the RCA ostium). `COLOR_1` baked AO on the heart wall.
- **`manifest.structures[]`:** `bestView {azimuth, elevation, distance}`, `labelAnchor [x,y,z]`, `labelNormal [x,y,z]`, and `rides` (the wall node).
- **`manifest.layers[]`:** `pivot`, `hingeAxis`, `hingeDeg`.
- **`metrics.json`:** `targets.*.curves.roc.thresholds[]`.
- **`schema.features[]`:** `phrase` (for example "typical chest pain") and `ice` (boolean, default true).

## 8. Signature moments

1. **The Peel.** One press of ▶ Dissect (key P) runs a 1.4 s dissection:
   - the skin lifts into a glass outline;
   - the ribs **swing open like a book**;
   - the lungs slide aside;
   - the camera drifts 20° for parallax;
   - the heart's anterior wall hinges open to show the valves.

   It keeps beating at the patient's own pulse throughout. The last frame is a matte clay heart whose coronary tree is the only saturated thing on screen, with the high-risk artery glowing. The sequence is scrubbable through named detents and assembles faster than it opens. Because it is driven by manifest data, it also demonstrates extensibility. This is the video thumbnail.
2. **C-arm, then Reveal.**
   - Clicking the LAD swings the camera along a C-arm arc to RAO 30° / CRA 25°, the view cardiologists actually read the LAD in, while the HUD readout ticks the angles live.
   - The other vessels dim, their territories fall quiet, and the WHY panel leads with "LAD 72 %, high. Typical chest pain and age push it up; a normal FBS pulls it down."
   - On a TEST patient, **Reveal cath result** places ● / ○ and "agrees ✓ / disagrees ✕" beside every vessel, misses included, captioned "This patient was never seen in training."
3. **Pull a lever: the heart answers.**
   - Pin the baseline (A/B), then drag *EF-TTE*. The thumb rides its own ICE curve, so the user can read the future before arriving.
   - In the same frame: labels read "was 41 % → 63 % ▲ +22 pts", a brightness ripple runs root to tip down each re-scored vessel in the direction of blood flow, the territory warms, and the SHAP bars re-sort with EF-TTE flagged.
   - A moment later the pill reads `Server ✓ matches`.
   - Toggles show their counterfactual before they are clicked ("Yes → 76 %").

   This proves interpretability and real-time integration in about 3 seconds, without narration.

## 9. Disclaimer treatment

- **Status line.** A permanent line runs along the bottom of every route: 28 px (24 px at ≤ 720 px tall), `bg/app` with a top hairline, a neutral (i) glyph, and 12/16 `text/secondary` text at 8.1:1.
  - **Wording:** "Decision support & education only — not a diagnosis; not a substitute for angiography, CTCA or formal diagnostic imaging."
  - **Also on the line:** "Vessel-level risk · no lesion localisation · Details ›". "Not a diagnosis" is set in `text/primary` 500.
  - **Hard rules:**
    - Never dismissible, never animated, never yellow or red, never a modal.
    - Its z-index (90) sits above the tour scrim and the flyouts.
    - Fullscreen applies to the app container, so the line stays visible.
- **Canvas watermark.** "NOT FOR DIAGNOSTIC USE" sits top-right in overline style (10–11 px, +0.12em, `text/tertiary` at 60%), following research DICOM-viewer convention. It is **burned into every PNG / PDF / SVG export** together with model version, engine and timestamp.
- **Contextual microcopy** where overtrust is most likely:
  - CAD card: "Model estimate, not a diagnosis".
  - Verdict: "CAD likely · above threshold 46 %". Never "Diagnosis".
  - The band word is "Very high", never "Critical".
  - Legend: "approximate supplied territory, not a perfusion scan".
  - LM: "not predicted".
  - Performance footer: "single-centre cohort (n = 303), not externally validated".
- **Details popover** covers:
  - intended use;
  - the dataset (71% CAD prevalence, so probabilities do not transfer to screening populations);
  - calibration notes and the absence of external validation;
  - what the colours mean;
  - licences (BodyParts3D © DBCLS CC BY-SA 2.1 JP, UCI #411 CC BY 4.0, MIT code).
- **Credits.** The BodyParts3D credit is also always visible bottom-right on the canvas (11 px).
- **First contact.** The landing page shows an "Intended use" card beside the CTA, and **tour step 1 spotlights the status line**. There is no blocking consent modal.

## 10. Accessibility rules

1. **Target: WCAG 2.2 AA.** Every text token passes on every surface (tertiary is at least 4.6:1 on surface/3), and every Ember stop is ≥ 3:1 against panels.
2. **Risk is never carried by colour alone.** Every value shows the %, band word, 4-segment meter, track position and a label. In 3D, glow rises with risk. Ember keeps monotonic lightness under all three colour-vision deficiencies, and CI runs `risk.test.ts`. Risk colours never colour text.
3. **Keyboard.** Tab order: skip link ("Skip to risk summary") → top bar → inputs → canvas → results → status line. The canvas has `role="application"` and `aria-roledescription="3D heart viewer"`, and shows a visible hint.
   - Arrow keys orbit 15°; +/− zoom.
   - 1/2/3 select LAD/LCX/RCA; 0 or H goes home; Esc clears.
   - P runs the peel, B toggles the beat, F the flow, T the territories, C Calm mode.
   - [ and ] cycle projections; ? opens the shortcut sheet.
   - Focus ring: 2 px accent with a 2 px offset, never removed. The ivory-free accent hull marks the focused vessel.
4. **Screen readers.**
   - The canvas region has `aria-describedby` pointing to a live text summary: "LAD 72 percent, high; LCX 38 percent, moderate; RCA 61 percent, high; left main not predicted. Ribs open."
   - A visually hidden equivalent table is always present.
   - Polite announcements fire only on commit, debounced 1 s, and only when a band changes or the verdict flips.
   - Sliders carry `aria-valuetext` such as "Ejection fraction 45 percent, below normal range 50 to 70".
   - SHAP rows read as "Typical chest pain, yes, raises LAD risk, plus 0.94 log-odds".
   - Every chart has an `aria-describedby` summary sentence and a "View as table" toggle.
5. **The 3D view is never the only path.** Every vessel action also exists on its VesselRow. Without WebGL2, the SVG fallback has the same interactions.
6. **Motion and photosensitivity.**
   - `prefers-reduced-motion` and Calm mode are both honoured (§6).
   - Nothing flashes more than 3 times per second.
   - The heartbeat is a 3% scale change with no luminance change, bloom never pulses, and the band ring is throttled to once per 1.2 s.
7. **Targets and inputs.**
   - Hit areas are at least 24×24 px, and 32 px for primary actions.
   - 3D hit tubes are 3× vessel radius.
   - Every slider has a numeric field and ±step buttons (arrow keys, and PgUp/PgDn for ×10). Drag is never the only way in.
8. **Tooltips** open on focus as well as hover, close with Esc, and never hold information that is not available elsewhere.
9. **Reflow and zoom.** At 200% zoom the 1280 rules apply. Below 1100 px the layout stacks. Sizes are in rem, and there is no horizontal scroll.
10. **Forced colours.** Chrome falls back to system colours. Chips and meters keep their segments. The canvas keeps its text summary.
11. **Focus management.** The flyout, sheets and tour trap focus, Esc closes them, and focus returns to whatever opened them.
12. **Plain language.**
    - Tooltips come from `schema.description`.
    - Abbreviations are expanded on first use with `<abbr>`, for example "left anterior descending (LAD)".
    - Each chart has a one-line "How to read this".
    - Out-of-range values are described in words, never flagged in red.
    - 11 px is used only for overlines and credits; every essential sentence is ≥ 12 px.

**Acceptance gate before the demo**
- `risk.test.ts` passes.
- Edge/server parity: `fixtures.json` matches with |Δp| < 1e-6.
- ≥ 45 fps at tier B on Iris Xe at 1440×900.
- An axe-core run on all three routes shows 0 serious issues.
- The canvas stays usable with reduced motion on.
- The status line is visible at every breakpoint, in fullscreen and during the tour.
- Exports carry the watermark.

---

## §7.9 Realistic mode (owner request)

The owner asked for anatomy that "looks real, super close to real human anatomy", and for "the exploded view where the model separates apart and comes back". This amendment adds a **Realistic** look beside LUMEN's **Clinical** clay and makes the exploded view the signature of the 3D stage. It amends §2.3, §6 (Peel, Physiology loops), §7.3, §7.5 and §7.7 only where stated; every risk rule of §2.2 and every safety rule of §9 still holds.

### 7.9.1 Decision: Realistic is the default look

- **Default.** Realistic is the default Look in the workstation and on the landing. Clinical stays available as the second option. The Look menu lists `Realistic · Clinical`, in that order (`LOOK_OPTIONS` in `three/stage/sceneControls.ts`).
- **Why this does not contradict V2 §5.15.** V2's "plain clay at rest" states a figure/ground rule: the myocardium carries no colour until a vessel is selected, and the coronary tree is the only saturated thing. Realistic keeps that rule by construction (§7.9.2), so it is the primary option and the V2 scene defaults apply to both looks unchanged.
- **Store.** `viewerStore.look` stays the single source of truth: `'anat'` means Realistic (the upgraded Anatomical look) and `'clay'` means Clinical. The first scene mount switches the untouched store default to `'anat'` once (`ensureRealisticDefault`). The values `'realistic' | 'clinical'` are also understood, so the store type can be widened without touching the scene.

### 7.9.2 Guardrails: risk stays unmistakable

| Rule | How Realistic keeps it |
|---|---|
| Only the coronary targets carry risk colour | Coronary targets keep `color = emissive = LUT(p)` in both looks, one colour per target, root to tip, animated through p. |
| The myocardium never competes with the ramp | The muscle red is desaturated and dark (`#5A2622`, OKLab L ≈ 0.33, chroma ≈ 0.07), below the p = 0 vessel's lightness and far from the coral/apricot chroma. A baked albedo, when present, is clamped to 72 % saturation. The myocardium is never emissive. |
| Glow means high risk | The emissive gain follows `0.3·k + 1.8·smoothstep(0.5, 1, p)`. The floor k is 0.45 in Realistic so glossy low-risk tubes still read as their hue. The bloom threshold (0.80) is crossed from p ≈ 0.70 only. |
| Anatomical colour is never read as risk colour | Arteries use a pale adventitia (`#9C8274`), not red. Systemic veins use a dusty atlas blue (`#34405C`), darker and greyer than the ramp's low end and never emissive. Cardiac veins stay hidden by default ("not modelled"); when shown they are a translucent atlas-blue overlay, never a solid tube. |
| Territory tint | Unchanged: `mix(albedo, Σ wᵢ·LUT(pᵢ), strength)`. The mode is Off · Selected · All, with 0.10 + 0.25·p in Selected mode and 0.10 + 0.30·Σwp in All mode, faded where COLOR_0's neutral weight dominates (atria). |
| Pending or stale state | Achromatic `#4B5260`, exactly as §2.2 rule 6. |

### 7.9.3 Materials (`three/anatomy/tissue.ts`, palette in `palette.ts`)

- **Material model.** One material instance per mesh (its rest offset, dissolve and baked maps differ) and a handful of shader programs, keyed by patch flags. Clinical = `MeshStandardMaterial` exactly as §7.3. Realistic = `MeshPhysicalMaterial` at tiers A/B and `MeshStandardMaterial` at tier C.

| Tissue | Realistic parameters |
|---|---|
| Myocardium | `#5A2622`, roughness 0.52, **clearcoat 0.9 / 0.16** (the wet epicardium), sheen 0.2 `#8E3A34` (tier A only), wrap-diffuse 0.55 tinted `#E0503C` and back-scatter `#B8322A` × 0.28 (the subsurface look where the rim light shines through thin edges), fibre-stretched detail, AV-groove fat, cavity AO. Chamber and cut faces `#3A1716`. |
| Coronaries | Ramp colour, roughness 0.34, clearcoat 0.55 / 0.2, env 0.5, rim `#FFF4EC` × 0.10, 0.5 mm display inflation (§7.3). |
| Valves, papillary muscles | Fibrous `#D6C4AA` with translucency; papillary muscles as myocardium `#5A2926`. |
| Great arteries | Adventitia `#9C8274`, clearcoat 0.35. Pulmonary veins `#6E3D3B`. SVC, IVC and cardiac veins atlas blue `#34405C`. |
| Bone, cartilage | Ivory `#E2D6BF` with pore-scale bump and yellowed mottling. Cartilage is a glossy bluish white `#BCC9CB` with translucency. |
| Lungs | Translucent spongy tissue (α 0.42 + fresnel rim, alveolar-scale bump) when closed; fresnel ghost once peeled. |
| Skin, muscle, diaphragm | Skin is always a warm fresnel ghost. Muscle and diaphragm are striated wet muscle `#6E2622`. |

- **Procedural detail.** All detail is computed in the heart's rest frame, so it sticks to the tissue while nodes explode, hinge and beat. No UVs are needed.
  - Detail comes from one baked, tileable 32³ RGBA8 volume holding value and gradient (`noiseTexture.ts`). There is one trilinear fetch per octave: 3 octaves at tier A, 2 at B and C.
  - It drives the bump (the tangential gradient), albedo mottling, roughness variation and the myocardial fibre direction (detail stretched across the long axis).
  - Octaves fade as they approach the pixel footprint, so distant tissue never shimmers.
- **Cavity attribute** (`cavity.ts`). `aCavity` is computed once per heart wall in idle time, with three channels:
  - x: crease AO, from the mean neighbour rise over squared edge length (≈ 1/(2R), independent of resolution);
  - y: the groove shadow next to each coronary centreline;
  - z: epicardial fat along the arteries.
- **Baked textures** (CONTRACTS §7.1). When the GLB carries `TEXCOORD_0` and PBR maps, Realistic uses them. Upload is lazy: one mesh per idle slice through `renderer.initTexture`, then that mesh's material is rebuilt with the maps. The procedural bump drops to 35 % and the mottling to 40 % on top of them. Clinical always ignores them.
- **Lighting** (`three/stage/studio.ts`). Realistic reflects a code-built photographic studio instead of RoomEnvironment: a dark cyclorama, a large warm softbox above left, a tall cool strip behind right, a soft top panel and a dim warm bounce, converted with PMREM once per look. Its camera-attached rig has a warmer key (2.7), a cool rim (2.3) that also drives the tissue back-scatter, and a lower hemisphere (0.42). Clinical keeps §7.2 exactly.

### 7.9.4 Scene defaults (V2 §5.15), both looks

- Lungs and airway are hidden in the workstation unless the Layers popover shows them. On the landing they are a fresnel ghost.
- **Pulmonary trees** are trimmed by a sphere centred between the pulmonary valve and the venous inflow: (0, 0.28, −0.15), radius 0.58, feather 0.2. The trunk, the proximal pulmonary arteries and the veins entering the left atrium remain. The trimmed ends fade out with alpha, so there is no black stub and no dither sparkle.
- The **descending aorta and the IVC** fade out beyond 1.35 units from the heart (feather 0.45). The arch stays.
- Peeled outer layers are ghosts faded to 40 % in the workstation (α ≤ 0.12). Skin also fades as it swings through the camera: the ghost shader has a near-lens fade.
- The orbit clamp (polar 35°–145°, distance 2.4–7) belongs to the camera rig (D1).

### 7.9.5 The exploded view (amends §6 "Peel")

- **Transform.** Every mesh's displayed matrix is `E · A · B · R`: rest (R), the affine beat (B), the cold-load assembly (A) and the explode (E). It is computed per frame in `three/anatomy/rig.ts` without React state.
- **Explode (E).** Displayed position = rest + k·(layer.explode + structure.explode), with k eased inside each layer's peel window (§6 table).
  - This fixes the bug where only layer vectors were applied and the heart never opened.
  - The anterior half first swings **16°** about an AV-groove hinge, then slides out along the cut-plane normal. The hinge lies in the cut plane, perpendicular to the long axis, through the base. It opens the half away from the posterior half and uncovers the chambers, valves and papillary muscles.
  - A manifest `pivot` / `hingeAxis` / `hingeDeg` on a layer or structure overrides the derived hinge.
  - A structure with `rides` inherits its wall's full rigid transform (translation and hinge), so coronary branches never detach.
- **Spring.** The displayed peel follows `viewerStore.explode` through a critically damped spring (ω = 7, about 0.7 s for the full travel, no overshoot). Scrubbing, ▶ Dissect and ⟲ Assemble all glide, and "comes back" is the same spring toward the rest detent (0.60).
- **Cold-load assembly** (`assembly.ts`). About 2.15 s, played once per session (the outer layers overlap tightly so the heart starts assembling after 0.4 s):
  - Layers fly in from beyond their explode offsets and materialise with a temporally dithered dissolve, in the order skin → muscle → ribs → lungs → diaphragm → great vessels → posterior half → anterior half.
  - The anterior half swings shut, carrying its coronaries. The curve is a critically damped settle: monotone, zero slope at both ends.
  - Any pointer, key or wheel input compresses the rest into 150 ms. Under reduced motion or Calm mode it is skipped.
  - The heart starts beating once it has closed. `sceneRuntime.assembly.t ≥ igniteAt` (1.95 s) is the fx layer's cue for the coronary ignition, and `useSceneControls().replayAssembly()` replays it.
- **Isolate (O)** keeps the myocardium and the selected artery (plus the left main for LAD and LCX), with its territory tinted, and fades everything else out. **Ghost others (G)** turns the myocardium, the other vessels and the great vessels into fresnel glass and keeps the selected artery solid and glowing. Every solid ↔ ghost change crossfades, because each mesh has a ghost twin.
- **Section.** An optional clipping plane on the manifest cut plane (`useSceneControls().setSection`, with depth ±0.6) glides in. Back faces render as tissue interior, so chambers and wall thickness read as a cutaway. The planes are shared through `sceneRuntime.sectionPlanes`.

### 7.9.6 Physiological heartbeat (amends §6 "Physiology loops")

- **Clock.** The beat runs on the scene's shared cardiac clock (`fx/cardiacClock.ts`, idempotent per frame) at the patient's PR (40–140 bpm), so the anatomy, the flow and the pulse share one phase.
- **Ventricular curve** (`heartbeat.ts`, tested). Isovolumic contraction (0–0.05); ejection peaking at end-systole (0.35 of the cycle); isovolumic relaxation (to 0.42); rapid filling (to 0.60); diastasis; an **atrial kick** (0.84–1.0) that over-fills the ventricles by 12 %.
- **Deformation.** Radial shortening of 3 % toward the long axis and longitudinal shortening of 4.5 % toward a point near the apex, so the base descends and the apex barely moves. This is an affine matrix in the node matrices of the walls, valves and coronaries. The atrial squeeze (4 %) and the great-vessel roots (which follow the beat near the base and stay still distally) use the same uniforms in the vertex shader (`BEAT_VERTEX_PARS` / `BEAT_VERTEX`).
- **Rules kept.** The beat is scale only, never luminance. It fades in and out over about 0.6 s and is off in Calm mode and under reduced motion.

### 7.9.7 Picking API

three-mesh-bvh raycasts against the heart walls, valves, great vessels and invisible proxy tubes at 3× lumen radius around the coronaries. BVHs are built lazily in idle time.

- `usePickStore` (`three/stage/pickStore.ts`) publishes `hover` and `selected` as `{ structureId, node, label, target, kind, segment, territory, point }`.
  - `segment` is the SCCT segment from `_SEGMENT`, resolved through manifest `segments[]` with the SCCT 2014 table as the fallback.
  - `territory` is the dominant COLOR_0 territory under the pointer on the myocardium.
- `pickPointer` carries the per-move face point and its screen position for per-frame consumers.
- Segments are anatomical labels for inspection, never lesion locations.

### 7.9.8 Performance

- Tiers are unchanged. Realistic uses clearcoat at A/B and sheen at A only, and falls back to `MeshStandardMaterial` with 2 octaves at C.
- The noise volume replaces about 120 ALU operations per octave with one texture fetch.
- Switching patients only moves uniforms: geometries, textures and programs stay constant (verified over repeated switches).

### 7.9.9 Amendments to earlier sections

| § | Was | Now |
|---|---|---|
| §2.3 | `anat/vein`: "hidden by default, never blue" | Clinical unchanged. Realistic uses a muted atlas blue for the SVC, IVC and (when shown) cardiac veins, darker and greyer than the ramp's low end and never emissive. |
| §7.3 | "MeshStandardMaterial … No transmission and no physical sheen" | Clinical unchanged. Realistic uses MeshPhysicalMaterial with clearcoat (tiers A/B) and sheen (tier A). There is still no transmission. |
| §7.7 | "Zero image textures: only the LUT and the blue-noise texture" | The shared 128 KB noise volume is also generated in code. Baked GLB textures are allowed (CONTRACTS §7.1) and uploaded lazily. |
| §6 Peel | Layer vectors, rib hinge "phase 2" | Layer and structure vectors, the anterior-half hinge, riders, a critically damped spring and the cold-load assembly (§7.9.5). |
