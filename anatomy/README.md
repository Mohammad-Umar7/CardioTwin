# CardioTwin anatomy pipeline

Reproducible, scripted pipeline that turns **BodyParts3D** anatomical meshes into the web assets behind
CardioTwin's 3D viewer:

| Output | What it is |
| --- | --- |
| `frontend/public/anatomy/cardiotwin_anatomy.glb` | 41 named anatomical nodes under 7 `Layer_*` groups (CONTRACTS §6.2 + v1.1 additive nodes), 407,737 triangles, baked PBR textures (WebP, 2.5 MB, 46 MiB on the GPU), **7.7 MB** (meshopt) |
| `frontend/public/anatomy/manifest.json` | Layers, structures (with FMA id, definition, clinical relevance, provenance), SCCT segment table, vein table, attribute docs, model-target mapping, explode vectors, camera presets (§6.3, §7.1) |
| `frontend/public/anatomy/vessels.json` | Coronary centrelines, proximal → distal, with lumen radius and SCCT labels; labelled cardiac-vein centrelines (§6.4, §7.1) |
| `docs/media/renders/*.jpg`, `heart_turntable.mp4` | Cycles portfolio renders, an EEVEE preview (`web_preview.jpg`) and a three.js capture (`web_preview_three.jpg`) of the published GLB |

