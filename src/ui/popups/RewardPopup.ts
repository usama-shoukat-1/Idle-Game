/**
 * Reward popup.
 *
 * A generic presentation surface for any granted reward (rewarded ad, purchase,
 * offline payout, event reward). It renders `RewardGrant` labels so it never needs
 * to know where the reward came from.
 */

import type Phaser from 'phaser';
import type { RewardGrant } from '@/core/types/monetization';
import { Modal } from './Modal';
import type { Viewport } from '../layout/Viewport';

export interface RewardPopupOptions {
  title: string;
  grants: RewardGrant[];
  acknowledgeLabel?: string;
  onClose?: () => void;
}

export function showRewardPopup(scene: Phaser.Scene, viewport: Viewport, options: RewardPopupOptions): void {
  const lines = options.grants.map((grant) => describeGrant(grant));
  new Modal(scene, viewport, {
    title: options.title,
    body: lines.length > 0 ? lines.join('\n') : 'No reward was granted.',
    heightFraction: 0.4,
    buttons: [
      {
        label: options.acknowledgeLabel ?? 'Nice!',
        tone: 'primary',
        onClick: () => options.onClose?.(),
      },
    ],
  });
}

function describeGrant(grant: RewardGrant): string {
  const amount = grant.amount ?? 0;
  switch (grant.kind) {
    case 'coins':
      return `+${Math.round(amount)} coins`;
    case 'gems':
      return `+${Math.round(amount)} gems`;
    case 'timer-reduction':
      return `Timer reduced by ${Math.round(amount / 1000)}s`;
    case 'income-boost':
      return `Income x${amount} for ${Math.round((grant.durationMs ?? 0) / 60000)}m`;
    case 'offline-enhance':
      return `Offline income boosted for ${Math.round((grant.durationMs ?? 0) / 60000)}m`;
    case 'entitlement':
      return `Unlocked: ${grant.entitlementId ?? 'entitlement'}`;
    default:
      return grant.label;
  }
}
