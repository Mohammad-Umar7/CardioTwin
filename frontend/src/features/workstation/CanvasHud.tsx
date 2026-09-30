import { useLayoutEffect } from 'react';
import { useLayoutMode } from '@/hooks/useMediaQuery';
import { useUiStore } from '@/state/uiStore';
import { CanvasToolbar } from './hud/CanvasToolbar';
import { FirstRunHint } from './hud/FirstRunHint';
import { LegendChip } from './hud/LegendChip';
import { SelectionChip } from './hud/SelectionChip';

/** Stage inset (px) and the toolbar's height, mirrored from the V2 layout tokens (40 at ≥ 1440, 36 below). */
const INSET = 12;

/**
 * The V2 HUD for the layouts that do not use StageLayout yet (`?layout=legacy` and the stacked < 1100 px
 * layout): the selection chip top-centre, the canvas toolbar bottom-centre (icons only when compact) and
 * the legend chip bottom-left, over the canvas — the same components as the stage, so there is one HUD.
 * It publishes the free area it leaves (the toolbar band at the bottom) so the camera centres the heart
 * above it. The phase-1 breadcrumb, projection buttons, layer chips, watermark, credits (now in the status
 * line) and hint sentence are gone (V2 §5.20).
 */
export function CanvasHud() {
  const compact = useLayoutMode() === 'compact';

  useLayoutEffect(() => {
    const toolbar = compact ? 36 : 40;
    useUiStore.getState().setStageInsets({ left: 0, right: 0, top: INSET, bottom: INSET + toolbar + INSET });
  }, [compact]);

  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-3 z-panels flex justify-center [&>*]:pointer-events-auto">
        <SelectionChip />
      </div>
      <div className="pointer-events-none absolute inset-x-3 bottom-3 z-panels flex items-end justify-center [&>*]:pointer-events-auto">
        {!compact && (
          <div className="absolute bottom-0 left-0 max-[1279.98px]:hidden">
            <LegendChip />
          </div>
        )}
        <CanvasToolbar compact={compact} />
      </div>
      <FirstRunHint />
    </>
  );
}