What is BodyParts3D, what is derived and what is synthesised (aortic root, aorto-mitral curtain and valve, the mitral and
tricuspid leaflets, chordae and papillary muscles, the coronary tree and cardiac veins designed on the heart, epicardial
fat; the heart wall's local corrections, the pulmonary veins and SVC that follow them) is listed in
[`docs/anatomy/SYNTHESIS.md`](../docs/anatomy/SYNTHESIS.md); the anatomical reference and its checks are
[`docs/anatomy/REFERENCE.md`](../docs/anatomy/REFERENCE.md) and [`checks/`](checks/) (`gap_report.md`).

![hero](../docs/media/renders/hero_heart.jpg)

## Quick start

```bash
./.venv/Scripts/python anatomy/build.py             # fetch → synth → blender → centrelines → bake → optimise → verify → manifest → explode (~5 min)
./.venv/Scripts/python anatomy/build.py --renders   # … plus the Cycles renders (GPU recommended)
./.venv/Scripts/python -m pytest anatomy            # geometry utilities, centreline graphs, asset contracts, mesh QA
./.venv/Scripts/python anatomy/checks/measure_model.py --markdown gap.md --json gap.json   # 78 reference checks (~4 min)
```

Set `CARDIOTWIN_PUBLIC_DIR=<folder>` to build, verify, measure and test into a staging folder instead of
`frontend/public/anatomy` (every script, the Node tools and the tests read it); copy the three files over when they
pass. Blender cannot open paths longer than 260 characters, so keep the staging folder short for the `explode` stage.

Prerequisites

* Python 3.11 virtualenv at `./.venv` with `numpy scipy trimesh scikit-image networkx rtree matplotlib pytest`
  (all in the project requirements).
* **Blender 5.1** (headless). Default path `C:/Program Files/Blender Foundation/Blender 5.1/blender.exe`; override with
  `--blender PATH` or `CARDIOTWIN_BLENDER`.
* **Node 18+**. `build.py` runs `npm ci` in `anatomy/` on first use (`@gltf-transform/*`, `meshoptimizer`, `sharp` for WebP).
* Internet access for the first fetch (~190 MB of STL, cached in `anatomy/raw/`, git-ignored).

Everything is driven by two declarative files, **`anatomy/config/anatomy.json`** (parts, layers, budgets, crops,
collision rules, territory parameters) and **`anatomy/config/definitions.json`** (FMA ids, precise definitions,
clinical relevance, vein table). Geometry, centrelines and the manifest rebuild deterministically; the baked textures
are Cycles bakes with a fixed seed (GPU noise can change individual texels, not the look). `anatomy/SOURCES.md` pins
every input STL by SHA-256 and lists the derived / synthesised parts.

## Stages

| # | Stage | Command (from repo root) | Output |
| --- | --- | --- | --- |
| 1 | Fetch | `./.venv/Scripts/python anatomy/scripts/fetch_bodyparts3d.py` | `anatomy/raw/*.stl`, `anatomy/SOURCES.md` |
| 1b | Synthesis (`synthesize.py` with `vascular.py`, `valves.py`, `coronary.py`, `veins.py`) | `./.venv/Scripts/python anatomy/scripts/synthesize.py` | `anatomy/build/synth/SYN_*.ply` (incl. `SYN_TunnelCutter`), `coronary_centerlines.json`, `vein_centerlines.json`, `synth_report.json` |
| 2–4 | Blender build | `blender --background --factory-startup --python anatomy/blender/build_anatomy.py` | `anatomy/build/cardiotwin_anatomy.raw.glb`, `build_report.json`, `vessels/*.ply`, `cardiotwin_build.blend` |
| 4a | Texture bake | `blender --background --factory-startup --python anatomy/blender/bake_textures.py` | `anatomy/build/bake/<node>_{base,normal,orm}.png`, `bake_manifest.json` |
| 4b | Web optimisation (after stage 5: needs `vessels.json` for `_ARCLEN` / `_SEGMENT` / `_VEIN`) | `node anatomy/scripts/optimize_glb.mjs` | `frontend/public/anatomy/cardiotwin_anatomy.glb` |
| 4c | Contract check | `./.venv/Scripts/python anatomy/scripts/verify_glb.py` | pass/fail + per-node report |
| 5 | Centrelines | `./.venv/Scripts/python anatomy/scripts/extract_centerlines.py` | `vessels.json`, `anatomy/build/centerline_report.json` |
| 6 | Manifest | `./.venv/Scripts/python anatomy/scripts/make_manifest.py` | `manifest.json` |
| 6b | Explode check | `blender --background --factory-startup --python anatomy/blender/check_explode.py` | pass/fail + `anatomy/build/explode_report.json` |
| 7 | Renders | `blender --background --factory-startup --python anatomy/blender/render_heroes.py -- [--shots …] [--save-scene]` | `docs/media/renders/` |
| 7b | Web preview | `blender --background --factory-startup --python anatomy/blender/render_web_preview.py` | `docs/media/renders/web_preview.jpg` |
| 7c | three.js capture | `node anatomy/scripts/web_preview_three.mjs` (headless Chrome / Edge) | `docs/media/renders/web_preview_three.jpg` |
| QA | Decode for QA | `node anatomy/scripts/decode_glb.mjs [glb] OUT_DIR` | plain per-node arrays (used by `tests/test_mesh_quality.py`) |
| QA | three.js view | `node anatomy/scripts/check_three.mjs` | attributes as three.js names them (`_segment`, `_vein`, `_dist_hilum` …) and the baked maps on the heart-wall material |
| QA | Previews | `blender --background --factory-startup --python anatomy/blender/preview.py -- --views torso,heart,open,territory,qa` | `anatomy/build/preview/*.png` |

`build.py --only manifest,verify` runs a subset; `--skip fetch` skips stages.

## Sources and licence

All source meshes come from **BodyParts3D** (Database Center for Life Science, Japan) via the GitHub mirror
`Kevin-Mattheus-Moerman/BodyParts3D`; every part name was checked against `parts_list_e.txt`
(see [`SOURCES.md`](SOURCES.md) for ID, name, node, triangle count, bytes and SHA-256 of all 112 parts). The aortic root,
aorto-mitral curtain and valve, the mitral and tricuspid leaflets with their chordae and papillary muscles, the coronary
arteries, the cardiac veins and the epicardial fat are synthesised on the BodyParts3D heart (the coronaries and veins
follow the course of the BodyParts3D branches); the ascending aorta, the heart wall (yielding round the root, the mitral
isthmus, the right-atrial roof), the pulmonary veins and the SVC are derived (see
[`docs/anatomy/SYNTHESIS.md`](../docs/anatomy/SYNTHESIS.md)).

> BodyParts3D, © The Database Center for Life Science, licensed under CC BY-SA 2.1 Japan.

The derived meshes (`cardiotwin_anatomy.glb`, `vessels.json` geometry) are a modified work and are redistributed
under **CC BY-SA 2.1 JP**. The pipeline code in `anatomy/` is **MIT** (repository `LICENSE`).

## Coordinate frame

BodyParts3D uses millimetres with **+X patient-left, +Y posterior, +Z superior** (`coordinate_system.png`),
verified anatomically on the data: the spine (y ≈ 0 mm) lies posterior to the sternum (y ≈ −200 mm), and the distal
LAD / cardiac apex sits at +x, −y, low z (left-anterior-inferior). That is exactly Blender's frame for the contract,
so the only transform is

```
p_scene = (p_mm − origin_mm) × 0.01        origin_mm = heart-wall bbox centre = (21.42, −121.85, 1237.01)
```

and Blender's glTF exporter maps Blender +Z → glTF **+Y (superior)** and Blender −Y → glTF **+Z (anterior)**, giving
the contract frame (1 unit = 10 cm, +X patient-left, radiological display). Every mesh node's origin is its
bounding-box centre and nodes carry **translation only** (no rotation/scale), parented to `Layer_*` empties at the
origin — the viewer can offset or scale any node safely.

## Mesh processing

* **Cleanup per part** — STL import (`bpy.ops.wm.stl_import`), then connected components with negative signed volume
  (inward-facing internal pockets; e.g. ~2 000 fragments inside the heart wall) or fewer than 5 % of the part's
  largest component are deleted; vertices are welded (1 µm), degenerate faces dissolved, normals made consistent
  and outward.
* **Skin** — the whole-body `FMA7163` has many internal surfaces; the true epidermis is a separate shell, identified
  by casting 840 horizontal rays from outside the body (100 % hit it first). It is cropped to z ∈ [980, 1397] mm
  (clavicles to below the costal margin) and the upper limbs are removed with an oblique shoulder plane through the
  axilla (159, 1140) and lateral shoulder (190, 1350) mm, applied only above the axilla — below it the arms are
  separate tubes and are dropped by connectivity. The pectoral tendons are trimmed at the same plane.
* **Thorax limits** — aorta, IVC and trachea are cut (and capped) to z ∈ [986, 1390] mm so nothing leaves the torso.
* **Seamless aorta** — BodyParts3D splits the aorta into ascending / arch / descending pieces whose end caps show
  as seam rings; they are fused by a 0.6 mm voxel remesh and relaxed with a corrective smooth.
* **Terrace removal** — BodyParts3D surfaces carry ~1 mm segmentation terraces that read as wood grain under
  specular light. The heart wall gets a Taubin λ|μ low-pass (10 iterations on the welded source, 5 more after
  decimation; mean surface shift 0.3 mm) and the pectorals 10 iterations before decimation (`"taubin": {"pre", "post"}`
  per node in the config). The synthesis seats the vessels on a copy of the wall smoothed the same way, whose voxel
  distance field is calibrated to that surface (the published wall matches it to ±0.03 mm, p10–p90), so every vessel
  lies on the wall it is shown with. The build fails if a heart half cannot be capped (a sign of over-smoothed thin
  wall touching itself on the cut plane).
* **Decimation** — quadric collapse to the per-node budget, then smooth shading with corner-angle-weighted normals;
  edges folding more than 75° (thin-wall rims at vessel and valve openings, cap edges) are split sharp so two
  opposite surfaces are never averaged into a dark seam. (Face-area weighting was dropped: on the decimated wall it
  inverted ~4 % of vertex normals against their faces.) The swept coronary tubes are generated within their budgets
  (only the acute-marginal set is collapsed by 1.5 %); the cardiac-vein tree is swept with coarser rings so its 0.25 mm remesh fits the budget, and
  crumbs the remesh leaves at sub-voxel tips are dropped. Collapse slits and edges shared by three faces that
  decimation leaves on thin wall (≤ 19 vertices) are healed before each heart half is capped.
* **Costal cartilages** — the individual cartilages of ribs 1–7 (FMA) plus the fused ribs 8–10 costal-margin sets
  (`BP24`/`BP28`); the two sets do not overlap (only the rib-7 joint touches).
* **Synthesised and derived parts** — `SYN_*` parts from `scripts/synthesize.py` (the heart wall with its three local
  corrections, rounded ascending aorta, aortic root with sinuses, aortic valve, aorto-mitral curtain, mitral and
  tricuspid valves and papillary muscles from `scripts/valves.py`, the pulmonary veins and SVC that follow the wall,
  the nine coronary nodes, cardiac-vein tree) are read from `build/synth/` like source parts; the cardiac veins are
  voxel-remeshed at 0.25 mm into one lumen.
* **Channels** — where a designed vessel passes under BodyParts3D's fused left auricle (its centreline > 2.1 mm inside
  the wall) or still dips into a ridge of the wall after its capped lift, `SYN_TunnelCutter` (the vessel tube + 0.7 mm,
  + 0.35 mm for a shallow bed) is subtracted from each capped heart half (exact Boolean), so the auricle overlies the
  vessel and no vessel runs inside the myocardium; a channel that would cross the long-axis cut is left solid in that
  half.
