import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { indexSchema, useCohort, useSchema } from '@/hooks/useData';
import { schemaDefaults } from '@/lib/patients';
import { usePatientStore } from '@/state/patientStore';
import { useUiStore } from '@/state/uiStore';
import { decodeShareState, SHARE_PARAM } from './lib/profile';
import { afterBaseline } from './profileActions';

/** Payloads already applied this session (the hook may be mounted by more than one component). */
const applied = new Set<string>();

/**
 * Restores a shared what-if from the URL (`#/workstation/P-011?w=…`, built by "Copy share link"):
 * opens the patient, applies the edits once its recorded estimate (the what-if baseline) exists, and
 * removes `w` from the URL so later edits and reloads are not overwritten. A link from another model
 * version or a damaged link is refused with a toast.
 */
export function useShareLinkRestore(): void {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const cohort = useCohort();
  const schema = useSchema();

  useEffect(() => {
    const params = new URLSearchParams(search);
    const payload = params.get(SHARE_PARAM);
    if (!payload || !schema.data || cohort.status === 'loading') return;
    if (applied.has(payload)) return;
    applied.add(payload);

    params.delete(SHARE_PARAM);
    const rest = params.toString();
    navigate({ pathname, search: rest ? `?${rest}` : '' }, { replace: true });

    const toast = (message: string, tone: 'info' | 'warn' | 'success') => useUiStore.getState().pushToast({ tone, message });
    const index = indexSchema(schema.data);
    const decoded = decodeShareState(payload, index);
    if (!decoded.ok) {
      toast(
        decoded.error === 'model'
          ? 'This share link was made with a different model version, so it was not applied.'
          : 'This share link is damaged, so it was not applied.',
        'warn',
      );
      return;
    }

    const { patientId, recorded, edits, skipped } = decoded.share;
    const store = usePatientStore.getState();
    if (patientId) {
      const patient = cohort.data?.patients.find((p) => p.id === patientId);
      if (!patient) {
        toast(`This share link opens ${patientId}, which is not in this cohort.`, 'warn');
        return;
      }
      store.loadPatient(patient);
      afterBaseline(() => usePatientStore.getState().setFeatures({ ...patient.features, ...edits }));
    } else {
      const base = { ...schemaDefaults(schema.data), ...recorded };
      store.startBlank(base);
      afterBaseline(() => usePatientStore.getState().setFeatures({ ...base, ...edits }));
    }
    const n = Object.keys(edits).length;
    const who = patientId ?? 'Shared patient';
    toast(
      `Shared what-if opened · ${who}${n > 0 ? ` with ${n} ${n === 1 ? 'change' : 'changes'}` : ''}${
        skipped > 0 ? ` (${skipped} unreadable ${skipped === 1 ? 'value' : 'values'} skipped)` : ''
      }`,
      skipped > 0 ? 'warn' : 'success',
    );
  }, [search, pathname, navigate, schema.data, cohort.status, cohort.data]);
}
