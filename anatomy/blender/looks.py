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
MYO = srgb("#6a221c")          # deep red-brown ventricular myocardium under the translucent epicardium
MYO_DARK = srgb("#4e1713")
MYO_LIGHT = srgb("#7c2b23")
MYO_SHEEN = srgb("#8a6a78")    # the thin serous epicardium gives a faint violet-grey sheen at grazing angles
MYO_CUT = srgb("#7c3228")      # cut surface: deep red-brown, matte, a little darker than fresh epicardium
EPI_FAT = srgb("#c9a36a")      # thin subepicardial fat showing through the serous epicardium


def attribute(g: "G", name: str):
    a = g.n("ShaderNodeAttribute")
    a.attribute_type = "GEOMETRY"
    a.attribute_name = name
    return a.outputs["Fac"]


def myocardium(name="L_Myocardium", tone=1.0):
    """Epicardial surface of the heart: a thin, moist (not glossy) serous layer over deep red-brown muscle.

    Colour: low-contrast mottle between dark and light red-brown, faint streaks of subepicardial fat and faint,
    open streaks of subepicardial vessels. Relief (baked into the web normal map): gentle 5 mm swellings of the muscle
    and a serous micro-relief, so highlights break up instead of smearing across the ventricle. Subsurface scattering, a violet-grey sheen and a very thin coat
    (0.08). The flat faces of the long-axis cut (``ct_cap``) get a matte, deep red-brown cut-muscle look with a very
    faint, irregular fibre texture (no periodic bands)."""
    g = G(name)
    p = g.heart()
    o = g.obj()
    mott = g.noise(p, 6.0, detail=3.0, rough=0.5)                              # ~15 mm patches
    fine = g.noise(p, 140.0, detail=2.0, rough=0.5)                            # serous micro-relief (~0.7 mm)
    swell = g.noise(p, 22.0, detail=2.0, rough=0.4)                            # gentle ~5 mm undulation
    fatn = g.noise(p, 16.0, detail=4.0, rough=0.6, distortion=0.8)             # subepicardial fat marbling
    # a faint, open (never cellular) trace of the subepicardial vessels: thin, low-contrast streaks along a distorted
    # noise's zero set, colour only (as relief it read as a cracked-mud cell pattern at close range)
    streak = g.noise(p, 11.0, detail=3.0, rough=0.55, distortion=1.2)
    vess = g.maprange(g.math("ABSOLUTE", g.math("SUBTRACT", streak, 0.5)), 0.0, 0.02, 1.0, 0.0)
    base = g.ramp(mott, [(0.25, MYO_DARK), (0.55, MYO), (0.85, MYO_LIGHT)])
    base = g.mixc(g.maprange(fatn, 0.64, 0.8, 0.0, 0.2), base, EPI_FAT)
    base = g.mixc(g.math("MULTIPLY", vess, 0.12), base, srgb("#3c0f0d"))
    rough = g.maprange(g.math("ADD", g.math("MULTIPLY", fine, 0.6), g.math("MULTIPLY", mott, 0.4)), 0.25, 0.75, 0.40, 0.55)
    h = g.math("ADD", g.math("MULTIPLY", fine, 0.12), g.math("MULTIPLY", swell, 0.6))
    # cut faces: matte, deep red-brown, irregular (non-periodic) faint fibre texture
    cap = attribute(g, "ct_cap")
    fib = g.noise(g.vmath("MULTIPLY", o, (60.0, 60.0, 9.0)), 1.0, detail=3.0, rough=0.6, distortion=1.5)
    cut = g.mixc(g.maprange(fib, 0.35, 0.8, 0.0, 0.05), MYO_CUT, MYO_DARK)
    cut = g.mixc(g.maprange(g.noise(o, 30.0), 0.3, 0.7, 0.0, 0.06), cut, srgb("#8a3a30"))
    base = g.mixc(cap, base, cut)
    rough = g.math("ADD", g.math("MULTIPLY", rough, g.math("SUBTRACT", 1.0, cap)), g.math("MULTIPLY", cap, 0.78))
    h = g.math("ADD", g.math("MULTIPLY", h, g.math("SUBTRACT", 1.0, cap)), g.math("MULTIPLY", g.math("MULTIPLY", fib, 0.1), cap))
    nrm = g.bump(h, 1.0, 0.009)  # strong enough to survive the web bake's 5 deg flatness test
    g.set(Subsurface_Weight=0.18, Subsurface_Radius=(1.0, 0.2, 0.1), Subsurface_Scale=0.012,
          Coat_Weight=0.08, Coat_Roughness=0.3, Sheen_Weight=0.12, Sheen_Roughness=0.45, Specular_IOR_Level=0.42)
    g.bsdf.inputs["Sheen Tint"].default_value = (*MYO_SHEEN, 1.0)
    return g.finish(base=base, rough=rough, normal=nrm, category="Myocardium")