* **Epicardial fat** — built on the decimated heart wall before it is opened (`FAT` in `blender/build_anatomy.py`): a
  groove bed whose surface rises to 0.35 r above the axis of each AV-groove (LM, pCx, RCA) and interventricular (LAD,
  PDA) artery, so about two-thirds of each trunk is buried and its crown stays a continuous ridge, and to 0.1 r below
  the axis of each groove vein (CS, GCV, SCV, AIV, MCV: half buried); at least 2.0 / 1.4 mm thick, full height 2 / 1.5 mm
  either side, feathering out by 7 / 5.5 mm, so the grooves read as fat-filled channels and the free walls stay bare;
  a narrow bed (0.8 → 3.5 mm) along the proximal 12 mm of the branch arteries (25 mm of the acute marginal), none on
  twigs thinner than 0.6 mm or on lone veins; a thin film over the apex. Lobules modulate only the thick fat, so the
  margin stays a soft edge. Besides the epicardial vertices (at least two of three outward
  rays escape), the fat fills the depth of a groove under an overhang (the auricles over the AV grooves): wall within
  2.5 mm of the epicardium whose normal meets the overhang within 12 mm and that has a groove vessel in plain view, up
  to 80 % of the free space (never an endocardium, which looks across a cavity). The thickness field is
  closed and smoothed over the wall (no bald pits), lobulated in the geometry (value noise, 3.2 / 1.5 mm cells), sunk
  1 mm into the myocardium, voxel-remeshed (0.38 mm) and split with the same plane as the wall
  (`EpicardialFat_Anterior` / `_Posterior`).
* **Collisions** — display-only neighbours yield to the structures they intersect (`collisions` in the config): a
  two-sided test (neighbour vertices inside a master, and master vertices inside a coarse neighbour) moves the
  neighbour along the surface normal and spreads the dent smoothly; the diaphragm is lowered 8 mm as a whole; the
  intrapulmonary branches of the pulmonary veins keep 6 mm from the heart, its fat and the epicardial vessels. The
  great vessels the viewer cuts open keep a real gap before the fat is shaped round them (their lumens are on show):
  the pulmonary trunk and the SVC leave the aorta by 1 mm (one-sided, to the full depth of the overlap, about 5 mm
  for the trunk), and the aorta's stump gives way 0.5 mm where it still bulges between their vertices; the fat stops
  0.8 mm short of every great vessel; the left main and the RCA are trimmed where they started inside the aortic root,
  so they begin (capped) 0.5 mm off its wall.
* **Cardiac impression** — after the push-out each lung is decimated to 55 % of its budget and the heart halves, fat,
  great vessels, coronaries and cardiac veins, inflated by 2.2 mm along their normals, are subtracted (exact Boolean;
  `lung_carve` in the config; the big masters are coarse cutters in this pass); a very dense impression is decimated
  once more, and a second pass with the full-resolution masters inflated by half the margin carves whatever is left,
  so no heart structure intersects a lung; Boolean crumbs and inside-out slivers are dropped and slits filled, so each
  lung stays a closed surface.
* **Pulmonary distances** — `_DIST_HEART` (geodesic distance from the pulmonary valve / left-atrial ostia) and
  `_DIST_HILUM` (signed geodesic distance from the lung entry, > 0 inside the lungs) on both pulmonary trees; the
  trunk's are measured on its shape from before the collisions dent it round the aorta, and it carries `_DIST_CUT`,
  the viewer's straightened cut distance (a plane across its root direction, `vesselCuts.ts`) on that shape too: the
  viewer cuts the trunk there (20 mm above its valve), so the wall pushed off the aorta keeps its place below the cut.
