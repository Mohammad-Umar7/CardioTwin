import { useEffect } from 'react';
import { useCohort, useSchema } from '@/hooks/useData';
import { useCommandHotkeys } from '@/hooks/useCommandHotkeys';
import { useReducedMotion } from '@/hooks/useMediaQuery';
import { usePredictionSync } from '@/hooks/usePrediction';
import { pickDefaultPatient, schemaDefaults } from '@/lib/patients';
import { usePatientStore } from '@/state/patientStore';
import { useShellCommands } from './useShellCommands';

/**
 * Invisible app-level controller, mounted once by the shell:
 *   - resolves the prediction engine and keeps the prediction in sync with the inputs;
 *   - opens the default held-out TEST patient as soon as the cohort arrives (Custom from schema defaults
 *     if no cohort is available), so the landing hero and the workstation show real numbers at once;
 *   - binds every registered command's shortcut (one dispatcher, WORKSTATION_V2 §4.10) and registers the
 *     app-level commands (palette, shortcut sheet, calm mode, focus mode, drawers, pages).
 */
export function AppBootstrap() {
  usePredictionSync();
  useReducedMotion();
  const cohort = useCohort();
  const schema = useSchema();

  useEffect(() => {
    const state = usePatientStore.getState();
    if (state.selectedPatientId || Object.keys(state.features).length > 0) return;
    if (cohort.status === 'ready' && cohort.data) {
      const patient = pickDefaultPatient(cohort.data.patients);
      if (patient) state.loadPatient(patient);
    } else if (cohort.status !== 'loading' && schema.status === 'ready' && schema.data) {
      state.startCustom(schemaDefaults(schema.data));
    }
  }, [cohort.status, cohort.data, schema.status, schema.data]);

  useCommandHotkeys();
  useShellCommands();

  return null;
}