def fat(name="L_Fat"):
    """Epicardial adipose tissue: golden yellow, softly lobulated (2-4 mm lobules in the geometry and as relief,
    faint deeper-toned septa between them), faintly translucent (short, warm scattering) and moist but not glossy."""
    g = G(name)
    p = g.heart()
    lob = g.voronoi(p, 30.0, "SMOOTH_F1", "Distance", randomness=0.9, smooth=1.0)   # ~3.3 mm lobules
    sub = g.voronoi(p, 70.0, "SMOOTH_F1", "Distance", randomness=0.9, smooth=1.0)   # ~1.4 mm
    edge = g.voronoi(p, 30.0, "DISTANCE_TO_EDGE", "Distance", randomness=0.9)
    tint = g.noise(p, 8.0, detail=3.0)
    fine = g.noise(p, 180.0, detail=2.0)
    base = g.ramp(tint, [(0.3, srgb("#c8943a")), (0.55, srgb("#d6a64b")), (0.8, srgb("#e1b85f"))])
    base = g.mixc(g.maprange(edge, 0.0, 0.012, 0.22, 0.0), base, srgb("#a06f2c"))     # faint septa between lobules
    base = g.mixc(g.maprange(lob, 0.2, 0.8, 0.0, 0.08), base, srgb("#b98a3e"))
    dome = g.math("ADD", g.math("SUBTRACT", 1.0, lob), g.math("MULTIPLY", g.math("SUBTRACT", 1.0, sub), 0.35))
    nrm = g.bump(g.math("ADD", dome, g.math("MULTIPLY", fine, 0.04)), 0.9, 0.005)
    rough = g.maprange(lob, 0.1, 0.8, 0.45, 0.6)
    g.set(Subsurface_Weight=0.18, Subsurface_Radius=(1.0, 0.7, 0.35), Subsurface_Scale=0.006,
          Coat_Weight=0.12, Coat_Roughness=0.3, Specular_IOR_Level=0.45)
    return g.finish(base=base, rough=rough, normal=nrm, category="Fat")


def vessel(name, hexes, *, rough=(0.42, 0.58), stria=0.05, sss=0.25, coat=0.14, scale_long=120.0, category="Vessel",
           vasa: float = 0.0):
    """Vessel wall: atlas colour with a smooth wet adventitia (soft large-scale tone, faint longitudinal fibres, a
    fine micro-relief that breaks up the highlight) and optionally faint vasa vasorum."""
    g = G(name)
    p = g.obj()
    mott = g.noise(p, 5.0, detail=2.0, rough=0.45)
    fine = g.noise(p, scale_long, detail=2.0, rough=0.55, distortion=0.3)
    base = g.ramp(mott, [(0.3, srgb(hexes[0])), (0.5, srgb(hexes[1])), (0.72, srgb(hexes[2]))])
    base = g.mixc(g.maprange(fine, 0.5, 0.85, 0.0, stria), base, srgb("#f0e0d8"))
    if vasa:
        vv = g.voronoi(p, 40.0, "DISTANCE_TO_EDGE", "Distance", randomness=1.0)
        base = g.mixc(g.maprange(vv, 0.0, 0.006, vasa, 0.0), base, srgb("#5a0f10"))
    rough_s = g.maprange(fine, 0.2, 0.8, *rough)
    nrm = g.bump(g.math("ADD", fine, g.math("MULTIPLY", mott, 0.3)), 0.18, 0.002)
    g.set(Subsurface_Weight=sss, Subsurface_Radius=(1.0, 0.35, 0.25), Subsurface_Scale=0.006,
          Coat_Weight=coat, Coat_Roughness=0.2)
    return g.finish(base=base, rough=rough_s, normal=nrm, category=category)


