import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { Archive, EyeOff, CirclePlay, X } from 'lucide-react';
import { IconButton } from '../../components/IconButton';
import { Ripple } from '../../components/Ripple';
import type { ArchiveConfirmation } from './useArchiveActions';
import { useClosingDialogValue } from './useClosingDialogValue';
import overlays from '../overlays.module.css';
import dialogs from './ConversationDialogs.module.css';
import styles from './ArchiveDialogs.module.css';

interface ArchiveHelpDialogProps {
  isOpen: boolean;
  keepUnmutedArchived: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}

interface ArchiveConfirmationDialogProps {
  confirmation?: ArchiveConfirmation;
  onCancel: () => void;
  onMarkAllAsRead: () => void;
  onDiscard: () => void;
  onSave: () => void;
}

/** Explain archive commands and link directly to the corresponding settings page. */
export function ArchiveHelpDialog({
  isOpen,
  keepUnmutedArchived,
  onClose,
  onOpenSettings,
}: ArchiveHelpDialogProps) {
  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(details) => {
        if (!details.open) {
          onClose();
        }
      }}
      lazyMount
      unmountOnExit
    >
      <Portal>
        <Dialog.Backdrop className={dialogs.backdrop} />
        <Dialog.Positioner className={overlays.dialogPositioner}>
          <Dialog.Content className={`${styles.help} ${dialogs.confirmation}`}>
            <IconButton label="Close archive help" className={styles.close} onClick={onClose}>
              <X />
            </IconButton>
            <div className={styles.hero} aria-hidden="true">
              <Archive size={56} />
            </div>
            <Dialog.Title>This is your Archive</Dialog.Title>
            <Dialog.Description>
              {keepUnmutedArchived
                ? 'Archived chats stay in the Archive when a new message arrives.'
                : 'Unmuted chats return to the chat list when a new message arrives.'}{' '}
              <button className={styles.settingsLink} onClick={onOpenSettings}>
                Click to change
              </button>
            </Dialog.Description>
            <div className={styles.feature}>
              <Archive />
              <div>
                <h3>Archiving Chats</h3>
                <p>
                  Right-click a chat and choose <strong>Archive</strong> or{' '}
                  <strong>Unarchive</strong>.
                </p>
              </div>
            </div>
            <div className={styles.feature}>
              <EyeOff />
              <div>
                <h3>Hiding the Archive</h3>
                <p>
                  Choose <strong>Hide from Chat List</strong> in the Archive menu. The main menu
                  always keeps an entry.
                </p>
              </div>
            </div>
            <div className={styles.feature}>
              <CirclePlay />
              <div>
                <h3>Stories</h3>
                <p>
                  Telegram archives Stories separately. Stories are not available in this local
                  demo.
                </p>
              </div>
            </div>
            <Dialog.CloseTrigger className={styles.confirmButton}>
              Got it
              <Ripple />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

/** Confirm large read operations or resolve unsaved archive settings without losing edits. */
export function ArchiveConfirmationDialog({
  confirmation,
  onCancel,
  onMarkAllAsRead,
  onDiscard,
  onSave,
}: ArchiveConfirmationDialogProps) {
  const retainedConfirmation = useClosingDialogValue(confirmation);
  const isDiscarding = retainedConfirmation === 'discard-settings';

  return (
    <Dialog.Root
      open={Boolean(confirmation)}
      role="alertdialog"
      onOpenChange={(details) => {
        if (!details.open) {
          onCancel();
        }
      }}
      lazyMount
      unmountOnExit
    >
      <Portal>
        <Dialog.Backdrop className={dialogs.backdrop} />
        <Dialog.Positioner className={overlays.dialogPositioner}>
          <Dialog.Content className={`${overlays.dialog} ${dialogs.confirmation}`}>
            <Dialog.Title>{isDiscarding ? 'Unsaved changes' : 'Mark all as read'}</Dialog.Title>
            <Dialog.Description>
              {isDiscarding
                ? 'Save your archive settings before leaving?'
                : 'Are you sure you want to mark all archived chats as read?'}
            </Dialog.Description>
            <div className={overlays.dialogActions}>
              <Dialog.CloseTrigger className={overlays.textButton}>Cancel</Dialog.CloseTrigger>
              {isDiscarding && (
                <button className={overlays.textButton} onClick={onDiscard}>
                  Discard
                </button>
              )}
              <button
                className={overlays.textButton}
                onClick={isDiscarding ? onSave : onMarkAllAsRead}
              >
                {isDiscarding ? 'Save' : 'Confirm'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
