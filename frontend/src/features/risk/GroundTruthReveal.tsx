import { RevealControl } from './RevealControl';

/** Legacy mount of Reveal (pre-V2 layouts only): the condensed V2 control, TEST patients only. */
export function GroundTruthReveal() {
  return (
    <div className="flex">
      <RevealControl />
    </div>
  );
}
