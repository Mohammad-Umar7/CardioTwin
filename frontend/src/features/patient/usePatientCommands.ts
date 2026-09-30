import { Download, FileUp, Link2, PencilLine, RotateCcw, Shuffle, SlidersHorizontal, ToggleRight, User, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCohort, useSchemaIndex, type SchemaIndex } from '@/hooks/useData';
import { useRegisterCommands } from '@/hooks/useRegisterCommands';
import { formatProbability } from '@/lib/format';
import { CMD } from '@/state/commandIds';
import type { Command } from '@/state/commandStore';
import { editedKeys, selectEditCount, usePatientStore } from '@/state/patientStore';
import { useUiStore } from '@/state/uiStore';
import { useViewerStore } from '@/state/viewerStore';
import type { CohortPatient, FeatureSpec, FeatureVector } from '@/types/contracts';
import { CURATED_CASES, CURATED_IDS } from './curated';
import { aliasesFor } from './lib/aliases';
import { describeFeatures, identityOf } from './lib/describe';
import { useInputInteraction } from './lib/interaction';
import { displayValue, flipped, isPresent, sameValue } from './lib/values';
import { scoreRows } from './lib/whatIfEngine';
import {
  copyShareLink,
  exportProfile,
  openPatient,
  openRandomTestPatient,
  pickProfileFile,
  resetAllEdits,
  startBlankPatient,
  type Navigate,
} from './profileActions';

/** Canonical ids of the patient-owned commands not already in `CMD`. */
export const PATIENT_CMD = {
  openPatient: (id: string) => `patient.open.${id}`,
  input: (key: string) => `input.${key}`,
  inputReset: (key: string) => `input.${key}.reset`,
  inputEdit: (key: string) => `input.${key}.edit`,
  flipSuggestion: 'suggested.flip-typical-angina',
  lowRisk: 'suggested.low-risk-patient',
  copyShareLink: 'patient.share-link',
  exportProfile: 'patient.export',
  importProfile: 'patient.import',
} as const;

/** The what-if lever the spec suggests in the palette (V2 §4.9 "Flip typical angina"). */
const SUGGESTED_FLIP = 'Typical Chest Pain';

const target = () => useViewerStore.getState().selectedStructure ?? 'CAD';

/** "Yes → No · CAD 98 % → 91 %" (edge worker; just the value change when the model is unavailable). */
export async function flipPreview(spec: FeatureSpec, features: FeatureVector): Promise<string> {
  const now = isPresent(features[spec.key]);
  const values = `${now ? 'Yes' : 'No'} → ${now ? 'No' : 'Yes'}`;
  const scores = await scoreRows([features, { ...features, [spec.key]: flipped(features[spec.key]) }]);
  const t = target();
  const a = scores?.[0]?.[t];
  const b = scores?.[1]?.[t];
  return a === undefined || b === undefined ? values : `${values} · ${t} ${formatProbability(a).text} → ${formatProbability(b).text}`;
}

/** Flip a finding in place (palette), with an Undo toast. */
export function flipInput(spec: FeatureSpec): void {
  const s = usePatientStore.getState();
  const before = s.features[spec.key];
  const next = flipped(before);
  const who = s.selectedPatientId;
  s.setFeature(spec.key, next);
  useUiStore.getState().pushToast({
    tone: 'info',
    message: `${spec.label}: ${isPresent(before) ? 'Yes' : 'No'} → ${next ? 'Yes' : 'No'}`,
    action: {
      label: 'Undo',
      onClick: () => {
        const now = usePatientStore.getState();
        if (now.selectedPatientId === who && before !== undefined) now.setFeature(spec.key, before);
      },
    },
  });
}

function inputCommands(index: SchemaIndex, features: FeatureVector, recorded: FeatureVector): Command[] {
  const groupLabel = new Map(index.groups.map((g) => [g.id, g.label]));
  return index.features.map((spec): Command => {
    const group = groupLabel.get(spec.group) ?? '';
    const value = features[spec.key];
    const edited = !sameValue(value, recorded[spec.key]);
    const open = () => useUiStore.getState().openDrawer('inputs', { field: spec.key });
    const reset: Command = {
      id: PATIENT_CMD.inputReset(spec.key),
      group: 'inputs',
      title: `Reset to ${displayValue(spec, recorded[spec.key])}`,
      subtitle: 'Recorded value',
      icon: RotateCcw,
      run: () => usePatientStore.getState().resetFeature(spec.key),
    };
    const edit: Command = { id: PATIENT_CMD.inputEdit(spec.key), group: 'inputs', title: 'Edit in the drawer', icon: SlidersHorizontal, run: open };
    const binary = spec.type === 'binary';
    return {
      id: PATIENT_CMD.input(spec.key),
      group: 'inputs',
      title: spec.label,
      subtitle: `${group} · ${displayValue(spec, value)}${edited ? ` (was ${displayValue(spec, recorded[spec.key])})` : ''}`,
      keywords: aliasesFor(spec.key),
      icon: binary ? ToggleRight : PencilLine,
      ...(binary ? { preview: () => flipPreview(spec, usePatientStore.getState().features) } : null),
      run: binary ? () => flipInput(spec) : open,
      actions: binary ? [edit, ...(edited ? [reset] : [])] : edited ? [reset] : undefined,
    };
  });
}

