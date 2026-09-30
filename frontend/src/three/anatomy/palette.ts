/**
 * Realistic-look palette (DESIGN_SYSTEM §7.9). sRGB hex, converted to linear by three.js `Color`.
 *
 * Rules that keep risk unmistakable next to realistic tissue:
 *  - The myocardium is a DESATURATED, dark muscle red (OKLab L ≈ 0.36, chroma ≈ 0.07): darker than the
 *    p = 0 vessel (#386695, L 0.50) and well below the ramp's coral/apricot chroma, so the Ember-coded
 *    coronary tree stays the most saturated and brightest thing on screen (V2 §5.15 figure/ground).
 *  - No tissue is emissive; only the coronary targets glow (bloom onset ≈ p 0.70).
 *  - Atlas colour coding is kept but muted: systemic veins in a dusty atlas blue (darker and greyer than
 *    the ramp's low end, and never emissive), arteries as pale adventitia (not red), so no anatomical colour
 *    can be read as a risk colour.
 */
export const REAL = {
  myocardium: '#5A2622',
  myocardiumDeep: '#3F1A1B',
  interior: '#3A1716',
  fat: '#8E7A5C',
  wrapTint: '#E0503C',
  sss: '#B8322A',
  papillary: '#5A2926',
  valve: '#D6C4AA',
  adventitia: '#9C8274',
  adventitiaDeep: '#6E564C',
  pulmonaryVein: '#6E3D3B',
  atlasVein: '#34405C',
  atlasVeinDeep: '#1F2638',
  leftMain: '#8E7A72',
  bone: '#E2D6BF',
  boneDeep: '#B5A07E',
  cartilage: '#BCC9CB',
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
    vein: '#7F93B8',
  },
  realistic: {
    skin: '#E7B9A2',
    lung: '#D9A9A6',
    bone: '#E6D9C2',
    muscle: '#B0605A',
    diaphragm: '#A0625A',
    heart: '#E09A8E',
    vessel: '#D8C8C0',
    vein: '#5E7BC0',
  },
} as const;
