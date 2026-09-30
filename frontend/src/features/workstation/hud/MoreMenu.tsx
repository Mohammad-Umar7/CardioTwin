import { ArrowLeft, ArrowRight, Expand, Keyboard, MoreHorizontal, Orbit, RefreshCcw, Shrink, Wind } from 'lucide-react';
import { useEffect, useState } from 'react';
import { IconButton, Menu, MenuItem, MenuLabel, MenuSeparator } from '@/design';
import { cn } from '@/lib/cn';
import { SHORTCUT } from '@/state/commandIds';
import { useUiStore } from '@/state/uiStore';
import { useViewerStore } from '@/state/viewerStore';
import { useCameraState } from '@/three/camera/cameraState';
import { useSceneControls } from '@/three/stage/sceneControls';
import { TOOLBAR_ICON } from './controls';
import { QUALITY_OPTIONS, qualityAvailable, qualityValue, setQuality, tierSummary } from './quality';

function useFullscreen(): [boolean, () => void] {
  const [on, setOn] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement);
  useEffect(() => {
    const sync = () => setOn(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  // The whole app goes full screen so the status line (disclaimer) stays visible (LUMEN §9).
  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void (document.getElementById('app') ?? document.documentElement).requestFullscreen?.();
  };
  return [on, toggle];
}

/**
 * ⋯ More (WORKSTATION_V2 §5.11): Calm mode (C) · Quality: Auto (tier · fps) / High / Balanced / Lite ·
 * Free orbit (unclamped) · camera Back / Forward · Full screen · Replay assembly · Keyboard shortcuts (?).
 */
export function MoreMenu() {
  const calm = useViewerStore((s) => s.calm);
  const tier = useViewerStore((s) => s.tier);
  const locked = useViewerStore((s) => s.tierLocked);
  const fps = useViewerStore((s) => s.fps);
  const freeOrbit = useCameraState((s) => s.freeOrbit);
  const canBack = useCameraState((s) => s.canBack);
  const canForward = useCameraState((s) => s.canForward);
  const [fullscreen, toggleFullscreen] = useFullscreen();
  const quality = qualityValue(tier, locked);

  return (
    <Menu
      label="More view options"
      placement="top"
      width={260}
      trigger={({ ref, ...props }) => (
        <IconButton
          ref={ref as (el: HTMLButtonElement | null) => void}
          label="More"
          tooltip="More · calm, quality, camera"
          icon={<MoreHorizontal />}
          size="md"
          active={props['aria-expanded']}
          className={cn(TOOLBAR_ICON)}
          {...props}
        />
      )}
    >
      <MenuItem type="checkbox" checked={calm} shortcut={SHORTCUT.calm} keepOpen onSelect={() => useViewerStore.getState().toggle('calm')}>
        <span className="inline-flex items-center gap-2">
          <Wind aria-hidden className="size-4 stroke-[1.5] text-secondary" />
          Calm mode
        </span>
      </MenuItem>
      <MenuItem type="checkbox" checked={freeOrbit} keepOpen onSelect={() => useCameraState.getState().setFreeOrbit(!freeOrbit)}>
        <span className="inline-flex items-center gap-2">
          <Orbit aria-hidden className="size-4 stroke-[1.5] text-secondary" />
          Free orbit <span className="text-tertiary">· unclamped</span>
        </span>
      </MenuItem>
      <MenuSeparator />
      <MenuLabel>Quality</MenuLabel>
      {QUALITY_OPTIONS.map((o) => (
        <MenuItem
          key={o.value}
          type="radio"
          checked={quality === o.value}
          disabled={quality === null || !qualityAvailable(o.value)}
          hint={o.value === 'auto' ? tierSummary(tier, fps) : o.hint}
          onSelect={() => setQuality(o.value)}
        >
          {o.label}
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuLabel>Camera</MenuLabel>
      <MenuItem icon={<ArrowLeft />} disabled={!canBack} onSelect={() => useCameraState.getState().back()}>
        Back
      </MenuItem>
      <MenuItem icon={<ArrowRight />} disabled={!canForward} onSelect={() => useCameraState.getState().forward()}>
        Forward
      </MenuItem>
      <MenuItem icon={fullscreen ? <Shrink /> : <Expand />} onSelect={toggleFullscreen}>
        {fullscreen ? 'Exit full screen' : 'Full screen'}
      </MenuItem>
      <MenuItem icon={<RefreshCcw />} onSelect={() => useSceneControls.getState().replayAssembly()}>
        Replay assembly
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={<Keyboard />} shortcut={SHORTCUT.shortcuts} onSelect={() => useUiStore.getState().setShortcutsOpen(true)}>
        Keyboard shortcuts
      </MenuItem>
    </Menu>
  );
}
