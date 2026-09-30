import { Eye, EyeOff, Layers, RotateCcw } from 'lucide-react';
import { Kbd, Popover, SegmentedControl, Shortcut } from '@/design';
import { useManifest } from '@/hooks/useData';
import { cn } from '@/lib/cn';
import { SHORTCUT } from '@/state/commandIds';
import { TERRITORY_MODES, useViewerStore, type TerritoryMode } from '@/state/viewerStore';
import { LOOK_OPTIONS, lookOf, storeValueFor, useSceneControls } from '@/three/stage/sceneControls';
import { HudSwitch, ToolbarTextButton } from './controls';
import { ANATOMY_LAYERS, layerIsDefault, layerVisible, resetLayers, type AnatomyLayerId } from './layers';

const TERRITORY_LABEL: Record<TerritoryMode, string> = { off: 'Off', selected: 'Selected', all: 'All' };

function SectionLabel({ children, shortcut }: { children: string; shortcut?: string }) {
  return (
    <div className="flex h-6 items-center justify-between px-2">
      <span className="eyebrow text-tertiary">{children}</span>
      {shortcut && <Shortcut shortcut={shortcut} />}
    </div>
  );
}

/**
 * Layers ▾ (WORKSTATION_V2 §5.11): a 280 px popover above the toolbar with the look (Realistic ·
 * Clinical), territories (Off · Selected · All, T), labels (L), the anatomy layers with eye toggles and a
 * hand-changed dot, ghosting, the cardiac veins and the cut-away section, the territory note and Reset.
 */
export function LayersPopover({ iconOnly = false }: { iconOnly?: boolean }) {
  const manifest = useManifest().data;
  const look = useViewerStore((s) => s.look);
  const territoryMode = useViewerStore((s) => s.territoryMode);
  const labels = useViewerStore((s) => s.labels);
  const ghostLayers = useViewerStore((s) => s.ghostLayers);
  const visibility = useViewerStore((s) => s.layerVisibility);
  const stage = useViewerStore((s) => s.stage);
  const showVeins = useSceneControls((s) => s.showVeins);
  const section = useSceneControls((s) => s.section);
  const viewer = useViewerStore.getState;

  const layerLabel = (id: AnatomyLayerId, fallback: string) => manifest?.layers.find((l) => l.id === id)?.label ?? fallback;
  const changed =
    ANATOMY_LAYERS.some((l) => !layerIsDefault(l.id, visibility, stage)) || !ghostLayers || showVeins || section;

  return (
    <Popover
      label="Layers"
      placement="top"
      width={288}
      className="!p-1"
      trigger={({ ref, ...props }) => (
        <ToolbarTextButton
          ref={ref}
          icon={<Layers />}
          open={props['aria-expanded']}
          tooltip={iconOnly ? 'Layers' : 'Look, territories, labels and anatomy layers'}
          aria-label="Layers"
          iconOnly={iconOnly}
          {...props}
        >
          Layers
        </ToolbarTextButton>
      )}
    >
      <div className="flex flex-col gap-0.5 text-primary">
        <SectionLabel>Look</SectionLabel>
        <div className="px-2 pb-1">
          <SegmentedControl
            label="Look"
            size="xs"
            fullWidth
            value={lookOf(look)}
            onChange={(v) => viewer().set('look', storeValueFor(v))}
            options={LOOK_OPTIONS.map((o) => ({ value: o.value, label: o.label, title: o.hint }))}
          />
        </div>
        <SectionLabel shortcut={SHORTCUT.territories}>Territories</SectionLabel>
        <div className="px-2 pb-1">
          <SegmentedControl
            label="Territories"
            size="xs"
            fullWidth
            value={territoryMode}
            onChange={(v) => viewer().setTerritoryMode(v)}
            options={TERRITORY_MODES.map((m) => ({ value: m, label: TERRITORY_LABEL[m] }))}
          />
        </div>
        <HudSwitch label="Labels" checked={labels} onChange={(on) => viewer().set('labels', on)} hint={<Kbd>{SHORTCUT.labels}</Kbd>} />

        <div className="mx-1 my-1 h-px bg-line" />
        <SectionLabel>Anatomy layers</SectionLabel>
        <ul className="flex flex-col">
          {ANATOMY_LAYERS.map((l) => {
            const on = layerVisible(l.id, visibility, stage);
            const edited = !layerIsDefault(l.id, visibility, stage);
            return (
              <li key={l.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => viewer().setLayerVisible(l.id, !on)}
                  className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-body-s outline-none transition-colors duration-instant hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:shadow-focus"
                >
                  <span aria-hidden className={cn('inline-flex [&>svg]:size-4 [&>svg]:stroke-[1.5]', on ? 'text-secondary' : 'text-disabled')}>
                    {on ? <Eye /> : <EyeOff />}
                  </span>
                  <span className={cn('min-w-0 flex-1 truncate', on ? 'text-primary' : 'text-tertiary')}>{layerLabel(l.id, l.label)}</span>
                  {edited && <span aria-label="changed" className="size-1.5 shrink-0 rounded-full bg-accent" />}
                </button>
              </li>
            );
          })}
        </ul>
        <HudSwitch label="Ghost removed layers" checked={ghostLayers} onChange={(on) => viewer().set('ghostLayers', on)} />
        <HudSwitch label="Cardiac veins" checked={showVeins} onChange={(on) => useSceneControls.getState().setShowVeins(on)} />
        <HudSwitch label="Cut-away section" checked={section} onChange={(on) => useSceneControls.getState().setSection(on)} />

        <div className="mx-1 my-1 h-px bg-line" />
        <p className="px-2 pb-1 text-label font-normal text-tertiary">
          Territory tint = approximate supplied territory, not a perfusion scan.
        </p>
        {changed && (
          <button
            type="button"
            onClick={() => resetLayers()}
            className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-body-s text-secondary outline-none transition-colors duration-instant hover:bg-surface-2 hover:text-primary focus-visible:bg-surface-2 focus-visible:shadow-focus [&>svg]:size-4 [&>svg]:stroke-[1.5]"
          >
            <RotateCcw aria-hidden />
            Reset layers
          </button>
        )}
      </div>
    </Popover>
  );
}
