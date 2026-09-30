/**
 * Anatomy layers shown in Layers ▾ (WORKSTATION_V2 §5.11) and their defaults. The scene treats a layer
 * missing from `viewerStore.layerVisibility` as its default: every layer is visible. The lungs are solid in
 * the closed chest and part during the dissection; at the rest detent the whole thorax is set aside, so the
 * heart stands alone (§5.15). Pure helpers, unit-tested in hud.test.ts.
 */
import { useViewerStore, type LayerVisibility, type Stage } from '@/state/viewerStore';
import { useSceneControls } from '@/three/stage/sceneControls';

export type AnatomyLayerId = 'skin' | 'muscle' | 'skeleton' | 'lungs' | 'diaphragm';

export const ANATOMY_LAYERS: readonly { id: AnatomyLayerId; label: string }[] = [
  { id: 'skin', label: 'Skin' },
  { id: 'muscle', label: 'Chest muscles' },
  { id: 'skeleton', label: 'Rib cage' },
  { id: 'lungs', label: 'Lungs & airway' },
  { id: 'diaphragm', label: 'Diaphragm' },
];

/** Default visibility of a layer on a stage (mirrors the anatomy rig's rule). */
export const layerDefault = (_id: string, _stage: Stage): boolean => true;

export const layerVisible = (id: string, visibility: LayerVisibility, stage: Stage): boolean =>
  visibility[id] ?? layerDefault(id, stage);

/** False when the user changed the layer by hand (the Layers popover shows a dot). */
export const layerIsDefault = (id: string, visibility: LayerVisibility, stage: Stage): boolean =>
  layerVisible(id, visibility, stage) === layerDefault(id, stage);

/** Reset layers: defaults for every layer, ghosting on, cardiac veins on, section off. */
export function resetLayers(): void {
  useViewerStore.setState({ layerVisibility: {} });
  const viewer = useViewerStore.getState();
  if (!viewer.ghostLayers) viewer.set('ghostLayers', true);
  const scene = useSceneControls.getState();
  scene.setShowVeins(true);
  scene.setSection(false);
}
