# Anatomy asset contract 1.1 (addendum to `docs/CONTRACTS.md` §6–7)

Version **1.1.0** of `frontend/public/anatomy/` (`manifest.version`, glTF `asset.extras.ct_contract = "1.1"`). Every
change is **additive**: the 41 node names, the 7 `Layer_*` groups, the node transforms and hierarchy, every existing
manifest field and every existing attribute keep their names and meaning. A 1.0 viewer loads 1.1 unchanged.

## GLB

| Item | 1.0 | 1.1 |
| --- | --- | --- |
| Size / triangles | 8.3 MB / 399,683 | 9.4 MB / 396,916 (budget 16 MB / 400k) |
| Extensions | `EXT_meshopt_compression`, `EXT_texture_webp`, `KHR_mesh_quantization` | + `KHR_materials_clearcoat` (factor 0.22–0.35 per tissue) |
| Textures | baseColor / normal / ORM WebP on every textured node | baseColor lossy WebP; normal lossless (dropped when flat); ORM near-lossless (replaced by a roughness factor when uniform); 4.4 MB, 123.2 MiB on the GPU (budget 128 MiB) |
| Normals | 10-bit | octahedral 8-bit (meshopt filter) |
| Heart-wall attributes | `COLOR_0` = (w_LAD, w_LCX, w_RCA) | + `_TERRITORY` (unorm8 VEC3, the same weights; three.js `_territory`) |
| `_VEIN` codes | 1 CS, 2 GCV, 3 AIV, 4 MCV, 5 PVLV, 6 ACV | + 7 LMV (left marginal vein), 8 SCV (small cardiac vein) |
| `_SEGMENT` values | 1–9, 11, 12, 16 | 1–14, 16 (SCCT 2014; 15, 17, 18 absent in this right-dominant heart) |
| Material `extras` | `ct_baked`, `ct_look` | + `ct_mean_rgb` (mean baked colour, sRGB hex), `ct_texture_priority` (upload order, 0 = first) |
| Asset `extras` | — | `ct_build`, `ct_contract` |

Geometry that changed meaning without changing name: the coronary arteries and cardiac veins are now synthesised on
the heart (courses, calibres and SCCT labels follow the reference, see [`SYNTHESIS.md`](SYNTHESIS.md));
`Valve_Mitral` includes the aorto-mitral curtain; the aortic root moved (3, 10, −10) mm.

## manifest.json

New top-level fields: `glb_bytes`, `glb_sha256`, `textures` (`gpu_mib`, `webp_mb`, `priority` — node names in upload
order). New per-structure fields: `fma_id` (verified FMA id), `realistic_color` (mean baked colour of the node's
texture, a fallback tint for a viewer that does not load textures). New per-segment fields in `segments[]`:
`length_mm` (main path) and `total_branch_length_mm`. `veins[]` lists the eight vein codes. `attributes` documents
`_TERRITORY`. The `Trachea_Bronchi` explode vector changed from `[0, 0.3, -0.8]` to `[0, 0.3, -0.65]` (the airway no
longer passes through the left lung at t = 1).

## vessels.json

Unchanged schema. An attached segment's first point now lies exactly on a point of its parent's centreline.
`veins.codes` gains `LMV: 7` and `SCV: 8`, so `veins.segments[].code` may be 7 or 8.

## For the viewer (hand-offs)

* Read `_TERRITORY` for the territory overlay and never multiply `COLOR_0` into the albedo.
* Keep the total wet look ≤ ~0.3 clearcoat (the GLB already carries 0.22–0.35).
* Upload textures in `textures.priority` order; use `realistic_color` as the tint of an untextured fallback.
* `docs/CONTRACTS.md` §7 should reference this addendum (that file is outside the anatomy pipeline's scope).
