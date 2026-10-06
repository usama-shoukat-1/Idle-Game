import Phaser from 'phaser';

import { PopupBase, type PopupOptions } from './PopupBase';

/**
 * Modal confirmation. Used for anything irreversible (reset save, spend gems, abandon an
 * upgrade) - the destructive action is the *secondary* button and never the default.
 */
export interface ConfirmationPopupOptions {
  readonly scene: Phaser.Scene;
  readonly title: string;
  readonly body?: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly destructive?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel?: () => void;
}

export class ConfirmationPopup extends PopupBase {
  constructor(options: ConfirmationPopupOptions) {
    const popupOptions: PopupOptions = {
      title: options.title,
      body: options.body,
      width: 600,
      height: 520,
      dismissible: true,
      actions: [
        {
          label: options.confirmLabel ?? 'Confirm',
          variant: options.destructive ? 'danger' : 'primary',
          onClick: () => options.onConfirm(),
        },
        {
          label: options.cancelLabel ?? 'Cancel',
          variant: 'secondary',
          onClick: () => options.onCancel?.(),
        },
      ],
      onClose: () => options.onCancel?.(),
    };
    super(options.scene, popupOptions);
  }
}
