import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { formatDeltaPts, formatProbability } from '@/lib/format';

export interface DeltaChipProps {
  /** Current probability. */
  now: number | undefined;
  /** Probability before the last change (auto-hides after 2 s). */
  previous: number | undefined;
  /** Pinned A/B baseline: when set the chip persists as "was → now". */
  baseline?: number | undefined;
  /** Changes whenever a new prediction commits (re-arms the 2 s hold). */
  seq: number;
  className?: string;
}

/**
 * Delta chip (DESIGN_SYSTEM §6 "Prediction update"): "▲ +12 pts" fades in, holds until 2 s after the
 * last change, then fades out. With a pinned baseline it persists as "was 41 % → 63 %". Text colour stays
 * neutral — direction is carried by the glyph and sign, never by red/green.
 */
export function DeltaChip({ now, previous, baseline, seq, className }: DeltaChipProps) {
  const [visible, setVisible] = useState(false);
  const pinned = typeof baseline === 'number';
  const ref = pinned ? baseline : previous;
  const delta = typeof now === 'number' && typeof ref === 'number' ? now - ref : 0;
  const d = formatDeltaPts(delta);

  useEffect(() => {
    if (pinned || d.direction === 'none') return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 2000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq]);

  if (pinned) {
    if (typeof now !== 'number' || typeof baseline !== 'number') return null;
    return (
      <span className={cn('num inline-flex items-center gap-1 whitespace-nowrap text-label font-normal text-secondary', className)}>
        was {formatProbability(baseline).text} → <span className="text-primary">{formatProbability(now).text}</span>
        {d.direction !== 'none' && (
          <span className="text-tertiary">
            {d.glyph} {d.text}
          </span>
        )}
      </span>
    );
  }
  return (
    <span
      aria-hidden={!visible}
      className={cn(
        'num inline-flex items-center gap-1 whitespace-nowrap text-label font-medium text-secondary transition-opacity',
        visible && d.direction !== 'none' ? 'opacity-100 duration-fast' : 'opacity-0 duration-base',
        className,
      )}
    >
      {d.glyph} {d.text}
    </span>
  );
}
