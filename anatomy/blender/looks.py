"""Photoreal tissue looks (Cycles node materials) shared by the texture bake and the portfolio renders.

Every look is a Principled BSDF driven by procedural textures in *physical* units (scene units: 1 u = 10 cm),
so the same material renders in Cycles and bakes into the web textures (``bake_textures.py``):

* ``base``  — albedo (atlas convention: systemic arteries / pulmonary veins red, systemic veins / cardiac veins /
  pulmonary artery blue; coronary arteries are recoloured by the risk ramp in the app and in the renders);
* ``rough`` — roughness (wet tissue: low, with variation so highlights break up instead of reading as plastic);
* ``height`` — micro-relief (fibre striation, fat lobules, bone porosity, cartilage rings) fed to a Bump node;
* ``sss`` / ``coat`` — subsurface scattering and a thin wet clear coat (render only; the web uses base/normal/ORM).

Each builder returns the material and records the sockets that carry base colour and roughness in
``mat["ct_bake"]`` so the baker can re-route them to an emission shader.

Tissue references (colour conventions): docs/anatomy/REFERENCE.md §7.
"""
from __future__ import annotations

import math

import bpy
from mathutils import Vector

HEART_FRAME = "CT_HeartFrame"


def srgb(h: str) -> tuple[float, float, float]:
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


