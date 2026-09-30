import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeftToLine, ChevronRight, PanelLeftOpen, PencilLine, Search } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button, ExitInert, IconButton, Kbd, Skeleton, StageCard, Tooltip, withShortcut } from '@/design';
import { useSchemaIndex } from '@/hooks/useData';
import { useIsReducedMotion } from '@/hooks/useMediaQuery';
import { useCommandShortcut } from '@/hooks/useRegisterCommands';
import { cn } from '@/lib/cn';
import { CMD, SHORTCUT } from '@/state/commandIds';
import { selectEditCount, usePatientStore } from '@/state/patientStore';
import { selectPatientCardExpanded, useUiStore } from '@/state/uiStore';
import { SHAP_LOWERS, SHAP_RAISES } from '@/theme/risk';
import { EASE, MOTION } from '@/theme/tokens';
import type { FeatureVector } from '@/types/contracts';
import { useCurrentTarget } from './hooks';
import { identityLine, identityOf } from './lib/describe';
import { keyInputAriaLabel, type KeyInput } from './lib/keyInputs';
import { abnormalKeys } from './lib/sections';
import { cardLabel, displayParts, displayValue, rangeGlyph, sameValue, spokenValue } from './lib/values';
import { useKeyInputs } from './useKeyInputs';

/**
 * PatientCard — WORKSTATION_V2 §5.5. Answers "What did the model see, and which inputs matter most for
 * the current target?". Rendered in StageLayout's `left` slot (the slot hugs the card).
 *
 *   header    "Male · 58 y" + ⇤ collapse
 *   overline  DRIVES {target} MOST (crossfades when a vessel is selected)
 *   rows      top 5 inputs by |SHAP| for the target (Age, Sex excluded): label · value (+ ▲/▼) · direction
 *             mark (SHAP raise / lower colour, 3 lengths). Hover links the SHAP row and the narrative;
 *             click opens the Inputs drawer on that field. Re-ranks with FLIP on a committed prediction.
 *   link      "+ n abnormal findings ›" → Inputs drawer, "Outside normal range"
 *   footer    [✎ Edit inputs  I]
 *
 * Collapsed (the user's choice, or automatically while the Explain drawer is open): a 40 × 116 rail with
 * ◧ Record · ✎ Edit inputs (accent dot while edited) · ⌕ palette.
 *
 * The card also hosts the patient-level wiring that must live while the workstation is open: the palette
 * commands for patients and inputs, and the share-link restore (`?w=` in the URL).
 */
export interface PatientCardProps {
  className?: string;
}

const ROW_H = 'h-8 max-[1439.98px]:h-7';

function DirectionMark({ item }: { item: KeyInput }) {
  if (!item.direction || !item.strength) return <span aria-hidden className="w-6" />;
  const len = [0, 4, 7, 10][item.strength]!;
  const raises = item.direction === 'raises';
  const color = raises ? SHAP_RAISES : SHAP_LOWERS;
  const x0 = raises ? 12 : 12 - len;
  const tip = raises ? `M${12 + len},3 L${15 + len},6 L${12 + len},9 Z` : `M${12 - len},3 L${9 - len},6 L${12 - len},9 Z`;
  return (
    <svg aria-hidden viewBox="0 0 24 12" className="h-3 w-6 shrink-0 overflow-visible">
      <line x1="12" x2="12" y1="1" y2="11" className="stroke-line" strokeWidth={1} />
      <rect x={x0} y={4.5} width={len} height={3} rx={0.5} fill={color} />
      <path d={tip} fill={color} />
    </svg>
  );
}

