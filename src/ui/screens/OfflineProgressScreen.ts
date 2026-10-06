/**
 * Offline progress overlay.
 *
 * Phase 0 shows the *foundation* honestly: how long the player was away, what the
 * (untuned, config-driven) payout is, and how many timers advanced. Numbers are not
 * balanced yet - the popup exists to prove the pipeline works end to end.
 */

import Phaser from 'phaser';
import type { GameContext } from '@/core/GameContext';
import type { OfflineReport } from '@/core/types/offline';
import type { Viewport } from '../layout/Viewport';
import { Modal } from '../popups/Modal';
import { formatDuration } from '@/core/utils/time';
import { formatNumber } from '@/core/utils/numbers';

export interface OfflineProgressScreenOptions {
  report: OfflineReport;
  onClaimed?: (report: OfflineReport) => void;
}

export class OfflineProgressScreen {
  private readonly modal: Modal;

  constructor(
    scene: Phaser.Scene,
    private readonly context: GameContext,
    viewport: Viewport,
    options: OfflineProgressScreenOptions,
  ) {
    const { report } = options;
    const away = formatDuration(report.elapsed.cappedMs);
    const lines = [
      `Away for ${away}${report.elapsed.wasCapped ? ' (capped by the offline limit)' : ''}`,
      `Income while you were out: ${formatNumber(report.creditedCoins)} coins`,
      `Efficiency: ${Math.round(report.efficiency * 100)}% (placeholder value - not tuned yet)`,
    ];
    if (report.completedTimerIds.length > 0) {
      lines.push(`${report.completedTimerIds.length} timer(s) finished while you were away`);
    }
    if (report.perBuilding.length > 0) {
      lines.push(`Buildings earning: ${report.perBuilding.length}`);
    }

    this.modal = new Modal(scene, viewport, {
      title: 'Welcome back',
      body: lines.join('\n'),
      heightFraction: 0.46,
      buttons: [
        {
          label: 'Collect',
          tone: 'primary',
          onClick: () => {
            const claimed = this.context.offline.claim(report);
            this.context.events.emit('ui:toast', {
              message: `+${formatNumber(claimed.creditedCoins)} coins`,
              tone: 'success',
            });
            options.onClaimed?.(claimed);
          },
        },
      ],
    });
  }

  close(): void {
    this.modal.close();
  }
}
