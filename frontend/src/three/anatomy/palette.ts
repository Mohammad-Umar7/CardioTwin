/**
 * Realistic-look palette (DESIGN_SYSTEM §7.9). sRGB hex, converted to linear by three.js `Color`.
 *
 * Rules that keep risk unmistakable next to realistic tissue:
 *  - The myocardium is a DESATURATED, dark muscle red (OKLab L ≈ 0.36, chroma ≈ 0.07): darker than the
 *    p = 0 vessel (#386695, L 0.50) and well below the ramp's coral/apricot chroma, so the Ember-coded
 *    coronary tree stays the most saturated and brightest thing on screen (V2 §5.15 figure/ground).
 *  - No tissue is emissive; only the coronary targets glow (bloom onset ≈ p 0.70).
 *  - Specimen colours, muted: the caval veins a dark plum-maroon (a specimen's thin venous wall, darker and
 *    greyer than the ramp's low end, and never emissive), arteries as pale adventitia (not red), so no
 *    anatomical colour can be read as a risk colour.
 *  - These are the colours BEFORE the baked GLB maps arrive (and for a GLB without maps). Once a mesh's
 *    baked albedo is uploaded it carries the colour itself, multiplied by a light tint (tissue.ts `baked`).
 */
export const REAL = {
  myocardium: '#5A2622',
  myocardiumDeep: '#3F1A1B',
  /** Chamber interiors and cut faces: a lighter blood-muscle red, so the opened chambers read. */
  interior: '#5E2522',
  fat: '#8E7A5C',
  /** Epicardial fat meshes (EpicardialFat_*) before their bake arrives: close to the toned bake (golden). */
  fatMesh: '#8A7E52',
  fatDeep: '#5E5434',
  /** Cardiac veins: dark plum-grey, never the ramp's blue. */
  cardiacVein: '#4A3E42',
  cardiacVeinDeep: '#2E2629',
  wrapTint: '#E0503C',
  sss: '#B8322A',
  papillary: '#5A2926',
  valve: '#D6C4AA',
  adventitia: '#9C8274',
  adventitiaDeep: '#6E564C',
  pulmonaryVein: '#6E3D3B',
  /** SVC and IVC: dark plum-maroon venous wall (an atlas blue tube read as a steel pipe). */
  systemicVein: '#4A2E38',
  systemicVeinDeep: '#2C1A22',
  leftMain: '#8E7A72',
  bone: '#DCCDB0',
  boneDeep: '#A88F68',
  /** Hyaline costal cartilage: a translucent blue-grey, never a white plastic slab. */
  cartilage: '#A4B0B2',
  lung: '#C99B98',
  lungDeep: '#8E5E62',
  airway: '#D8C9BA',
  skin: '#E0AE98',
  muscle: '#6E2622',
  muscleDeep: '#4B1716',
  diaphragm: '#6C2F2A',
  coronaryRim: '#FFF4EC',
} as const;

/** Ghost (peeled / "ghost others") tints per look. */
export const GHOST = {
  clinical: {
    skin: '#A9B8C8',
    lung: '#C7A9A6',
    bone: '#9FB4C8',
    muscle: '#8B5E58',
    diaphragm: '#6B5F5A',
    heart: '#9FB4C8',
    vessel: '#B7C3D0',
    /** Neutral: a low-risk artery is ramp blue, so a vein must never be. */
    vein: '#8E898C',
    /** Clinical fat: a faint warm-grey veil in the grooves. */
    fat: '#A8A092',
  },
  realistic: {
    // Thorax ghosts are near-achromatic (a warm grey, never a red or orange glow at the frame's edges):
    // only the coronaries carry colour on the stage.
    skin: '#C2B6B0',
    lung: '#BFB0AE',
    bone: '#D6D0C6',
    muscle: '#A69A96',
    diaphragm: '#A09692',
    heart: '#E09A8E',
    vessel: '#D8C8C0',
    vein: '#8A7C80',
    fat: '#B8A070',
  },
} as const;
