import { describe, expect, it } from 'vitest';
import { computeStageInsets } from '@/features/workstation/stageInsets';
import { useUiStore } from '@/state/uiStore';
import { announceSeamlessHandoff, sameSlotRect, takeSeamlessHandoff } from '@/three/sceneSlot';
import { enterWorkstationFromLanding, registerWorkstationEntry } from './entry';
import { predictedWorkstationInsets } from './useEnterWorkstation';
import { COPY_GAP, HERO_COPY_MIN_SHARE, LANDING_SPLIT_AT, heroInsets } from './useLandingStage';

describe('heroInsets', () => {
  it('covers the copy column (from its widest line) so the camera centres the torso beside it', () => {
    expect(heroInsets(1440, 620)).toEqual({ left: 620 + COPY_GAP, right: 0, top: 0, bottom: 0 });
  });

  it('never leaves the torso less than the minimum share of the stage to the copy', () => {
    expect(heroInsets(1920, 300).left).toBe(Math.round(1920 * HERO_COPY_MIN_SHARE));
    expect(heroInsets(1440).left).toBe(Math.round(1440 * HERO_COPY_MIN_SHARE));
  });

  it('publishes nothing when the landing stacks', () => {
    expect(heroInsets(LANDING_SPLIT_AT - 1, 500)).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
    expect(heroInsets(0, 0)).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });

  it("follows the page's media query, not the hero's box (narrower than the viewport by the scrollbar)", () => {
    // A 1024 px window with a 10 px scrollbar: the copy sits beside the stage, so its column is covered.
    expect(heroInsets(1014, 507, true).left).toBe(507 + COPY_GAP);
    expect(heroInsets(1030, 507, false).left).toBe(0);
  });
});

describe('the dolly into the workstation', () => {
  it("lands on the free area the workstation's cards will publish (its own rule and tokens)", () => {
    useUiStore.setState({ patientCardOpen: true, drawer: null });
    const { insets, handoff } = predictedWorkstationInsets(1440);
    expect(handoff).toBe(true);
    // jsdom has no CSS custom properties: the 1440 tokens are the fallbacks (280 · 352 · 40, inset 12).
    expect(insets).toEqual({ left: 304, right: 376, top: 12, bottom: 64 });
    expect(insets).toEqual(
      computeStageInsets({
        chrome: 'workstation',
        drawer: null,
        stageInset: 12,
        left: { width: 280, height: 1 },
        right: { width: 352, height: 1 },
        bottom: { width: 1, height: 40 },
        drawerInputsWidth: 400,
        drawerExplainWidth: 440,
      }),
    );
  });

  it('follows the patient card the user collapsed to its rail', () => {
    useUiStore.setState({ patientCardOpen: false, drawer: null });
    expect(predictedWorkstationInsets(1440).insets.left).toBe(12 + 40 + 12);
    useUiStore.setState({ patientCardOpen: true });
  });

  it('frames the heart in the hero canvas when the workstation stacks (no seamless handoff there)', () => {
    expect(predictedWorkstationInsets(1000)).toEqual({ insets: { left: 0, right: 0, top: 0, bottom: 0 }, handoff: false });
  });

  it('hands the canvas over once, at the same rectangle, and only right after it was announced', () => {
    const rect = { left: 0, top: 48, width: 1440, height: 824 };
    announceSeamlessHandoff(rect);
    const taken = takeSeamlessHandoff();
    expect(taken).toEqual(rect);
    expect(takeSeamlessHandoff()).toBeNull();
    expect(sameSlotRect(rect, { left: 0.4, top: 48.6, width: 1440, height: 823.5 })).toBe(true);
    expect(sameSlotRect(rect, { left: 0, top: 48, width: 1430, height: 824 })).toBe(false);
  });

  it("lets the top bar's Workstation link play the landing's entry only while the landing is mounted", () => {
    let calls = 0;
    const unregister = registerWorkstationEntry(() => {
      calls += 1;
      return true;
    });
    expect(enterWorkstationFromLanding()).toBe(true);
    expect(calls).toBe(1);
    unregister();
    expect(enterWorkstationFromLanding()).toBe(false);
    expect(calls).toBe(1);
  });
});
