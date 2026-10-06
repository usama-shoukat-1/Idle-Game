import { describe, expect, it } from 'vitest';

import { DESIGN_MIN_HEIGHT, DESIGN_WIDTH } from '@/core/constants/Layout';
import {
  anchorX,
  anchorY,
  computeLayoutMetrics,
  contentBoxUnits,
  resolveAnchorPosition,
  unitsToPx,
} from '@/ui/layout/LayoutMetrics';

/**
 * Responsive layout guarantees. The game must be correct on 16:9, 18:9, 19.5:9 and on a
 * desktop browser window, without any device-specific branches. Because the maths is a pure
 * function, every supported aspect ratio is verified here rather than by eyeballing devices.
 */
const DEVICES = [
  { name: '16:9 portrait (720x1280)', width: 720, height: 1280 },
  { name: '18:9 portrait (1080x2160)', width: 1080, height: 2160 },
  { name: '19.5:9 portrait (1170x2532, iPhone 13)', width: 1170, height: 2532 },
  { name: '20:9 portrait (1080x2400, Pixel)', width: 1080, height: 2400 },
  { name: 'small phone (360x640)', width: 360, height: 640 },
  { name: 'desktop landscape (1920x1080)', width: 1920, height: 1080 },
  { name: 'desktop window (1280x900)', width: 1280, height: 900 },
  { name: 'tablet portrait (820x1180)', width: 820, height: 1180 },
];

describe('computeLayoutMetrics', () => {
  for (const device of DEVICES) {
    describe(device.name, () => {
      const metrics = computeLayoutMetrics({ width: device.width, height: device.height });

      it('always produces a design-width play frame', () => {
        expect(metrics.frameUnits.width).toBeCloseTo(DESIGN_WIDTH, 3);
      });

      it('never shrinks the frame below the design minimum height', () => {
        expect(metrics.frameUnits.height).toBeGreaterThanOrEqual(DESIGN_MIN_HEIGHT - 0.001);
      });

      it('keeps the frame inside the viewport', () => {
        expect(metrics.frame.x).toBeGreaterThanOrEqual(-0.001);
        expect(metrics.frame.y).toBeGreaterThanOrEqual(-0.001);
        expect(metrics.frame.x + metrics.frame.width).toBeLessThanOrEqual(device.width + 0.001);
        expect(metrics.frame.y + metrics.frame.height).toBeLessThanOrEqual(device.height + 0.001);
      });

      it('scales design units consistently', () => {
        expect(unitsToPx(metrics, DESIGN_WIDTH)).toBeCloseTo(metrics.frame.width, 3);
      });
    });
  }

  it('fills the width on a tall phone (no letterboxing)', () => {
    const metrics = computeLayoutMetrics({ width: 1170, height: 2532 });
    expect(metrics.frame.x).toBe(0);
    expect(metrics.frame.width).toBe(1170);
    expect(metrics.letterboxed).toBe(false);
    // 19.5:9 gives a taller design area than the 16:9 minimum.
    expect(metrics.frameUnits.height).toBeGreaterThan(DESIGN_MIN_HEIGHT);
  });

  it('letterboxes a landscape desktop window into a portrait strip', () => {
    const metrics = computeLayoutMetrics({ width: 1920, height: 1080 });
    expect(metrics.letterboxed).toBe(true);
    expect(metrics.frameUnits.width).toBeCloseTo(DESIGN_WIDTH, 3);
    expect(metrics.frameUnits.height).toBeCloseTo(DESIGN_MIN_HEIGHT, 3);
    // The strip is horizontally centred: equal empty space on both sides.
    expect(metrics.frame.x).toBeCloseTo((1920 - metrics.frame.width) / 2, 3);
    expect(metrics.frame.y).toBeCloseTo(0, 3);
  });

  it('converts safe-area insets into design units and clamps absurd values', () => {
    const metrics = computeLayoutMetrics({ width: 1170, height: 2532 }, { top: 141, right: 0, bottom: 68, left: 0 });
    expect(metrics.safeAreaUnits.top).toBeCloseTo(141 / metrics.scale, 3);
    expect(metrics.safeAreaUnits.bottom).toBeCloseTo(68 / metrics.scale, 3);

    const absurd = computeLayoutMetrics({ width: 720, height: 1280 }, { top: 99999, right: 0, bottom: 0, left: 0 });
    expect(absurd.safeAreaUnits.top).toBeLessThanOrEqual(absurd.frameUnits.height * 0.25);
  });

  it('resolves anchors inside the frame', () => {
    const metrics = computeLayoutMetrics({ width: 1080, height: 2160 });
    expect(anchorX(metrics, 'left')).toBeCloseTo(metrics.frame.x, 3);
    expect(anchorX(metrics, 'center')).toBeCloseTo(metrics.frame.x + metrics.frame.width / 2, 3);
    expect(anchorX(metrics, 'right')).toBeCloseTo(metrics.frame.x + metrics.frame.width, 3);
    expect(anchorY(metrics, 'top')).toBeCloseTo(metrics.frame.y, 3);
    expect(anchorY(metrics, 'bottom')).toBeCloseTo(metrics.frame.y + metrics.frame.height, 3);
  });

  it('exposes a content box that excludes safe areas', () => {
    const metrics = computeLayoutMetrics({ width: 1170, height: 2532 }, { top: 100, right: 0, bottom: 60, left: 0 });
    const box = contentBoxUnits(metrics);

    expect(box.y).toBeCloseTo(metrics.safeAreaUnits.top, 3);
    expect(box.height).toBeCloseTo(
      metrics.frameUnits.height - metrics.safeAreaUnits.top - metrics.safeAreaUnits.bottom,
      3,
    );
  });

  it('handles degenerate (zero/one pixel) viewports without producing NaN', () => {
    for (const viewport of [{ width: 0, height: 0 }, { width: 1, height: 1 }]) {
      const metrics = computeLayoutMetrics(viewport);
      expect(Number.isFinite(metrics.scale)).toBe(true);
      expect(metrics.scale).toBeGreaterThan(0);
      expect(Number.isFinite(metrics.frameUnits.height)).toBe(true);
    }
  });
});

