# CardioTwin anatomy pipeline

Reproducible, scripted pipeline that turns **BodyParts3D** anatomical meshes into the web assets behind
CardioTwin's 3D viewer:

| Output | What it is |
| --- | --- |
| `frontend/public/anatomy/cardiotwin_anatomy.glb` | 41 named anatomical nodes under 7 `Layer_*` groups (CONTRACTS §6.2 + v1.1 additive nodes), 396,916 triangles, baked PBR textures (WebP, 4.4 MB, 123 MiB on the GPU), **9.4 MB** (meshopt) |
| `frontend/public/anatomy/manifest.json` | Layers, structures (with FMA id, definition, clinical relevance, provenance), SCCT segment table, vein table, attribute docs, model-target mapping, explode vectors, camera presets (§6.3, §7.1) |
| `frontend/public/anatomy/vessels.json` | Coronary centrelines, proximal → distal, with lumen radius and SCCT labels; labelled cardiac-vein centrelines (§6.4, §7.1) |
| `docs/media/renders/*.jpg`, `heart_turntable.mp4` | Cycles portfolio renders, an EEVEE preview (`web_preview.jpg`) and a three.js capture (`web_preview_three.jpg`) of the published GLB |

What is BodyParts3D, what is derived and what is synthesised (aortic root, aorto-mitral curtain and valve, the coronary
tree and cardiac veins designed on the heart, epicardial fat) is listed in [`docs/anatomy/SYNTHESIS.md`](../docs/anatomy/SYNTHESIS.md); the anatomical reference and its checks
are [`docs/anatomy/REFERENCE.md`](../docs/anatomy/REFERENCE.md) and [`checks/`](checks/) (`gap_report.md`).

![hero](../docs/media/renders/hero_heart.jpg)

## Quick start

