# What is BodyParts3D, what is derived, what is synthesised

CardioTwin's 3D anatomy is built from **BodyParts3D** (one segmented body; CC BY-SA 2.1 JP). Where that source is
collapsed, sunk into the heart wall, mislabelled for our purpose or simply missing, the pipeline corrects or adds
geometry. Every correction is scripted, deterministic and listed here, with the literature value it follows
([`REFERENCE.md`](REFERENCE.md)). Nothing is sculpted by hand.

| Structure (node) | Provenance | What was done | Why (reference) |
| --- | --- | --- | --- |
| Valves (mitral, tricuspid, pulmonary), papillary muscles, lungs, airway, ribs, sternum, spine, clavicles, cartilages, pectorals, skin, diaphragm, SVC, IVC, pulmonary artery and veins | **BodyParts3D** | Cleaned, cropped to the thorax, decimated to the triangle budget | — |
| Heart wall (`Heart_Wall_Anterior` / `_Posterior`, `SYN_HeartWall`) | **Derived** from BodyParts3D FMA7274 | The wall yields round the moved aortic root (13,097 vertices shifted up to 9.4 mm, 1 mm clearance, relaxed so no face folds); decimated as one mesh, collapse slits healed, opened along the long axis and capped | The moved root would otherwise sit up to 11 mm inside the wall (VLV-05, POS-09) |
| Arch branches (`GreatVessel_Aorta_ArchBranches`), brachiocephalic veins (`GreatVessel_SVC_BrachiocephalicVeins`), oesophagus (`Oesophagus`) | **BodyParts3D** | Cropped at the neck base (z = 1390 mm) | Missing structures in the baseline gap report |
| Diaphragm | **BodyParts3D**, rigidly lowered 4 mm | Its dome rose 3–4 mm into the inferior heart wall | No intersections (POS-10) |
| Lungs, spine, trachea, oesophagus, pulmonary artery, SVC, brachiocephalic veins, descending aorta | **BodyParts3D**, locally dented | Display-only neighbours yield where they intersect a structure (two-sided push-out, smooth dents; `collisions` in `anatomy/config/anatomy.json`) | No intersections (POS-09, GV-04/05) |
| Ascending aorta (`SYN_AortaAscending`) | **Derived** | The cadaveric, oval 22 mm tube is rounded to ≥ 25.6 mm about its own centreline, fading back to the source at the arch; blended into the moved root over 12–45 mm | In-vivo 33 ± 4 mm, ≥ 25 accepted; PA : Ao ≤ 0.9 (§3.1, §3.2, GV-02/08) |
| Aortic root (`SYN_AorticRoot`) | **Synthesised** | Annulus 23 mm, three sinuses of Valsalva (inter-sinus 29 mm, sinus 34 mm, STJ 26 mm at 21 mm); moved as a whole by a constrained 1 mm grid search (box x −6…3.5, y −4…10, z −10…3 mm) to the smallest rim-to-mitral gap that keeps the valve order and the ascending course: (3, 10, −10) mm; ostia 15.5 mm (LM) and 18.6 mm (RCA) above the annulus | BodyParts3D has no root and its aorta ended 29 mm from the mitral valve (§4.4, VLV-05, COR-02) |
| Aorto-mitral curtain (`SYN_AortoMitralCurtain`, part of `Valve_Mitral`) | **Synthesised** | A 1 mm fibrous sheet, 32 mm wide and 9–14 mm high, from the left / non-coronary annulus to the hinge of the anterior mitral leaflet, 1.2 mm clear of the wall | Aorto-mitral fibrous continuity (§4.4, VLV-05: gap 1.1 mm) |
| Aortic valve (`Valve_Aortic`, `SYN_AorticValve`) | **Synthesised** | Three closed semilunar cusps, 1.4 mm thick, hinged in a crown line from the annulus nadir to the commissures at the STJ, with a lunula, a nodule of Arantius and a 5 mm belly towards the ventricle | Not in BodyParts3D |
| Coronary arteries (`Coronary_*`, `SYN_Coronary_*`) | **Synthesised** on the BodyParts3D heart (`anatomy/scripts/coronary.py`) | Designed on the epicardium (voxel SDF, 0.5 mm) with the measured mitral / tricuspid hinge rings: LM 10–13 mm leftwards behind the pulmonary trunk to the anterior end of the left AV groove (bifurcation 13.7 mm from the mitral ring); LCX along the mitral hinge ring round the obtuse margin with OM1 / OM2; LAD, diagonals and RV branches re-seated on the BodyParts3D courses; RCA in the right AV groove from an anterior take-off to the crux, with conus and sinus-node branches, acute marginals, PDA and posterolateral branches; three LAD and three PDA septal perforators through the mid-septum (take-off 55–95°). SCCT / MDCT calibres with a power-law taper (LM 4.3, LAD 3.9 → 1.3, LCX 3.3 → 1.9, RCA 3.3 → 2.4 mm), swept tubes, exact centrelines | The BodyParts3D tree had an RCA with a shepherd's-crook loop running 20 mm from the tricuspid hinge, a bifurcation 37 mm from the mitral ring, backward septal perforators and cadaveric calibres (§5.1–5.7, COR-09/10/12/13/15/20) |
| Cardiac veins (`CardiacVeins`, `SYN_CardiacVeins`) | **Synthesised** on the BodyParts3D heart (`anatomy/scripts/veins.py`) | CS seated in the posterior left AV groove (4–8.5 mm atrial to the mitral hinge) with a flush ostium in the posteroinferior RA 2 mm from the tricuspid hinge and in front of the IVC; GCV continuing round the left AV groove into the AIV beside the LAD; MCV with the PDA, joining 9.6 mm from the ostium; PVLV and left marginal vein (LMV) on the lateral wall; small cardiac vein (SCV) along the right AV groove; two anterior cardiac veins opening into the RA wall; calibres CS 10 → 8.6, GCV 6.6 → 4.6, AIV 4 → 1.3, MCV 4.6 → 1.3, LMV 3 → 1, SCV 2.4 → 0.9 mm, every tip thinned to 0.45–0.65 mm; seated 0.25 mm off the epicardium; voxel-remeshed at 0.25 mm into one lumen | Source veins were cadaveric (CS 4.7 mm), 54 % inside the myocardium, five disjoint pieces, no LMV / SCV (§6.1–6.5, VEN-01/05/08/11/12) |
| Epicardial fat (`EpicardialFat_Anterior` / `_Posterior`) | **Synthesised** | A groove bed on the epicardium whose surface rises to 0.6 r above the axis of each AV-groove (LM, pCx, RCA, CS, GCV, SCV) and interventricular (LAD, PDA, AIV, MCV) vessel, at least 2.6 / 1.6 mm thick; narrow beds along branch arteries of radius ≥ 0.6 mm; thinning towards the apex; softly lobulated; sunk 1 mm into the myocardium; split with the heart's cut plane (57 ml) | Trunks half-buried in epicardial fat with their crown visible (§5.8) |
| Perfusion territories (`COLOR_0`, `_TERRITORY`) | **Derived** | Nearest-artery soft weights blended 85 % towards the AHA-17 standard territories on LV myocardium, the septum split by LAD vs RCA septal perforators, the right-ventricular free wall given to the RCA except a strip 8–13 mm wide beside the anterior groove, then the three weights re-balanced on the LV region towards the population shares (LAD 42.5 / LCX 28.8 / RCA 26.4 %) | §5.10, COR-23/24/25 |

