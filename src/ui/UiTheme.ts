/**
 * UI theme tokens.
 *
 * Placeholder styling on purpose: Phase 0 proves layout/scaling on many aspect
 * ratios, real illustration and polish come later. All values are numbers (for
 * Phaser Graphics) plus their hex strings for Text objects.
 */

import { UI_FONT_FAMILY } from '@/core/constants';
import type { FontSize, Viewport } from './layout/Viewport';

export const COLORS = {
  bgTop: 0x141a23,
  bgBottom: 0x0b0e14,
  panel: 0x161b22,
  panelAlt: 0x1c232d,
  border: 0x2b3444,
  text: 0xe6edf3,
  textDim: 0x9aa7b4,
  accent: 0xffb347,
  accentDark: 0xa86c14,
  success: 0x54d18a,
  warning: 0xf2c14e,
  danger: 0xe5484d,
  coin: 0xffd166,
  gem: 0x6fd3ff,
  overlay: 0x000000,
} as const;

export const HEX = {
  text: '#e6edf3',
  textDim: '#9aa7b4',
  accent: '#ffb347',
  success: '#54d18a',
  warning: '#f2c14e',
  danger: '#e5484d',
  coin: '#ffd166',
  gem: '#6fd3ff',
  dark: '#0b0e14',
} as const;

export const FONTS = {
  family: UI_FONT_FAMILY,
  sizes: {
    xs: 0.021,
    sm: 0.025,
    md: 0.031,
    lg: 0.045,
    xl: 0.062,
    title: 0.105,
  } as const,
} as const;

export function fontPx(viewport: Viewport, size: FontSize): number {
  return viewport.font(size);
}

export function textStyle(
  viewport: Viewport,
  options: {
    size?: FontSize;
    color?: string;
    bold?: boolean;
    align?: 'left' | 'center' | 'right';
  } = {},
): Phaser.Types.GameObjects.Text.TextStyle {
  return {
    fontFamily: FONTS.family,
    fontSize: `${fontPx(viewport, options.size ?? 'md')}px`,
    color: options.color ?? HEX.text,
    fontStyle: options.bold ? 'bold' : 'normal',
    align: options.align ?? 'left',
    resolution: Math.min(2, Math.max(1, window.devicePixelRatio || 1)),
  };
}
