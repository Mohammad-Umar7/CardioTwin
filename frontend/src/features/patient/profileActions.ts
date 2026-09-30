/**
 * Patient-level actions shared by the switcher, the Inputs drawer menu and the palette: open a patient,
 * start blank, random TEST patient, reset edits (with Undo), copy a share link, export / import a JSON
 * profile. Each action reads the latest store state when it runs, so commands never go stale.
 */
import { cohortResource, schemaResource } from '@/services/staticData';
import { indexSchema } from '@/hooks/useData';
import { schemaDefaults } from '@/lib/patients';
import { selectEditCount, usePatientStore } from '@/state/patientStore';
import { useUiStore, type ToastTone } from '@/state/uiStore';
import type { CohortPatient, FeatureVector } from '@/types/contracts';
import {
  buildProfile,
  encodeShareState,
  parseProfile,
  profileFileName,
  shareUrl,
  type ImportedProfile,
} from './lib/profile';

/** Navigate within the hash router (injected by React callers; defaults to the location hash). */
export type Navigate = (to: string) => void;

const hashNavigate: Navigate = (to) => {
  if (typeof window !== 'undefined') window.location.hash = to;
};

const onWorkstation = () => typeof window !== 'undefined' && window.location.hash.startsWith('#/workstation');

const toast = (message: string, tone: ToastTone = 'info', action?: { label: string; onClick(): void }) =>
  useUiStore.getState().pushToast({ tone, message, ...(action ? { action } : null) });

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

async function loadSchemaIndex() {
  const schema = await schemaResource.get();
  return { index: indexSchema(schema), defaults: schemaDefaults(schema) };
}

/** Keep the workstation URL on the patient that is open (shareable, and a reload reopens it). */
function syncRoute(patientId: string | null, navigate: Navigate) {
  if (!onWorkstation()) return;
  navigate(patientId ? `/workstation/${patientId}` : '/workstation');
}

export function openPatient(patient: CohortPatient, navigate: Navigate = hashNavigate): void {
  usePatientStore.getState().loadPatient(patient);
  syncRoute(patient.id, navigate);
}

export async function startBlankPatient(navigate: Navigate = hashNavigate): Promise<void> {
  const { defaults } = await loadSchemaIndex();
  usePatientStore.getState().startBlank(defaults);
  syncRoute(null, navigate);
}

export function pickRandomTestPatient(patients: readonly CohortPatient[], currentId: string | null, random = Math.random): CohortPatient | null {
  const pool = patients.filter((p) => p.split === 'test' && p.id !== currentId);
  if (pool.length === 0) return null;
  return pool[Math.floor(random() * pool.length)] ?? null;
}

export async function openRandomTestPatient(navigate: Navigate = hashNavigate): Promise<void> {
  const cohort = await cohortResource.get();
  const next = pickRandomTestPatient(cohort.patients, usePatientStore.getState().selectedPatientId);
  if (next) openPatient(next, navigate);
}

/** Reset every edit; Undo restores them (V2 §5.7). */
export function resetAllEdits(): void {
  const s = usePatientStore.getState();
  const edits = selectEditCount(s);
  if (edits === 0) return;
  const before: FeatureVector = { ...s.features };
  const who = s.selectedPatientId;
  s.resetAll();
  toast(`Inputs reset · ${plural(edits, 'change')} undone`, 'info', {
    label: 'Undo',
    onClick: () => {
      const now = usePatientStore.getState();
      if (now.selectedPatientId === who) now.setFeatures(before);
    },
  });
}

/** Copy a link that reopens this patient with these edits; falls back to putting it in the address bar. */
export async function copyShareLink(): Promise<void> {
  const { index, defaults } = await loadSchemaIndex();
  const s = usePatientStore.getState();
  const patientId = s.mode === 'cohort' ? s.selectedPatientId : null;
  const payload = encodeShareState({ patientId, recorded: s.recorded, features: s.features }, index, defaults);
  const url = shareUrl(window.location.href, patientId, payload);
  const edits = selectEditCount(s);
  const what = `${patientId ?? 'Blank patient'}${edits > 0 ? ` with ${plural(edits, 'what-if change')}` : ''}`;
  try {
    await navigator.clipboard.writeText(url);
    toast(`Share link copied · ${what}`, 'success');
  } catch {
    window.history.replaceState(window.history.state, '', url);
    toast('Could not reach the clipboard: the share link is now in the address bar', 'warn');
  }
}

/** Download the current patient as a JSON profile. */
export async function exportProfile(): Promise<void> {
  const { index } = await loadSchemaIndex();
  const s = usePatientStore.getState();
  const profile = buildProfile({
    index,
    patientId: s.mode === 'cohort' ? s.selectedPatientId : null,
    split: s.mode === 'cohort' ? s.split : null,
    recorded: s.recorded,
    features: s.features,
  });
  const blob = new Blob([`${JSON.stringify(profile, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = profileFileName(profile);
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Profile exported · ${a.download}`, 'success');
}

/** Apply a parsed profile: a known cohort id reopens that patient, anything else becomes a blank patient. */
export async function applyImportedProfile(profile: ImportedProfile, navigate: Navigate = hashNavigate): Promise<string> {
  const cohort = await cohortResource.get().catch(() => null);
  const patient = profile.patientId ? cohort?.patients.find((p) => p.id === profile.patientId) : undefined;
  const store = usePatientStore.getState();
  if (patient) {
    store.loadPatient(patient);
    usePatientStore.getState().setFeatures(profile.features);
    syncRoute(patient.id, navigate);
  } else {
    store.startBlank(profile.recorded);
    usePatientStore.getState().setFeatures(profile.features);
    syncRoute(null, navigate);
  }
  const edits = selectEditCount(usePatientStore.getState());
  return `${patient ? patient.id : 'Imported patient'}${edits > 0 ? ` with ${plural(edits, 'what-if change')}` : ''}`;
}

/** Read, validate and apply a profile file; reports the outcome in a toast. */
export async function importProfileFile(file: File, navigate: Navigate = hashNavigate): Promise<boolean> {
  if (file.size > 512 * 1024) {
    toast('That file is too large to be a patient profile (512 KB max)', 'warn');
    return false;
  }
  const [{ index, defaults }, text] = await Promise.all([loadSchemaIndex(), file.text()]);
  const parsed = parseProfile(text, index, defaults);
  if (!parsed.ok) {
    toast(`Import failed: ${parsed.error}`, 'warn');
    return false;
  }
  const what = await applyImportedProfile(parsed.profile, navigate);
  toast(`Profile imported · ${what}${parsed.profile.warnings.length ? `. ${parsed.profile.warnings.join(' ')}` : ''}`, parsed.profile.warnings.length ? 'warn' : 'success');
  return true;
}

/** Open the file picker for a JSON profile (must run inside a user gesture: a click or a key press). */
export function pickProfileFile(navigate: Navigate = hashNavigate): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) void importProfileFile(file, navigate);
  });
  input.click();
}
