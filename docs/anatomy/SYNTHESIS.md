# What is BodyParts3D, what is derived, what is synthesised

CardioTwin's 3D anatomy is built from **BodyParts3D** (one segmented body; CC BY-SA 2.1 JP). Where that source is
collapsed, sunk into the heart wall, mislabelled for our purpose or simply missing, the pipeline corrects or adds
geometry. Every correction is scripted, deterministic and listed here, with the literature value it follows
([`REFERENCE.md`](REFERENCE.md)). Nothing is sculpted by hand.

| Structure (node) | Provenance | What was done | Why (reference) |
| --- | --- | --- | --- |
| Heart wall, valves (mitral, tricuspid, pulmonary), papillary muscles, lungs, airway, ribs, sternum, spine, clavicles, cartilages, pectorals, skin, diaphragm, SVC, IVC, pulmonary artery and veins | **BodyParts3D** | Cleaned, cropped to the thorax, decimated to the triangle budget, heart opened along its long axis | — |
| Coronary arteries (`Coronary_*`) | **BodyParts3D** | Geometry untouched. The LCX centreline is split where it leaves the left AV groove (> 15 mm from the mitral hinge, s ≈ 62 mm): the AV-groove part is the circumflex trunk (SCCT 11, pCx), the apical run is relabelled as the first obtuse marginal (SCCT 12, OM1). Every centreline point and mesh vertex carries its SCCT 2014 segment. | LCX runs in the left AV groove and ends before the crux in right dominance (§5.4, COR-10/11/19) |
| Arch branches (`GreatVessel_Aorta_ArchBranches`), brachiocephalic veins (`GreatVessel_SVC_BrachiocephalicVeins`), oesophagus (`Oesophagus`) | **BodyParts3D** (added this round) | Cropped at the neck base (z = 1390 mm) | Missing structures in the baseline gap report |
| Diaphragm | **BodyParts3D**, rigidly lowered 4 mm | Its dome rose 3–4 mm into the inferior heart wall | No intersections (POS-10) |
| Lungs, spine, trachea, oesophagus, pulmonary artery, SVC, brachiocephalic veins, descending aorta | **BodyParts3D**, locally dented | Display-only neighbours yield where they intersect a structure (two-sided push-out, smooth dents; `collisions` in `anatomy/config/anatomy.json`) | No intersections (POS-09, GV-04/05) |
| Ascending aorta (`SYN_AortaAscending`) | **Derived** | The cadaveric, oval 22 mm tube is rounded to ≥ 25.6 mm about its own centreline, fading back to the source at the arch | In-vivo 33 ± 4 mm, ≥ 25 accepted; PA : Ao ≤ 0.9 (§3.1, §3.2, GV-02/08) |
| Aortic root (`SYN_AorticRoot`) | **Synthesised** | Annulus 23 mm parallel to the source cap and 11 mm below it (shifted 3 mm to the patient's right), three sinuses of Valsalva centred on the RCA ostium (right sinus), left-main ostium (left sinus) and the bisector of the remaining arc (non-coronary sinus), inter-sinus diameter 29 mm, sinus 34 mm, STJ 26 mm at 21 mm | BodyParts3D has no root: its aorta ended in a flat cap 29 mm from the mitral valve. Ostial heights become 15 / 19 mm (MDCT 14.4 ± 2.9 / 17.2 ± 3.3 mm, §5.1, COR-02) |
| Aortic valve (`Valve_Aortic`, `SYN_AorticValve`) | **Synthesised** | Three closed semilunar cusps, 0.8 mm thick, hinged in a crown line from the annulus nadir to the commissures at the STJ, coapting at 62 % of the root height with a 3 mm belly towards the ventricle | Not in BodyParts3D |
| Cardiac veins (`CardiacVeins`, `SYN_CardiacVeins`) | **Derived** from the five BodyParts3D vein parts | Skeletonised; labelled CS (last 40 mm to the ostium) / GCV / AIV / MCV / PVLV / ACV; tributaries bridged onto the CS–GCV trunk so the tree is **one lumen**; re-swept with in-vivo calibres (CS 10 → 8 mm, GCV 6 → 5 mm, AIV 4 → 1.6 mm, MCV 4.8 → 1.6 mm, PVLV 3.4 → 1.4 mm, ACV 2 → 1.1 mm); centres re-seated one radius + 0.25 mm outside the epicardium (narrowed where a groove is narrower than the vein); the CS lifted onto the atrial side of the mitral hinge and its ostium placed in front of and medial to the IVC orifice; voxel-remeshed at 0.25 mm | Source veins are cadaveric (collapsed: CS 4.7 mm vs 9 mm), 54 % of their vertices lay inside the myocardium, five disjoint pieces, CS 73 % on the ventricular side (§6.2–6.5, VEN-01/04/05/08/10) |
| Epicardial fat (`EpicardialFat_Anterior` / `_Posterior`) | **Synthesised** | A shell on the epicardium: up to 5.5 mm in the AV grooves (RCA, CS, GCV, LM) and 3.5 mm along the interventricular grooves (AIV, MCV), thinning towards the apex; every coronary artery and vein lies in a channel (fat at 35 % beside it) so it stays readable; Voronoi lobules ~3.6 mm; split with the heart's cut plane | Epicardial fat ~7 mm, trunks embedded in fat (§5.8) |
| Perfusion territories (`COLOR_0`) | **Derived** | Nearest-artery soft weights blended 85 % towards the AHA-17 standard territories on LV myocardium, the septum split by LAD vs RCA septal perforators, then the three weights re-balanced towards the population shares (LAD 42.5 / LCX 28.8 / RCA 26.4 %) | §5.10, COR-23/24 |

## Labels and attributes that exist only in CardioTwin

* `_SEGMENT` (coronary meshes): SCCT 2014 segment of the nearest labelled centreline point; the table with
  definitions is `manifest.segments`, the per-point ranges are `vessels.json` `segments[].labels`.
  Present: 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 16. Absent by anatomy of this heart: 10 (no second diagonal ≥ 0.9 mm),
  13 (the circumflex ends as OM1 at the obtuse margin), 14, and the left-dominant / ramus segments 15, 17, 18.
* `_VEIN` (cardiac veins) and `vessels.json` `veins`: labelled vein centrelines with radii measured on the mesh.
* `_DIST_HEART`, `_DIST_HILUM` (pulmonary artery and veins): geodesic distance from the cardiac end and signed
  distance from the lung hilum, so a viewer can keep the proximal vessels and fade the intrapulmonary tree.

## Known limitations of the source that are not corrected yet

* The RCA leaves the aorta with a 10 mm upward loop (shepherd's crook, a 5 % variant) and its mid part runs
  ~20 mm from the tricuspid hinge; the fix needs a re-routed trunk with its branches (COR-13/15).
* The LM bifurcation lies 37 mm from the mitral hinge, so the proximal circumflex cannot be in the AV groove
  within its first 20 mm (COR-10).
* The tricuspid hinge is 10 mm more basal than the mitral hinge and the pulmonary valve ring is 31 mm wide
  (VLV-04/06); the SVC is 37 mm long (GV-10/11). These are BodyParts3D placements left as they are.
* Septal perforators leave the LAD at 118–136° (backwards) and are short (COR-09).