function KeyRow({ item, value, recorded, target, compare }: { item: KeyInput; value: FeatureVector[string]; recorded: FeatureVector[string]; target: string; compare: boolean }) {
  const openDrawer = useUiStore((s) => s.openDrawer);
  const highlighted = useUiStore((s) => s.highlightedFeature === item.key);
  const edited = !compare && !sameValue(value, recorded);
  const { value: v, unit } = displayParts(item.spec, value);
  const glyph = rangeGlyph(item.spec, value);
  const label = cardLabel(item.spec);
  const truncatedLabel = label !== item.spec.label ? item.spec.label : null;
  return (
    <button
      type="button"
      data-feature={item.key}
      aria-label={`${keyInputAriaLabel(item, spokenValue(item.spec, value), target)}${edited ? ` Edited, was ${spokenValue(item.spec, recorded)}.` : ''} Edit.`}
      onClick={() => openDrawer('inputs', { field: item.key })}
      onPointerEnter={() => useUiStore.getState().highlightFeature(item.key)}
      onPointerLeave={() => useUiStore.getState().highlightFeature(null)}
      onFocus={() => useUiStore.getState().highlightFeature(item.key)}
      onBlur={() => useUiStore.getState().highlightFeature(null)}
      className={cn(
        '-mx-2 grid w-[calc(100%+16px)] grid-cols-[minmax(0,1fr)_auto_24px] items-center gap-2 rounded-sm px-2 text-left transition-colors duration-instant',
        ROW_H,
        highlighted ? 'bg-surface-1' : 'hover:bg-surface-1',
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {edited && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-accent" />}
        <Tooltip content={edited ? `${item.spec.label} · was ${displayValue(item.spec, recorded)}` : truncatedLabel} placement="right">
          <span className="min-w-0 truncate text-body-s text-secondary">{label}</span>
        </Tooltip>
      </span>
      <span className="flex items-baseline gap-1 whitespace-nowrap">
        <span className="num text-body-s font-medium text-primary">{v}</span>
        {unit && <span className="text-label text-tertiary">{unit}</span>}
        {glyph && (
          <span aria-hidden className="w-2.5 text-center text-label text-secondary">
            {glyph}
          </span>
        )}
      </span>
      <DirectionMark item={item} />
    </button>
  );
}

function Rail() {
  const setOpen = useUiStore((s) => s.setPatientCardOpen);
  const edits = usePatientStore(selectEditCount);
  const palette = useCommandShortcut(CMD.paletteOpen) ?? SHORTCUT.palette;
  return (
    <div className="flex flex-col items-center gap-1 p-1">
      <IconButton label="Show the patient record" tooltip="Record" icon={<PanelLeftOpen />} size="md" onClick={() => setOpen(true)} />
      <span className="relative">
        <IconButton
          label={edits > 0 ? `Edit inputs, ${edits} ${edits === 1 ? 'change' : 'changes'}` : 'Edit inputs'}
          tooltip={withShortcut('Edit inputs', SHORTCUT.inputs)}
          icon={<PencilLine />}
          size="md"
          onClick={() => useUiStore.getState().openDrawer('inputs')}
        />
        {edits > 0 && <span aria-hidden className="pointer-events-none absolute right-1.5 top-1.5 size-1.5 rounded-full bg-accent" />}
      </span>
      <IconButton
        label="Search or jump to"
        tooltip={withShortcut('Search or jump to', palette.split(',')[0])}
        icon={<Search />}
        size="md"
        onClick={() => useUiStore.getState().setPaletteOpen(true)}
      />
    </div>
  );
}

function CardBody() {
  const target = useCurrentTarget();
  const index = useSchemaIndex();
  const setOpen = useUiStore((s) => s.setPatientCardOpen);
  const openDrawer = useUiStore((s) => s.openDrawer);
  const comparing = usePatientStore((s) => s.comparing && s.recordedPrediction !== null);
  const features = usePatientStore((s) => (s.comparing && s.recordedPrediction ? s.recorded : s.features));
  const recorded = usePatientStore((s) => s.recorded);
  const reduced = useIsReducedMotion();
  const { items, loading } = useKeyInputs(target, 5, { exclude: ['Age', 'Sex'] });
  const identity = identityOf(features);
  const identityEdited = !comparing && (!sameValue(features.Age, recorded.Age) || !sameValue(features.Sex, recorded.Sex));
  const shown = new Set(items.map((i) => i.key));
  const moreAbnormal = index ? abnormalKeys(index, features).filter((k) => !shown.has(k)).length : 0;
  const layout = reduced ? { duration: 0 } : { duration: MOTION.base / 1000, ease: EASE.out };
  // Rows fade in only when they join an already-shown list, never on the card's own first paint.
  const listShown = useRef(false);
  useEffect(() => {
    if (!loading) listShown.current = true;
  }, [loading]);

  return (
    <>
      <header className="flex h-8 items-center justify-between gap-2">
        <h2 className="m-0 flex min-w-0 items-center gap-1.5 truncate text-body-s font-semibold text-primary">
          {identityEdited && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-accent" />}
          <span className="truncate">{identityLine(identity) || 'Patient'}</span>
        </h2>
        <IconButton label="Collapse the patient card" tooltip="Collapse to rail" icon={<ArrowLeftToLine />} size="sm" onClick={() => setOpen(false)} />
      </header>
      <div className="relative mt-1 h-6">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.p
            key={target}
            className="eyebrow absolute inset-0 m-0 flex items-center text-tertiary"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: MOTION.fast / 1000, ease: EASE.out }}
          >
            Drives {target} most
          </motion.p>
        </AnimatePresence>
      </div>
      {loading ? (
        <div className="flex flex-col" aria-busy="true" aria-label="Loading the inputs that drive this estimate">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className={cn('flex items-center justify-between gap-3', ROW_H)}>
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-3 w-10" />
            </div>
          ))}
        </div>
      ) : (
        // No exit animation (and so no AnimatePresence): a row that left and came back within an exit
        // (fast 1 → 2 → Esc switching) could be revived by framer-motion at its exit opacity 0 and stay
        // invisible. Leaving rows drop out at once; the rows that stay glide to their new place and the
        // newcomers fade in.
        <ul className="m-0 flex list-none flex-col p-0" aria-label={`Inputs that drive ${target} most`}>
          {items.map((item) => (
            <motion.li
              key={item.key}
              layout={reduced ? false : 'position'}
              initial={listShown.current ? { opacity: 0 } : false}
              animate={{ opacity: 1 }}
              transition={layout}
            >
              <KeyRow item={item} value={features[item.key]} recorded={recorded[item.key]} target={target} compare={comparing} />
            </motion.li>
          ))}
        </ul>
      )}
      {moreAbnormal > 0 && (
        <button
          type="button"
          onClick={() => openDrawer('inputs', { section: 'abnormal' })}
          className="-mx-2 mt-0.5 flex h-8 items-center gap-1 rounded-sm px-2 text-label font-medium text-secondary transition-colors duration-instant hover:bg-surface-1 hover:text-primary"
        >
          <span className="num">+ {moreAbnormal}</span> abnormal {moreAbnormal === 1 ? 'finding' : 'findings'}
          <ChevronRight aria-hidden className="size-3.5 stroke-[1.5]" />
        </button>
      )}
      <Button
        variant="secondary"
        className="mt-2 w-full justify-between"
        iconLeft={<PencilLine className="stroke-[1.5]" />}
        onClick={() => openDrawer('inputs')}
        aria-keyshortcuts="I"
      >
        <span className="flex-1 text-left">Edit inputs</span>
        <Kbd>I</Kbd>
      </Button>
    </>
  );
}