class G:
    """Tiny node-graph helper."""

    def __init__(self, name: str):
        self.mat = bpy.data.materials.new(name)
        if not self.mat.node_tree:
            self.mat.use_nodes = True
        self.nt = self.mat.node_tree
        self.nt.nodes.clear()
        self.out = self.n("ShaderNodeOutputMaterial")
        self.bsdf = self.n("ShaderNodeBsdfPrincipled")
        self.link(self.bsdf.outputs["BSDF"], self.out.inputs["Surface"])
        self.coords: dict[str, bpy.types.NodeSocket] = {}

    def n(self, kind: str, **props):
        node = self.nt.nodes.new(kind)
        for k, v in props.items():
            setattr(node, k, v)
        return node

    def link(self, a, b):
        self.nt.links.new(a, b)

    def set(self, **inputs):
        for k, v in inputs.items():
            self.bsdf.inputs[k.replace("_", " ")].default_value = v

    # --- coordinates -------------------------------------------------------------------------------
    def obj(self) -> bpy.types.NodeSocket:
        if "obj" not in self.coords:
            self.coords["obj"] = self.n("ShaderNodeTexCoord").outputs["Object"]
        return self.coords["obj"]

    def heart(self) -> bpy.types.NodeSocket:
        """Coordinates in the heart frame (Z = apex -> base long axis), shared by both heart halves."""
        if "heart" not in self.coords:
            tc = self.n("ShaderNodeTexCoord")
            frame = bpy.data.objects.get(HEART_FRAME)
            if frame is not None:
                tc.object = frame
            self.coords["heart"] = tc.outputs["Object"]
        return self.coords["heart"]

    def world(self) -> bpy.types.NodeSocket:
        if "world" not in self.coords:
            self.coords["world"] = self.n("ShaderNodeNewGeometry").outputs["Position"]
        return self.coords["world"]

    # --- textures ------------------------------------------------------------------------------------
    def noise(self, vec, scale, detail=4.0, rough=0.55, distortion=0.0, dims="3D"):
        t = self.n("ShaderNodeTexNoise")
        t.noise_dimensions = dims
        self.link(vec, t.inputs["Vector"])
        t.inputs["Scale"].default_value = scale
        t.inputs["Detail"].default_value = detail
        t.inputs["Roughness"].default_value = rough
        t.inputs["Distortion"].default_value = distortion
        return t.outputs["Fac"]

    def voronoi(self, vec, scale, feature="F1", out="Distance", randomness=1.0, smooth=None):
        t = self.n("ShaderNodeTexVoronoi")
        t.feature = feature
        self.link(vec, t.inputs["Vector"])
        t.inputs["Scale"].default_value = scale
        t.inputs["Randomness"].default_value = randomness
        if smooth is not None and "Smoothness" in t.inputs:
            t.inputs["Smoothness"].default_value = smooth
        return t.outputs[out]

    def wave(self, vec, scale, distortion=2.0, detail=3.0, direction="X", profile="SIN"):
        t = self.n("ShaderNodeTexWave")
        t.wave_type = "BANDS"
        t.bands_direction = direction
        t.wave_profile = profile
        self.link(vec, t.inputs["Vector"])
        t.inputs["Scale"].default_value = scale
        t.inputs["Distortion"].default_value = distortion
        t.inputs["Detail"].default_value = detail
        t.inputs["Detail Scale"].default_value = 1.5
        return t.outputs["Fac"]

    def math(self, op, a, b=None, clamp=False):
        m = self.n("ShaderNodeMath", operation=op)
        m.use_clamp = clamp
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                m.inputs[i].default_value = v
            else:
                self.link(v, m.inputs[i])
        return m.outputs[0]

    def vmath(self, op, a, b=None):
        m = self.n("ShaderNodeVectorMath", operation=op)
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (tuple, list, Vector)):
                m.inputs[i].default_value = v
            else:
                self.link(v, m.inputs[i])
        return m.outputs["Vector"] if op not in ("DOT_PRODUCT", "LENGTH", "DISTANCE") else m.outputs["Value"]

    def ramp(self, fac, stops):
        r = self.n("ShaderNodeValToRGB")
        self.link(fac, r.inputs["Fac"])
        els = r.color_ramp.elements
        while len(els) > 1:
            els.remove(els[-1])
        for i, (pos, col) in enumerate(stops):
            e = els[0] if i == 0 else els.new(pos)
            e.position = pos
            e.color = (*col, 1.0) if len(col) == 3 else col
        return r.outputs["Color"]

    def maprange(self, v, a, b, c=0.0, d=1.0, clamp=True):
        m = self.n("ShaderNodeMapRange")
        m.clamp = clamp
        self.link(v, m.inputs["Value"])
        m.inputs["From Min"].default_value = a
        m.inputs["From Max"].default_value = b
        m.inputs["To Min"].default_value = c
        m.inputs["To Max"].default_value = d
        return m.outputs["Result"]

    def mixc(self, fac, a, b, blend="MIX"):
        m = self.n("ShaderNodeMix")
        m.data_type = "RGBA"
        m.blend_type = blend
        for sock, v in ((m.inputs["Factor"], fac), (m.inputs[6], a), (m.inputs[7], b)):
            if isinstance(v, (int, float)):
                sock.default_value = v
            elif isinstance(v, tuple):
                sock.default_value = (*v, 1.0) if len(v) == 3 else v
            else:
                self.link(v, sock)
        return m.outputs[2]

    def bump(self, height, strength, distance=0.001, normal=None):
        b = self.n("ShaderNodeBump")
        b.inputs["Strength"].default_value = strength
        b.inputs["Distance"].default_value = distance
        self.link(height, b.inputs["Height"])
        if normal is not None:
            self.link(normal, b.inputs["Normal"])
        return b.outputs["Normal"]

    # --- outputs ---------------------------------------------------------------------------------------
    def finish(self, *, base, rough, normal=None, coat_normal=True, category: str = ""):
        for key, v in (("Base Color", base), ("Roughness", rough)):
            if isinstance(v, (int, float, tuple)):
                self.bsdf.inputs[key].default_value = (*v, 1.0) if isinstance(v, tuple) and len(v) == 3 else v
            else:
                self.link(v, self.bsdf.inputs[key])
        if normal is not None:
            self.link(normal, self.bsdf.inputs["Normal"])
            if coat_normal:
                self.link(normal, self.bsdf.inputs["Coat Normal"])
        self.mat["ct_look"] = category
        return self.mat


