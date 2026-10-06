import Phaser from 'phaser';

import { COLORS_CSS, FONT_FAMILY, FONT_SIZE, PALETTE, RADIUS } from '@/core/constants/Layout';

/**
 * UI THEME
 * ========
 * Placeholder styling lives in one module so the "polished illustrated" pass later is a
 * theme swap rather than a rewrite of every component. Components must not invent
 * colours, radii or font sizes - they use these tokens (see docs/DEVELOPMENT_RULES.md).
 */
export const UI_THEME = {
  colors: PALETTE,
  css: COLORS_CSS,
  radius: RADIUS,
  fontSize: FONT_SIZE,
  fontFamily: FONT_FAMILY,
} as const;

export type TextStyleToken = keyof typeof FONT_SIZE;

export interface MakeTextOptions {
  readonly size?: TextStyleToken | number;
  readonly color?: string;
  readonly bold?: boolean;
  readonly align?: 'left' | 'center' | 'right';
  readonly wordWrapWidth?: number;
  readonly alpha?: number;
}

/** Single factory for text, so sizes/colours stay consistent across screens. */
export function makeText(
  scene: Phaser.Scene,
  text: string,
  options: MakeTextOptions = {},
): Phaser.GameObjects.Text {
  const size = typeof options.size === 'number' ? options.size : FONT_SIZE[options.size ?? 'body'];
  const style: Phaser.Types.GameObjects.Text.TextStyle = {
    fontFamily: FONT_FAMILY,
    fontSize: `${size}px`,
    color: options.color ?? COLORS_CSS.text,
    align: options.align ?? 'left',
  };
  if (options.bold) style.fontStyle = 'bold';
  if (options.wordWrapWidth) {
    style.wordWrap = { width: options.wordWrapWidth, useAdvancedWrap: true };
  }

  const object = scene.add.text(0, 0, text, style);
  if (options.alpha !== undefined) object.setAlpha(options.alpha);
  return object;
}

