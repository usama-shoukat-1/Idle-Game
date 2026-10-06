import Phaser from 'phaser';

import { formatCompactNumber } from '@/core/events/EventBus';
import { PopupBase } from './PopupBase';

/**
 * Reward presentation popup.
 *
 * Used for: offline income summaries, rewarded-ad payouts, purchase confirmations and
 * (later) milestone/mastery rewards. It is presentation-only - it never grants anything
 * itself. The caller grants through the owning system and then shows this to communicate
 * what happened, which keeps the economy auditable and prevents "UI granted currency" bugs.
 */
export interface RewardPopupOptions {
  readonly scene: Phaser.Scene;
  readonly title: string;
  readonly subtitle?: string;
  readonly rewards: ReadonlyArray<{
    readonly label: string;
    readonly amount: number;
    readonly kind: 'coins' | 'gems' | 'time' | 'other';
  }>;
  readonly ctaLabel?: string;
  /** Called exactly once, whether the player taps the CTA or dismisses by tapping away. */
  readonly onCollect?: () => void;
}

export class RewardPopup extends PopupBase {
  constructor(options: RewardPopupOptions) {
    const rewardLines = options.rewards
      .map((reward) => `${formatRewardAmount(reward.kind, reward.amount)}  ${reward.label}`)
      .join('\n');

    let collected = false;
    const collect = (): void => {
      if (collected) return;
      collected = true;
      options.onCollect?.();
    };

    super(options.scene, {
      title: options.title,
      body: [options.subtitle, rewardLines].filter(Boolean).join('\n\n'),
      width: 620,
      height: 620,
      dismissible: true,
      actions: [
        {
          label: options.ctaLabel ?? 'Collect',
          variant: 'primary',
          onClick: collect,
        },
      ],
      onClose: collect,
    });
  }
}

/** Formats a reward amount for display. Time rewards are shown in seconds. */
export function formatRewardAmount(kind: 'coins' | 'gems' | 'time' | 'other', amount: number): string {
  switch (kind) {
    case 'time':
      return `${Math.round(amount / 1000)}s`;
    case 'coins':
    case 'gems':
      return `+${formatCompactNumber(amount)}`;
    default:
      return `x${amount}`;
  }
}