def artery(name="L_Artery"):
    return vessel(name, ("#8a2622", "#a2322b", "#b44639"), category="Artery", vasa=0.12)


def pulmonary_vein(name="L_PulmonaryVein"):
    return vessel(name, ("#952e28", "#ad3f36", "#bf5448"), category="PulmonaryVein")


def pulmonary_artery(name="L_PulmonaryArtery"):
    return vessel(name, ("#344686", "#43599e", "#5a70ae"), stria=0.04, category="PulmonaryArtery")


def vein(name="L_Vein"):
    return vessel(name, ("#2d386e", "#3d4e8f", "#5465a2"), stria=0.03, sss=0.3, category="Vein")


def cardiac_vein(name="L_CardiacVein"):
    return vessel(name, ("#2e3c7c", "#3d57a3", "#5268b0"), stria=0.03, sss=0.3, coat=0.16, category="CardiacVein")


def coronary(name, color, glow=0.0):
    """Coronary artery for renders: its colour (atlas red, or a risk colour) with a wet wall whose highlight is
    broken up by a fine micro-relief."""
    g = G(name)
    p = g.obj()
    fine = g.noise(p, 260.0, detail=2.0)
    nrm = g.bump(fine, 0.12, 0.0006)
    g.set(Subsurface_Weight=0.2, Subsurface_Radius=(1.0, 0.4, 0.3), Subsurface_Scale=0.004,
          Coat_Weight=0.35, Coat_Roughness=0.18, Emission_Color=(*color, 1.0), Emission_Strength=glow)
    return g.finish(base=tuple(color), rough=g.maprange(fine, 0.2, 0.8, 0.36, 0.46), normal=nrm, category="Coronary")


def valve(name="L_Valve"):
    """Thin, pale, translucent fibrous leaflets (cream, faintly yellow towards the thicker free edge), with a very
    faint collagen texture (no stripes) and light transmission / scattering so they glow when back-lit."""
    g = G(name)
    p = g.obj()
    mott = g.noise(p, 20.0)
    fib = g.noise(g.vmath("MULTIPLY", p, (8.0, 8.0, 60.0)), 1.0, detail=2.0, distortion=1.0)
    base = g.ramp(mott, [(0.3, srgb("#e6d7ba")), (0.7, srgb("#efe3c8"))])
    base = g.mixc(g.maprange(fib, 0.4, 0.8, 0.0, 0.05), base, srgb("#d8c3a0"))
    nrm = g.bump(fib, 0.06, 0.0006)
    g.set(Subsurface_Weight=0.7, Subsurface_Radius=(1.0, 0.85, 0.65), Subsurface_Scale=0.004,
          Coat_Weight=0.12, Coat_Roughness=0.25, Transmission_Weight=0.25)
    return g.finish(base=base, rough=0.42, normal=nrm, category="Valve")


def papillary(name="L_Papillary"):
    """Papillary muscles: smooth, endocardium-covered muscle (a soft mottle, no ridges), slightly paler at the head
    where the chordae arise."""
    g = G(name)
    p = g.obj()
    mott = g.noise(p, 10.0)
    fine = g.noise(p, 120.0, detail=2.0)
    base = g.ramp(mott, [(0.3, srgb("#5e1a14")), (0.7, srgb("#7a2a20"))])
    nrm = g.bump(fine, 0.08, 0.001)
    g.set(Subsurface_Weight=0.18, Subsurface_Radius=(1.0, 0.2, 0.1), Subsurface_Scale=0.01, Coat_Weight=0.08, Coat_Roughness=0.3)
    return g.finish(base=base, rough=g.maprange(fine, 0.0, 1.0, 0.42, 0.55), normal=nrm, category="Papillary")