* **UVs** — Smart UV projection (66°) on every non-coronary node for the baked textures; islands are packed with their
  concave shapes (`pack_islands(shape_method="CONCAVE")`), which fits the 1024² heart atlases at a higher texel
  density.

### Triangle budget (total 420,735 in the GLB ≤ 430,000)

The budget rose from 400k to 430k for the lobulated epicardial fat (40k) and the synthesised valve apparatus (16k); the
GLB stays at about 8 MB.

| Node | Layer | Source | Source tris | Final tris |
| --- | --- | --- | ---: | ---: |
| `Skin_Torso` | skin | FMA7163 (outer shell, cropped) | 23,002 | 9,999None |
| `Pectoralis_L` | muscle | sternocostal + clavicular parts | 41,986 | 5,000None |
| `Pectoralis_R` | muscle | sternocostal + clavicular parts | 41,758 | 5,000None |
| `Ribs_L` | skeleton | 12 ribs | 381,430 | 13,000None |
| `Ribs_R` | skeleton | 12 ribs | 374,274 | 12,998None |
| `CostalCartilage` | skeleton | 14 FMA cartilages + BP24/BP28 | 100,898 | 9,000None |
| `Sternum` | skeleton | manubrium, body, xiphoid | 35,884 | 5,000None |
| `Clavicle_L` | skeleton | FMA13323 | 5,140 | 2,998None |
| `Clavicle_R` | skeleton | FMA13322 | 5,112 | 3,000None |
| `Spine_Thoracic` | skeleton | T1–T12 | 97,394 | 12,498None |
| `Lung_L` | lungs | 2 lobes, cardiac impression carved | 84,920 | 16,324 ³ |
| `Lung_R` | lungs | 3 lobes, cardiac impression carved | 119,366 | 13,744 ³ |
| `Trachea_Bronchi` | lungs | trachea + bronchial tree | 125,240 | 6,500None |
| `Oesophagus` | lungs | FMA7131 (thoracic part) | 2,492 | 2,492None |
| `Diaphragm` | diaphragm | FMA13295 (lowered 8 mm) | 210,666 | 6,500None |
| `Heart_Wall_Anterior` | heart | `SYN_HeartWall` (FMA7274, three local corrections), opened, channels carved | 306,214 | 51,832 ¹ |
| `Heart_Wall_Posterior` | heart | `SYN_HeartWall` (FMA7274, three local corrections), opened, channels carved | 306,214 | 54,920 ¹ |
| `Valve_Mitral` | heart | synthesised leaflets + chordae + aorto-mitral curtain | 6,608 | 6,600None |
| `Valve_Tricuspid` | heart | synthesised leaflets + chordae | 5,128 | 5,128None |
| `Valve_Pulmonary` | heart | FMA7246 | 18,200 | 3,000None |
| `Valve_Aortic` | heart | synthesised (3 cusps) | 6,144 | 3,000None |
| `Papillary_Muscles` | heart | synthesised on the 5 BodyParts3D muscles | 4,832 | 4,000None |
| `GreatVessel_Aorta` | heart | synthesised root, rounded ascending, arch, descending | 32,538 | 12,000None |
| `GreatVessel_Aorta_ArchBranches` | heart | brachiocephalic trunk, R CCA, R subclavian, L CCA, L subclavian | 11,826 | 5,000None |
| `GreatVessel_PulmonaryArtery` | heart | FMA66326 (dense near the trunk) | 116,948 | 12,000None |
| `GreatVessel_PulmonaryVeins` | heart | `SYN_PulmonaryVeins` (FMA66643, left veins moved with the atrium) | 72,548 | 7,000None |
| `GreatVessel_SVC` | heart | `SYN_SVC` (FMA4720, lengthened 10 mm) | 1,532 | 1,532None |
| `GreatVessel_SVC_BrachiocephalicVeins` | heart | R / L brachiocephalic, internal jugular and subclavian stumps | 6,412 | 5,000None |
| `GreatVessel_IVC` | heart | FMA10951 | 5,322 | 3,000None |
| `CardiacVeins` | heart | synthesised CS, GCV/AIV, MCV, PVLV, LMV, SCV, RMV, ACV (one lumen) | 19,296 | 24,000None |
| `EpicardialFat_Anterior` | heart | synthesised groove fat (opened) | 526,956 | 18,018 ² |
| `EpicardialFat_Posterior` | heart | synthesised groove fat (opened) | 526,956 | 21,534 ² |
| `Coronary_LM` | coronary | synthesised (designed on the heart) | 280 | 280None |
| `Coronary_LAD` | coronary | synthesised (designed on the heart) | 12,148 | 12,000None |
| `Coronary_LAD_Septal` | coronary | synthesised (designed on the heart) | 2,428 | 2,428None |
| `Coronary_LCX` | coronary | synthesised (designed on the heart) | 6,128 | 6,128None |
| `Coronary_RCA` | coronary | synthesised (designed on the heart) | 5,292 | 5,000None |
| `Coronary_RCA_Marginal` | coronary | synthesised (designed on the heart) | 9,884 | 9,500None |
| `Coronary_RCA_PDA` | coronary | synthesised (designed on the heart) | 5,644 | 5,644None |
| `Coronary_RCA_PL` | coronary | synthesised (designed on the heart) | 3,876 | 3,876None |
| `Coronary_RCA_Septal` | coronary | synthesised (designed on the heart) | 1,264 | 1,264None |

¹ The wall is decimated as one mesh to 96k triangles; opening it adds the split and cap triangles, carving the channels
a few hundred more.
² Both halves come from one 0.38 mm remeshed shell, decimated to the sum of the two budgets before the split.
³ Decimated to 55 % of the budget before the impression is carved; the Boolean adds the impression's detail.

