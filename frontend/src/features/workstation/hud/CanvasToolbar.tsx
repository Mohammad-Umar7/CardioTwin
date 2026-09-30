import { FoldHorizontal, Heart, Home, Maximize2, Minimize2, Square, UnfoldHorizontal, Waves } from 'lucide-react';
import { IconButton, StageCard, withShortcut } from '@/design';
import { useIsReducedMotion } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { SHORTCUT } from '@/state/commandIds';
import { usePatientStore } from '@/state/patientStore';
import { useUiStore } from '@/state/uiStore';
import { useViewerStore } from '@/state/viewerStore';
import { clampHeartRate } from '@/three/anatomy/heartbeat';
import { TOOLBAR_ICON, ToolbarSeparator } from './controls';
import { LayersPopover } from './LayersPopover';
import { MoreMenu } from './MoreMenu';
import { OPEN_AT, usePeelPlayer } from './peel';
import { PeelSlider } from './PeelSlider';
import { useViewCommands } from './useViewCommands';
import { ViewMenu } from './ViewMenu';

/**
 * CanvasToolbar — WORKSTATION_V2 §5.11. Answers "How do I look at it?". Rendered in StageLayout's `bottom`
 * slot (bottom 12, centred on the free area; StageLayout counts its height in `stageInsets.bottom`).
 *
 *   View ▾ ⌂ │ Peel ○━━◆━━ ⟷ │ Layers ▾ │ ♥ ≋ │ ⤢ ⋯
 *
 * Its width is fixed (≈ 545 px at 1440, ≈ 510 at 1280): the View button has a fixed-width short label, so
 * selecting a vessel (whose view is "RAO 30 CRA 25") never re-centres the bar or moves the peel slider.
 *
 * Material: h 40 (36), r-lg, bg/panel, 1 px border/default, e-2, padding 4; groups split by 1 × 20
 * hairlines; icon buttons 32 (28) with 16 px lucide at stroke 1.5; pressed = surface/2 + accent icon;
 * every tooltip reads "Name · key". It also registers the view and layer commands (palette + keys).
 */
export interface CanvasToolbarProps {
  /** Compact stage (< 1100 px): icons only, no peel slider (▶ Dissect stays). */
  compact?: boolean;
  className?: string;
}

/**
 * Explode / Assemble (P): the icon says what it does — two halves pulled apart (explode: the great vessels
 * lift and the heart opens; from a closed chest the whole dissection plays) or pushed together (assemble back
 * to the rest state), never a media "play" triangle.
 */
function DissectButton() {
  const reduced = useIsReducedMotion();
  const playing = usePeelPlayer((s) => s.playing);
  const open = useViewerStore((s) => s.explode >= OPEN_AT);
  const name = playing ? 'Stop' : open ? 'Assemble' : 'Explode';
  return (
    <IconButton
      label={name}
      tooltip={withShortcut(
        playing ? 'Stop the peel' : open ? 'Assemble · close the heart' : 'Explode · open the heart',
        SHORTCUT.peel,
      )}
      icon={playing ? <Square className="!size-3.5 fill-current" /> : open ? <FoldHorizontal /> : <UnfoldHorizontal />}
      size="md"
      active={!!playing}
      className={TOOLBAR_ICON}
      aria-keyshortcuts={SHORTCUT.peel}
      onClick={() => usePeelPlayer.getState().toggle(reduced)}
    />
  );
}

export function CanvasToolbar({ compact = false, className }: CanvasToolbarProps) {
  useViewCommands();
  const heartbeat = useViewerStore((s) => s.heartbeat);
  const flow = useViewerStore((s) => s.bloodFlow);
  const calm = useViewerStore((s) => s.calm);
  const chrome = useUiStore((s) => s.chrome);
  const reduced = useIsReducedMotion();
  const bpm = Math.round(clampHeartRate(usePatientStore((s) => s.features.PR)));
  const v = useViewerStore.getState;
  const motionOff = reduced || calm;
  const motionWhy = calm ? 'paused in Calm mode' : 'paused: reduced motion is on';

  return (
    <StageCard
      as="div"
      role="toolbar"
      aria-label="View controls"
      shape="bare"
      region="toolbar"
      enterDelay={120}
      className={cn('flex h-[var(--toolbar-h)] items-center gap-0.5 p-1', className)}
    >
      <ViewMenu iconOnly={compact} />
      <IconButton
        label="Home view"
        tooltip={withShortcut('Home view', SHORTCUT.home)}
        icon={<Home />}
        size="md"
        className={TOOLBAR_ICON}
        onClick={() => v().flyHome()}
      />
      <ToolbarSeparator />
      {!compact && <PeelSlider />}
      <DissectButton />
      <ToolbarSeparator />
      <LayersPopover iconOnly={compact} />
      <ToolbarSeparator />
      <IconButton
        label="Heartbeat"
        tooltip={withShortcut(motionOff ? `Heartbeat · ${motionWhy}` : `Heartbeat · ${bpm} bpm from the patient's pulse`, SHORTCUT.beat)}
        icon={<Heart />}
        size="md"
        className={TOOLBAR_ICON}
        active={heartbeat && !motionOff}
        aria-pressed={heartbeat}
        onClick={() => v().toggle('heartbeat')}
      />
      <IconButton
        label="Illustrative coronary flow"
        tooltip={withShortcut(motionOff ? `Illustrative coronary flow · ${motionWhy}` : 'Illustrative coronary flow', SHORTCUT.flow)}
        icon={<Waves />}
        size="md"
        className={TOOLBAR_ICON}
        active={flow && !motionOff}
        aria-pressed={flow}
        onClick={() => v().toggle('bloodFlow')}
      />
      <ToolbarSeparator />
      <IconButton
        label={chrome === 'focus' ? 'Exit focus mode' : 'Focus mode'}
        tooltip={withShortcut(chrome === 'focus' ? 'Exit focus mode' : 'Focus mode · hide the cards', SHORTCUT.focusMode)}
        icon={chrome === 'focus' ? <Minimize2 /> : <Maximize2 />}
        size="md"
        className={TOOLBAR_ICON}
        aria-pressed={chrome === 'focus'}
        onClick={() => useUiStore.getState().toggleFocusMode()}
      />
      <MoreMenu />
    </StageCard>
  );
}
