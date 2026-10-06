import Phaser from 'phaser';

import { SPACING } from '@/core/constants/Layout';
import { UI_DEPTH } from '@/core/constants/GameConstants';
import type { LayoutHandle } from '@/ui/layout/LayoutService';
import type { Insets } from '@/ui/layout/LayoutMetrics';
import { UI_THEME, makeText } from '@/ui/theme/UiTheme';

/**
 * SCREEN BASE CLASS
 * =================
 * A screen owns a full-viewport container pinned to the frame origin in design units, so
 * every child shares one coordinate space: x in `0..frameWidth`, y in `0..frameHeight`.
 *
 * The placement helpers (`top`, `bottom`, `left`, `right`, `centerX`, `centerY`, `edge`)
 * are the supported way to position things. They are safe-area aware and contain no magic
 * pixel numbers, which is what keeps the layout correct from 16:9 to 21:9 without a
 * single device-specific branch.
 */
export interface ScreenOptions {
  readonly depth?: number;
  /** Dim whatever is behind (menus, pause, settings, popups). */
  readonly withScrim?: boolean;
  readonly title?: string;
  /** Show a back/close affordance in the top-left. */
  readonly onBack?: () => void;
}

export class Screen {
  readonly container: Phaser.GameObjects.Container;
  protected readonly scene: Phaser.Scene;
  protected readonly options: ScreenOptions;
  protected handle: LayoutHandle | null = null;

  protected readonly scrim: Phaser.GameObjects.Rectangle | null = null;
  private readonly titleText: Phaser.GameObjects.Text | null = null;
  private backButton: Phaser.GameObjects.Text | null = null;

  constructor(scene: Phaser.Scene, options: ScreenOptions = {}) {
    this.scene = scene;
    this.options = options;

    this.container = scene.add.container(0, 0).setDepth(options.depth ?? UI_DEPTH.panels);

    if (options.withScrim) {
      this.scrim = scene.add.rectangle(0, 0, 10, 10, UI_THEME.colors.background, 0.78).setOrigin(0, 0);
      this.scrim.setInteractive(); // block taps reaching the world behind
      this.container.add(this.scrim);
    }

    if (options.title) {
      this.titleText = makeText(scene, options.title, { size: 'title', bold: true, align: 'center' });
      this.titleText.setOrigin(0.5, 0);
      if (this.titleText) this.container.add(this.titleText);
    }

    if (options.onBack) {
      const back = makeText(scene, '‹', { size: 'heading', bold: true });
      back.setOrigin(0.5, 0.5);
      back.setInteractive({ useHandCursor: true });
      back.on('pointerup', () => options.onBack?.());
      this.backButton = back;
      this.container.add(back);
    }
  }

  // --- Frame helpers (design units) ---------------------------------------

  protected get frameWidth(): number {
    return this.handle?.metrics.frameUnits.width ?? 720;
  }

  protected get frameHeight(): number {
    return this.handle?.metrics.frameUnits.height ?? 1280;
  }

  protected get safe(): Insets {
    return this.handle?.metrics.safeAreaUnits ?? { top: 0, right: 0, bottom: 0, left: 0 };
  }

  protected left(offset = 0): number {
    return this.safe.left + offset;
  }

  protected right(offset = 0): number {
    return this.frameWidth - this.safe.right - offset;
  }

  protected top(offset = 0): number {
    return this.safe.top + offset;
  }

  protected bottom(offset = 0): number {
    return this.frameHeight - this.safe.bottom - offset;
  }

  protected centerX(offset = 0): number {
    return this.frameWidth / 2 + offset;
  }

  protected centerY(offset = 0): number {
    return this.frameHeight / 2 + offset;
  }

  /** Horizontal margin used by full-width blocks. */
  protected get gutter(): number {
    return SPACING.lg;
  }

  protected get contentWidth(): number {
    return this.frameWidth - this.gutter * 2;
  }

  // --- Lifecycle -----------------------------------------------------------

  applyLayout(handle: LayoutHandle): void {
    this.handle = handle;
    // The container stays at the frame origin; UiRoot applies the device transform.
    this.container.setPosition(0, 0);

    if (this.scrim) {
      this.scrim.setSize(this.frameWidth, this.frameHeight);
    }
    if (this.titleText) {
      this.titleText.setPosition(this.centerX(), this.top(SPACING.xxxl));
    }
    if (this.backButton) {
      this.backButton.setPosition(this.left(SPACING.xl), this.top(SPACING.xxxl + SPACING.sm));
    }

    this.layout(handle);
  }

  /** Subclasses position their widgets here using the helpers above. */
  protected layout(_handle: LayoutHandle): void {
    /* optional override */
  }

  /**
   * Per-frame hook, called by UiRoot. The default is an empty method (not an optional
   * property) so subclasses can use `override` and so the call site stays monomorphic;
   * screens that do not animate simply inherit a no-op.
   */
  update(_time: number, _delta: number): void {
    /* optional override */
  }


  setVisible(visible: boolean): this {
    this.container.setVisible(visible);
    return this;
  }

  get visible(): boolean {
    return this.container.visible;
  }

  destroy(): void {
    this.container.removeAll(true);
    this.container.destroy();
  }
}