## Opening the heart

The long axis runs from the **apex** — the most left-anterior-inferior heart-wall vertex, beside the distal LAD — to
the **base centre** (centroid of the mitral and tricuspid valves). The heart wall is bisected by the plane that contains
this axis and faces anteriorly (normal = anterior direction orthogonalised against the axis; glTF
`(−0.455, 0.233, 0.859)`), i.e. a long-axis section through both ventricles. Each half is **capped**, so the cut
shows solid myocardium; cap faces are flat with sharp rim edges so smooth shading never bleeds across the cut.
Opening the halves along the cut normal reveals the chambers, valves and papillary muscles.

## Perfusion territories (`COLOR_0` on both heart halves)

`COLOR_0.rgb = (w_LAD, w_LCX, w_RCA)`; `r + g + b` is the territory confidence and `1 − (r + g + b)` is neutral.

1. For every wall vertex, the distance `d_k` to the nearest point of each coronary group — LAD (+ septal
   perforators), LCX, RCA (+ acute marginal, PDA, posterolateral, septal) — gives `w_k = softmax(−d_k / σ)`,
   σ = 7 mm, faded as `exp(−max(0, min d − 20 mm) / 15 mm)` far from every artery.
2. **Ventricular mask** — weights fade to zero outside ventricular myocardium, defined as wall that is
   *thick* (≥ 4.5–6.5 mm; wall thickness = shortest of 7 inward rays through the solid wall, so vessel rims do not
   read as thick) **or** closer to ventricular landmarks (papillary muscles, septal perforators, PDA, marginal /
   posterolateral branches, apex — ignoring points within 12 mm of the AV-groove vessels) than to the inflow /
   outflow landmarks (venae cavae, pulmonary veins, aortic and pulmonary roots). Wall within 6–14 mm of the
   pulmonary trunk (artery within 50 mm of the pulmonary valve) is never ventricular: BodyParts3D's left atrial
   appendage is solid, passes the thickness rule and wraps around the trunk, and without this gate it glowed in the
   LAD's colour in the default anterior view. Atria, auricles and great-vessel roots therefore stay neutral.
3. Laplacian smoothing (6 iterations) removes decimation-scale seams. Cap vertices get transmural weights.

4. **AHA-17 blend** — on LV myocardium the weights are blended 85 % towards the standard AHA-17 territories (the septal
   segments split by whether the LAD or the RCA/PDA septal perforators are nearer), then the three weights are
   re-balanced (iterative proportional fitting, gains capped to 0.8–1.25) towards the population shares of LV mass
   (LAD 42.5 %, LCX 28.8 %, RCA 26.4 %) on the same LV region `anatomy/checks` uses.

5. **Right-ventricular free wall** — the thin (< 6 mm) wall in the RV sector and all wall outside the LV region is
   RCA territory, except a strip 8–13 mm wide beside the anterior interventricular groove that the LAD keeps (its RV
   branches); the LV shares are calibrated without it (85 % of the epicardial RV free wall is RCA-dominant).

This approximates the standard coronary territories of the **AHA 17-segment model** on a **right-dominant** heart:
LAD → anterior wall, anterior septum and apex; LCX → lateral wall; RCA → RV, inferior wall and inferior septum.
**Limitations**: it is a nearest-artery supply map, not perfusion imaging and **not a lesion map** (the ML model
predicts vessel-level stenosis, never a location within a vessel); dominance and collaterals vary between
patients; the posterior lobe of the left atrial appendage keeps a faint LCX tint (it is in fact supplied by atrial
branches of the LCX, so the colour is not misleading); the left main has no territory of its own (it feeds
LAD + LCX).

## Web optimisation

`optimize_glb.mjs` (glTF-Transform 4 + meshoptimizer + sharp) attaches the baked maps to each node's own material
(`EXT_texture_webp`): baseColor as lossy WebP (q86, full-resolution chroma); the tangent-space normal map
renormalised, tilt-clamped to 60° and stored **near-lossless** (q60: no block facets) — or dropped when its
99th-percentile tilt is under 5° (8-bit noise only); one ORM map (occlusion R, roughness G) near-lossless — or replaced
by a roughness factor when both channels are uniform. The maps are sized to what they carry (`SIZES` in
`blender/bake_textures.py`): 1024² colour + 1024² normal on the heart walls (the muscle relief and faint
subepicardial vessel streaks), 512² on the fat, aorta, pulmonary artery and lungs, 256² on the ghosted layers, 128² for flat maps:
**2.5 MB of WebP, 46.4 MiB on the GPU** (RGBA8 + mips; the build fails above 48 MiB). Atlas samplers clamp to
the edge (`CLAMP_TO_EDGE`: no seam bleeding across islands). The wet serous look goes in as `KHR_materials_clearcoat`
(factor 0.08 on the myocardium, 0.12 fat and valves, 0.14–0.16 vessels; 0.25–0.3 lungs, airway, diaphragm) and each
material's `extras` carry `ct_mean_rgb` (mean baked colour) and `ct_texture_priority` (upload order: heart walls and
fat first). It writes `_SEGMENT` / `_VEIN` / `_ARCLEN` / `_RADIUS`, copies the territory weights to `_TERRITORY`
(unorm8 VEC3, so a viewer can drop `COLOR_0` from its albedo path), reorders vertex caches, quantises `NORMAL`
(octahedral 8-bit via meshopt filters), `TEXCOORD_0` (14-bit) and `COLOR_0` (8-bit RGB) and compresses every buffer
with `EXT_meshopt_compression`. It deliberately **does not** quantise `POSITION` (KHR_mesh_quantization would fold
dequantisation into node matrices, breaking `node.scale` and explode offsets), join, flatten, instance or deduplicate
materials. It fails if any node name, transform or hierarchy changes, re-reads its output to check territory weights
and positions, and writes `anatomy/build/optimize_report.json` (bytes, SHA-256, GPU MiB) and `bake/texture_report.json`
(per-map sizes, tilts, mean colours), which `make_manifest.py` copies into the manifest. The centreline stage runs
first because `_ARCLEN` / `_SEGMENT` / `_VEIN` / `_RADIUS` come from `vessels.json`.

