import { useSyncExternalStore } from 'react';
import type { SessionOwner } from '@/features/auth/SessionOwner';
import type { ChatOwner } from '@/features/chat/data/ChatOwner';
import { CommunityDetails } from './CommunityDetails';
import { InformationPanel } from '@/features/chat/details/InformationPanel';

interface CommunityProfileProps {
  session: SessionOwner;
  chat: ChatOwner;
  id: string;
  isOpen: boolean;
  isAvatarAvailable?: boolean;
  onClose: () => void;
}

/** Open the group or channel profile without remounting the chat behind it. */
export function CommunityProfile({
  session,
  chat,
  id,
  isOpen,
  isAvatarAvailable,
  onClose,
}: CommunityProfileProps) {
  const snapshot = useSyncExternalStore(chat.subscribe, chat.getSnapshot);
  const conversation = snapshot.conversations.find((entry) => entry.id === id);
  const title = conversation?.kind === 'channel' ? 'Channel info' : 'Group info';

  return (
    <InformationPanel
      title={title}
      closeLabel="Close community info"
      isOpen={isOpen}
      onClose={onClose}
    >
      <CommunityDetails
        session={session}
        chat={chat}
        id={id}
        isAvatarAvailable={isAvatarAvailable}
        onBack={onClose}
      />
    </InformationPanel>
  );
}
