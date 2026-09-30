# CardioTwin anatomy gap report (baseline before the realism loop)

Measured against [`docs/anatomy/REFERENCE.md`](../../docs/anatomy/REFERENCE.md) and
[`reference_checks.yaml`](reference_checks.yaml) with [`measure_model.py`](measure_model.py) on the published GLB.
Reproduce the full table with `./.venv/Scripts/python anatomy/checks/measure_model.py --markdown gap_report_table.md --json results.json`.

35 checks pass, 12 are minor and 23 fail, out of 70 (none N/A). The script ran end to end on the published GLB at commit `b874f00`; one run takes about 4 minutes.

**`gap_report.md` was not created.** The harness blocks subagents from writing report `.md` files, so the report content is below. I committed `measure_model.py` on its own with the requested message (commit `0cf46b8`, no AI attribution). The full gap table is reproducible with:
- `./.venv/Scripts/python anatomy/checks/measure_model.py --markdown gap_report_table.md --json results.json` (full run)
- `--render results.json --markdown gap_report_table.md` (re-renders the table from a saved result without re-measuring)

**Grading used:**
- **PASS:** every sub-metric is inside the YAML's accepted band.
- **MINOR:** only soft (population) metrics miss, each by less than half the band width; or a soft yes/no fails; or a hard length misses by no more than 0.5 mm.
- **FAIL:** a hard metric misses, a soft one misses by half the band or more, or the needed structure or attribute is absent.

**Where the YAML definitions didn't work on this mesh, I used these instead** (each is noted in the script):
- **Valve annuli:** hinge rings, meaning valve vertices within 1 mm of the heart wall. The YAML fallback picks leaflet and chordal tissue.
- **Aortic annulus:** the aorta's flat proximal end cap, which is tilted 33°.
- **Carina:** found by tracking the tracheal lumen downward. A plain "first two-lumen slice" lands at T3 because the upper-lobe bronchi rise beside the trachea.
- **Pulmonary-artery branch lengths:** measured from the bifurcation to where each branch enters the lung.
- **AHA 17-segment rings:** the YAML text has the basal and mid bounds swapped; the script uses the anatomical order.

**Top 15 fixes, most anatomically important first:**
1. **LCX leaves the AV groove.** It stays within 15 mm of the mitral hinge only from 34 to 61 mm, then runs 74 mm down the lateral wall to 17 mm from the apex, which is an obtuse-marginal course. The trunk is 135 mm (reference 41–108); LAD:LCX length ratio is 0.92 (reference ≈1.65); no marginal branch is ≥1.5 mm. (COR-10/11/12, VEN-06)
   - Fix: in `extract_centerlines.decompose`, pick the LCX trunk by how closely it follows the AV groove, end it before the crux, and relabel the apical run as OM1 (SCCT 12).
2. **RCA is off the right AV groove and has a shepherd's crook.** The mid RCA is 21 mm (median; max 32 mm) from the tricuspid hinge, against a limit of 15 mm. The first 30 mm rise 10 mm (limit 3 mm). (COR-13, COR-15)
   - Fix: re-route it 8–10 mm outside the tricuspid ring and flatten the proximal loop.
3. **The web viewer's Realistic look hides the veins and breaks the atlas colours.** The GLB colours are all correct. In the viewer, the aorta and pulmonary artery are pale `#C3ADA0` (hue 22°, saturation 0.18) instead of red and blue, and `showVeins` defaults to false. (COL-01/02/03)
   - Fix: change `tissue.ts` / `palette.ts`. This conflicts with DESIGN_SYSTEM §2.3 ("anat/vein … never blue"), so that rule has to be decided first.
4. **The cardiac-vein tree is five separate pieces, half sunk into the wall.** 54% of vein vertices lie inside the myocardium (95th percentile 1.9 mm deep, max 3.7 mm). The coronary sinus is 4.7 mm wide (hard minimum 6 mm); the great cardiac vein is 2.6 mm. (VEN-10, VEN-01, VEN-08)
   - Fix: dilate the veins, merge the pieces into one lumen with a voxel remesh, and offset them outside the heart surface.
5. **Coronary sinus position is wrong.** 73% of it sits on the ventricular side of the mitral hinge (at least 75% should be atrial). Its ostium is 3.6 mm behind the IVC opening instead of in front. The source "coronary sinus" part is 68 mm long (reference 20–55). (VEN-04/05/09)
6. **No SCCT segment labels.** There is no `_SEGMENT` vertex attribute, no `scct`/`code` in `vessels.json` and no `manifest.segments`, all required by CONTRACTS v1.1 §7.1. Only one diagonal is ≥1.5 mm, and five LAD branches run onto the RV. (COR-22, COR-08)
7. **Territory map over-weights the RCA.** Share of LV myocardium: LAD 32.5%, LCX 19.6%, RCA 48.0% (reference 42.5 / 28.8 / 26.4%). Segment 1 is LCX-majority, segment 5 is RCA-majority, and segment 2 is only 54% LAD. (COR-24, COR-23)
   - Fix: blend the nearest-artery weights with the AHA-17 standard map and split the septum using the septal perforators.
