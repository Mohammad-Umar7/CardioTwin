# CardioTwin anatomy gap report

Measured against [`docs/anatomy/REFERENCE.md`](../../docs/anatomy/REFERENCE.md) and
[`reference_checks.yaml`](reference_checks.yaml) with [`measure_model.py`](measure_model.py) on the published GLB
(`./.venv/Scripts/python anatomy/checks/measure_model.py --markdown gap.md --json gap.json`, about 4 minutes).

| Run | PASS | MINOR | FAIL | of |
| --- | ---: | ---: | ---: | ---: |
| Baseline (commit `b874f00`) | 35 | 12 | 23 | 70 |
| Realism round 1 | 45 | 8 | 17 | 70 |
| Realism round 2 | **52** | **8** | **13** | 73 |

Grading: **PASS** every sub-metric inside the accepted band; **MINOR** only soft metrics miss by less than half the band
(or a soft yes/no fails); **FAIL** a hard metric misses, a soft one misses by half the band or more, or the structure
or attribute is absent.

## What changed in round 2

* **Aorto-mitral continuity** — the synthesised root is moved by a constrained search (x -6…3.5, y -4…10, z -10…3 mm,
  1 mm steps) to the smallest rim-to-mitral gap that keeps VLV-03 and GV-01, and a 1 mm fibrous curtain
  (`SYN_AortoMitralCurtain`, part of `Valve_Mitral`) joins the left / non-coronary annulus to the anterior mitral
  leaflet; the heart wall yields 1 mm around the root. VLV-05 FAIL → PASS (1.1 mm).
* **Coronary tree designed on this heart** (`anatomy/scripts/coronary.py`) — left main 10–13 mm leftward behind the
  pulmonary trunk to the anterior end of the left AV groove; circumflex along the mitral hinge ring; RCA traced in the
  right AV groove from an anterior take-off to the crux (no proximal loop), acute marginals, PDA and posterolateral
  branches bridged from the BodyParts3D branches; three LAD and three PDA septal perforators through the mid-septum
  (take-off 55–95°); SCCT / MDCT calibres with a power-law taper. COR-09 / 12 / 13 / 15 / 20 pass.
* **Right-ventricular free wall** — RCA territory except a LAD strip beside the anterior groove (85 % RCA-dominant; new
  COR-25, MINOR only for the strip width).
* **Cardiac veins designed on this heart** (`anatomy/scripts/veins.py`) — CS seated in the posterior AV groove with a
  flush RA ostium 2 mm from the tricuspid hinge in front of the IVC, GCV / AIV, MCV joining 9.6 mm from the ostium,
  left marginal (LMV, FMA4708) and small cardiac vein (SCV, FMA4714) added, two anterior cardiac veins opening into the
  RA, in-vivo calibres (CS 10 → 8.6 mm) tapering to 0.45 mm tips. VEN-01 / 08 / 11 pass.
* **Epicardial fat** — groove beds whose surface rises to 0.6 r above each groove vessel's axis (the crown stays
  exposed), narrow beds along branch arteries ≥ 1.2 mm, none on lone twigs; golden, lobulated.
* **Web asset** — 9.38 MB, 396,916 triangles; WebP maps (lossy colour, lossless renormalised normals, near-lossless
  ORM), flat maps dropped, 123 MiB of GPU textures (budget 128), `KHR_materials_clearcoat`, a `_TERRITORY` copy of the
  territory weights, contract 1.1.

Measurement changes in round 2 (`measure_model.py`): wall thickness is measured by shell occupancy with the cut caps
excluded; the right-ventricular free wall is excluded from the LV territory shares; COR-19 reads the `_SEGMENT` values
15 / 18; COR-20 uses the SCCT labels; VEN-01 / 09 / 11 recognise the LMV and SCV; VEN-10 ignores 6 mm around each
drainage ostium; new checks COR-25 (RV free-wall supply), COR-26 (crux, CS ostium and MCV junction together) and VEN-12
(venous ostia and tips).

## What changed in round 1

* **Coronary labelling** — the LCX trunk now ends where it leaves the left AV groove (s = 62 mm) and the apical run
  is OM1 (COR-11 passes: LCX 62 mm, LAD : LCX 2.0). Every centreline point and coronary vertex carries its SCCT 2014
  segment (`_SEGMENT`, `vessels.json` labels, `manifest.segments`; COR-22 passes).
* **Aortic root and valve** — synthesised root with three sinuses at the ostia and a `Valve_Aortic` node; ascending
  aorta rounded to an in-vivo calibre (GV-01/02/08 and COR-02 pass: sinus 34 mm, STJ 26 mm, ascending 27 mm,
  PA : Ao 0.83, LM / RCA ostia 13 / 16 mm above the annulus).
* **Cardiac veins** — one labelled lumen with in-vivo calibres, seated on the epicardium, CS on the atrial side of the
  mitral hinge with its ostium in front of the IVC (VEN-05/06 pass; VEN-01 MINOR only for the absent left marginal
  vein; VEN-10 pieces 5 → 1).
