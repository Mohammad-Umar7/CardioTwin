# `three/fx` — scene effects layer

Everything in the 3D view that is *light rather than anatomy*: coronary blood-flow particles, the per-beat
pulse wave, the ignition sweep, the atmosphere and the post-processing chain. It never edits the anatomy's
scene graph or materials; it reads node transforms and shares the anatomy's beat uniforms.

Mounted once inside the R3F `<Canvas>` by `SceneCanvas.tsx` (`<SceneFX />`, which **replaces**
`stage/PostFX` — the post chain lives here now; do not mount a second `EffectComposer`).

```
SceneFX.tsx          root: driver, caption, atmosphere, GLB flow layer (particles + overlay), post chain
FxDriver.tsx         useFrame(−1): the ONLY writer of `fxFrame` and the one ticker of `cardiacClock`
cardiacClock.ts      shared heartbeat clock (singleton) + phase lock to the heart's beat scale
cardiacCycle.ts      pure maths: diastole-dominant coronary flow waveform, its exact integral, pulse front
fxState.ts           per-frame shared state (`fxFrame`), risk → flow parameters, ignition envelope/trigger
centreline.ts        vessels.json → arc lengths (= GLB `_ARCLEN`), ostium→tip paths, uniform resampling, packing
particles.ts         particle allocation over paths (deterministic), density maths
sceneNodes.ts        live node tracking: p_now = node.matrixWorld · restWorld⁻¹ · p_rest
flowMaterial.ts      instanced streak shader (all positioning in the vertex shader)
FlowParticles.tsx    one instanced draw call, uniforms refreshed in onBeforeRender
overlayMaterial.ts   additive `_ARCLEN` overlay: pulse, ignition, tier-C dashes
VesselOverlay.tsx    finds meshes with `_ARCLEN`, draws an additive twin sharing their geometry
Atmosphere.tsx       backlight glow behind the heart + dust motes
FXComposer.tsx       SelectiveBloom (coronary tree only) → Neutral tone mapping → Vignette → SMAA, tiers A/B
bloomSelection.ts    which meshes may bloom (every mesh under a `Coronary_*` node), mask tolerance
FlowCaption.tsx      "Illustrative flow — not a haemodynamic simulation" note on a scrim, shown while flow is visible
caption.ts           caption wording, its one fixed spot (canvas centre, above the toolbar row), visibility rule
```

## For the 3D layer (`anatomy/`)

* **One clock.** `cardiacClock` is advanced once per frame (`tick(delta, state.clock.elapsedTime)` is
  idempotent per frame key). `useBeat` in `anatomy/useHeartbeat.ts` ticks the same clock, so the myocardium,
  the particles' diastolic surge and the pulse wave share one phase. Until a heart runs off another phase,
  `observeHeartScale(Layer_Heart.scale.x)` phase-locks the clock to it (±15 % rate slew; no-op when locked).
* **Node transforms are the contract.** Particles follow `node.matrixWorld` of every vessels.json node
  (`Coronary_*`), measured against the pristine glTF's rest pose. Anything you do to those nodes — layer and
  structure explode, `rides`, hinges, the affine beat matrix — is followed automatically. Non-affine beat
  terms must go through `BEAT_UNIFORMS` / `BEAT_VERTEX_PARS` (the particle and overlay shaders include them,
  coronaries in `BEAT_MODE.atrial`).
* **Hidden nodes hide their flow** (`visible` anywhere up the chain).
* **`sceneRuntime` (stage/sceneRuntime.ts) is read, never written:** the ignition waits for
  `assembly.igniteAt` (cold-load fly-in), flow and pulse multiply by `nodes[name].solid` (isolate / ghost /
  assembly dissolve), and both clip with `sectionPlanes` (a cut heart never shows flow in the removed half).
* **Selective bloom** marks every coronary mesh with render layer `BLOOM_LAYER` (11) — a layer bit, nothing
  else. Keep other override-material passes off that layer.
* The fx objects are named `FX_*`, flagged `userData.ctFx`, stay on layer 0 only, and never raycast. The
  particle quad is stored at ±1e-4 so an override-material pass that does draw it costs nothing.
* R3F resets `state.clock.elapsedTime` to 0 whenever the frame-loop mode changes (always ↔ demand ↔ never);
  never time envelopes against it (the driver keeps its own monotonic time).

## Behaviour

| Effect | What it shows | Where the numbers come from |
| --- | --- | --- |
| Flow particles | Direction of flow (ostium → distal), diastolic surge / systolic near-stall, streak length ∝ instantaneous speed | `cardiacCycle.coronaryFlowSpeed` (mean 1, ≈ 91 % of flow in diastole; RCA phasicity 0.6), `BASE_FLOW_SPEED` 0.3 u/s |
| Risk coding of the flow | Higher P(stenosis) → sparser (≥ 50 %), slower (≥ 55 %), warmer (tint toward the Ember LUT colour of p) | `riskFlowParams`; off while no estimate is shown (pending/error/LM) |
| Pulse wave | A crest + wake in the vessel's own hue (never white) running root → tip once per beat, launched with the diastolic surge | `pulseFront(phase)`: 42 % of the cycle, ease-out, arc length 0 → 1.25 |
| Ignition | Trace-colour sweep ostia → tips, then afterglow settles; flow is gated behind the front | fires when a prediction lands for a NEW case (patient or custom), or after 1.5 s without any estimate; `replayIgnition()` |
| Atmosphere | Cool backlight behind the heart (+≈ 6 sRGB levels), 200–320 dust motes at 3–12 % | never risk-coloured |

**Design note.** DESIGN_SYSTEM §7.4 originally specified achromatic, identical-speed flow. The flow here echoes
the model's per-vessel estimate (a product decision for this build); it is deliberately gentle, never the
only carrier of risk, switchable with `FLOW_RISK_CODING = 0`, and always captioned as illustrative.

## Tiers, motion, budget

| | A | B | C | D |
| --- | --- | --- | --- | --- |
| Particles (instances) | 4096 | 2048 | 0 → arc-length dashes on the overlay | – |
| Post | Selective bloom, 5 levels ½ res | Selective bloom, 4 levels ½ res | none (renderer Neutral TM) | – |
| Dust | 320 | 200 | – | – |

* Reduced motion / Calm mode: no particles, pulse, ignition or dust (the backlight is static).
* Flow toggle (`viewerStore.bloodFlow`, key F) fades particles and dashes over ≈ 300 ms.
* Draw calls: particles 1, overlay ≤ 9 (only meshes the pulse/sweep can reach this frame), atmosphere 2.
* GPU timer queries (RTX 4070 laptop, tier A, 1800×1030 at DPR 1.25, 7 interleaved runs, medians): whole
  frame 2.97 ms with the fx layer on vs 2.97 ms with it off — below measurement noise; the particle draw is a
  16 k-vertex instanced pass, the selective-bloom mask ~30 k triangles of depth. Per frame the CPU uploads
  ~60 uniforms; nothing is re-uploaded per particle.
* Bloom is masked to the coronary tree by a depth-only pass of layer 11 (`SelectiveBloomEffect`), so the
  glossy myocardium's specular highlights never glow; the flow, pulse and ignition light that lands on a
  vessel does.

## Tests

`cardiac.test.ts` (waveform mean/continuity/diastolic share, exact frame-rate independent advance, pulse
front, clock rate rules and phase lock), `centreline.test.ts` (arc length = GLB `_ARCLEN` definition,
fold-free branch joins, uniform resampling, packing + CPU reference sampler, allocation, the published
vessels.json), `fxState.test.ts` (risk → flow monotonicity and neutrality, ignition envelope and trigger).
