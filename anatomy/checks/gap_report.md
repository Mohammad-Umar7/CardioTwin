# CardioTwin anatomy gap report

Measured against [`docs/anatomy/REFERENCE.md`](../../docs/anatomy/REFERENCE.md) and
[`reference_checks.yaml`](reference_checks.yaml) with [`measure_model.py`](measure_model.py) on the published GLB
(`./.venv/Scripts/python anatomy/checks/measure_model.py --markdown gap.md --json gap.json`, about 4 minutes).

| Run | PASS | MINOR | FAIL | of |
| --- | ---: | ---: | ---: | ---: |
| Baseline (commit `b874f00`) | 35 | 12 | 23 | 70 |
| Realism round 1 | 45 | 8 | 17 | 70 |
| Realism round 2 | 52 | 8 | 13 | 73 |
| Realism round 3 | **60** | **8** | **10** | 78 |

Grading: **PASS** every sub-metric inside the accepted band; **MINOR** only soft metrics miss by less than half the band
(or a soft yes/no fails); **FAIL** a hard metric misses, a soft one misses by half the band or more, or the structure
or attribute is absent.

## What changed in round 3

* **Heart wall** (`SYN_HeartWall`, three smooth, fold-free local corrections) — the **mitral isthmus**: the
  posterolateral left atrium is stretched away from the mitral hinge, so the left pulmonary-vein ostia lie at least
  25 mm (median 32 mm) from it instead of 10–17 mm (new VEN-14 passes; the pulmonary veins follow the atrium); the
  **right-atrial roof** round the cavo-atrial junction is lowered 10 mm and the SVC lengthened with it (GV-10 and POS-06
  pass). Vessel stretches under BodyParts3D's fused left auricle are carved out of the wall as channels (exact Boolean
  per capped half, the half closed again afterwards), so the auricle overlies them and no coronary or vein runs inside
  the myocardium (COR-21 deepest sample 0.0 mm; VEN-10 passes).
* **Valve apparatus synthesised** (`anatomy/scripts/valves.py`) — half-open mitral (anterior leaflet 22 mm, posterior
  12.5 mm with P1–P3 scallops) and tricuspid leaflets hinged on the fitted annuli, branching first- and second-order
  chordae from both heads of each papillary muscle, smooth papillary cones; the septal tricuspid hinge sits 7 mm apical
  of the anterior mitral hinge (VLV-04 reads the basal quartile and still reports the anterior / posterior hinge, MINOR).
* **Coronary arteries** — branches classified by where they end: the outflow-tract branch is a right-ventricular branch,
  D1 re-attached 24–32 mm from the bifurcation, D2 grown at 45° over the anterolateral LV, left conus branch; the RCA's
  conus branch crosses the anterior infundibulum 11 mm below the pulmonary valve (new COR-27 passes); the first septal
  perforator 38 mm down the LAD; the circumflex on the ventricular side of the groove's bottom (COR-10 passes).
* **Cardiac veins** — the GCV runs in the left AV groove below the auricle (no longer up the left-atrial wall) and turns
  into the AIV within 10 mm of the left-main bifurcation; the small cardiac vein runs beside the distal RCA in the
  posterior right AV groove and receives a new right marginal vein (FMA4716, `_VEIN` 9); anterior cardiac veins 45 mm.
  VEN-10 and VEN-12 pass (no vein inside the wall, tips on the epicardium, ostia in the atrial wall).
* **Vessels on the heart** — the synthesis' wall distance field read 0.34 mm outside the surface (voxel bias); it is now
  calibrated on the mesh and the seat heights lowered (branches 0.15 mm, trunks 0.3 mm, groove trunks 0.6 mm; tube
  clearance 0.15 mm, veins 0.2 mm); where a capped lift still leaves a vein in a ridge of the wall, a shallow bed is
  carved. Floating centreline samples 853 → 164 of 1848 (new VAS-01, still FAIL: vessels lifted out of creases where
  the narrower fat no longer fills the groove).
* **Epicardial fat** — rebuilt as a golden, lobulated groove bed (40k triangles, 25 mL): the groove arteries two-thirds
  buried with their crown a continuous ridge, the groove veins half buried, feathering out within 5.5–7 mm so the
  grooves read as fat-filled channels and the free walls stay bare; closed and smoothed thickness field (no pits), lobules
  only on the thick fat (soft margins), a thin apical film; the depth of an overhung groove is filled too (never an
  endocardium).
* **Myocardium look** — the cellular vessel-network relief read as cracked mud at close range: replaced by faint open
  vessel streaks (colour only) over gentle muscle swellings and a serous micro-relief (still a 1024² normal map).