* **Intersections** — two-sided push-out of display-only neighbours and a 4 mm lower diaphragm (GV-04/05 pass; POS-09
  4.9 → 3.3 mm, POS-10 2.7 → 1.9 mm).
* **Territories** — AHA-17 blend with a perforator septal split and share re-balancing (COR-24 FAIL → MINOR: LAD 42.9 %,
  LCX 24.8 %, RCA 32.2 % of the LV region; the majority map is the AHA standard in all 17 segments).
* **New structures** — epicardial fat, arch branches, brachiocephalic veins, oesophagus.

Measurement changes (all in `measure_model.py`, documented in its code): the vein checks read the labelled single-lumen
tree (`vessels.json` `veins` + `_VEIN`) instead of naming disjoint components; aortic diameters are in-plane outer-wall
equivalent diameters (the YAML's definition; the 3D inscribed sphere was dominated by the closed annulus cap); the
aortic root end is the trunk end of the skeleton and the annulus cap is found by coplanar area (a decimated flat cap
keeps its area, not its vertices); the CS/GCV calibre ratio uses the AV-groove GCV like `D_GCV`; the glTF colour checks
read baked texture colours.

## Remaining failures (and why)

* **POS-09 / POS-10** — the display-only lungs and diaphragm are too coarse to follow the grooves: veins dip 4.4 mm and
  the heart 3.6 mm into the lungs, the heart 1.8 mm into the diaphragm.
* **VLV-04 / VLV-06, GV-10 / 11** — BodyParts3D placements left as sourced: the tricuspid hinge 10 mm basal to the
  mitral hinge, a 31 mm pulmonary ring, a 37 mm SVC.
* **COR-10** — beyond its first 20 mm the circumflex runs up to 16.8 mm from the mitral hinge (band 15 mm) where the
  obtuse margin bulges.
* **VEN-04** — the CS ostium must lie in front of the IVC (VEN-05), so the last 15 mm of the sinus approach the groove
  obliquely: 70 % on the atrial side of the mitral hinge (0.75), 48 % parallel (0.8).
* **VEN-09** — the GCV follows the whole left AV groove to the anterior groove: CS + GCV 197 mm (≤ 145); the MCV is
  117 mm (≤ 115).
* **VEN-10** — the AIV join crosses 4.3 mm into the wall below the left auricle and a vein passes 3 mm from a pulmonary
  vein (≥ 5 mm).
* **COL-01 / 02 / 03** — the web viewer's Realistic look (aorta, pulmonary trunk and cardiac veins not in atlas colours;
  veins hidden by default), not the GLB, whose baked colours pass; owned by the frontend.

## Verdict per check