8. **No aortic root or aortic valve.** The aorta's end cap is 29 mm from the mitral valve (limit 5 mm). The coronary ostia sit 3.1 mm (LM) and 6.9 mm (RCA) above the cap, against 14.4 and 17.2 mm. BodyParts3D has no aortic-valve part. (VLV-05, COR-02, GV-01)
   - Fix: loft an aortic root with three sinuses and add a `Valve_Aortic` node.
9. **Aorta is a uniform 22 mm tube** (reference 25–41, 33 typical) with no sinus bulge. This makes the PA:aorta ratio 1.02, over the hard limit of 1.0. (GV-02, GV-08)
10. **Coronary seating and taper.**
    - Buried stretches: proximal RCA 14 mm (up to 2.6 mm deep), LCX 10 mm, LAD 5 mm (deepest 3.4 mm). COR-21 still passes, but these stretches are hidden in the viewer.
    - Taper: distal-to-proximal diameter ratio is 0.26 for the LAD and 0.29 for the LCX (reference minimum 0.30).
    - Children wider than parents: 14 branches, including an LAD branch of 2.3 mm.
    - (COR-21 notes, COR-20)
11. **Septal perforators point back toward the base.** They leave the LAD at 118–136° (reference 30–100°); one is only 56% inside the myocardium (reference ≥70%). (COR-09)
12. **Tricuspid hinge is 10.4 mm more basal than the mitral hinge.** Normally it is 0–15 mm more apical. (VLV-04)
13. **Meshes intersect.** Aorta goes 4.9 mm into the vertebral bodies; heart 3.7 mm into the right lung, 1.9 mm into the left lung and 2.7 mm into the diaphragm; aortic arch 1.6 mm into the trachea. (POS-09/10, GV-04/05)
    - Fix: push the display-only neighbours out along their normals.
14. **SVC too short.** It is 37 mm long (reference 60–80) and joins the right atrium 19 mm above the right 3rd costal cartilage; the right heart border is 15 mm high. (GV-10/11, POS-06)
    - Fix: add the brachiocephalic veins (FMA4751/4761) and arch branches (FMA3932/4058/4694).
15. **Missing structures** (see the next list).

**Missing structures:**
- Available in BodyParts3D but not built:
  - small cardiac vein (FMA4714)
  - chamber labels: RA/LA/RV/LV/septum (FMA7096/7097/7098/7101/7133)
  - oesophagus (FMA7131)
  - arch branches and brachiocephalic veins
- Not in BodyParts3D, would need to be synthesised:
  - left marginal vein (present in 66.7% of people)
  - epicardial fat in the grooves (about 7 mm)
  - pericardium
  - aortic valve and sinuses
  - vein of Marshall
- Nothing in the pipeline produces vein centrelines in `vessels.json` or names for diagonal/OM/conus/SA-nodal branches.

**Artery–vein pairing** (vein↔artery):
- **AIV↔LAD:** vein within 10 mm of 95.7% of LAD samples; median gap 1.8 mm. Pass.
- **MCV↔PDA:** median 1.4 mm; joins the coronary sinus 10.5 mm from its ostium. Pass.
- **GCV at the LM bifurcation:** 2.4 mm from the proximal LAD and 0.6 mm from the proximal LCX, so the Brocq–Mouchet triangle closes. Pass.
- **CS/GCV↔LCX:** median gap 2.8 mm, but the LCX is nearer the mitral annulus in only 32% of paired samples (reference 68–80%).
- **Anterior cardiac veins:** cross the RCA. Pass.

**Other results:**
- **Pass:** heart position, size and axis; carina at T5; valve order; left main; LAD course and length; PDA and posterolateral branches; right dominance; pulmonary artery course and branches; IVC entering at T8/T9.
- **Minor:** pulmonary-vein ostia 15.4 mm median (reference up to 14 mm).
- **Contradicts `REFERENCE.md` §10 snapshot:** measured against the tilted annulus plane, the RCA ostium sits 3.8 mm *higher* than the LM ostium, and the mitral centre is 2.3 mm above the tricuspid centre.

Files are in `C:\Users\omerj\Downloads\CardioTwin\anatomy\checks`:
- measure_model.py
