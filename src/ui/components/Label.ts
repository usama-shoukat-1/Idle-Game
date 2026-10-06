/**
 * Text helper.
 *
 * All UI text goes through here so font sizing stays proportional to the viewport
 * and nothing in the UI has to guess a pixel size.
 */

import Phaser from 'phaser';
import { textStyle } from '../UiTheme';
import type { FontSize, Viewport } from '../layout/Viewport';

export interface LabelOptions {
  size?: FontSize;
  color?: string;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  origin?: { x: number; y: number };
  wrapWidth?: number;
}

export function createLabel(
  scene: Phaser.Scene,
  viewport: Viewport,
  text: string,
  options: LabelOptions = {},
): Phaser.GameObjects.Text {
  const label = scene.add.text(0, 0, text, textStyle(viewport, options));
  const origin = options.origin ?? { x: 0, y: 0 };
  label.setOrigin(origin.x, origin.y);
  if (options.wrapWidth) label.setWordWrapWidth(options.wrapWidth, true);
  return label;
}

/** Update a label's origin-independent text + wrapped width in one call. */
export function setLabelText(label: Phaser.GameObjects.Text, text: string, wrapWidth?: number): void {
  label.setText(text);
  if (wrapWidth) label.setWordWrapWidth(wrapWidth, true);
}