```bash
./.venv/Scripts/python anatomy/build.py             # fetch → synth → blender → centrelines → bake → optimise → verify → manifest → explode (~5 min)
./.venv/Scripts/python anatomy/build.py --renders   # … plus the Cycles renders (GPU recommended)
./.venv/Scripts/python -m pytest anatomy            # geometry utilities, centreline graphs, asset contracts, mesh QA
./.venv/Scripts/python anatomy/checks/measure_model.py --markdown gap.md --json gap.json   # 73 reference checks (~4 min)
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
| 1b | Synthesis (`synthesize.py` with `vascular.py`, `coronary.py`, `veins.py`) | `./.venv/Scripts/python anatomy/scripts/synthesize.py` | `anatomy/build/synth/SYN_*.ply`, `coronary_centerlines.json`, `vein_centerlines.json`, `synth_report.json` |
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
aorto-mitral curtain and valve, the coronary arteries, the cardiac veins and the epicardial fat are synthesised on the
BodyParts3D heart (the coronaries and veins follow the course of the BodyParts3D branches), the ascending aorta and
heart wall around the root are derived (see [`docs/anatomy/SYNTHESIS.md`](../docs/anatomy/SYNTHESIS.md)).

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
  decimation; mean surface shift 0.3 mm, coronary centrelines stay within 0.1 mm of the epicardium) and the
  pectorals 10 iterations before decimation (`"taubin": {"pre", "post"}` per node in the config). The build
  fails if a heart half cannot be capped (a sign of over-smoothed thin wall touching itself on the cut plane).
* **Decimation** — quadric collapse to the per-node budget, then smooth shading with corner-angle-weighted normals;
  edges folding more than 75° (thin-wall rims at vessel and valve openings, cap edges) are split sharp so two
  opposite surfaces are never averaged into a dark seam. (Face-area weighting was dropped: on the decimated wall it
  inverted ~4 % of vertex normals against their faces.) The swept coronary tubes are generated within their budgets
  (only the acute-marginal set is collapsed by 1.5 %); the cardiac-vein tree is swept with coarser rings so its 0.25 mm remesh fits the budget, and
  crumbs the remesh leaves at sub-voxel tips are dropped. Collapse slits and edges shared by three faces that
  decimation leaves on thin wall (≤ 19 vertices) are healed before each heart half is capped.
* **Costal cartilages** — the individual cartilages of ribs 1–7 (FMA) plus the fused ribs 8–10 costal-margin sets
  (`BP24`/`BP28`); the two sets do not overlap (only the rib-7 joint touches).
* **Synthesised and derived parts** — `SYN_*` parts from `scripts/synthesize.py` (heart wall yielding round the moved
  root, rounded ascending aorta, aortic root with sinuses, aortic valve, aorto-mitral curtain, the nine coronary nodes,
  cardiac-vein tree) are read from `build/synth/` like source parts; the cardiac veins are voxel-remeshed at 0.25 mm
  into one lumen.
* **Epicardial fat** — built on the decimated heart wall before it is opened: a groove bed whose surface rises to
  0.6 r above the axis of each AV-groove (LM, pCx, RCA, CS, GCV, SCV) and interventricular (LAD, PDA, AIV, MCV) vessel
  (at least 2.6 / 1.6 mm thick), a narrow bed along branch arteries of radius ≥ 0.6 mm, none on thinner twigs or lone
  veins; falling off across the groove, thinning towards the apex, softly lobulated, sunk 1 mm into the myocardium,
  voxel-remeshed (0.45 mm), then split with the same plane as the wall (`EpicardialFat_Anterior` / `_Posterior`).
* **Collisions** — display-only neighbours yield to the structures they intersect (`collisions` in the config): a
  two-sided test (neighbour vertices inside a master, and master vertices inside a coarse neighbour) moves the
  neighbour along the surface normal and spreads the dent smoothly; the diaphragm is lowered 4 mm as a whole.
* **Pulmonary distances** — `_DIST_HEART` (geodesic distance from the pulmonary valve / left-atrial ostia) and
  `_DIST_HILUM` (signed geodesic distance from the lung entry, > 0 inside the lungs) on both pulmonary trees.
* **UVs** — Smart UV projection (66°) on every non-coronary node for the baked textures.

### Triangle budget (total 396,916 in the GLB ≤ 400,000)

| Node | Layer | Source | Source tris | Final tris |
| --- | --- | --- | ---: | ---: |
| `Skin_Torso` | skin | FMA7163 (outer shell, cropped) | 23,002 | 12,498 |
| `Pectoralis_L` | muscle | sternocostal + clavicular parts | 41,986 | 5,000 |
| `Pectoralis_R` | muscle | sternocostal + clavicular parts | 41,758 | 5,000 |
| `Ribs_L` | skeleton | 12 ribs | 381,430 | 15,498 |
| `Ribs_R` | skeleton | 12 ribs | 374,274 | 15,498 |
| `CostalCartilage` | skeleton | 14 FMA cartilages + BP24/BP28 | 100,898 | 9,000 |
| `Sternum` | skeleton | manubrium, body, xiphoid | 35,884 | 5,000 |
| `Clavicle_L` | skeleton | FMA13323 | 5,140 | 2,998 |
| `Clavicle_R` | skeleton | FMA13322 | 5,112 | 3,000 |
| `Spine_Thoracic` | skeleton | T1–T12 | 97,394 | 16,000 |
| `Lung_L` | lungs | 2 lobes | 84,920 | 12,000 |
| `Lung_R` | lungs | 3 lobes | 119,366 | 13,000 |
| `Trachea_Bronchi` | lungs | trachea + bronchial tree | 125,240 | 6,500 |
| `Oesophagus` | lungs | FMA7131 (thoracic part) | 2,492 | 2,492 |
| `Diaphragm` | diaphragm | FMA13295 (lowered 4 mm) | 210,666 | 6,500 |
| `Heart_Wall_Anterior` | heart | `SYN_HeartWall` (FMA7274 yielding round the root), opened | 306,212 | 53,498 ¹ |
| `Heart_Wall_Posterior` | heart | `SYN_HeartWall` (FMA7274 yielding round the root), opened | 306,212 | 55,016 ¹ |
| `Valve_Mitral` | heart | FMA7235 + aorto-mitral curtain | 22,658 | 5,000 |
| `Valve_Tricuspid` | heart | FMA7234 | 47,260 | 5,000 |
| `Valve_Pulmonary` | heart | FMA7246 | 18,200 | 3,000 |
| `Valve_Aortic` | heart | synthesised (3 cusps) | 6,144 | 3,000 |
| `Papillary_Muscles` | heart | 5 parts | 16,404 | 6,000 |
| `GreatVessel_Aorta` | heart | synthesised root, rounded ascending, arch, descending | 32,538 | 12,000 |
| `GreatVessel_Aorta_ArchBranches` | heart | brachiocephalic trunk, R CCA, R subclavian, L CCA, L subclavian | 11,826 | 5,000 |
| `GreatVessel_PulmonaryArtery` | heart | FMA66326 (dense near the trunk) | 116,948 | 12,000 |
| `GreatVessel_PulmonaryVeins` | heart | FMA66643 | 72,548 | 7,000 |
| `GreatVessel_SVC` | heart | FMA4720 | 1,532 | 1,532 |
| `GreatVessel_SVC_BrachiocephalicVeins` | heart | R / L brachiocephalic, internal jugular and subclavian stumps | 6,412 | 5,000 |
| `GreatVessel_IVC` | heart | FMA10951 | 5,322 | 3,000 |
| `CardiacVeins` | heart | synthesised CS, GCV/AIV, MCV, PVLV, LMV, SCV, ACV (one lumen) | 26,332 | 26,794 |
| `EpicardialFat_Anterior` | heart | synthesised groove fat (opened) | 541,672 | 7,816 ² |
| `EpicardialFat_Posterior` | heart | synthesised groove fat (opened) | 541,672 | 11,200 ² |
| `Coronary_LM` | coronary | synthesised (designed on the heart) | 308 | 308 |
| `Coronary_LAD` | coronary | synthesised (designed on the heart) | 11,528 | 11,528 |
| `Coronary_LAD_Septal` | coronary | synthesised (designed on the heart) | 2,428 | 2,428 |
| `Coronary_LCX` | coronary | synthesised (designed on the heart) | 5,800 | 5,800 |
| `Coronary_RCA` | coronary | synthesised (designed on the heart) | 4,652 | 4,652 |
| `Coronary_RCA_Marginal` | coronary | synthesised (designed on the heart) | 9,648 | 9,500 |
| `Coronary_RCA_PDA` | coronary | synthesised (designed on the heart) | 5,720 | 5,720 |
| `Coronary_RCA_PL` | coronary | synthesised (designed on the heart) | 3,984 | 3,984 |
| `Coronary_RCA_Septal` | coronary | synthesised (designed on the heart) | 1,264 | 1,264 |

¹ The wall is decimated as one mesh to 102k triangles; opening it adds the split and cap triangles.
² Both halves come from one 0.45 mm remeshed shell, decimated to the sum of the two budgets before the split.

## Opening the heart

The long axis runs from the **apex** — the most left-anterior-inferior heart-wall vertex, 4.5 mm from the distal
LAD — to the **base centre** (centroid of the mitral and tricuspid valves). The heart wall is bisected by the plane
that contains this axis and faces anteriorly (normal = anterior direction orthogonalised against the axis; glTF
`(−0.445, 0.232, 0.865)`), i.e. a long-axis section through both ventricles. Each half is **capped**, so the cut
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
renormalised, tilt-clamped to 60° and stored **lossless** — or dropped when its 99th-percentile tilt is under 5° (8-bit
noise only); one ORM map (occlusion R, roughness G) near-lossless — or replaced by a roughness factor when both channels
are uniform. 2048² colour / 1024² normal on the heart walls, 1024–256² elsewhere: **4.4 MB of WebP, 123.2 MiB on the
GPU** (RGBA8 + mips; the build fails above 128 MiB). The wet serous look goes in as `KHR_materials_clearcoat` (factor
0.22–0.35) and each material's `extras` carry `ct_mean_rgb` (mean baked colour) and `ct_texture_priority` (upload
order: heart walls and fat first). It writes `_SEGMENT` / `_VEIN` / `_ARCLEN`, copies the territory weights to
`_TERRITORY` (unorm8 VEC3, so a viewer can drop `COLOR_0` from its albedo path), reorders vertex caches, quantises
`NORMAL` (octahedral 8-bit via meshopt filters), `TEXCOORD_0` (14-bit) and `COLOR_0` (8-bit RGB) and compresses every
buffer with `EXT_meshopt_compression`. It deliberately **does not** quantise `POSITION` (KHR_mesh_quantization
would fold dequantisation into node matrices, breaking `node.scale` and explode offsets), join, flatten, instance or
deduplicate materials. It fails if any node name, transform or hierarchy changes, re-reads its output to check
territory weights and positions, and writes `anatomy/build/optimize_report.json` (bytes, SHA-256, GPU MiB) and
`bake/texture_report.json` (per-map sizes, tilts, mean colours), which `make_manifest.py` copies into the manifest. The
centreline stage runs first because `_ARCLEN` / `_SEGMENT` / `_VEIN` come from `vessels.json`.

## Coronary centrelines (`vessels.json`)

The coronary tree is designed on this heart by `scripts/coronary.py` (with `scripts/vascular.py`), so its centrelines
are exact rather than skeletonised: a voxel signed-distance field of the heart wall (0.5 mm) gives the epicardium, the
mitral and tricuspid hinge rings are fitted exactly as `checks/measure_model.py` fits them, and the AV grooves are
traced as the first exit from the myocardium along each ring plane. The left main leaves its ostium on the moved root
and runs 10–13 mm leftwards behind the pulmonary trunk to the anterior end of the left AV groove; the circumflex
follows the mitral hinge ring round the obtuse margin; the LAD, its diagonals and RV branches follow the BodyParts3D
branch courses re-seated on the epicardium; the RCA runs in the right AV groove from an anterior take-off to the crux
(no proximal loop) with a conus branch, a sinus-node branch, acute marginals, the PDA and posterolateral branches; three
septal perforators leave the LAD and three the PDA at 55–95° and run through the mid-septum. Every point is seated at
radius + 0.45–1.0 mm off the epicardium; calibres follow the SCCT / MDCT reference diameters with a power-law taper
(LM 4.3 → 4.0 mm, LAD 3.9 → 1.3, LCX 3.3 → 1.9, RCA 3.3 → 2.4; branches 1–2.2 mm narrowing to 0.5–1.0 mm) and tubes are
swept with rotation-minimising frames. `extract_centerlines.py` converts `build/synth/coronary_centerlines.json` to the
glTF frame (0.8 mm spacing; an attached branch starts exactly on its parent's centreline) and labels SCCT 2014 segments
(pCx / LCx split at the OM1 origin; RCA 1 / 2 / 3 up to the acute margin and the crux). The lumen radius is the swept radius.

Lengths: LM 17 mm, LAD tree 484 mm (14 segments), LCX 240 mm (trunk 74 mm to OM1 / OM2), RCA 241 mm (trunk 171 mm, crux at
140 mm), acute marginals 463 mm, PDA 256 mm, posterolateral 192 mm, septal perforators 100 + 53 mm; 2,625 points.
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
intersecting triangles: 181 pairs already interpenetrate at rest (coronaries embedded in the epicardium, bronchi in
the lungs) and may keep doing so, but no pair may intersect more at t = 1 than at rest. The previous layout failed
with 9 collisions (lungs through the rib cage, costal cartilages through the LAD and marginal branch, the
pulmonary trees through each other and the SVC); the current one has none. While sliding (0 < t < 1) the
interleaved intrapulmonary vessel and bronchial trees still pass through neighbouring layers — the viewer's
staggered peel windows hide most of that.

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
  8 SCV); `vessels.json` `veins` holds the labelled centrelines (ordered from the drainage end outward). The CS opens
  flush into the RA 2 mm from the tricuspid hinge; the anterior cardiac veins open into the RA wall.
* **Territories**: `_TERRITORY` (three.js `_territory`, unorm8 VEC3) repeats `COLOR_0`'s LAD / LCX / RCA weights under a
  name no glTF viewer multiplies into the albedo; read it and ignore `color`.
* **Clearcoat**: materials carry `KHR_materials_clearcoat` (0.22–0.35); a viewer adding its own wet look should keep the
  total at or below ~0.3 so the tissue does not read as plastic.
* **Pulmonary trees**: `_DIST_HEART` / `_DIST_HILUM` (three.js: `_dist_heart` / `_dist_hilum`) let the viewer keep the trunk, main
  branches and venous ostia (`_DIST_HILUM < ~0.02`) and fade the intrapulmonary tree.
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
same materials the bake stage turns into the web textures). The anatomical shots paint the coronary arteries atlas red
(`#9f2a22`; veins blue, fat golden); the data shots (`territories`, `xray`) use the viewer's risk ramp, read from
`frontend/src/theme/risk.ts` and interpolated in OKLab like the app, for an example profile (LAD p = 0.84, LCX 0.5, RCA
0.16). Light is a large soft key, a cool rim, a broad fill and a warm floor bounce in a dark grey-blue studio dome.