export function PatientCard({ className }: PatientCardProps) {
  const expanded = useUiStore(selectPatientCardExpanded);
  const reduced = useIsReducedMotion();
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
  }, []);

  const exit = reduced ? { opacity: 0, transition: { duration: 0.12 } } : { opacity: 0, x: -12, transition: { duration: 0.17, ease: EASE.exit } };

  return (
    // popLayout: the leaving variant is lifted out of the slot at once, so the slot (and the published stage
    // insets) take the new size immediately; ExitInert takes it out of the tab order and the accessibility
    // tree while it fades (the Explain drawer collapses the card to its rail).
    <AnimatePresence initial={false} mode="popLayout">
      {expanded ? (
        <ExitInert key="card" initial={reduced ? { opacity: 0 } : { opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={exit} transition={{ duration: MOTION.base / 1000, ease: EASE.out }}>
          <StageCard
            as="aside"
            aria-label="Patient record"
            region="patient-card"
            enterDelay={60}
            noEnter={mounted.current}
            className={cn('flex w-[var(--card-left-w)] flex-col', className)}
          >
            <CardBody />
          </StageCard>
        </ExitInert>
      ) : (
        <ExitInert
          key="rail"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
          transition={{ duration: MOTION.fast / 1000, delay: reduced ? 0 : 0.06, ease: EASE.out }}
        >
          <StageCard as="nav" aria-label="Patient record" region="patient-rail" shape="bare" noEnter={mounted.current} className={cn('w-[var(--rail-w)]', className)}>
            <Rail />
          </StageCard>
        </ExitInert>
      )}
    </AnimatePresence>
  );
}
