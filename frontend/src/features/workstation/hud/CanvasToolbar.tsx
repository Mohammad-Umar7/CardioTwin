import { Heart, Home, Layers, Maximize2, Tags, Waves } from 'lucide-react';
import { HairlineProgress, IconButton, StageCard, withShortcut } from '@/design';
import { SHORTCUT } from '@/state/commandIds';
import { useUiStore } from '@/state/uiStore';
import { useViewerStore } from '@/state/viewerStore';

/**
 * CanvasToolbar — WORKSTATION_V2 §5.11. Answers "How do I look at it?". Rendered in StageLayout's
 * `bottom` slot (bottom 12, centred on the free area; StageLayout counts its height in `stageInsets.bottom`).
 *
 * STUB (agent A, Wave 0). Ownership transferred to agent D on creation; A never edits this file again.
 *
 * Contract:
 *   export interface CanvasToolbarProps { className?: string }
 *   - StageCard `shape="bare"`, h var(--toolbar-h) (40 / 36), padding 4, `data-region="toolbar"`,
 *     groups: View menu (design `Menu`) + ⌂ · Peel slider + Dissect · Layers ▾ · Beat, Flow · Focus, ⋯.
 *   - Tooltips "Name · key" via `withShortcut(name, shortcut)`; shortcuts come from `state/commandIds`
 *     (register D's commands with the same ids at priority 0 to replace A's interim ones).
 *   - Focus mode: `uiStore.toggleFocusMode()`.
 */
export interface CanvasToolbarProps {
  className?: string;
}

export function CanvasToolbar({ className }: CanvasToolbarProps) {
  const heartbeat = useViewerStore((s) => s.heartbeat);
  const flow = useViewerStore((s) => s.bloodFlow);
  const labels = useViewerStore((s) => s.labels);
  const territoryMode = useViewerStore((s) => s.territoryMode);
  const source = useViewerStore((s) => s.anatomySource);
  const progress = useViewerStore((s) => s.anatomyProgress);
  const v = useViewerStore.getState;

  return (
    <StageCard
      as="div"
      role="toolbar"
      aria-label="View controls"
      shape="bare"
      region="toolbar"
      enterDelay={120}
      className={`flex h-[var(--toolbar-h)] items-center gap-0.5 p-1 ${className ?? ''}`}
    >
      <IconButton label="Home view" tooltip={withShortcut('Home view', SHORTCUT.home)} icon={<Home />} size="md" onClick={() => v().flyHome()} />
      <span aria-hidden className="mx-1 h-5 w-px bg-hairline" />
      <IconButton
        label="Territories"
        tooltip={withShortcut(`Territories: ${territoryMode}`, SHORTCUT.territories)}
        icon={<Layers />}
        size="md"
        active={territoryMode !== 'off'}
        aria-pressed={territoryMode !== 'off'}
        onClick={() => v().cycleTerritoryMode()}
      />
      <IconButton
        label="Labels"
        tooltip={withShortcut('Labels', SHORTCUT.labels)}
        icon={<Tags />}
        size="md"
        active={labels}
        aria-pressed={labels}
        onClick={() => v().toggle('labels')}
      />
      <span aria-hidden className="mx-1 h-5 w-px bg-hairline" />
      <IconButton
        label="Heartbeat"
        tooltip={withShortcut('Heartbeat', SHORTCUT.beat)}
        icon={<Heart />}
        size="md"
        active={heartbeat}
        aria-pressed={heartbeat}
        onClick={() => v().toggle('heartbeat')}
      />
      <IconButton
        label="Illustrative coronary flow"
        tooltip={withShortcut('Illustrative coronary flow', SHORTCUT.flow)}
        icon={<Waves />}
        size="md"
        active={flow}
        aria-pressed={flow}
        onClick={() => v().toggle('bloodFlow')}
      />
      <span aria-hidden className="mx-1 h-5 w-px bg-hairline" />
      <IconButton
        label="Focus mode"
        tooltip={withShortcut('Focus mode', SHORTCUT.focusMode)}
        icon={<Maximize2 />}
        size="md"
        onClick={() => useUiStore.getState().toggleFocusMode()}
      />
      {source === 'loading' && (
        <HairlineProgress
          value={progress ? progress.loaded / progress.total : null}
          label="Loading anatomy"
          className="absolute inset-x-2 bottom-0"
        />
      )}
    </StageCard>
  );
}
