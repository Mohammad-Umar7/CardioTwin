import { Heart, Home, Maximize2, Minimize2, Tags, Waves, Wind } from 'lucide-react';
import { useEffect, useState } from 'react';
import { HairlineProgress, IconButton, RiskLegend, SegmentedControl, Toggle } from '@/design';
import { useLayoutMode } from '@/hooks/useMediaQuery';
import { usePatientStore } from '@/state/patientStore';
import { useViewerStore } from '@/state/viewerStore';
import { Credits, Watermark } from '@/features/landing/HeroHud';
import { PROJECTIONS, formatCarm } from '@/three/camera/presets';
import { clampHeartRate } from '@/three/anatomy/heartbeat';

function Breadcrumb() {
  const selected = useViewerStore((s) => s.selectedStructure);
  const carm = useViewerStore((s) => s.carm);
  const source = useViewerStore((s) => s.anatomySource);
  const progress = useViewerStore((s) => s.anatomyProgress);
  return (
    <div className="flex flex-col gap-1">
      <nav aria-label="3D selection" className="hud-chip flex h-6 items-center gap-1 px-2 text-label font-normal text-secondary">
        <span>Heart</span>
        <span aria-hidden className="text-tertiary">›</span>
        <span className={selected ? '' : 'text-primary'}>Coronary</span>
        {selected && (
          <>
            <span aria-hidden className="text-tertiary">›</span>
            <span className="text-primary">{selected}</span>
          </>
        )}
      </nav>
      {carm && (
        <span className="mono pl-1 text-mono-s text-tertiary" aria-live="off">
          C-arm {formatCarm(carm.azimuth, carm.elevation)}
        </span>
      )}
      {source === 'loading' && (
        <div className="flex w-44 flex-col gap-1 pl-1">
          <HairlineProgress value={progress ? progress.loaded / progress.total : null} label="Loading anatomy" />
          <span className="text-label font-normal text-tertiary">
            Loading anatomy{progress ? ` ${Math.round((progress.loaded / progress.total) * 100)} %` : '…'}
          </span>
        </div>
      )}
      {(source === 'procedural' || source === 'error') && (
        <span className="pl-1 text-label font-normal text-tertiary">
          Schematic heart{source === 'error' ? ' · anatomy failed to load' : ''}
        </span>
      )}
    </div>
  );
}

function Projections() {
  const flyToPreset = useViewerStore((s) => s.flyToPreset);
  const flyHome = useViewerStore((s) => s.flyHome);
  const mode = useLayoutMode();
  const [fullscreen, setFullscreen] = useState(false);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const on = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  // Fullscreen applies to the whole app container so the status line stays visible (§9).
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.getElementById('app')?.requestFullscreen?.();
  };

  const presets = mode === 'wide' ? PROJECTIONS.slice(0, 3) : [];
  return (
    <div className="flex items-center gap-1.5">
      {presets.length > 0 ? (
        <SegmentedControl
          label="Projection"
          size="xs"
          value={active}
          onChange={(id) => {
            setActive(id);
            flyToPreset(id);
          }}
          options={presets.map((p) => ({ value: p.id, label: p.label }))}
          className="hud-chip"
        />
      ) : (
        <select
          aria-label="Projection"
          value={active ?? ''}
          onChange={(e) => {
            setActive(e.target.value);
            flyToPreset(e.target.value);
          }}
          className="hud-chip h-6 px-1.5 text-label text-secondary outline-none"
        >
          <option value="" disabled>
            Projection
          </option>
          {PROJECTIONS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      )}
      <IconButton
        label="Home view (H)"
        icon={<Home />}
        size="xs"
        variant="hud"
        onClick={() => {
          setActive(null);
          flyHome();
        }}
      />
      <IconButton
        label={fullscreen ? 'Exit full screen' : 'Full screen'}
        icon={fullscreen ? <Minimize2 /> : <Maximize2 />}
        size="xs"
        variant="hud"
        onClick={toggleFullscreen}
      />
    </div>
  );
}

function LayerToggles() {
  const heartbeat = useViewerStore((s) => s.heartbeat);
  const territories = useViewerStore((s) => s.territories);
  const labels = useViewerStore((s) => s.labels);
  const calm = useViewerStore((s) => s.calm);
  const look = useViewerStore((s) => s.look);
  const toggle = useViewerStore((s) => s.toggle);
  const set = useViewerStore((s) => s.set);
  const pr = usePatientStore((s) => s.features.PR);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Toggle variant="hud" pressed={territories} onPressedChange={() => toggle('territories')} icon={<Waves />} hint="Approximate supplied territory tint (T)">
        Territories
      </Toggle>
      <Toggle variant="hud" pressed={heartbeat} onPressedChange={() => toggle('heartbeat')} icon={<Heart />} hint="Heartbeat at the patient's pulse rate (B)">
        Beat {Math.round(clampHeartRate(pr))}
      </Toggle>
      <Toggle variant="hud" pressed={labels} onPressedChange={() => toggle('labels')} icon={<Tags />} hint="Vessel labels">
        Labels
      </Toggle>
      <Toggle variant="hud" pressed={calm} onPressedChange={() => toggle('calm')} icon={<Wind />} hint="Calm mode: no motion (C)">
        Calm
      </Toggle>
      <SegmentedControl
        label="Myocardium look"
        size="xs"
        value={look}
        onChange={(v) => set('look', v)}
        options={[
          { value: 'clay', label: 'Clay' },
          { value: 'anat', label: 'Anat' },
        ]}
        className="hud-chip"
      />
    </div>
  );
}

/**
 * Canvas HUD (DESIGN_SYSTEM §4.2, §5 CanvasHUD): breadcrumb + live C-arm readout top-left, projections /
 * home / fullscreen top-right with the NOT FOR DIAGNOSTIC USE watermark, legend with the selected target's
 * threshold and layer toggles along the bottom, BodyParts3D credit bottom-right. Chips are surface/3 at
 * 88 % with e-hud, no backdrop blur.
 */
export function CanvasHud() {
  const selected = useViewerStore((s) => s.selectedStructure);
  const threshold = usePatientStore((s) => s.prediction?.predictions[selected ?? 'CAD']?.threshold ?? null);
  return (
    <>
      <div className="pointer-events-none absolute inset-x-3 top-3 z-hud flex items-start justify-between gap-3 [&>*]:pointer-events-auto">
        <Breadcrumb />
        <div className="flex flex-col items-end gap-1.5">
          <Projections />
          <Watermark />
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-3 bottom-3 z-hud flex flex-col gap-2 [&>*]:pointer-events-auto">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="hud-chip flex flex-col gap-1 px-2.5 py-1.5">
            <RiskLegend threshold={threshold} caption={selected ? `P(stenosis) · thr ${selected}` : 'P(stenosis)'} />
            <span className="text-[0.6875rem] leading-4 text-tertiary">territory tint = approximate supplied territory, not a perfusion scan</span>
          </div>
          <span className="hidden text-label font-normal text-tertiary min-[1280px]:inline">
            Drag to rotate · scroll to zoom · 1 2 3 select · H home · ? shortcuts
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <LayerToggles />
          <Credits />
        </div>
      </div>
    </>
  );
}
