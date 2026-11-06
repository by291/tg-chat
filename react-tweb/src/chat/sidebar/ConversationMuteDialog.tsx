import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { RadioGroup } from '@ark-ui/react/radio-group';
import { useState } from 'react';
import { Avatar } from '../../components/Avatar';
import { Ripple } from '../../components/Ripple';
import type { ConversationListEntry } from './conversationList';
import overlays from '../overlays.module.css';
import styles from './ConversationDialogs.module.css';
import { useClosingDialogValue } from './useClosingDialogValue';

const MUTE_OPTIONS = [
  { hours: 1, label: 'For 1 Hour' },
  { hours: 4, label: 'For 4 Hours' },
  { hours: 8, label: 'For 8 Hours' },
  { hours: 24, label: 'For 1 Day' },
  { hours: 72, label: 'For 3 Days' },
  { hours: 0, label: 'Forever' },
];

interface ConversationMuteDialogProps {
  conversation?: ConversationListEntry;
  onCancel: () => void;
  onConfirm: (hours: number) => void;
}

/** Choose a persisted mute deadline before applying the conversation's notification state. */
export function ConversationMuteDialog({
  conversation: openConversation,
  onCancel,
  onConfirm,
}: ConversationMuteDialogProps) {
  const [hours, setHours] = useState('0');
  const conversation = useClosingDialogValue(openConversation);

  return (
    <Dialog.Root
      open={Boolean(openConversation)}
      onExitComplete={() => setHours('0')}
      onOpenChange={(details) => {
        if (!details.open) {
          onCancel();
        }
      }}
      lazyMount
      unmountOnExit
    >
      <Portal>
        <Dialog.Backdrop className={styles.backdrop} />
        <Dialog.Positioner className={overlays.dialogPositioner}>
          <Dialog.Content className={styles.muteDialog}>
            <header className={styles.muteHeader}>
              {conversation && (
                <Avatar initials={conversation.initials} color={conversation.color} size="small" />
              )}
              <Dialog.Title>Notifications</Dialog.Title>
            </header>
            <RadioGroup.Root
              value={hours}
              onValueChange={(details) => setHours(details.value ?? '0')}
              aria-label="Mute duration"
            >
              {MUTE_OPTIONS.map((option) => (
                <RadioGroup.Item
                  key={option.hours}
                  value={String(option.hours)}
                  className={styles.muteOption}
                >
                  <RadioGroup.ItemControl className={styles.radioControl} />
                  <RadioGroup.ItemText>{option.label}</RadioGroup.ItemText>
                  <RadioGroup.ItemHiddenInput />
                  <Ripple />
                </RadioGroup.Item>
              ))}
            </RadioGroup.Root>
            <div className={styles.actions}>
              <Dialog.CloseTrigger className={overlays.textButton}>Cancel</Dialog.CloseTrigger>
              <button
                type="button"
                className={overlays.textButton}
                onClick={() => onConfirm(Number(hours))}
              >
                Mute
                <Ripple />
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