# =============================================================================================
# Looks
# =============================================================================================
MYO = srgb("#6e1a14")          # deep red-brown ventricular myocardium
MYO_DARK = srgb("#3d0c09")
MYO_LIGHT = srgb("#8f3024")


def myocardium(name="L_Myocardium", tone=1.0):
    """Wet epicardium over red-brown muscle: helical fibre striation (~60 deg helix), fine mottling,
    subsurface scattering and a thin, broken clear coat (visceral pericardium)."""
    g = G(name)
    p = g.heart()
    sep = g.n("ShaderNodeSeparateXYZ")
    g.link(p, sep.inputs[0])
    theta = g.math("ARCTAN2", sep.outputs["Y"], sep.outputs["X"])
    # helical fibre coordinate: arc length around the axis (~R 3.5 cm) + axial term (helix ~ -60 deg)
    w = g.math("ADD", g.math("MULTIPLY", theta, 0.35), g.math("MULTIPLY", sep.outputs["Z"], 1.6))
    comb = g.n("ShaderNodeCombineXYZ")
    g.link(w, comb.inputs["X"])
    g.link(g.math("MULTIPLY", sep.outputs["Z"], 3.0), comb.inputs["Y"])
    fibres = g.wave(comb.outputs[0], 7.0, distortion=7.0, detail=5.0)           # ~4.5 mm fibre bundles, irregular
    fine = g.noise(p, 90.0, detail=3.0, rough=0.6)                               # ~1 mm grain
    mottle = g.noise(p, 9.0, detail=5.0, rough=0.6)                              # patchy subepicardial tone
    base = g.ramp(mottle, [(0.30, MYO_DARK), (0.55, MYO), (0.80, MYO_LIGHT)])
    # the visceral pericardium is smooth and wet: fibres only faintly shine through (colour, gloss, relief)
    base = g.mixc(g.maprange(fibres, 0.35, 0.95, 0.0, 0.07), base, MYO_DARK)
    rough = g.maprange(g.math("ADD", g.math("MULTIPLY", fibres, 0.35), g.math("MULTIPLY", fine, 0.65)), 0.2, 0.8, 0.32, 0.50)
    h = g.math("ADD", g.math("MULTIPLY", fibres, 0.45), g.math("MULTIPLY", fine, 0.55))
    nrm = g.bump(h, 0.10, 0.003)
    g.set(Subsurface_Weight=0.22, Subsurface_Radius=(1.0, 0.22, 0.10), Subsurface_Scale=0.012,
          Coat_Weight=0.30, Coat_Roughness=0.10, Sheen_Weight=0.05, Specular_IOR_Level=0.45)
    return g.finish(base=base, rough=rough, normal=nrm, category="Myocardium")


def fat(name="L_Fat"):
    """Epicardial adipose tissue: glistening yellow lobules (Voronoi domes ~4-5 mm) separated by thin, slightly
    darker and more orange septa, strongly translucent."""
    g = G(name)
    p = g.heart()
    lob = g.voronoi(p, 20.0, "SMOOTH_F1", "Distance", randomness=0.95, smooth=0.35)
    edge = g.voronoi(p, 20.0, "DISTANCE_TO_EDGE", "Distance", randomness=0.95)
    fine = g.noise(p, 70.0, detail=3.0)
    base = g.ramp(lob, [(0.0, srgb("#f6cf5a")), (0.3, srgb("#eab547")), (0.55, srgb("#d9973a")), (0.85, srgb("#b8742e"))])
    base = g.mixc(g.maprange(edge, 0.0, 0.025, 0.22, 0.0), base, srgb("#b86a30"))
    base = g.mixc(g.maprange(fine, 0.3, 0.7, 0.0, 0.12), base, srgb("#fff2b0"))
    dome = g.math("SUBTRACT", 1.0, g.math("POWER", lob, 1.2))
    h = g.math("ADD", g.math("MULTIPLY", dome, 0.9), g.maprange(edge, 0.0, 0.03, 0.0, 0.15))
    nrm = g.bump(g.math("ADD", h, g.math("MULTIPLY", fine, 0.06)), 0.5, 0.004)
    rough = g.maprange(edge, 0.0, 0.05, 0.36, 0.24)
    g.set(Subsurface_Weight=0.55, Subsurface_Radius=(1.0, 0.75, 0.35), Subsurface_Scale=0.025,
          Coat_Weight=0.45, Coat_Roughness=0.06, Specular_IOR_Level=0.55)
    return g.finish(base=base, rough=rough, normal=nrm, category="Fat")