describe('resolveAnchorPosition', () => {
  const placements = [
    { name: 'bottom panel 660x420 with 24 gap', anchor: { anchorX: 'center', anchorY: 'bottom' } as const, size: { width: 660, height: 420 }, offset: 24 },
    { name: 'top bar chip 190x62', anchor: { anchorX: 'left', anchorY: 'top' } as const, size: { width: 190, height: 62 }, offset: 16 },
    { name: 'centred card', anchor: { anchorX: 'center', anchorY: 'middle' } as const, size: { width: 620, height: 620 }, offset: 0 },
  ];

  for (const device of DEVICES) {
    for (const placement of placements) {
      it(`${placement.name} stays inside the ${device.name} frame`, () => {
        const metrics = computeLayoutMetrics({ width: device.width, height: device.height });
        const [x, y] = resolveAnchorPosition(metrics, {
          anchorX: placement.anchor.anchorX,
          anchorY: placement.anchor.anchorY,
          offsetX: placement.offset,
          offsetY: placement.offset,
          size: placement.size,
        });

        // half-size shifted placement must keep the whole widget inside the play frame
        expect(x - placement.size.width / 2).toBeGreaterThanOrEqual(-0.001);
        expect(x + placement.size.width / 2).toBeLessThanOrEqual(metrics.frameUnits.width + 0.001);
        expect(y - placement.size.height / 2).toBeGreaterThanOrEqual(-0.001);
        expect(y + placement.size.height / 2).toBeLessThanOrEqual(metrics.frameUnits.height + 0.001);
      });
    }
  }

  it('places a bottom-anchored panel fully above the safe area inset', () => {
    const metrics = computeLayoutMetrics({ width: 1170, height: 2532 }, { top: 100, right: 0, bottom: 60, left: 0 });
    const [x, y] = resolveAnchorPosition(metrics, {
      anchorX: 'center',
      anchorY: 'bottom',
      offsetY: 24,
      size: { width: 660, height: 420 },
      respectSafeArea: true,
    });

    expect(x).toBeCloseTo(metrics.frameUnits.width / 2, 3);
    expect(y + 210).toBeCloseTo(metrics.frameUnits.height - metrics.safeAreaUnits.bottom - 24, 3);
  });

  it('centres when no size is provided', () => {
    const metrics = computeLayoutMetrics({ width: 1080, height: 2160 });
    expect(resolveAnchorPosition(metrics, { anchorX: 'center', anchorY: 'middle' })).toEqual([
      metrics.frameUnits.width / 2,
      metrics.frameUnits.height / 2,
    ]);
  });
});