function patientCommands(patients: readonly CohortPatient[], navigate: Navigate): Command[] {
  const curatedNote = new Map(CURATED_CASES.map((c) => [c.id, c.note]));
  const rank = (p: CohortPatient) => (CURATED_IDS.has(p.id) ? 0 : p.split === 'test' ? 1 : 2);
  return [...patients]
    .sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))
    .map((p): Command => {
      const { sex } = identityOf(p.features);
      return {
        id: PATIENT_CMD.openPatient(p.id),
        group: 'patients',
        title: `Open ${p.id}`,
        subtitle: `${describeFeatures(p.features)}${p.split === 'test' ? ' · held-out test' : ' · development'}`,
        keywords: [p.id, p.id.replace('P-', ''), sex ?? '', p.split === 'test' ? 'test held-out' : 'dev development', curatedNote.get(p.id) ?? ''],
        icon: User,
        when: () => usePatientStore.getState().selectedPatientId !== p.id || usePatientStore.getState().mode !== 'cohort',
        run: () => openPatient(p, navigate),
      };
    });
}

/**
 * Palette commands owned by the patient feature (WORKSTATION_V2 §9.3 B): every cohort patient, all 53
 * inputs (findings flip in place with a live "CAD 98 % → 91 %" preview; other inputs open the drawer on
 * that row), Reset all edits, New blank patient, Random test patient, and the profile workflow (share
 * link, JSON export / import). Subtitles show current values, refreshed after each committed edit.
 */
export function usePatientCommands(): void {
  const navigate = useNavigate();
  const index = useSchemaIndex();
  const cohort = useCohort();
  const selectedId = usePatientStore((s) => s.selectedPatientId);
  const features = usePatientStore((s) => s.features);
  const recorded = usePatientStore((s) => s.recorded);
  const edits = usePatientStore(selectEditCount);
  const dragging = useInputInteraction((s) => s.dragging);

  // Values in subtitles follow committed edits, not every frame of a drag.
  const [snapshot, setSnapshot] = useState({ features, recorded });
  useEffect(() => {
    if (!dragging) setSnapshot({ features, recorded });
  }, [features, recorded, dragging]);

  const patients = cohort.data?.patients;
  const lever = index?.byKey.get(SUGGESTED_FLIP);

  const commands = useMemo((): Command[] => {
    const list: Command[] = [];
    if (lever) {
      const now = isPresent(snapshot.features[lever.key]);
      list.push({
        id: PATIENT_CMD.flipSuggestion,
        group: 'suggested',
        title: `Flip ${lever.label.toLowerCase()} (${now ? 'Yes → No' : 'No → Yes'})`,
        keywords: aliasesFor(lever.key),
        icon: ToggleRight,
        preview: () => flipPreview(lever, usePatientStore.getState().features),
        run: () => flipInput(lever),
      });
    }
    if (patients?.length) {
      list.push({
        id: PATIENT_CMD.lowRisk,
        group: 'suggested',
        title: 'Open a low-risk patient',
        subtitle: 'Held-out test patient with the lowest CAD estimate',
        keywords: ['low risk', 'healthy', 'contrast'],
        icon: User,
        run: () => {
          const test = patients.filter((p) => p.split === 'test');
          void scoreRows(test.map((p) => p.features)).then((scores) => {
            const fallback = test.find((p) => p.id === 'P-009') ?? test[0];
            const best = scores ? test[scores.reduce((bi, s, i, all) => ((s.CAD ?? 1) < (all[bi]!.CAD ?? 1) ? i : bi), 0)] : fallback;
            if (best) openPatient(best, navigate);
          });
        },
      });
      list.push(...patientCommands(patients, navigate));
      list.push({
        id: CMD.randomTestPatient,
        group: 'patients',
        title: 'Random test patient',
        subtitle: 'A held-out patient the model never saw',
        keywords: ['shuffle', 'random', 'another'],
        icon: Shuffle,
        run: () => void openRandomTestPatient(navigate),
      });
    }
    list.push({
      id: CMD.blankPatient,
      group: 'patients',
      title: 'New blank patient',
      subtitle: 'Cohort medians and modes, no edits',
      keywords: ['custom', 'new', 'empty', 'defaults'],
      icon: UserPlus,
      run: () => void startBlankPatient(navigate),
    });
    if (index) list.push(...inputCommands(index, snapshot.features, snapshot.recorded));
    list.push(
      {
        id: CMD.resetEdits,
        group: 'actions',
        title: 'Reset all edits',
        subtitle: `Back to the recorded inputs · ${edits} ${edits === 1 ? 'change' : 'changes'}`,
        keywords: ['undo', 'what if', 'restore', 'recorded'],
        icon: RotateCcw,
        when: () => editedKeys(usePatientStore.getState().features, usePatientStore.getState().recorded).length > 0,
        run: resetAllEdits,
      },
      {
        id: PATIENT_CMD.copyShareLink,
        group: 'actions',
        title: 'Copy share link',
        subtitle: 'Reopens this patient with these edits',
        keywords: ['url', 'link', 'share', 'what if'],
        icon: Link2,
        run: () => void copyShareLink(),
      },
      {
        id: PATIENT_CMD.exportProfile,
        group: 'actions',
        title: 'Export patient profile',
        subtitle: 'Download the inputs as JSON',
        keywords: ['download', 'json', 'save', 'profile'],
        icon: Download,
        run: () => void exportProfile(),
      },
      {
        id: PATIENT_CMD.importProfile,
        group: 'actions',
        title: 'Import patient profile…',
        subtitle: 'Open a JSON file of inputs',
        keywords: ['upload', 'json', 'load', 'open file', 'profile'],
        icon: FileUp,
        run: () => pickProfileFile(navigate),
      },
    );
    return list;
    // `navigate` is stable for the router's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, patients, selectedId, snapshot, edits, lever]);

  useRegisterCommands('patient', commands, [commands]);
}