def vessel(name, hexes, *, rough=(0.30, 0.46), stria=0.08, sss=0.25, coat=0.35, scale_long=120.0, category="Vessel"):
    """Vessel wall: atlas colour with adventitial fibre striations along the vessel and fine mottling."""
    g = G(name)
    p = g.obj()
    mott = g.noise(p, 9.0, detail=3.0)
    fine = g.noise(p, scale_long, detail=2.0, rough=0.6, distortion=0.4)
    base = g.ramp(mott, [(0.3, srgb(hexes[0])), (0.5, srgb(hexes[1])), (0.72, srgb(hexes[2]))])
    base = g.mixc(g.maprange(fine, 0.45, 0.8, 0.0, stria * 0.6), base, srgb("#f0e0d8"))
    rough_s = g.maprange(fine, 0.2, 0.8, *rough)
    nrm = g.bump(g.math("ADD", fine, g.math("MULTIPLY", mott, 0.4)), 0.2, 0.002)
    g.set(Subsurface_Weight=sss, Subsurface_Radius=(1.0, 0.35, 0.25), Subsurface_Scale=0.006,
          Coat_Weight=coat, Coat_Roughness=0.12)
    return g.finish(base=base, rough=rough_s, normal=nrm, category=category)


def artery(name="L_Artery"):
    return vessel(name, ("#8f1f1a", "#b0302a", "#c9483c"), category="Artery")


def pulmonary_vein(name="L_PulmonaryVein"):
    return vessel(name, ("#9c2a25", "#bd4038", "#d4594c"), category="PulmonaryVein")


def pulmonary_artery(name="L_PulmonaryArtery"):
    return vessel(name, ("#2c3f86", "#3f5aa6", "#5d78bd"), stria=0.06, category="PulmonaryArtery")


def vein(name="L_Vein"):
    return vessel(name, ("#27306e", "#394a93", "#5465a8"), stria=0.05, sss=0.3, category="Vein")


def cardiac_vein(name="L_CardiacVein"):
    return vessel(name, ("#222a66", "#33428a", "#4c5ea3"), stria=0.04, sss=0.3, coat=0.45, category="CardiacVein")


def coronary(name, color, glow=0.0):
    """Coronary artery for renders: risk colour with a wet, slightly translucent wall."""
    g = G(name)
    p = g.obj()
    fine = g.noise(p, 300.0, detail=2.0)
    nrm = g.bump(fine, 0.05, 0.0005)
    g.set(Subsurface_Weight=0.2, Subsurface_Radius=(1.0, 0.4, 0.3), Subsurface_Scale=0.004,
          Coat_Weight=0.8, Coat_Roughness=0.06, Emission_Color=(*color, 1.0), Emission_Strength=glow)
    return g.finish(base=tuple(color), rough=0.28, normal=nrm, category="Coronary")


def valve(name="L_Valve"):
    """Pale, translucent fibrous leaflets with fine collagen striation."""
    g = G(name)
    p = g.obj()
    fib = g.wave(p, 60.0, distortion=4.0, detail=3.0, direction="Z")
    mott = g.noise(p, 30.0)
    base = g.ramp(mott, [(0.3, srgb("#d8c0a2")), (0.7, srgb("#efe0c8"))])
    base = g.mixc(g.maprange(fib, 0.3, 0.9, 0.0, 0.15), base, srgb("#c9a88a"))
    nrm = g.bump(fib, 0.08, 0.0006)
    g.set(Subsurface_Weight=0.6, Subsurface_Radius=(1.0, 0.75, 0.55), Subsurface_Scale=0.004,
          Coat_Weight=0.5, Coat_Roughness=0.1, Transmission_Weight=0.0)
    return g.finish(base=base, rough=0.32, normal=nrm, category="Valve")


