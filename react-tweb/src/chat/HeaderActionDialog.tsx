import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { useState } from 'react';
import dialogs from './sidebar/ConversationDialogs.module.css';
import overlays from './overlays.module.css';
import { useClosingDialogValue } from './sidebar/useClosingDialogValue';

const MIN_AUTO_DELETE_DAYS = 1;
const MAX_AUTO_DELETE_DAYS = 365;

interface HeaderActionDialogProps {
  mode?: 'call' | 'auto-delete' | 'delete-messages';
  selectedCount: number;
  onClose: () => void;
  onAutoDelete: (days: number) => void;
  onDelete: () => void;
}

/** Confirm local message actions and explain the demo's unavailable network call. */
export function HeaderActionDialog({
  mode: openMode,
  selectedCount,
  onClose,
  onAutoDelete,
  onDelete,
}: HeaderActionDialogProps) {
  const mode = useClosingDialogValue(openMode);
  const [days, setDays] = useState(MIN_AUTO_DELETE_DAYS);
  const canSetPeriod =
    Number.isInteger(days) && days >= MIN_AUTO_DELETE_DAYS && days <= MAX_AUTO_DELETE_DAYS;
  let title = 'Video Chat';
  let description =
    'Video calls require a Telegram connection. This local demo does not connect to a call.';
  if (mode === 'auto-delete') {
    title = 'Auto-Delete Messages';
    description = 'Automatically delete new messages after the selected number of days.';
  }
  if (mode === 'delete-messages') {
    title = 'Delete Messages';
    description = `Delete ${selectedCount} selected messages from this device?`;
  }

  return (
    <Dialog.Root
      open={Boolean(openMode)}
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
          <Dialog.Content className={`${overlays.dialog} ${dialogs.confirmation}`}>
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Description>{description}</Dialog.Description>
            {mode === 'auto-delete' && (
              <label>
                Days{' '}
                <input
                  type="number"
                  min={MIN_AUTO_DELETE_DAYS}
                  max={MAX_AUTO_DELETE_DAYS}
                  value={days}
                  onChange={(event) => setDays(Number(event.target.value))}
                />
              </label>
            )}
            <div className={overlays.dialogActions}>
              <Dialog.CloseTrigger className={overlays.textButton}>
                {mode === 'call' ? 'OK' : 'Cancel'}
              </Dialog.CloseTrigger>
              {mode === 'auto-delete' && (
                <button
                  className={overlays.textButton}
                  disabled={!canSetPeriod}
                  onClick={() => onAutoDelete(days)}
                >
                  Set
                </button>
              )}
              {mode === 'delete-messages' && (
                <button className={`${overlays.textButton} ${overlays.danger}`} onClick={onDelete}>
                  Delete
                </button>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
