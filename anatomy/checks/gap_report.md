# CardioTwin anatomy gap report

Measured against [`docs/anatomy/REFERENCE.md`](../../docs/anatomy/REFERENCE.md) and
[`reference_checks.yaml`](reference_checks.yaml) with [`measure_model.py`](measure_model.py) on the published GLB
(`./.venv/Scripts/python anatomy/checks/measure_model.py --markdown gap.md --json gap.json`, about 4 minutes).

| Run | PASS | MINOR | FAIL | of |
| --- | ---: | ---: | ---: | ---: |
| Baseline (commit `b874f00`) | 35 | 12 | 23 | 70 |
| Realism round 1 | **45** | **8** | **17** | 70 |

Grading: **PASS** every sub-metric inside the accepted band; **MINOR** only soft metrics miss by less than half the band
(or a soft yes/no fails); **FAIL** a hard metric misses, a soft one misses by half the band or more, or the structure
or attribute is absent.

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

* **POS-09 / POS-10** — cardiac veins still dip 3.3 mm into the left lung and the heart 1.9 mm into the diaphragm where
  the coarse lung / diaphragm meshes cannot follow the grooves; next round: subdivide the yielder locally.
* **VLV-04 / 05 / 06, GV-10 / 11, GV-13** — BodyParts3D placements (tricuspid hinge 10 mm basal to the mitral, pulmonary
  ring 31 mm, root 22 mm from the anterior mitral leaflet, SVC 37 mm long); left as sourced.
* **COR-09** — septal perforators leave the LAD backwards (118–136°) and are short.
* **COR-10 / COR-12** — the LM bifurcation is 37 mm from the mitral hinge, so the first 20 mm of the circumflex cannot
  lie in the groove; the OM1 ends medial to the LAD near the apex (73 % lateral, needs 80 %).
* **COR-13 / COR-15** — the RCA has a 10 mm proximal loop and runs ~20 mm from the tricuspid hinge; needs a re-routed
  trunk with its branches (next round).
* **VEN-04 / VEN-09** — the BodyParts3D coronary sinus approaches the mitral ring obliquely over its first 15 mm
  (parallel fraction 52 %) and the MCV joins 35 mm from the ostium; the CS + GCV course is 165 mm (reference ≤ 145).
* **VEN-10** — the lifted veins still touch the wall in a few crevices (max 2.8 mm).
* **COL-01 / COL-03** — the web viewer's Realistic look, not the GLB (whose baked colours pass: aorta hue 3°, PA 226°,
  PV 4°); owned by the frontend.

## Verdict per check