def papillary(name="L_Papillary"):
    return myocardium(name)


def bone(name="L_Bone"):
    """Ivory cortical bone with micro-porosity (fine pits) and faint periosteal mottling."""
    g = G(name)
    p = g.obj()
    pits = g.voronoi(p, 70.0, "F1", "Distance", randomness=1.0)
    mott = g.noise(p, 14.0, detail=5.0)
    grain = g.noise(p, 160.0, detail=2.0)
    base = g.ramp(mott, [(0.25, srgb("#cdbb98")), (0.55, srgb("#e3d5b8")), (0.85, srgb("#efe6d2"))])
    pit = g.maprange(pits, 0.0, 0.18, 1.0, 0.0)
    base = g.mixc(g.math("MULTIPLY", pit, 0.35), base, srgb("#8d7b5c"))
    h = g.math("SUBTRACT", g.math("MULTIPLY", grain, 0.3), g.math("MULTIPLY", pit, 0.7))
    nrm = g.bump(h, 0.3, 0.0015)
    rough = g.maprange(g.math("ADD", pit, grain), 0.2, 1.2, 0.48, 0.72)
    g.set(Subsurface_Weight=0.12, Subsurface_Radius=(1.0, 0.8, 0.6), Subsurface_Scale=0.01, Coat_Weight=0.05)
    return g.finish(base=base, rough=rough, normal=nrm, coat_normal=False, category="Bone")


def cartilage(name="L_Cartilage"):
    g = G(name)
    p = g.obj()
    mott = g.noise(p, 16.0, detail=3.0)
    base = g.ramp(mott, [(0.3, srgb("#b9c6c4")), (0.75, srgb("#dde4df"))])
    nrm = g.bump(g.noise(p, 120.0), 0.06, 0.0005)
    g.set(Subsurface_Weight=0.55, Subsurface_Radius=(0.8, 0.9, 1.0), Subsurface_Scale=0.015,
          Coat_Weight=0.4, Coat_Roughness=0.1)
    return g.finish(base=base, rough=0.3, normal=nrm, category="Cartilage")


def lung(name="L_Lung"):
    """Pink spongy lung: alveolar micro-cells (Voronoi), lobular polygons and faint anthracotic speckle."""
    g = G(name)
    p = g.obj()
    alv = g.voronoi(p, 70.0, "F1", "Distance")
    lobular = g.voronoi(p, 18.0, "DISTANCE_TO_EDGE", "Distance")
    mott = g.noise(p, 6.0, detail=5.0)
    speck = g.noise(p, 60.0, detail=2.0)
    base = g.ramp(mott, [(0.25, srgb("#c96f72")), (0.55, srgb("#e0979a")), (0.8, srgb("#eeb4b2"))])
    base = g.mixc(g.maprange(lobular, 0.0, 0.03, 0.35, 0.0), base, srgb("#8c4a55"))
    base = g.mixc(g.maprange(speck, 0.66, 0.74, 0.0, 0.35), base, srgb("#4a3a3e"))
    h = g.math("ADD", g.math("MULTIPLY", alv, 0.8), g.maprange(lobular, 0.0, 0.03, 0.0, 0.4))
    nrm = g.bump(h, 0.35, 0.001)
    g.set(Subsurface_Weight=0.35, Subsurface_Radius=(1.0, 0.45, 0.4), Subsurface_Scale=0.02,
          Coat_Weight=0.3, Coat_Roughness=0.15, Sheen_Weight=0.15)
    return g.finish(base=base, rough=g.maprange(alv, 0.0, 0.6, 0.35, 0.6), normal=nrm, category="Lung")