## Labels and attributes that exist only in CardioTwin

* `_SEGMENT` (coronary meshes): SCCT 2014 segment of the nearest labelled centreline point; the table with
  definitions and main-path / total branch lengths is `manifest.segments`, the per-point ranges are `vessels.json`
  `segments[].labels`. Present: 1–14 and 16. Absent by anatomy of this right-dominant heart: 15 (L-PDA), 17 (ramus),
  18 (L-PLB).
* `_VEIN` (cardiac veins) and `vessels.json` `veins`: labelled vein centrelines with their design radii (1 CS, 2 GCV,
  3 AIV, 4 MCV, 5 PVLV, 6 ACV, 7 LMV, 8 SCV).
* `_TERRITORY` (heart walls): the LAD / LCX / RCA weights of `COLOR_0` under a name no glTF viewer multiplies into the
  albedo.
* `_DIST_HEART`, `_DIST_HILUM` (pulmonary artery and veins): geodesic distance from the cardiac end and signed
  distance from the lung hilum, so a viewer can keep the proximal vessels and fade the intrapulmonary tree.

## Known limitations that are not corrected yet

* The tricuspid hinge is 10 mm more basal than the mitral hinge (it should be 0–15 mm more apical) and the pulmonary
  valve ring is 31 mm wide (VLV-04/06); the SVC is 37 mm long (GV-10/11). These are BodyParts3D placements.
* The coronary sinus must open in front of the IVC, so its last 15 mm approach the AV groove obliquely: 70 % of it lies
  on the atrial side of the mitral hinge and 48 % runs parallel to it (VEN-04); the GCV follows the whole left AV groove,
  so CS + GCV measure 197 mm (VEN-09).
* The AIV join crosses up to 4.3 mm into the wall below the left auricle and a vein passes 3 mm from a pulmonary vein
  (VEN-10).
* Past its first 20 mm the circumflex runs up to 16.8 mm from the mitral hinge where the obtuse margin bulges (COR-10).
* Over the proximal two-thirds, 38–56 % of each trunk's centreline lies inside the fat (the crown of every groove
  vessel is left exposed on purpose); the lungs and diaphragm are too coarse to follow the grooves (POS-09/10).
