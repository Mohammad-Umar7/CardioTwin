import { useFrame, useThree } from '@react-three/fiber';
import { useRef } from 'react';
import { Vector3 } from 'three';
import { useViewerStore } from '@/state/viewerStore';
import { getAnchors } from '../anatomy/anchors';
import { LABEL_MIN_GAP, LANE_MARGIN, defaultLane, labelEls, lineEls, stackLane } from './labelRegistry';

const projected = new Vector3();
const toCamera = new Vector3();

/**
 * Canvas-side half of the vessel labels: projects each anchor, assigns radiological lanes, stacks labels
 * without crossings, dims far-side labels to 25 % with a dashed leader and "(posterior)", and writes the
 * result straight into the overlay's DOM nodes.
 */
export function LabelProjector() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const lastKey = useRef('');

  useFrame(() => {
    const viewer = useViewerStore.getState();
    const anchors = getAnchors();
    const visible = viewer.labels && anchors.size > 0;
    const { width, height } = size;
    const compact = width < 640;
    const swap = Math.abs(viewer.carm?.azimuth ?? 0) > 90;

    const lanes: Record<'left' | 'right', { id: string; y: number; x: number; posterior: boolean }[]> = { left: [], right: [] };
    for (const [id, anchor] of anchors) {
      if (!labelEls.has(id) || !lineEls.has(id)) continue;
      projected.copy(anchor.position).project(camera);
      const x = ((projected.x + 1) / 2) * width;
      const y = ((1 - projected.y) / 2) * height;
      toCamera.copy(camera.position).sub(anchor.position).normalize();
      const posterior = anchor.normal.dot(toCamera) < 0;
      let lane = defaultLane(id);
      if (swap) lane = lane === 'left' ? 'right' : 'left';
      lanes[lane].push({ id, x, y, posterior });
    }

    for (const lane of ['left', 'right'] as const) {
      const items = lanes[lane];
      const stacked = stackLane(items, LABEL_MIN_GAP, 40, height - 72);
      for (const item of items) {
        const label = labelEls.get(item.id)!;
        const line = lineEls.get(item.id)!;
        const ly = stacked.get(item.id) ?? item.y;
        const labelWidth = label.offsetWidth || 120;
        const lx = lane === 'left' ? LANE_MARGIN : width - LANE_MARGIN - labelWidth;
        const edgeX = lane === 'left' ? lx + labelWidth : lx;
        label.style.transform = `translate3d(${lx.toFixed(1)}px, ${(ly - 14).toFixed(1)}px, 0)`;
        label.style.opacity = visible ? (item.posterior ? '0.25' : '1') : '0';
        label.dataset.posterior = item.posterior ? 'true' : 'false';
        label.dataset.compact = compact ? 'true' : 'false';
        line.setAttribute('x1', edgeX.toFixed(1));
        line.setAttribute('y1', ly.toFixed(1));
        line.setAttribute('x2', item.x.toFixed(1));
        line.setAttribute('y2', item.y.toFixed(1));
        line.style.opacity = visible ? (item.posterior ? '0.35' : '0.7') : '0';
        line.setAttribute('stroke-dasharray', item.posterior ? '3 3' : '');
      }
    }
    // Hide labels whose anchor disappeared (e.g. anatomy switched).
    const key = [...anchors.keys()].join(',');
    if (key !== lastKey.current) {
      lastKey.current = key;
      for (const [id, label] of labelEls) {
        if (!anchors.has(id)) {
          label.style.opacity = '0';
          const line = lineEls.get(id);
          if (line) line.style.opacity = '0';
        }
      }
    }
  });

  return null;
}
