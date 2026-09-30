/** Hover tooltip content for a picked 3D structure (pure; tested in labels.test.ts). */
import type { AnatomyManifest } from '@/types/contracts';
import type { PickInfo } from '../stage/pickStore';

const TERRITORY_NAME: Record<'LAD' | 'LCX' | 'RCA', string> = {
  LAD: 'left anterior descending',
  LCX: 'left circumflex',
  RCA: 'right coronary artery',
};

export interface HoverContent {
  title: string;
  /** SCCT segment line ("Segment 7 · Mid LAD (mLAD)"), coronaries only. */
  segment: string | null;
  /** Precise definition (segment definition, else the structure's definition / description). */
  definition: string | null;
  /** Small print: what the anatomical label does and does not mean. */
  note: string | null;
}

/** Shorten to `max` characters, preferring a sentence or clause boundary over a mid-phrase cut. */
export const clip = (text: string | null | undefined, max = 220): string | null => {
  if (!text) return null;
  const t = text.trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const clause = Math.max(head.lastIndexOf('. '), head.lastIndexOf('; '));
  if (clause >= 60) return `${head.slice(0, clause)}.`;
  return `${head.slice(0, Math.max(head.lastIndexOf(' '), max - 20))}…`;
};

/**
 * Tooltip content for a picked structure (V2 §9.3 D, P2; CONTRACTS §7.1): the structure's name, the SCCT
 * segment under the pointer when the coronary mesh carries `_SEGMENT`, and the most precise definition
 * available — the segment's, else `structures[].definition`, else its description. Risk stays vessel-level,
 * so a segment is labelled as anatomy, never as a lesion location. Pure; tested.
 */
/**
 * Anatomical name of a picked structure: the explode split of the GLB ("Myocardium (anterior half)") is an
 * engineering detail, not anatomy, so it is dropped from the title.
 */
export const anatomicalTitle = (label: string): string => label.replace(/\s*\((anterior|posterior) half\)\s*$/i, '');

/**
 * A definition without the exploded view's engineering ("opened by a long-axis cut", "anterior half"): the
 * split is how the model opens, not anatomy.
 */
export const anatomyOnly = (text: string | null | undefined): string | null => {
  if (!text) return null;
  const kept = text
    .split(/(?<=[.;])\s+/)
    .map((sentence) => sentence.replace(/,?\s*opened by [^,;.]*(?:cut|split)[^,;.]*/i, '').replace(/\b(anterior|posterior) half of (the )?/i, ''))
    .filter((sentence) => !/\b(half|halves|long-axis cut)\b/i.test(sentence));
  const out = kept.join(' ').trim();
  return out ? out.charAt(0).toUpperCase() + out.slice(1) : null;
};

export function hoverContent(info: PickInfo, manifest: AnatomyManifest | null | undefined): HoverContent {
  const structure = manifest?.structures.find((s) => s.id === info.structureId || s.node === info.node);
  const title = anatomicalTitle(structure?.label ?? info.label);
  const definition = typeof structure?.definition === 'string' ? structure.definition : null;
  if (info.segment) {
    const s = info.segment;
    return {
      title,
      segment: `Segment ${s.scct} · ${s.name} (${s.code})`,
      definition: clip(s.definition ?? definition ?? structure?.description),
      note: s.target ? `Anatomical segment · risk is estimated for the whole ${s.target}` : 'Anatomical segment · not predicted by the model',
    };
  }
  if (info.vein) {
    return {
      title: info.vein.name,
      segment: `${info.vein.label} · cardiac vein`,
      definition: clip(info.vein.definition ?? definition ?? structure?.description),
      note: 'Venous anatomy · not predicted by the model',
    };
  }
  if (info.kind === 'myocardium' && (info.territory || info.wall)) {
    return {
      // "Left ventricle · mid anterolateral wall" rather than "Myocardium".
      title: info.wall?.name ?? title,
      segment: info.wall?.aha ? `AHA segment ${info.wall.aha} (approximate)` : null,
      definition: info.territory
        ? `Supplied mostly by the ${TERRITORY_NAME[info.territory]} (${info.territory}).`
        : clip(anatomyOnly(definition ?? structure?.description)),
      note: info.territory ? 'Approximate supplied territory and segment, not a perfusion scan' : null,
    };
  }
  return {
    title,
    segment: null,
    definition: clip(info.kind === 'myocardium' ? anatomyOnly(definition ?? structure?.description) : (definition ?? structure?.description)),
    note: info.kind === 'leftMain' ? 'Left main · not predicted by the model' : info.kind === 'cardiacVein' ? 'Venous anatomy · not predicted by the model' : null,
  };
}

