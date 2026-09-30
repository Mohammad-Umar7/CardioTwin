# Printable clinical report (`features/report`)

A two-page, print-ready report of the **current workstation state** (patient, inputs including what-if
edits, latest estimate, engine and model version). It prints to a clean 2-page A4 or US Letter PDF from
the browser's print dialog ("Save as PDF").

## Integration (router and palette)

| What | How |
| --- | --- |
| Route | `<Route path="report" element={<ReportPage />} />` inside the `AppShell` route, with `const ReportPage = lazy(() => import('@/features/report/ReportPage'))` (default export). |
| Palette | Mount `<ReportCommands />` (`ReportCommands.tsx`) once inside the router, e.g. next to the shell's command hooks. It registers **Open printable report** (`page.report`, Pages) and **Print or save report as PDF** (`report.print`, Actions, only on `/report` once the estimate is current). |
| Path constant | `REPORT_PATH = '/report'` in `useReportCommands.ts` (add it to `routes.ts` if you prefer). |

Nothing else is required: the page reads the stores and the static artifacts itself.

## What it shows

1. Header: CardioTwin, patient id + split + sex/age, generation time, engine, model and schema version,
   a deterministic report id (hash of inputs + model + engine), "Model estimate" and
   "NOT FOR DIAGNOSTIC USE" tags, and "What-if scenario" while edits exist.
2. The full clinical-safety disclaimer, boxed at the top of page 1 and in the footer of every page.
3. Result: a vector anterior coronary schematic coloured by vessel probability (no capture API exists
   yet; see below), the CAD headline with band, track, threshold and verdict, and the vessel table
   (probability, band, threshold tick, "Flagged"/"Not flagged", what-if Δ vs the recorded estimate, and
   the cath result after Reveal, never for a what-if).
4. What drives each estimate: top 5 SHAP drivers per target in percentage points (calibrated SHAP mapped
   through the logistic secant, so baseline + contributions = estimate exactly; falls back to log-odds
   when an engine sends no calibrated fields).
5. Page 2: all inputs by modality with ▲/▼ reference-range flags, present/absent findings, imputed and
   edited markers; model performance from `metrics_summary.json` (falls back to `metrics.json`); and
   "About these estimates" (intended use, data, validation, colours, provenance).

## Print mechanics

* `report.css` hides the app chrome in print (`html:has(.ct-report)`), sets paper tokens (white page,
  ink text, Ember only on ringed marks) and avoids breaks inside cards.
* `usePrintSetup.ts` renders `@page { size: A4 | letter; margin: 0 }` only while the route is mounted,
  remembers the paper choice, and sets `document.title` so the PDF is named
  "CardioTwin report · P-011 · 2026-09-30".
* `fitToPage.ts` measures each sheet and applies a CSS `zoom` (≥ 0.86) only when it would overflow, so the
  screen preview and the printout are identical and each sheet is exactly one page.

## Optional 3D snapshot (for agent D)

No documented scene-capture API exists, so the report draws `CoronarySchematic.tsx` (the same Ember
ramp, one colour per vessel, left main achromatic). If a capture API lands, add it as a figure beside
the schematic; keep the schematic as the fallback.