* **Lungs and diaphragm** — the cardiac impression is carved into each lung (every heart structure inflated by 2.2 mm,
  exact Boolean, then a full-resolution pass at 1.1 mm; Boolean crumbs dropped and slits closed, so the lungs stay
  closed and outward) and the diaphragm lowered 8 mm: POS-09 and POS-10 pass.
* **Territories** — the right-ventricular free wall is RCA territory except a 6–10 mm LAD strip; the build's LV region
  takes its radius from the lateral epicardium like the check (COR-24 MINOR, COR-25 MINOR).
* **Web asset** — 7.7 MB, 407,737 triangles (budget 430k for the fat and the valve apparatus); textures sized to their
  content (1024² heart atlases, 256² ghosted layers) with near-lossless normal maps and edge-clamped samplers: 2.5 MB of
  WebP and 46 MiB on the GPU instead of 123 MiB; clearcoat 0.08–0.16 on the heart; `_RADIUS` on every vessel mesh;
  `manifest.facts` fills the numbers quoted in the definitions from the build.

Measurement changes in round 3 (`measure_model.py`, `reference_checks.yaml`): COR-04 adds a soft test that the
pulmonary trunk actually overlies the left main in the frontal view (the "behind the trunk" test was vacuous); new checks
VEN-13 (GCV in the left AV groove, AIV at the bifurcation), VEN-14 (mitral isthmus, pulmonary veins clear of the LCX and
GCV), VEN-15 (small cardiac vein with the RCA), COR-27 (conus branch over the anterior infundibulum) and VAS-01 (no
vessel floats off the heart; the aortic root and pulmonary trunk support the ostial vessels, a branch's first 3 mm lie
on its parent). The VEN-15 length band was written in the wrong unit (3–8 mm instead of 30–80 mm) and is corrected.
On the 73 round-2 checks the model now scores 58 PASS / 7 MINOR / 8 FAIL (round 2: 52 / 8 / 13).

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

* **VLV-06, GV-11, GV-13** — BodyParts3D annuli and veins left as sourced: a 31 mm pulmonary ring and a tricuspid ring
  smaller than the mitral one, a 46 mm SVC (60–80 mm; it is cropped at the neck base and joins the lowered atrial roof),
  pulmonary-vein ostia 17 mm wide (9–14 mm).
* **COR-26, VEN-04** — the coronary-sinus ostium has to lie in front of the IVC orifice (VEN-05), 23 mm from the crux
  (≤ 15 mm), and between that ostium and the groove the sinus rises over the posterior left-atrial wall (up to 16 mm on
  the atrial side of the hinge plane): 58 % of the sinus lies on the atrial side of the hinge (0.75), 38 % runs parallel
  to it (0.8). The sinus course is the next design task.
* **VEN-13** — the GCV stays within 15 mm of the mitral hinge along the posterior and lateral groove (median 14 mm) but
  lies up to 19 mm from it anterolaterally, where the fused auricle overhangs the groove and the vein descends to the
  left-main bifurcation, which is itself 16 mm from the hinge ring.
* **VAS-01** — 164 of 1848 vessel centreline samples float 0.6–3 mm off the wall (99th percentile 1.6 mm): trunks lifted
  out of creases and branches crossing the dips of the right-ventricular wall where the narrower fat no longer fills the
  groove.
* **MINOR** — VLV-04 (the check fits the tricuspid annulus to the basal quartile of the valve, which excludes the septal
  hinge lowered 22 mm; the hinge lines put it 7 mm apical of the anterior mitral hinge), GV-01 (aortic valve 0.4 mm
  beyond the band), COR-04 (the pulmonary trunk does not overlie the left main in the frontal view), COR-05 (LM–LAD
  angle 64°, ≤ 60°), COR-24 (LV shares LAD 36 / LCX 30 / RCA 35 %; segment 1 RCA, segment 3 LAD), COR-25 (11 % of the
  RV free wall beyond 15 mm of the LAD is still LAD-dominant, ≤ 10 %), VEN-09 (CS + GCV 156 mm on this 37 mm mitral
  annulus, ≤ 145 mm), VEN-15 (the SCV ends 13 mm from the tricuspid hinge at the acute margin, ≤ 12 mm).
* **COL-01 / 02 / 03** — the web viewer's Realistic look (aorta and pulmonary trunk not in atlas colours, cardiac veins
  not blue), not the GLB, whose baked colours pass; owned by the frontend (CONTRACT_1_1.md hand-offs).