def airway(name="L_Airway"):
    """Trachea / bronchi: pale pink wall with C-shaped cartilage rings (~4 mm pitch) along the airway."""
    g = G(name)
    p = g.world()
    rings = g.wave(p, 11.0, distortion=0.4, detail=1.0, direction="Z", profile="SIN")
    mott = g.noise(g.obj(), 12.0)
    base = g.ramp(mott, [(0.3, srgb("#c9a49a")), (0.75, srgb("#e2c7bb"))])
    base = g.mixc(g.maprange(rings, 0.5, 1.0, 0.0, 0.35), base, srgb("#eee6dc"))
    nrm = g.bump(rings, 0.4, 0.002)
    g.set(Subsurface_Weight=0.35, Subsurface_Scale=0.01, Coat_Weight=0.35, Coat_Roughness=0.12)
    return g.finish(base=base, rough=0.38, normal=nrm, category="Airway")


def oesophagus(name="L_Oesophagus"):
    g = G(name)
    p = g.world()
    folds = g.wave(p, 25.0, distortion=3.0, detail=2.0, direction="X")
    mott = g.noise(g.obj(), 10.0)
    base = g.ramp(mott, [(0.3, srgb("#a8645a")), (0.75, srgb("#c98a7a"))])
    nrm = g.bump(folds, 0.2, 0.002)
    g.set(Subsurface_Weight=0.3, Subsurface_Scale=0.01, Coat_Weight=0.35, Coat_Roughness=0.12)
    return g.finish(base=base, rough=0.4, normal=nrm, category="Oesophagus")


def muscle(name="L_Muscle", fibre_dir=(1.0, 0.0, 0.35)):
    """Skeletal muscle: parallel fibre bundles along ``fibre_dir`` under a thin glossy fascia."""
    g = G(name)
    p = g.obj()
    d = Vector(fibre_dir).normalized()
    w = g.vmath("DOT_PRODUCT", p, tuple(d))
    # bands across the fibre direction -> use the perpendicular coordinate
    perp = Vector((-d.z, 0.0, d.x)).normalized() if abs(d.y) < 0.9 else Vector((1, 0, 0))
    u = g.vmath("DOT_PRODUCT", p, tuple(perp))
    comb = g.n("ShaderNodeCombineXYZ")
    g.link(u, comb.inputs["X"])
    g.link(g.math("MULTIPLY", w, 0.05), comb.inputs["Y"])
    fib = g.wave(comb.outputs[0], 22.0, distortion=2.5, detail=3.0)
    mott = g.noise(p, 8.0, detail=4.0)
    base = g.ramp(mott, [(0.3, srgb("#6b1a15")), (0.6, srgb("#8e2a24")), (0.85, srgb("#a33a30"))])
    base = g.mixc(g.maprange(fib, 0.2, 0.9, 0.0, 0.3), base, srgb("#4a0f0c"))
    nrm = g.bump(fib, 0.25, 0.0015)
    g.set(Subsurface_Weight=0.25, Subsurface_Radius=(1.0, 0.25, 0.15), Subsurface_Scale=0.015,
          Coat_Weight=0.25, Coat_Roughness=0.2, Sheen_Weight=0.1)
    return g.finish(base=base, rough=g.maprange(fib, 0.0, 1.0, 0.36, 0.55), normal=nrm, category="Muscle")


