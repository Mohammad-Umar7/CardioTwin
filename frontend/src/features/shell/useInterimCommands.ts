import { FilePlus2, PencilLine, PlayCircle, RotateCcw, Shuffle, UserRound } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { startGuidedDemo } from '@/features/tour/tourApi';
import { useCohort, useSchemaIndex } from '@/hooks/useData';
import { useRegisterCommands } from '@/hooks/useRegisterCommands';
import { formatFeatureValue } from '@/lib/format';
import { schemaDefaults } from '@/lib/patients';
import { ROUTES, loadWorkstation } from '@/routes';
import { CMD } from '@/state/commandIds';
import type { Command } from '@/state/commandStore';
import { selectEditCount, usePatientStore } from '@/state/patientStore';
import { useUiStore } from '@/state/uiStore';
import type { CohortPatient } from '@/types/contracts';
import { inputAliases, patientKeywords } from './commandAliases';
import { SPLIT_COPY, sexAgeLine } from './patientIdentity';

/** Undo window of "Inputs reset · Undo" (V2 §5.7). */
const UNDO_MS = 6000;

/**
 * INTERIM palette lists for other owners, so the palette reaches every patient and every input from
 * day one (WORKSTATION_V2 §4.9, §9.3 B):
 *   - every cohort patient and every input, registered with `yieldToGroup`: they disappear wholesale as
 *     soon as agent B registers its own patient / input commands, whatever ids B chooses;
 *   - New blank patient, Random test patient, Reset all edits and Start guided demo at priority −1, under
 *     the canonical ids in `commandIds.ts`, so B's and E's registrations replace them one by one.
 */
export function useInterimCommands(): void {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const onWorkstation = pathname.startsWith(ROUTES.workstation);
  const cohort = useCohort();
  const index = useSchemaIndex();
  const features = usePatientStore((s) => s.features);
  const edits = usePatientStore(selectEditCount);

  const toWorkstation = (patientId?: string) => {
    if (onWorkstation) return;
    void loadWorkstation();
    navigate(patientId ? `${ROUTES.workstation}/${patientId}` : ROUTES.workstation);
  };

  const openPatient = (patient: CohortPatient) => {
    usePatientStore.getState().loadPatient(patient);
    toWorkstation(patient.id);
  };

  const patients = cohort.data?.patients ?? [];
  const patientCommands: Command[] = patients.map((p) => ({
    id: CMD.openPatient(p.id),
    group: 'patients',
    title: p.id,
    subtitle: [sexAgeLine(p), p.split === 'test' ? 'Held-out test' : p.split === 'dev' ? 'Development' : null]
      .filter(Boolean)
      .join(' · '),
    keywords: patientKeywords(p),
    icon: UserRound,
    run: () => openPatient(p),
  }));

  const inputCommands: Command[] = (index?.groups ?? []).flatMap((group) =>
    group.features.map(
      (spec): Command => ({
        id: CMD.editInput(spec.key),
        group: 'inputs',
        title: spec.label,
        subtitle: group.label,
        keywords: inputAliases(spec),
        hint: spec.key in features ? formatFeatureValue(spec, features[spec.key]) : undefined,
        icon: PencilLine,
        run: () => {
          toWorkstation();
          useUiStore.getState().openDrawer('inputs', { field: spec.key });
        },
      }),
    ),
  );

  const actions: Command[] = [
    {
      id: CMD.blankPatient,
      group: 'patients',
      title: 'New blank patient',
      subtitle: 'Cohort defaults, no edits',
      keywords: ['custom', 'empty', 'new'],
      icon: FilePlus2,
      when: () => index !== null,
      run: () => {
        if (!index) return;
        usePatientStore.getState().startBlank(schemaDefaults(index.schema));
        toWorkstation();
      },
    },
    {
      id: CMD.randomTestPatient,
      group: 'patients',
      title: 'Random test patient',
      subtitle: SPLIT_COPY.test,
      keywords: ['shuffle', 'held-out', 'unseen'],
      icon: Shuffle,
      when: () => patients.some((p) => p.split === 'test'),
      run: () => {
        const current = usePatientStore.getState().selectedPatientId;
        const pool = patients.filter((p) => p.split === 'test' && p.id !== current);
        const pick = pool[Math.floor(Math.random() * pool.length)];
        if (pick) openPatient(pick);
      },
    },
    {
      id: CMD.resetEdits,
      group: 'inputs',
      title: 'Reset all edits',
      subtitle: `${edits} ${edits === 1 ? 'change' : 'changes'}`,
      keywords: ['undo', 'recorded', 'what if', 'revert'],
      icon: RotateCcw,
      when: () => selectEditCount(usePatientStore.getState()) > 0,
      run: () => {
        const store = usePatientStore.getState();
        const before = store.features;
        store.resetAll();
        const ui = useUiStore.getState();
        const toastId = ui.pushToast({
          tone: 'info',
          message: 'Inputs reset',
          action: { label: 'Undo', onClick: () => usePatientStore.getState().setFeatures(before) },
        });
        window.setTimeout(() => useUiStore.getState().dismissToast(toastId), UNDO_MS);
      },
    },
    {
      id: CMD.tourStart,
      group: 'actions',
      title: 'Start guided demo',
      subtitle: '5 chapters · 90 s',
      keywords: ['tour', 'demo', 'walkthrough', 'guide'],
      icon: PlayCircle,
      run: () => startGuidedDemo(navigate, `${pathname}${search}`),
    },
  ];

  useRegisterCommands('interim.data', [...patientCommands, ...inputCommands], [cohort.data, index, features, onWorkstation], {
    priority: -1,
    yieldToGroup: true,
  });
  useRegisterCommands('interim.actions', actions, [cohort.data, index, edits, onWorkstation, pathname, search], {
    priority: -1,
  });
}