* `hero_heart` — left-anterior-oblique view of the heart, fat, great vessels and arch stumps.
* `heart_posterior` — from behind and below: the diaphragmatic surface with the crux, PDA, MCV and coronary sinus; the
  apex points to the lower left.
* `coronary_detail` — the anterior interventricular groove: LAD, diagonal, AIV in the groove fat.
* `open_heart` — the long-axis cut opened like a book: the anterior half is turned 180° about the vertical line of the
  cutting plane and laid beside the posterior half, so both cut faces are coplanar and face the camera.
* `four_chamber` — the heart cut in the plane through the apex and the mitral and tricuspid valve centres (render-only
  copies: the two published halves are welded back without their caps, re-cut and capped), the posterior part seen from
  the front: both atria and ventricles, the septa, the AV valves with chordae and papillary muscles.
* `exploded_torso` — the manifest's exploded layout at t = 1 (skin faded, intrapulmonary trees trimmed with
  `_DIST_HILUM`); the costal cartilages are split at the sternal midline so each half travels with its ribs.
* `xray`, `territories`, `turntable` — the fresnel torso with emissive flow beads, the territory map anterior and
  posterior-inferior, and a 360° turn of the heart.

Close-ups stage the heart on its own (the pulmonary-vein tree and IVC hidden, the pulmonary artery clipped near its
bifurcation, the descending aorta cut behind the atria) using render-only copies — the published asset is never
modified. `render_web_preview.py` imports the **published** GLB (decoded losslessly by `scripts/decode_for_blender.mjs`)
into an empty scene and renders it with EEVEE from the hero camera using only its baked textures and the risk ramp on
the coronaries, as the viewer's Realistic look (`web_preview.jpg`); `scripts/web_preview_three.mjs` serves the repository
and opens `scripts/web_preview_three.html` in headless Chrome / Edge, which loads the GLB with the app's own three.js
(GLTFLoader + MeshoptDecoder, ACES, a neutral room environment) from the manifest's heart camera and saves
`web_preview_three.jpg` — what any glTF 2.0 viewer shows. The full set renders in about 1 minute on an RTX 4070 laptop GPU
plus 2 minutes for the turntable.

## Adding a new anatomical structure

1. Find the part(s) in `parts_list_e.txt` and add a node entry to `config/anatomy.json`: `node`, `id`, `layer`,
   `label`, `parts`, `budget`, `material` (a key of `MATERIAL_LOOKS`), `explode`, `target`, `description`
   (optionally `crop`, `remesh_mm`, `coronary_group`, `territory`).
2. `./.venv/Scripts/python anatomy/build.py` — fetch, build, optimisation, manifest and focus camera are automatic.
3. If the node is part of the viewer contract, add it to `docs/CONTRACTS.md` §6.2 and to `CONTRACT_LAYERS` in
   `scripts/verify_glb.py`. A new coronary vessel also needs a line in `TOPOLOGY` in
   `scripts/extract_centerlines.py` (vessel id + parent) and, if it perfuses myocardium, a `coronary_group`.
4. New layers are declared in the config's `layers` list (they become `Layer_*` empties).