## Coronary centrelines (`vessels.json`)

The coronary tree is designed on this heart by `scripts/coronary.py` (with `scripts/vascular.py`), so its centrelines
are exact rather than skeletonised: a voxel signed-distance field of the heart wall (0.5 mm, calibrated so that it reads
zero on the surface) gives the epicardium, the mitral and tricuspid hinge rings are fitted exactly as
`checks/measure_model.py` fits them, and the AV grooves are traced as the first exit from the myocardium along each ring
plane. The left main leaves its ostium on the moved root and runs at least 9 mm (16 mm) leftwards, below the root of
the pulmonary trunk (which does not overlie it in the frontal view, COR-04), to the anterior end of the left AV groove; the circumflex runs on the ventricular side of the groove's bottom (the crease
below the bulging atrium) round the obtuse margin; the LAD follows the BodyParts3D course, and its first-order branches
are classified by where they end (the branch on the outflow tract is a right-ventricular branch; D1 is re-attached
24–32 mm from the bifurcation, D2 grown 24 mm further at 45°, a left conus branch leaves the first 8 mm); the RCA runs
in the right AV groove from an anterior take-off to the crux (no proximal loop) with a conus branch over the anterior
infundibulum (11 mm below the pulmonary valve), a sinus-node branch, acute marginals, the PDA and posterolateral
branches; three septal perforators leave the LAD from 38 mm and three the PDA at 44–56° and run through the mid-septum.
Each tube lies on the wall: its wall 0.15 mm (branches), 0.3 mm (trunks) or 0.6 mm (groove trunks, in the fat) off the
epicardium, and a last pass lifts every tube out of creases until its wall clears the epicardium by 0.15 mm (never
more than 3.5 mm) and gives every path its uniform 0.8 mm spacing back (lift, resample, lift, resample); stretches
under the fused left auricle are carved as channels (see *Channels*). Calibres follow the
SCCT / MDCT reference diameters with a power-law taper (LM 4.3 → 4.0 mm, LAD 3.9 → 1.3, LCX 3.3 → 1.9, RCA 3.3 → 2.4;
branches 1–2.2 mm narrowing to 0.5–1.0 mm) and tubes are swept with rotation-minimising frames.
`extract_centerlines.py` converts `build/synth/coronary_centerlines.json` to the glTF frame (0.8 mm spacing; an
attached branch starts exactly on its parent's centreline) and labels SCCT 2014 segments (pCx / LCx split at the OM1
origin; RCA 1 / 2 / 3 up to the acute margin and the crux). The lumen radius is the swept radius.

Lengths: LM 16 mm, LAD tree 509 mm (15 segments: diagonals, right-ventricular and left conus branches), LCX 251 mm
(trunk 61 mm to OM1 / OM2), RCA 270 mm (trunk 170 mm, crux at 138 mm; conus and sinus-node branches), acute marginals
473 mm, PDA 252 mm, posterolateral 187 mm, septal perforators 99 + 52 mm (take-off 44–56°); 2,699 points.
`manifest.segments[]` give each segment's main-path `length_mm` and its `total_branch_length_mm`.

## Manifest

Generated from the config plus measured geometry: per layer `id/node/label/explode/order/nodes`; per structure
`id/node/label/layer/target/explode/description/territory` plus `category`, `material`, `fma`, `center`, `bbox`,
`triangles` (and `territory_weights` / `feeds` where relevant); `targets` maps each model output (`CAD`, `LAD`,
`LCX`, `RCA`) to its nodes; `camera` has `home`, `heart`, `exploded` (frames the layout at t = 1 for a 16:9
canvas) and a `focus` preset per structure (35° vertical FOV). Round 2 adds (additively): a verified `fma_id` per structure
(EBI OLS FMA service; the papillary muscles and arch branches list their parts in `fma`), segment `length_mm` /
`total_branch_length_mm`, `realistic_color` (the mean baked colour), `glb_bytes`, `glb_sha256` and `textures` (`gpu_mib`, `webp_mb`,
upload `priority`); version 1.1.0 (contract 1.1, [`docs/anatomy/CONTRACT_1_1.md`](../docs/anatomy/CONTRACT_1_1.md)).
Round 3 adds `facts` (the numbers the definitions quote — left-main, sinus and vein lengths, the number of anterior
cardiac veins, the SVC length, the tricuspid offset, the mitral isthmus — measured on the build and filled into
`config/definitions.json`'s `{PLACEHOLDERS}`, so a definition never contradicts the geometry; `tests/test_definitions.py`
re-measures them), the right marginal vein in `veins[]` (FMA4716) and the `_RADIUS` attribute in `attributes`.

## Exploded view

Displayed position = rest + t · (layer.explode + structure.explode), t ∈ [0, 1]. The layout is radial in the
picture plane of the home camera, so layers separate on screen instead of stacking along the view axis:

* chest wall — pectorals up and out (±1.55, +0.45), rib halves out (±1.95) beyond the lungs, sternum up (clear of the great vessels) and
  forward, costal cartilages down and forward, clavicles up and out, spine straight back;
