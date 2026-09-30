import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useDelayedFlag } from '@/hooks/useMediaQuery';
import { selectDisplayedPrediction, selectEditCount, usePatientStore } from '@/state/patientStore';
import { documentTitle } from './documentTitle';

/** Keeps `document.title` on the current patient and CAD estimate (WORKSTATION_V2 §7). */
export function useDocumentTitle(): void {
  const { pathname } = useLocation();
  const id = usePatientStore((s) => s.selectedPatientId);
  const mode = usePatientStore((s) => s.mode);
  const cad = usePatientStore((s) => selectDisplayedPrediction(s)?.predictions.CAD ?? null);
  const status = usePatientStore((s) => s.status);
  const comparing = usePatientStore((s) => s.comparing);
  const edits = usePatientStore(selectEditCount);
  const updating = useDelayedFlag(status === 'loading', 150);

  const patient = mode === 'cohort' ? id : mode === 'blank' ? 'Blank patient' : id ? id : 'Custom patient';
  const title = documentTitle({
    pathname,
    patient: patient ?? null,
    cad: cad && status !== 'error' ? { probability: cad.probability, band: cad.risk_band } : null,
    updating,
    comparing,
    edits,
  });

  useEffect(() => {
    if (title !== null) document.title = title;
  }, [title]);
}