def bone(name="L_Bone"):
    """Ivory cortical bone with micro-porosity (fine pits) and faint periosteal mottling."""
    g = G(name)
    p = g.obj()
    pits = g.voronoi(p, 70.0, "F1", "Distance", randomness=1.0)
    mott = g.noise(p, 14.0, detail=4.0)
    grain = g.noise(p, 160.0, detail=2.0)
    base = g.ramp(mott, [(0.25, srgb("#d2c19f")), (0.55, srgb("#e3d5b8")), (0.85, srgb("#ede3cc"))])
    pit = g.maprange(pits, 0.0, 0.18, 1.0, 0.0)
    base = g.mixc(g.math("MULTIPLY", pit, 0.25), base, srgb("#9a886a"))
    h = g.math("SUBTRACT", g.math("MULTIPLY", grain, 0.3), g.math("MULTIPLY", pit, 0.7))
    nrm = g.bump(h, 0.35, 0.0015)
    rough = g.maprange(g.math("ADD", pit, grain), 0.2, 1.2, 0.5, 0.72)
    g.set(Subsurface_Weight=0.12, Subsurface_Radius=(1.0, 0.8, 0.6), Subsurface_Scale=0.01, Coat_Weight=0.05)
    return g.finish(base=base, rough=rough, normal=nrm, coat_normal=False, category="Bone")


def cartilage(name="L_Cartilage"):
    """Hyaline costal cartilage: bluish-white, translucent and smooth - distinct from the ivory bone."""
    g = G(name)
    p = g.obj()
    mott = g.noise(p, 10.0, detail=3.0)
    base = g.ramp(mott, [(0.3, srgb("#bcc8cb")), (0.75, srgb("#d4dde0"))])
    nrm = g.bump(g.noise(p, 90.0), 0.08, 0.0006)
    g.set(Subsurface_Weight=0.4, Subsurface_Radius=(0.8, 0.9, 1.0), Subsurface_Scale=0.012,
          Coat_Weight=0.3, Coat_Roughness=0.15)
    return g.finish(base=base, rough=0.3, normal=nrm, category="Cartilage")


def lung(name="L_Lung"):
    """Lung: pink-grey mottled pleura with a faint lobular polygon pattern, alveolar micro-relief and sparse
    anthracotic flecks."""
    g = G(name)
    p = g.obj()
    alv = g.voronoi(p, 70.0, "F1", "Distance")
    lobular = g.voronoi(p, 14.0, "DISTANCE_TO_EDGE", "Distance")
    mott = g.noise(p, 5.0, detail=4.0)
    speck = g.noise(p, 55.0, detail=2.0)
    base = g.ramp(mott, [(0.25, srgb("#b58488")), (0.55, srgb("#cf9fa0")), (0.8, srgb("#dcb4b1"))])
    base = g.mixc(g.maprange(lobular, 0.0, 0.02, 0.22, 0.0), base, srgb("#7d5a62"))
    base = g.mixc(g.maprange(speck, 0.70, 0.76, 0.0, 0.45), base, srgb("#3c3438"))
    h = g.math("ADD", g.math("MULTIPLY", alv, 0.8), g.maprange(lobular, 0.0, 0.02, 0.0, 0.3))
    nrm = g.bump(h, 0.4, 0.001)
    g.set(Subsurface_Weight=0.3, Subsurface_Radius=(1.0, 0.45, 0.4), Subsurface_Scale=0.02,
          Coat_Weight=0.25, Coat_Roughness=0.2, Sheen_Weight=0.15)
    return g.finish(base=base, rough=g.maprange(alv, 0.0, 0.6, 0.38, 0.62), normal=nrm, category="Lung")