## Verdict per check

| Check | Baseline | Round 1 | Round 2 | Round 3 | Title |
| --- | --- | --- | --- | --- | --- |
| POS-01 | PASS | PASS | PASS | PASS | About two-thirds of the heart lies left of the midline |
| POS-02 | PASS | PASS | PASS | PASS | The apex points left, down and forward |
| POS-03 | PASS | PASS | PASS | PASS | Long-axis angles in the axial and frontal planes |
| POS-04 | PASS | PASS | PASS | PASS | Apex behind the left 5th intercostal space |
| POS-05 | PASS | PASS | PASS | PASS | Apex 8-9 cm left of the midline, near the mid-clavicular line |
| POS-06 | MINOR | MINOR | MINOR | PASS | Superior border and vertebral span |
| POS-07 | PASS | PASS | PASS | PASS | Heart size (long axis and transverse diameter) |
| POS-08 | PASS | PASS | PASS | PASS | Cardiothoracic ratio |
| POS-09 | FAIL | FAIL | FAIL | PASS | Heart and vessels do not intersect the chest wall, spine or lungs |
| POS-10 | FAIL | FAIL | FAIL | PASS | Heart rests on the diaphragm; right dome higher than left |
| POS-11 | PASS | PASS | PASS | PASS | Carina at T4/T5; the heart body lies below it |
| CHM-01 | PASS | PASS | PASS | PASS | The anterior (sternocostal) surface is mostly RV |
| CHM-02 | PASS | PASS | PASS | PASS | The right border is the RA, 1-2 cm beyond the sternal edge, between the venae cavae |
| VLV-01 | PASS | PASS | PASS | PASS | Anatomical surface projection of the four valves |
| VLV-02 | PASS | PASS | PASS | PASS | Pulmonary valve anterior, superior and left of the aortic valve |
| VLV-03 | PASS | PASS | PASS | PASS | Right-to-left order TV < AoV < MV; mitral valve most posterior |
| VLV-04 | FAIL | FAIL | FAIL | MINOR | AV-valve levels and tricuspid apical offset |
| VLV-05 | FAIL | FAIL | PASS | PASS | Aorto-mitral fibrous continuity |
| VLV-06 | FAIL | FAIL | FAIL | FAIL | Valve annulus diameters |
| GV-01 | MINOR | PASS | MINOR | MINOR | Ascending aorta origin, course and length |
| GV-02 | FAIL | PASS | PASS | PASS | Aortic root and ascending calibre |
| GV-03 | PASS | PASS | PASS | PASS | Top of the aortic arch |
| GV-04 | FAIL | PASS | PASS | PASS | Arch course over the left main bronchus and right PA, to the left of the trachea |
| GV-05 | FAIL | PASS | PASS | PASS | Descending thoracic aorta left of the spine and behind the heart |
| GV-06 | PASS | PASS | PASS | PASS | Descending aortic calibre, smaller than the ascending |
| GV-07 | PASS | PASS | PASS | PASS | Pulmonary trunk origin and course |
| GV-08 | FAIL | PASS | PASS | PASS | Main pulmonary artery calibre and PA:aorta ratio |
| GV-09 | PASS | PASS | PASS | PASS | PA bifurcation level; right PA behind the aorta and SVC; left PA over the left bronchus |
| GV-10 | FAIL | FAIL | FAIL | PASS | SVC position and course |
| GV-11 | FAIL | FAIL | FAIL | FAIL | SVC length and calibre |
| GV-12 | PASS | PASS | PASS | PASS | IVC crosses the diaphragm at T8 and enters the RA almost at once |
| GV-13 | MINOR | MINOR | MINOR | FAIL | Pulmonary veins enter the posterior-superior LA |
| COR-01 | PASS | PASS | PASS | PASS | Two ostia, in the right and left coronary sinuses |
| COR-02 | MINOR | PASS | PASS | PASS | Ostial heights above the annulus; RCA usually a little higher |
| COR-03 | PASS | PASS | PASS | PASS | Left main length and calibre |
| COR-04 | PASS | PASS | PASS | MINOR | Left main runs leftward behind the pulmonary trunk, without branches |
| COR-05 | PASS | PASS | PASS | MINOR | LM bifurcation angles |
| COR-06 | PASS | PASS | PASS | PASS | LAD descends in the anterior interventricular groove to the apex |
| COR-07 | PASS | PASS | PASS | PASS | LAD length |
| COR-08 | PASS | PASS | PASS | PASS | Diagonals run over the anterolateral LV and never cross onto the RV |
| COR-09 | FAIL | FAIL | PASS | PASS | Septal perforators are intramyocardial and short from the PDA |
| COR-10 | FAIL | FAIL | FAIL | PASS | LCX stays in the left AV groove along the mitral annulus |
| COR-11 | MINOR | PASS | PASS | PASS | LCX length and LAD:LCX length ratio |
| COR-12 | MINOR | FAIL | PASS | PASS | Obtuse marginals run toward the apex over the lateral LV wall |
| COR-13 | FAIL | FAIL | PASS | PASS | RCA course (anterior take-off, right AV groove, acute margin, crux) |
| COR-14 | PASS | PASS | PASS | PASS | RCA length to the crux |
| COR-15 | FAIL | FAIL | PASS | PASS | No shepherd's-crook loop in the proximal RCA (default phenotype) |
| COR-16 | PASS | PASS | PASS | PASS | Acute marginal / RV branches stay on the RV free wall |
| COR-17 | PASS | PASS | PASS | PASS | PDA in the posterior IV groove, from the crux toward the apex |
| COR-18 | PASS | PASS | PASS | PASS | Posterolateral branches continue past the crux onto the inferolateral LV |
| COR-19 | PASS | PASS | PASS | PASS | One consistent dominance type (right by default) |
| COR-20 | MINOR | MINOR | PASS | PASS | Lumen diameters by segment, proximal ordering and taper |
| COR-21 | PASS | PASS | PASS | PASS | Epicardial course inside epicardial fat; no trunk crosses a cavity |
| COR-22 | FAIL | PASS | PASS | PASS | SCCT segment labels match the node mapping and run in order |
| COR-23 | PASS | PASS | PASS | PASS | LAD-specific AHA segments are LAD territory |
| COR-24 | FAIL | MINOR | MINOR | MINOR | Remaining territory map and share of LV myocardium |
| COR-25 | — | — | MINOR | MINOR | The right-ventricular free wall is RCA territory; the LAD supplies only a strip beside the anterior groove |
| COR-26 | — | — | MINOR | FAIL | The crux, the coronary-sinus ostium and the middle-cardiac-vein junction coincide |
| COR-27 | — | — | — | PASS | The conus branch crosses the anterior surface of the infundibulum |
| VEN-01 | FAIL | MINOR | PASS | PASS | Coronary sinus and its main tributaries are present |
| VEN-02 | PASS | PASS | MINOR | PASS | Anterior interventricular vein runs with the LAD, mostly on its LV side |
| VEN-03 | PASS | PASS | PASS | PASS | Middle cardiac vein runs with the PDA |
| VEN-04 | FAIL | FAIL | FAIL | FAIL | Coronary sinus in the posterior left AV groove, on the atrial side of the mitral annulus |
| VEN-05 | FAIL | PASS | PASS | PASS | Coronary sinus ostium in the posteroinferior RA, near the tricuspid annulus |
| VEN-06 | MINOR | PASS | PASS | PASS | The LCX lies between the CS/GCV and the mitral annulus |
| VEN-07 | PASS | PASS | PASS | PASS | Triangle of Brocq and Mouchet at the LM bifurcation |
| VEN-08 | MINOR | MINOR | PASS | PASS | Venous calibres grow toward the ostium; the CS is the largest vein |
| VEN-09 | MINOR | FAIL | FAIL | MINOR | CS and GCV lengths, tributary order and take-off angles |
| VEN-10 | FAIL | FAIL | FAIL | PASS | Venous topology and epicardial layer |
| VEN-11 | MINOR | MINOR | PASS | PASS | GCV passes below the left auricle; small and anterior cardiac veins follow the right side |
| VEN-12 | — | — | MINOR | PASS | Venous ostia meet the atrial wall and distal tips thin out on the epicardium |
| VEN-13 | — | — | — | FAIL | The great cardiac vein stays in the left AV groove and becomes the AIV at the LM bifurcation |
| VEN-14 | — | — | — | PASS | Mitral isthmus and clearance of the pulmonary veins |
| VEN-15 | — | — | — | MINOR | The small cardiac vein runs in the posterior right AV groove with the RCA |
| VAS-01 | — | — | — | FAIL | No coronary or vein floats off the heart |
| COL-01 | FAIL | FAIL | FAIL | FAIL | Systemic arteries are red |
| COL-02 | MINOR | MINOR | FAIL | FAIL | Systemic veins are blue in every mode |
| COL-03 | FAIL | FAIL | FAIL | FAIL | Pulmonary circulation colours are reversed (artery blue, veins red) |
