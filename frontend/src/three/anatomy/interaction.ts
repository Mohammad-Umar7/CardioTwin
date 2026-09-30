import type { ThreeEvent } from '@react-three/fiber';
import type { TargetId } from '@/types/contracts';
import { useViewerStore } from '@/state/viewerStore';

/**
 * Pointer handlers shared by procedural and GLB vessels (DESIGN_SYSTEM §7.5): hover lights the vessel and
 * its panel row, click selects (camera flies to the vessel's best view, the WHY tab follows).
 */
export function vesselHandlers(target: TargetId) {
  return {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      useViewerStore.getState().hover(target);
      document.body.style.cursor = 'pointer';
    },
    onPointerOut: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      if (useViewerStore.getState().hoveredStructure === target) useViewerStore.getState().hover(null);
      document.body.style.cursor = '';
    },
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      const { selectedStructure, select } = useViewerStore.getState();
      select(selectedStructure === target ? null : target);
    },
  };
}