* lungs slide out (±0.8) and back to frame the heart; the airway rises and moves back (0.65, clear of the left lung);
* heart — the anterior half swings open along the cut normal (0.8) plus a sideways offset (−0.45 X), so the
  home camera sees the epicardium of the anterior half (LAD, RCA) beside the open cavity of the posterior half,
  whose valves, papillary muscles and great vessels stay in place. Coronary branches and cardiac veins ride on the
  half they lie on (the pulmonary valve rides with the anterior half's outflow tract), so vessels stay seated and
  `vessels.json` particles only need their node's offset;
* the skin is an enclosing shell: any translation sweeps it through the organs, so the viewer fades it out.

`blender/check_explode.py` (build stage `explode`) moves every node exactly as documented and tests all pairs for
intersecting triangles: 160 pairs already touch or interpenetrate at rest (coronaries on the epicardium and in the
fat, bronchi in the lungs) and may keep doing so, but no pair may intersect more at t = 1 than at rest. The previous layout failed
with 9 collisions (lungs through the rib cage, costal cartilages through the LAD and marginal branch, the
pulmonary trees through each other and the SVC); the current one has none. While sliding (0 < t < 1) the
interleaved intrapulmonary vessel and bronchial trees still pass through neighbouring layers (39 transient crossings) —
the viewer's staggered peel windows hide most of that.

## Notes for the viewer

* Load with `GLTFLoader` + `setMeshoptDecoder(MeshoptDecoder)` (three/examples/jsm/libs/meshopt_decoder.module.js).
* Because the heart walls have `COLOR_0`, three.js turns on `vertexColors` for their materials: override the
  material (or read `geometry.attributes.color` in a custom shader) — neutral regions have RGB ≈ 0.
* Every node has its **own** material `<Node>_Mat` (safe to mutate), and glTF `extras` (`userData`):
  `ct_id`, `ct_layer`, `ct_label`, `ct_target` (`"LAD"`, … or `""`), `ct_category` (`Coronary`, `Myocardium`, …).
* Closed meshes are single-sided; only `Skin_Torso` (an open shell) is double-sided.
* `vessels.json` points are in the scene / rest frame — add a vessel node's explode offset when it is displaced.
* **SCCT segments**: coronary meshes carry `_SEGMENT` (three.js: `geometry.attributes._segment`) = SCCT 2014 segment
  of the nearest labelled centreline point (0 = named but unnumbered branch: septal, acute marginal, RV branch, D3);
  `manifest.segments` holds codes, names and definitions, `vessels.json` `segments[].labels` the point ranges.
* **Veins**: `CardiacVeins` carries `_VEIN` (`manifest.veins`: 1 CS, 2 GCV, 3 AIV, 4 MCV, 5 PVLV, 6 ACV, 7 LMV,
  8 SCV, 9 RMV); `vessels.json` `veins` holds the labelled centrelines (ordered from the drainage end outward). The CS
  opens flush into the right atrium in front of the IVC orifice; the anterior cardiac veins open into the RA wall.
* **Calibre**: every `Coronary_*` node and `CardiacVeins` carry `_RADIUS` (three.js `_radius`, scene units): the lumen
  radius of the nearest labelled centreline point, so a viewer can inflate each vessel in proportion to its calibre
  (instead of a fixed offset) and fade sub-pixel tips.
* **Territories**: `_TERRITORY` (three.js `_territory`, unorm8 VEC3) repeats `COLOR_0`'s LAD / LCX / RCA weights under a
  name no glTF viewer multiplies into the albedo; read it and ignore `color`.
* **Clearcoat**: materials carry `KHR_materials_clearcoat` (0.08 myocardium – 0.16 cardiac veins; 0.25–0.3 lungs,
  airway, diaphragm); a viewer adding its own wet look should keep the total at or below ~0.3 so the tissue does not
  read as plastic.
* **Pulmonary trees**: `_DIST_HEART` / `_DIST_HILUM` (three.js: `_dist_heart` / `_dist_hilum`) let the viewer keep the trunk, main
  branches and venous ostia (`_DIST_HILUM < ~0.02`) and fade the intrapulmonary tree.
* **Enclosure**: the heart walls, valves, papillary muscles, epicardial fat and `CardiacVeins` carry `_ENCLOSURE`
  (three.js `_enclosure`, 0 – 1): the share of a vertex's sky the closed heart hides (the walls and the great-vessel
  stumps the viewer keeps, the venae cavae and the aorta closed at their cut). The viewer keeps what lies in the
  chambers dark while the heart is closed, so a cut vessel opens onto a dark atrium or ventricle.
* **Coronary pull**: every `Coronary_*` node carries `_PULL` (three.js `_pull`, 0 – 1): 0 within 3.5 mm of a
  great-vessel stump's wall, 1 from 6 mm. The viewer scales the coronaries' display inflation and depth pull by it, so
  an artery running by a stump (the sinus-node artery at the SVC, the ostia on the aortic root) never shows through
  the stump into its dark lumen.
