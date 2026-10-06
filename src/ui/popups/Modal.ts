/**
 * Modal base class.
 *
 * Provides the dim backdrop, title/body area and a button row. Confirm/Reward
 * popups (and future dialogs) build on it so sizing, dismissal and layout stay
 * consistent on every aspect ratio.
 */

import Phaser from 'phaser';
import { COLORS, HEX } from '../UiTheme';
import { Panel } from '../components/Panel';
import { TextButton } from '../components/TextButton';
import { createLabel } from '../components/Label';
import { centeredRect, insetRect, rowRects } from '../layout/Layout';
import type { Rect } from '../layout/Layout';
import type { Viewport } from '../layout/Viewport';

export interface ModalButtonSpec {
  label: string;
  tone?: 'primary' | 'secondary' | 'ghost' | 'danger';
  onClick: () => void;
  /** Keep the modal open after the click (default: closes). */
  keepOpen?: boolean;
}

export interface ModalOptions {
  title: string;
  body?: string;
  buttons?: ModalButtonSpec[];
  /** Fraction of the viewport width/height the modal may occupy. */
  widthFraction?: number;
  heightFraction?: number;
  dismissible?: boolean;
}

export class Modal {
  protected readonly container: Phaser.GameObjects.Container;
  protected readonly panel: Panel;
  protected readonly titleLabel: Phaser.GameObjects.Text;
  protected readonly bodyLabel: Phaser.GameObjects.Text;
  protected readonly buttons: TextButton[] = [];
  protected readonly scene: Phaser.Scene;
  protected readonly viewport: Viewport;
  private readonly backdrop: Phaser.GameObjects.Rectangle;

  constructor(scene: Phaser.Scene, viewport: Viewport, options: ModalOptions) {
    this.scene = scene;
    this.viewport = viewport;

    const rect = centeredRect(viewport, options.widthFraction ?? 0.84, options.heightFraction ?? 0.44);

    this.backdrop = scene.add
      .rectangle(0, 0, viewport.width, viewport.height, COLORS.overlay, 0.62)
      .setOrigin(0, 0)
      .setInteractive();
    if (options.dismissible) {
      this.backdrop.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, () => this.close());
    }

    this.panel = new Panel(scene, { x: 0, y: 0, width: rect.width, height: rect.height }, {
      fill: COLORS.panel,
      radius: Math.round(rect.width * 0.045),
    });

    const padding = Math.round(rect.width * 0.07);
    this.titleLabel = createLabel(scene, viewport, options.title, {
      size: 'lg',
      bold: true,
      align: 'center',
      origin: { x: 0.5, y: 0 },
      wrapWidth: rect.width - padding * 2,
    });
    this.titleLabel.setX(rect.width / 2).setY(padding);

    this.bodyLabel = createLabel(scene, viewport, options.body ?? '', {
      size: 'sm',
      color: HEX.textDim,
      align: 'center',
      origin: { x: 0.5, y: 0 },
      wrapWidth: rect.width - padding * 2,
    });
    this.bodyLabel.setX(rect.width / 2).setY(this.titleLabel.y + this.titleLabel.height + viewport.font('sm'));

    this.container = scene.add.container(rect.x, rect.y, [this.panel, this.titleLabel, this.bodyLabel]);
    this.container.setDepth(8_000).setScrollFactor(0);

    // Backdrop lives outside the modal container so it always covers the screen.
    this.backdrop.setDepth(7_900).setScrollFactor(0);

    this.setButtons(options.buttons ?? [], rect);
    scene.add.existing(this.container);
  }

  /** Replace the body text and let the layout breathe. */
  setBody(text: string): void {
    this.bodyLabel.setText(text);
  }

  protected setButtons(specs: ModalButtonSpec[], rect: Rect): void {
    for (const button of this.buttons) button.destroy();
    this.buttons.length = 0;

    if (specs.length === 0) return;

    const padding = Math.round(rect.width * 0.07);
    const area = insetRect({ x: padding, y: rect.height - padding, width: rect.width - padding * 2, height: 0 }, 0);
    const buttonHeight = Math.max(this.viewport.touchTarget * 0.8, rect.height * 0.16);
    const rects = rowRects(
      { x: area.x, y: rect.height - padding - buttonHeight, width: rect.width - padding * 2, height: buttonHeight },
      specs.length,
      Math.round(rect.width * 0.03),
    );

    specs.forEach((spec, index) => {
      const button = new TextButton(this.scene, {
        rect: rects[index],
        label: spec.label,
        viewport: this.viewport,
        tone: spec.tone ?? 'primary',
        fontSize: 'sm',
        onClick: () => {
          spec.onClick();
          if (!spec.keepOpen) this.close();
        },
      });
      this.buttons.push(button);
      this.container.add(button);
    });
  }

  close(): void {
    this.container.destroy(true);
    this.backdrop.destroy();
  }

  get isOpen(): boolean {
    return this.backdrop.active;
  }
}
