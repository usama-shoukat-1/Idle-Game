import Phaser from 'phaser';

import type { WorkerDefinition } from '@/core/types/content';
import { COLORS_CSS, FONT_FAMILY, FONT_SIZE } from '@/core/constants/Layout';

/**
 * Placeholder worker marker.
 *
 * Workers are the Phase 2 automation layer ("hire someone to run the café"). Phase 0
 * establishes only the view + binding shape so that automation content can be added
 * without inventing a new pattern: a `WorkerDefinition` from content, a runtime row in
 * `GameState.workers`, and this marker rendered at its assigned building.
 */
export class WorkerEntity {
  readonly definition: WorkerDefinition;
  readonly container: Phaser.GameObjects.Container;

  private readonly marker: Phaser.GameObjects.Arc;
  private readonly label: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, definition: WorkerDefinition, x: number, y: number, depth = 60) {
    this.definition = definition;

    this.marker = scene.add.circle(0, 0, 14, 0x5fd0ff).setStrokeStyle(2, 0x0e1116, 0.6);
    this.label = scene.add
      .text(0, 22, definition.displayName, {
        fontFamily: FONT_FAMILY,
        fontSize: `${FONT_SIZE.micro}px`,
        color: COLORS_CSS.textMuted,
      })
      .setOrigin(0.5, 0);

    this.container = scene.add.container(x, y, [this.marker, this.label]).setDepth(depth);
  }

  setAssigned(assigned: boolean): void {
    this.container.setAlpha(assigned ? 1 : 0.35);
  }

  moveTo(x: number, y: number): void {
    this.container.setPosition(x, y);
  }

  destroy(): void {
    this.container.removeAll(true);
    this.container.destroy();
  }
}