* **Baked maps**: every non-coronary material has a baseColor WebP map and, where they carry information, a normal
  and an occlusion-roughness map (otherwise a roughness factor), with neutral factors; `COLOR_0` on the heart walls is territory DATA — a spec-compliant viewer would multiply it into the albedo,
  so the Realistic look must not (the web preview doesn't).
* **Additive nodes** (not in CONTRACTS §6.2 v1.0): `Valve_Aortic`, `GreatVessel_Aorta_ArchBranches`,
  `GreatVessel_SVC_BrachiocephalicVeins` (their names already classify as valve / aorta / systemic vein),
  `EpicardialFat_Anterior` / `_Posterior` (ride on their heart half; need a `fat` tissue kind) and `Oesophagus`
  (Layer_Lungs; needs its own kind).
* Coronary meshes carry `_ARCLEN` (float, 0 → 1 along each tree from its ostium: left tree from the left-main
  ostium, right tree from the RCA ostium), taken from the nearest `vessels.json` point. **three.js lower-cases
  custom attribute names**, so read `geometry.attributes._arclen` in a shader.
* DESIGN_SYSTEM §7.8 additive manifest fields: `structures[].rides` (the heart-wall node a coronary branch, the
  cardiac veins or the pulmonary valve moves with; their `explode` equals that wall's), `labelAnchor` /
  `labelNormal` on `Coronary_LAD` / `_LCX` / `_RCA` (a centreline point at 30 / 35 / 25 % of the trunk and the
  outward direction from the heart centre) and `bestView` (LAD RAO 30 / CRA 25, LCX RAO 30 / CAU 25, RCA LAO 40).
  Not provided: layer `pivot` / `hingeAxis` / `hingeDeg` (the peel is translation-only) and a baked-AO `COLOR_1`.

## Renders

`render_heroes.py` (Cycles, OptiX + OpenImageDenoise, AgX) writes `hero_heart.jpg`, `heart_posterior.jpg`,
`coronary_detail.jpg`, `open_heart.jpg`, `four_chamber.jpg`, `exploded_torso.jpg`, `territories.jpg`, `xray.jpg`
(1920×1080) and `heart_turntable.mp4` (1280×720, 7 s), all with the procedural tissue looks of `blender/looks.py` (the
same materials the bake stage turns into the web textures). The anatomical shots use the atlas colours of the app's
Realistic look: arteries red (the coronaries `#9f2a22`), the pulmonary artery and every vein blue, the fat golden; the
data shots (`territories`, `xray`) use the viewer's risk ramp, read from `frontend/src/theme/risk.ts` and interpolated
in OKLab like the app, for an example profile (LAD p = 0.84, LCX 0.5, RCA 0.16). Light is a large soft key, a cool rim,
a broad fill and a warm floor bounce; the background is a soft vertical studio gradient (camera-ray only, it lights
nothing).

* `hero_heart` — left-anterior-oblique view of the heart, fat, great vessels and arch stumps.
* `heart_posterior` — from behind and below: the diaphragmatic surface with the crux, PDA, MCV and coronary sinus; the
  apex points to the lower left.
* `coronary_detail` — the anterior interventricular groove: LAD, diagonals, AIV in the groove fat.
* `open_heart` — the long-axis cut opened like a book: the anterior half is turned 180° about the vertical line of the
  cutting plane and laid beside the posterior half, so both cut faces are coplanar and face the camera.
* `four_chamber` — the heart cut in the plane through the apex and the mitral and tricuspid valve centres (render-only
  copies: the two published halves are welded back without their caps, re-cut and capped), the posterior part seen from
  the front: both atria and ventricles, the septa, the AV valves with chordae and papillary muscles.
* `exploded_torso` — the manifest's exploded layout at t = 1 (skin faded, intrapulmonary trees trimmed with
  `_DIST_HILUM`), seen from the front-left above; the costal cartilages are split at the sternal midline so each half
  travels with its ribs, and the rib cage, sternum and cartilages spread in the picture plane (render only).
* `xray` — an anteroposterior view through the fresnel torso (bones faded towards their far side) with emissive flow
  beads on the risk-coloured coronaries.
* `territories`, `turntable` — the perfusion-territory map (LAD / LCX / RCA in three distinct hues, anterior and
  posterior-inferior) and a 360° turn of the heart.

Close-ups stage the heart on its own (the pulmonary-vein tree and IVC hidden, the pulmonary artery clipped near its
bifurcation, the descending aorta cut behind the atria) using render-only copies — the published asset is never
modified. `render_web_preview.py` imports the **published** GLB (decoded losslessly by `scripts/decode_for_blender.mjs`)
into an empty scene and renders it with EEVEE from the hero camera using only its baked textures and the risk ramp on
the coronaries (veins and fat stepped back), as the viewer's Realistic look (`web_preview.jpg`);
`scripts/web_preview_three.mjs` serves the repository and opens `scripts/web_preview_three.html` in headless
Chrome / Edge, which loads the GLB with the app's own three.js (GLTFLoader + MeshoptDecoder, NeutralToneMapping, the
viewer's code-built studio environment and its camera-attached Realistic light rig) from the exact hero camera and
saves `web_preview_three.jpg` as a side-by-side of `hero_heart.jpg` (Cycles) and the three.js frame, with their mean
absolute difference over the object pixels (`anatomy/build/web_parity.json`) — what the app shows next to what Cycles
shows. The full set renders in a few minutes
on an RTX 4070 laptop GPU plus 2 minutes for the turntable.

## Adding a new anatomical structure

1. Find the part(s) in `parts_list_e.txt` and add a node entry to `config/anatomy.json`: `node`, `id`, `layer`,
   `label`, `parts`, `budget`, `material` (a key of `MATERIAL_LOOKS`), `explode`, `target`, `description`
   (optionally `crop`, `remesh_mm`, `coronary_group`, `territory`).
2. `./.venv/Scripts/python anatomy/build.py` — fetch, build, optimisation, manifest and focus camera are automatic.
3. If the node is part of the viewer contract, add it to `docs/CONTRACTS.md` §6.2 and to `CONTRACT_LAYERS` in
   `scripts/verify_glb.py`. A new coronary vessel also needs a line in `TOPOLOGY` in
   `scripts/extract_centerlines.py` (vessel id + parent) and, if it perfuses myocardium, a `coronary_group`.
4. New layers are declared in the config's `layers` list (they become `Layer_*` empties).