| Check | Baseline | Round 1 | Title |
| --- | --- | --- | --- |
| POS-01 | PASS | PASS | About two-thirds of the heart lies left of the midline |
| POS-02 | PASS | PASS | The apex points left, down and forward |
| POS-03 | PASS | PASS | Long-axis angles in the axial and frontal planes |
| POS-04 | PASS | PASS | Apex behind the left 5th intercostal space |
| POS-05 | PASS | PASS | Apex 8-9 cm left of the midline, near the mid-clavicular line |
| POS-06 | MINOR | MINOR | Superior border and vertebral span |
| POS-07 | PASS | PASS | Heart size (long axis and transverse diameter) |
| POS-08 | PASS | PASS | Cardiothoracic ratio |
| POS-09 | FAIL | FAIL | Heart and vessels do not intersect the chest wall, spine or lungs |
| POS-10 | FAIL | FAIL | Heart rests on the diaphragm; right dome higher than left |
| POS-11 | PASS | PASS | Carina at T4/T5; the heart body lies below it |
| CHM-01 | PASS | PASS | The anterior (sternocostal) surface is mostly RV |
| CHM-02 | PASS | PASS | The right border is the RA, 1-2 cm beyond the sternal edge, between the venae cavae |
| VLV-01 | PASS | PASS | Anatomical surface projection of the four valves |
| VLV-02 | PASS | PASS | Pulmonary valve anterior, superior and left of the aortic valve |
| VLV-03 | PASS | PASS | Right-to-left order TV < AoV < MV; mitral valve most posterior |
| VLV-04 | FAIL | FAIL | AV-valve levels and tricuspid apical offset |
| VLV-05 | FAIL | FAIL | Aorto-mitral fibrous continuity |
| VLV-06 | FAIL | FAIL | Valve annulus diameters |
| GV-01 | MINOR | PASS | Ascending aorta origin, course and length |
| GV-02 | FAIL | PASS | Aortic root and ascending calibre |
| GV-03 | PASS | PASS | Top of the aortic arch |
| GV-04 | FAIL | PASS | Arch course over the left main bronchus and right PA, to the left of the trachea |
| GV-05 | FAIL | PASS | Descending thoracic aorta left of the spine and behind the heart |
| GV-06 | PASS | PASS | Descending aortic calibre, smaller than the ascending |
| GV-07 | PASS | PASS | Pulmonary trunk origin and course |
| GV-08 | FAIL | PASS | Main pulmonary artery calibre and PA:aorta ratio |
| GV-09 | PASS | PASS | PA bifurcation level; right PA behind the aorta and SVC; left PA over the left bronchus |
| GV-10 | FAIL | FAIL | SVC position and course |
| GV-11 | FAIL | FAIL | SVC length and calibre |
| GV-12 | PASS | PASS | IVC crosses the diaphragm at T8 and enters the RA almost at once |
| GV-13 | MINOR | MINOR | Pulmonary veins enter the posterior-superior LA |
| COR-01 | PASS | PASS | Two ostia, in the right and left coronary sinuses |
| COR-02 | MINOR | PASS | Ostial heights above the annulus; RCA usually a little higher |
| COR-03 | PASS | PASS | Left main length and calibre |
| COR-04 | PASS | PASS | Left main runs leftward behind the pulmonary trunk, without branches |
| COR-05 | PASS | PASS | LM bifurcation angles |
| COR-06 | PASS | PASS | LAD descends in the anterior interventricular groove to the apex |
| COR-07 | PASS | PASS | LAD length |
| COR-08 | PASS | PASS | Diagonals run over the anterolateral LV and never cross onto the RV |
| COR-09 | FAIL | FAIL | Septal perforators are intramyocardial and short from the PDA |
| COR-10 | FAIL | FAIL | LCX stays in the left AV groove along the mitral annulus |
| COR-11 | MINOR | PASS | LCX length and LAD:LCX length ratio |
| COR-12 | MINOR | FAIL | Obtuse marginals run toward the apex over the lateral LV wall |
| COR-13 | FAIL | FAIL | RCA course (anterior take-off, right AV groove, acute margin, crux) |
| COR-14 | PASS | PASS | RCA length to the crux |
| COR-15 | FAIL | FAIL | No shepherd's-crook loop in the proximal RCA (default phenotype) |
| COR-16 | PASS | PASS | Acute marginal / RV branches stay on the RV free wall |
| COR-17 | PASS | PASS | PDA in the posterior IV groove, from the crux toward the apex |
| COR-18 | PASS | PASS | Posterolateral branches continue past the crux onto the inferolateral LV |
| COR-19 | PASS | PASS | One consistent dominance type (right by default) |
| COR-20 | MINOR | MINOR | Lumen diameters by segment, proximal ordering and taper |
| COR-21 | PASS | PASS | Epicardial course inside epicardial fat; no trunk crosses a cavity |
| COR-22 | FAIL | PASS | SCCT segment labels match the node mapping and run in order |
| COR-23 | PASS | PASS | LAD-specific AHA segments are LAD territory |
| COR-24 | FAIL | MINOR | Remaining territory map and share of LV myocardium |
| VEN-01 | FAIL | MINOR | Coronary sinus and its main tributaries are present |
| VEN-02 | PASS | PASS | Anterior interventricular vein runs with the LAD, mostly on its LV side |
| VEN-03 | PASS | PASS | Middle cardiac vein runs with the PDA |
| VEN-04 | FAIL | FAIL | Coronary sinus in the posterior left AV groove, on the atrial side of the mitral annulus |
| VEN-05 | FAIL | PASS | Coronary sinus ostium in the posteroinferior RA, near the tricuspid annulus |
| VEN-06 | MINOR | PASS | The LCX lies between the CS/GCV and the mitral annulus |
| VEN-07 | PASS | PASS | Triangle of Brocq and Mouchet at the LM bifurcation |
| VEN-08 | MINOR | MINOR | Venous calibres grow toward the ostium; the CS is the largest vein |
| VEN-09 | MINOR | FAIL | CS and GCV lengths, tributary order and take-off angles |
| VEN-10 | FAIL | FAIL | Venous topology and epicardial layer |
| VEN-11 | MINOR | MINOR | GCV passes below the left auricle; small and anterior cardiac veins follow the right side |
| COL-01 | FAIL | FAIL | Systemic arteries are red |
| COL-02 | MINOR | MINOR | Systemic veins are blue in every mode |
| COL-03 | FAIL | FAIL | Pulmonary circulation colours are reversed (artery blue, veins red) |