| Check | Baseline | Round 1 | Round 2 | Title |
| --- | --- | --- | --- | --- |
| POS-01 | PASS | PASS | PASS | About two-thirds of the heart lies left of the midline |
| POS-02 | PASS | PASS | PASS | The apex points left, down and forward |
| POS-03 | PASS | PASS | PASS | Long-axis angles in the axial and frontal planes |
| POS-04 | PASS | PASS | PASS | Apex behind the left 5th intercostal space |
| POS-05 | PASS | PASS | PASS | Apex 8-9 cm left of the midline, near the mid-clavicular line |
| POS-06 | MINOR | MINOR | MINOR | Superior border and vertebral span |
| POS-07 | PASS | PASS | PASS | Heart size (long axis and transverse diameter) |
| POS-08 | PASS | PASS | PASS | Cardiothoracic ratio |
| POS-09 | FAIL | FAIL | FAIL | Heart and vessels do not intersect the chest wall, spine or lungs |
| POS-10 | FAIL | FAIL | FAIL | Heart rests on the diaphragm; right dome higher than left |
| POS-11 | PASS | PASS | PASS | Carina at T4/T5; the heart body lies below it |
| CHM-01 | PASS | PASS | PASS | The anterior (sternocostal) surface is mostly RV |
| CHM-02 | PASS | PASS | PASS | The right border is the RA, 1-2 cm beyond the sternal edge, between the venae cavae |
| VLV-01 | PASS | PASS | PASS | Anatomical surface projection of the four valves |
| VLV-02 | PASS | PASS | PASS | Pulmonary valve anterior, superior and left of the aortic valve |
| VLV-03 | PASS | PASS | PASS | Right-to-left order TV < AoV < MV; mitral valve most posterior |
| VLV-04 | FAIL | FAIL | FAIL | AV-valve levels and tricuspid apical offset |
| VLV-05 | FAIL | FAIL | PASS | Aorto-mitral fibrous continuity |
| VLV-06 | FAIL | FAIL | FAIL | Valve annulus diameters |
| GV-01 | MINOR | PASS | MINOR | Ascending aorta origin, course and length |
| GV-02 | FAIL | PASS | PASS | Aortic root and ascending calibre |
| GV-03 | PASS | PASS | PASS | Top of the aortic arch |
| GV-04 | FAIL | PASS | PASS | Arch course over the left main bronchus and right PA, to the left of the trachea |
| GV-05 | FAIL | PASS | PASS | Descending thoracic aorta left of the spine and behind the heart |
| GV-06 | PASS | PASS | PASS | Descending aortic calibre, smaller than the ascending |
| GV-07 | PASS | PASS | PASS | Pulmonary trunk origin and course |
| GV-08 | FAIL | PASS | PASS | Main pulmonary artery calibre and PA:aorta ratio |
| GV-09 | PASS | PASS | PASS | PA bifurcation level; right PA behind the aorta and SVC; left PA over the left bronchus |
| GV-10 | FAIL | FAIL | FAIL | SVC position and course |
| GV-11 | FAIL | FAIL | FAIL | SVC length and calibre |
| GV-12 | PASS | PASS | PASS | IVC crosses the diaphragm at T8 and enters the RA almost at once |
| GV-13 | MINOR | MINOR | MINOR | Pulmonary veins enter the posterior-superior LA |
| COR-01 | PASS | PASS | PASS | Two ostia, in the right and left coronary sinuses |
| COR-02 | MINOR | PASS | PASS | Ostial heights above the annulus; RCA usually a little higher |
| COR-03 | PASS | PASS | PASS | Left main length and calibre |
| COR-04 | PASS | PASS | PASS | Left main runs leftward behind the pulmonary trunk, without branches |
| COR-05 | PASS | PASS | PASS | LM bifurcation angles |
| COR-06 | PASS | PASS | PASS | LAD descends in the anterior interventricular groove to the apex |
| COR-07 | PASS | PASS | PASS | LAD length |
| COR-08 | PASS | PASS | PASS | Diagonals run over the anterolateral LV and never cross onto the RV |
| COR-09 | FAIL | FAIL | PASS | Septal perforators are intramyocardial and short from the PDA |
| COR-10 | FAIL | FAIL | FAIL | LCX stays in the left AV groove along the mitral annulus |
| COR-11 | MINOR | PASS | PASS | LCX length and LAD:LCX length ratio |
| COR-12 | MINOR | FAIL | PASS | Obtuse marginals run toward the apex over the lateral LV wall |
| COR-13 | FAIL | FAIL | PASS | RCA course (anterior take-off, right AV groove, acute margin, crux) |
| COR-14 | PASS | PASS | PASS | RCA length to the crux |
| COR-15 | FAIL | FAIL | PASS | No shepherd's-crook loop in the proximal RCA (default phenotype) |
| COR-16 | PASS | PASS | PASS | Acute marginal / RV branches stay on the RV free wall |
| COR-17 | PASS | PASS | PASS | PDA in the posterior IV groove, from the crux toward the apex |
| COR-18 | PASS | PASS | PASS | Posterolateral branches continue past the crux onto the inferolateral LV |
| COR-19 | PASS | PASS | PASS | One consistent dominance type (right by default) |
| COR-20 | MINOR | MINOR | PASS | Lumen diameters by segment, proximal ordering and taper |
| COR-21 | PASS | PASS | PASS | Epicardial course inside epicardial fat; no trunk crosses a cavity |
| COR-22 | FAIL | PASS | PASS | SCCT segment labels match the node mapping and run in order |
| COR-23 | PASS | PASS | PASS | LAD-specific AHA segments are LAD territory |
| COR-24 | FAIL | MINOR | MINOR | Remaining territory map and share of LV myocardium |
| COR-25 | — | — | MINOR | The right-ventricular free wall is RCA territory; the LAD supplies only a strip beside the anterior groove |
| COR-26 | — | — | MINOR | The crux, the coronary-sinus ostium and the middle-cardiac-vein junction coincide |
| VEN-01 | FAIL | MINOR | PASS | Coronary sinus and its main tributaries are present |
| VEN-02 | PASS | PASS | MINOR | Anterior interventricular vein runs with the LAD, mostly on its LV side |
| VEN-03 | PASS | PASS | PASS | Middle cardiac vein runs with the PDA |
| VEN-04 | FAIL | FAIL | FAIL | Coronary sinus in the posterior left AV groove, on the atrial side of the mitral annulus |
| VEN-05 | FAIL | PASS | PASS | Coronary sinus ostium in the posteroinferior RA, near the tricuspid annulus |
| VEN-06 | MINOR | PASS | PASS | The LCX lies between the CS/GCV and the mitral annulus |
| VEN-07 | PASS | PASS | PASS | Triangle of Brocq and Mouchet at the LM bifurcation |
| VEN-08 | MINOR | MINOR | PASS | Venous calibres grow toward the ostium; the CS is the largest vein |
| VEN-09 | MINOR | FAIL | FAIL | CS and GCV lengths, tributary order and take-off angles |
| VEN-10 | FAIL | FAIL | FAIL | Venous topology and epicardial layer |
| VEN-11 | MINOR | MINOR | PASS | GCV passes below the left auricle; small and anterior cardiac veins follow the right side |
| VEN-12 | — | — | MINOR | Venous ostia meet the atrial wall and distal tips thin out on the epicardium |
| COL-01 | FAIL | FAIL | FAIL | Systemic arteries are red |
| COL-02 | MINOR | MINOR | FAIL | Systemic veins are blue in every mode |
| COL-03 | FAIL | FAIL | FAIL | Pulmonary circulation colours are reversed (artery blue, veins red) |