def diaphragm(name="L_Diaphragm"):
    """Radial muscle fibres around a pearly central tendon (the dome's upper centre)."""
    g = G(name)
    p = g.obj()
    sep = g.n("ShaderNodeSeparateXYZ")
    g.link(p, sep.inputs[0])
    theta = g.math("ARCTAN2", sep.outputs["Y"], sep.outputs["X"])
    comb = g.n("ShaderNodeCombineXYZ")
    g.link(g.math("MULTIPLY", theta, 1.2), comb.inputs["X"])
    fib = g.wave(comb.outputs[0], 30.0, distortion=2.0, detail=2.0)
    r = g.vmath("LENGTH", g.vmath("MULTIPLY", p, (1.0, 1.0, 0.0)))
    tendon = g.maprange(g.math("ADD", r, g.math("MULTIPLY", g.noise(p, 5.0), 0.25)), 0.55, 0.75, 1.0, 0.0)
    mott = g.noise(p, 8.0)
    musc = g.ramp(mott, [(0.3, srgb("#6d1b16")), (0.7, srgb("#942d25"))])
    musc = g.mixc(g.maprange(fib, 0.2, 0.9, 0.0, 0.3), musc, srgb("#4a0f0c"))
    base = g.mixc(tendon, musc, srgb("#d9d2c6"))
    nrm = g.bump(fib, 0.2, 0.0015)
    g.set(Subsurface_Weight=0.25, Subsurface_Scale=0.012, Coat_Weight=0.3, Coat_Roughness=0.15)
    return g.finish(base=base, rough=g.maprange(tendon, 0.0, 1.0, 0.45, 0.3), normal=nrm, category="Diaphragm")


def skin(name="L_Skin"):
    g = G(name)
    p = g.obj()
    pores = g.voronoi(p, 260.0, "F1", "Distance")
    mott = g.noise(p, 5.0, detail=5.0)
    base = g.ramp(mott, [(0.3, srgb("#c98f72")), (0.7, srgb("#e0ab90"))])
    nrm = g.bump(pores, 0.15, 0.0004)
    g.set(Subsurface_Weight=0.5, Subsurface_Radius=(1.0, 0.45, 0.3), Subsurface_Scale=0.02, Coat_Weight=0.1)
    return g.finish(base=base, rough=g.maprange(pores, 0.0, 0.5, 0.42, 0.55), normal=nrm, coat_normal=False, category="Skin")


def look_for(category: str, node: str) -> bpy.types.Material:
    """The realistic look of a node (by its ct_category), one material instance per node."""
    name = f"L_{node}"
    if category == "Myocardium":
        return myocardium(name)
    if category == "Papillary":
        return myocardium(name)
    if category == "Fat":
        return fat(name)
    if category == "Valve":
        return valve(name)
    if category == "Artery":
        return artery(name)
    if category == "PulmonaryArtery":
        return pulmonary_artery(name)
    if category == "PulmonaryVein":
        return pulmonary_vein(name)
    if category == "Vein":
        return vein(name)
    if category == "CardiacVein":
        return cardiac_vein(name)
    if category == "Bone":
        return bone(name)
    if category == "Cartilage":
        return cartilage(name)
    if category == "Lung":
        return lung(name)
    if category == "Airway":
        return airway(name)
    if category == "Oesophagus":
        return oesophagus(name)
    if category == "Diaphragm":
        return diaphragm(name)
    if category == "Skin":
        return skin(name)
    if category == "Muscle":
        side = -1.0 if node.endswith("_R") else 1.0
        return muscle(name, fibre_dir=(side, 0.0, 0.45))
    if category == "Coronary":
        return coronary(name, srgb("#b0302a"))
    raise KeyError(f"no look for category {category!r}")


def ensure_heart_frame(base, apex) -> bpy.types.Object:
    """Empty at the heart base centre whose local +Z points from the apex to the base (Blender frame)."""
    ob = bpy.data.objects.get(HEART_FRAME)
    if ob is None:
        ob = bpy.data.objects.new(HEART_FRAME, None)
        bpy.context.scene.collection.objects.link(ob)
    axis = (Vector(base) - Vector(apex)).normalized()
    ob.location = Vector(base)
    ob.rotation_euler = axis.to_track_quat("Z", "Y").to_euler()
    ob["ct_rig"] = False
    return ob


def gltf_to_blender(v) -> Vector:
    return Vector((v[0], -v[2], v[1]))


_ = math
