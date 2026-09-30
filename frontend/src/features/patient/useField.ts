import { usePatientStore } from '@/state/patientStore';
import type { FeatureValue } from '@/types/contracts';

/** Current value, recorded value and edit state of one feature. */
export function useField(key: string) {
  const value = usePatientStore((s) => s.features[key]);
  const recorded = usePatientStore((s) => s.recorded[key]);
  const imputed = usePatientStore((s) => s.prediction?.imputed.includes(key) ?? false);
  const setFeature = usePatientStore((s) => s.setFeature);
  const resetFeature = usePatientStore((s) => s.resetFeature);
  const edited =
    value !== recorded && !(typeof value === 'number' && typeof recorded === 'number' && Math.abs(value - recorded) < 1e-9);
  return {
    value,
    recorded,
    edited,
    imputed,
    set: (v: FeatureValue) => setFeature(key, v),
    reset: () => resetFeature(key),
  };
}
