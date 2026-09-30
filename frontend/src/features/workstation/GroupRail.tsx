import {
  Activity,
  ClipboardList,
  FlaskConical,
  HeartPulse,
  Pin,
  PinOff,
  RotateCcw,
  Stethoscope,
  User,
  UserRound,
  Waves,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { IconButton, Tooltip, trapFocus } from '@/design';
import { useSchemaIndex } from '@/hooks/useData';
import { cn } from '@/lib/cn';
import { ClinicalForm } from '@/features/patient/ClinicalForm';
import { useGroupInfo } from '@/features/patient/useGroupInfo';
import { editedKeys, usePatientStore } from '@/state/patientStore';
import { useUiStore } from '@/state/uiStore';
import { EASE, MOTION } from '@/theme/tokens';
import { PatientHeader } from './panels';

const ICONS: Record<string, LucideIcon> = {
  user: User,
  clipboard: ClipboardList,
  activity: Activity,
  stethoscope: Stethoscope,
  'heart-pulse': HeartPulse,
  flask: FlaskConical,
  waves: Waves,
};

const PATIENT = '__patient';

/**
 * 1100–1439 left rail (DESIGN_SYSTEM §4.3): one icon per schema group (• marks edits), the edit count,
 * reset, and a pin for the flyout. The 296 px flyout overlays the canvas — the canvas never resizes —
 * traps focus, and closes with Esc (focus returns to the rail button).
 */
export function GroupRail() {
  const index = useSchemaIndex();
  const info = useGroupInfo(index);
  const flyout = useUiStore((s) => s.panels.flyoutGroup);
  const pinned = useUiStore((s) => s.panels.flyoutPinned);
  const setPanels = useUiStore((s) => s.setPanels);
  const edits = usePatientStore((s) => editedKeys(s.features, s.recorded).length);
  const resetAll = usePatientStore((s) => s.resetAll);
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const open = (id: string) => {
    openerRef.current = document.activeElement as HTMLElement | null;
    setPanels({ flyoutGroup: flyout === id && !pinned ? null : id });
  };
  const close = () => {
    setPanels({ flyoutGroup: null });
    openerRef.current?.focus();
  };

  useEffect(() => {
    if (!flyout) return;
    const t = setTimeout(() => panelRef.current?.querySelector<HTMLElement>('input, button, [tabindex="0"]')?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pinned) {
        e.stopPropagation();
        close();
      } else if (!pinned) trapFocus(panelRef.current)(e);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyout, pinned]);

  const title = flyout === PATIENT ? 'Patient' : index?.groups.find((g) => g.id === flyout)?.label;

  return (
    <>
      <nav aria-label="Input groups" className="flex w-[var(--group-rail-w)] flex-col items-center gap-1 border-r border-hairline bg-panel py-2" data-tour="inputs">
        <RailButton label="Patient" icon={UserRound} active={flyout === PATIENT} onClick={() => open(PATIENT)} />
        <div className="my-1 h-px w-8 bg-hairline" />
        {index?.groups.map((g) => (
          <RailButton
            key={g.id}
            label={g.label}
            icon={ICONS[g.icon ?? ''] ?? ClipboardList}
            active={flyout === g.id}
            badge={(info.get(g.id)?.edited ?? 0) > 0}
            onClick={() => open(g.id)}
          />
        ))}
        <div className="my-1 h-px w-8 bg-hairline" />
        {edits > 0 && (
          <span className="num text-label font-semibold text-accent">
            {edits}
            <span className="sr-only"> edits</span>
          </span>
        )}
        <IconButton label="Reset all inputs to recorded" icon={<RotateCcw />} size="md" onClick={resetAll} disabled={edits === 0} />
        <IconButton
          label={pinned ? 'Unpin the input panel' : 'Pin the input panel open'}
          icon={pinned ? <PinOff /> : <Pin />}
          size="md"
          active={pinned}
          onClick={() => setPanels({ flyoutPinned: !pinned })}
        />
      </nav>
      <AnimatePresence>
        {flyout && (
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal={!pinned}
            aria-label={`${title ?? 'Inputs'} inputs`}
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16, transition: { duration: (MOTION.flyout * 0.7) / 1000, ease: EASE.exit } }}
            transition={{ duration: MOTION.flyout / 1000, ease: EASE.out }}
            className="absolute bottom-0 left-[var(--group-rail-w)] top-0 z-flyout flex w-[var(--flyout-w)] flex-col rounded-r-lg bg-panel shadow-e3"
          >
            <header className="flex h-10 shrink-0 items-center justify-between border-b border-hairline pl-4 pr-2">
              <h2 className="eyebrow text-secondary">{title}</h2>
              <IconButton label="Close (Esc)" icon={<X />} size="sm" onClick={close} tooltip={false} />
            </header>
            <div className="panel-scroll min-h-0 flex-1">
              {flyout === PATIENT ? <PatientHeader /> : <ClinicalForm groups={[flyout]} exclusive />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function RailButton({
  label,
  icon: Icon,
  active,
  badge,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  active: boolean;
  badge?: boolean;
  onClick(): void;
}) {
  return (
    <Tooltip content={label} placement="right">
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        className={cn(
          'relative flex size-10 items-center justify-center rounded-sm border-l-2 transition-colors duration-fast',
          active ? 'border-accent bg-surface-2 text-primary' : 'border-transparent text-secondary hover:bg-surface-1 hover:text-primary',
        )}
      >
        <Icon className="size-4 stroke-[1.5]" />
        {badge && <span aria-hidden className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-accent" />}
      </button>
    </Tooltip>
  );
}
