import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { X } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { IconButton } from '@/components/IconButton';
import dialogs from '@/components/overlays/dialogs.module.css';
import overlays from '@/components/overlays/overlays.module.css';
import type { SessionOwner } from '@/features/auth/SessionOwner';
import type { ChatOwner } from '@/features/chat/data/ChatOwner';
import { CommunityDetails } from './CommunityDetails';
import styles from './CommunityProfile.module.css';

interface CommunityProfileProps {
  session: SessionOwner;
  chat: ChatOwner;
  id: string;
  isAvatarAvailable?: boolean;
  onClose: () => void;
}

/** Open the group or channel profile without remounting the chat behind it. */
export function CommunityProfile({
  session,
  chat,
  id,
  isAvatarAvailable,
  onClose,
}: CommunityProfileProps) {
  const snapshot = useSyncExternalStore(chat.subscribe, chat.getSnapshot);
  const conversation = snapshot.conversations.find((entry) => entry.id === id);
  const title = conversation?.kind === 'channel' ? 'Channel info' : 'Group info';

  return (
    <Dialog.Root
      open
      onOpenChange={({ open }) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <Portal>
        <Dialog.Backdrop className={`${dialogs.backdrop} ${styles.profileBackdrop}`} />
        <Dialog.Positioner className={`${overlays.dialogPositioner} ${styles.profilePositioner}`}>
          <Dialog.Content className={`${overlays.dialog} ${styles.profileDialog}`}>
            <header className={styles.profileHeader}>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.CloseTrigger asChild>
                <IconButton label="Close community info">
                  <X />
                </IconButton>
              </Dialog.CloseTrigger>
            </header>
            <div className={styles.profileBody}>
              <CommunityDetails
                session={session}
                chat={chat}
                id={id}
                isAvatarAvailable={isAvatarAvailable}
                onBack={onClose}
              />
            </div>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
