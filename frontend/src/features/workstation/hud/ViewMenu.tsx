import { Crosshair, Home, Video } from 'lucide-react';
import { Menu, MenuItem, MenuLabel, MenuSeparator, Shortcut } from '@/design';
import { SHORTCUT } from '@/state/commandIds';
import { useViewerStore } from '@/state/viewerStore';
import { useCameraState } from '@/three/camera/cameraState';
import { PROJECTIONS } from '@/three/camera/presets';
import { ToolbarTextButton } from './controls';

/**
 * View ▾ (WORKSTATION_V2 §5.11): a text button with the current view's name ("AP", "RAO 30 · CRA 25",
 * "Custom" after a free orbit) opening the C-arm projections (`[` `]` cycle them), Home view (H) and
 * Frame selection (double-click a vessel).
 */
export function ViewMenu({ iconOnly = false }: { iconOnly?: boolean }) {
  const label = useCameraState((s) => s.viewLabel);
  const kind = useCameraState((s) => s.viewKind);
  const presetId = useCameraState((s) => s.presetId);
  const selected = useViewerStore((s) => s.selectedStructure);
  const viewer = useViewerStore.getState;

  return (
    <Menu
      label="View"
      placement="top"
      width={232}
      trigger={({ ref, ...props }) => (
        <ToolbarTextButton
          ref={ref}
          icon={<Video />}
          open={props['aria-expanded']}
          tooltip={iconOnly ? `View: ${label}` : 'View · C-arm projections'}
          aria-label={`View: ${label}`}
          iconOnly={iconOnly}
          className="max-w-[148px] max-[1439.98px]:max-w-[132px]"
          {...props}
        >
          <span className="num">{label}</span>
        </ToolbarTextButton>
      )}
    >
      <MenuLabel>
        <span className="flex items-center justify-between">
          C-arm projections
          <span className="flex gap-0.5 normal-case tracking-normal">
            <Shortcut shortcut={SHORTCUT.projectionPrev} />
            <Shortcut shortcut={SHORTCUT.projectionNext} />
          </span>
        </span>
      </MenuLabel>
      {PROJECTIONS.map((p) => (
        <MenuItem
          key={p.id}
          type="radio"
          checked={kind === 'preset' && presetId === p.id}
          onSelect={() => viewer().flyToPreset(p.id)}
        >
          {p.label}
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem icon={<Home />} shortcut={SHORTCUT.home} onSelect={() => viewer().flyHome()}>
        Home view
      </MenuItem>
      <MenuItem
        icon={<Crosshair />}
        disabled={!selected}
        hint="double-click"
        onSelect={() => selected && viewer().focusTarget(selected)}
      >
        {selected ? `Frame ${selected}` : 'Frame selection'}
      </MenuItem>
    </Menu>
  );
}
