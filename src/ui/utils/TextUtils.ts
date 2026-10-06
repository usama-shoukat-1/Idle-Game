import type Phaser from 'phaser';

/**
 * Mobile performance helper: Phaser's `setText` re-rasterises the whole text texture even
 * when the string is unchanged. UI that refreshes on a timer (timer labels, income
 * readouts) would otherwise re-render textures every tick for no visual change.
 */
export function setTextIfChanged(text: Phaser.GameObjects.Text, value: string): boolean {
  if (text.text === value) return false;
  text.setText(value);
  return true;
}
