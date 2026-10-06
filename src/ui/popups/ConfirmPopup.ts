/**
 * Confirmation popup.
 *
 * Returns a promise so callers can `await` the player's decision instead of
 * threading callbacks through the UI. Used by the settings screen (reset save) and
 * any future destructive action.
 */

import type Phaser from 'phaser';
import { Modal } from './Modal';
import type { Viewport } from '../layout/Viewport';

export interface ConfirmPopupOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export function showConfirm(
  scene: Phaser.Scene,
  viewport: Viewport,
  options: ConfirmPopupOptions,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const modal = new Modal(scene, viewport, {
      title: options.title,
      ...(options.body ? { body: options.body } : {}),
      dismissible: true,
      buttons: [
        {
          label: options.cancelLabel ?? 'Cancel',
          tone: 'secondary',
          onClick: () => finish(false),
        },
        {
          label: options.confirmLabel ?? 'Confirm',
          tone: options.destructive ? 'danger' : 'primary',
          onClick: () => finish(true),
        },
      ],
    });

    // If the modal is closed by the backdrop, treat it as a cancellation.
    const originalClose = modal.close.bind(modal);
    modal.close = () => {
      originalClose();
      finish(false);
    };
  });
}