def airway(name="L_Airway"):
    """Trachea / bronchi: pale pink wall with C-shaped cartilage rings (~4 mm pitch) along the airway."""
    g = G(name)
    p = g.world()
    rings = g.wave(p, 11.0, distortion=0.4, detail=1.0, direction="Z", profile="SIN")
    mott = g.noise(g.obj(), 12.0)
    base = g.ramp(mott, [(0.3, srgb("#b98f8a")), (0.75, srgb("#cda6a0"))])       # pink-grey mucosa, not bone white
    base = g.mixc(g.maprange(rings, 0.5, 1.0, 0.0, 0.22), base, srgb("#d9c4be"))  # faint cartilage rings
    nrm = g.bump(rings, 0.4, 0.002)
    g.set(Subsurface_Weight=0.35, Subsurface_Scale=0.01, Coat_Weight=0.3, Coat_Roughness=0.15)
    return g.finish(base=base, rough=0.4, normal=nrm, category="Airway")


def oesophagus(name="L_Oesophagus"):
    g = G(name)
    p = g.world()
    folds = g.wave(p, 25.0, distortion=3.0, detail=2.0, direction="X")
    mott = g.noise(g.obj(), 10.0)
    base = g.ramp(mott, [(0.3, srgb("#b27a6c")), (0.75, srgb("#c9978a"))])
    nrm = g.bump(folds, 0.25, 0.002)
    g.set(Subsurface_Weight=0.3, Subsurface_Scale=0.01, Coat_Weight=0.3, Coat_Roughness=0.15)
    return g.finish(base=base, rough=0.42, normal=nrm, category="Oesophagus")


def muscle(name="L_Muscle", fibre_dir=(1.0, 0.0, 0.35)):
    """Skeletal muscle under a thin glossy fascia: a gentle fibre fan along ``fibre_dir`` at low amplitude."""
    g = G(name)
    p = g.obj()
    d = Vector(fibre_dir).normalized()
    w = g.vmath("DOT_PRODUCT", p, tuple(d))
    perp = Vector((-d.z, 0.0, d.x)).normalized() if abs(d.y) < 0.9 else Vector((1, 0, 0))
    u = g.vmath("DOT_PRODUCT", p, tuple(perp))
    comb = g.n("ShaderNodeCombineXYZ")
    g.link(u, comb.inputs["X"])
    g.link(g.math("MULTIPLY", w, 0.05), comb.inputs["Y"])
    fib = g.wave(comb.outputs[0], 30.0, distortion=1.5, detail=2.0)
    mott = g.noise(p, 6.0, detail=3.0)
    base = g.ramp(mott, [(0.3, srgb("#7a241c")), (0.6, srgb("#942f26")), (0.85, srgb("#a63b30"))])
    base = g.mixc(g.maprange(fib, 0.2, 0.9, 0.0, 0.12), base, srgb("#5a1510"))
    nrm = g.bump(fib, 0.12, 0.0015)
    g.set(Subsurface_Weight=0.25, Subsurface_Radius=(1.0, 0.25, 0.15), Subsurface_Scale=0.015,
          Coat_Weight=0.2, Coat_Roughness=0.25, Sheen_Weight=0.1)
    return g.finish(base=base, rough=g.maprange(fib, 0.0, 1.0, 0.4, 0.55), normal=nrm, category="Muscle")


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
    # the central tendon is the upper, central part of the dome: the crura hanging below it are muscle
    tendon = g.math("MULTIPLY", tendon, g.maprange(sep.outputs["Z"], -0.35, -0.05, 0.0, 1.0))
    mott = g.noise(p, 8.0)
    musc = g.ramp(mott, [(0.3, srgb("#5e1713")), (0.7, srgb("#7e261f"))])
    musc = g.mixc(g.maprange(fib, 0.2, 0.9, 0.0, 0.2), musc, srgb("#3e0c0a"))
    base = g.mixc(tendon, musc, srgb("#bdb3a6"))
    nrm = g.bump(fib, 0.2, 0.0015)
    g.set(Subsurface_Weight=0.25, Subsurface_Scale=0.012, Coat_Weight=0.12, Coat_Roughness=0.3)
    return g.finish(base=base, rough=g.maprange(tendon, 0.0, 1.0, 0.55, 0.42), normal=nrm, category="Diaphragm")


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
        return papillary(name)
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
