/**
 * Status in the tab (WORKSTATION_V2 §7): `P-011 · CAD 98 % Very high — CardioTwin`. Pure, so the rules are
 * tested: the estimate shows only when it is current (never a stale value), what-if edits are marked, and
 * pages without a patient read as their name.
 */
import { formatProbability } from '@/lib/format';
import { ROUTES } from '@/routes';
import { RISK_BAND_STYLES } from '@/theme/risk';
import type { RiskBandId } from '@/types/contracts';

export const APP_TITLE = 'CardioTwin';
export const LANDING_TITLE = 'CardioTwin · Explainable coronary risk';

export interface TitleInput {
  pathname: string;
  /** "P-011", "Blank patient", or null while no patient is loaded. */
  patient: string | null;
  /** P(CAD) and its band, when a prediction exists. */
  cad: { probability: number; band: RiskBandId } | null;
  /** The shown estimate is being recomputed (after the 150 ms grace period). */
  updating: boolean;
  /** Hold-to-compare shows the recorded estimate. */
  comparing: boolean;
  edits: number;
}

const PAGE_TITLES: Record<string, string> = {
  [ROUTES.performance]: 'Model performance',
  [ROUTES.methodology]: 'Methodology',
};

/** Routes that set their own title (the report names the PDF after the patient and the date). */
const OWN_TITLE = [ROUTES.report];

/** The tab title, or null on routes that manage `document.title` themselves. */
export function documentTitle(t: TitleInput): string | null {
  if (OWN_TITLE.some((r) => t.pathname.startsWith(r))) return null;
  if (t.pathname === ROUTES.landing) return LANDING_TITLE;
  const page = PAGE_TITLES[t.pathname];
  if (page) return `${page} — ${APP_TITLE}`;
  if (!t.pathname.startsWith(ROUTES.workstation)) return APP_TITLE;
  if (!t.patient) return `Workstation — ${APP_TITLE}`;
  const who = t.edits > 0 && !t.comparing ? `${t.patient} (what-if)` : t.patient;
  if (t.updating) return `${who} · updating — ${APP_TITLE}`;
  if (!t.cad) return `${who} — ${APP_TITLE}`;
  const band = RISK_BAND_STYLES[t.cad.band]?.label ?? '';
  return `${who} · CAD ${formatProbability(t.cad.probability).text} ${band} — ${APP_TITLE}`.replace(/\s+—/, ' —');
}
