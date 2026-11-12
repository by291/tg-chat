import { Menu } from '@ark-ui/react/menu';
import {
  Archive,
  ArchiveRestore,
  Bell,
  BellOff,
  CheckCheck,
  Circle,
  Pin,
  PinOff,
} from 'lucide-react';
import type { components } from '@/api/schema';
import overlays from '@/components/overlays/overlays.module.css';
import {
  conversationMuteChange,
  isConversationMuted,
  type Conversation,
} from '../data/messageModels';

type CommandAction = components['schemas']['CommandAction'];

interface ConversationActionsProps {
  conversation: Conversation;
  onCommand: (action: CommandAction) => void;
}

/** Render personal actions shared by the conversation row and the chat header. */
export function ConversationActions({ conversation, onCommand }: ConversationActionsProps) {
  const isUnread = conversation.unread_count !== '0' || conversation.is_manually_unread;
  const isMuted = isConversationMuted(conversation);
  const isPinned = conversation.pin_rank !== null;

  function toggleRead() {
    if (isUnread) {
      // An explicit mark-as-read covers the known history even when it is outside the viewport.
      onCommand({ kind: 'read', through: conversation.last_sequence });
      return;
    }
    onCommand({ kind: 'preferences', change: { field: 'unread', is_manually_unread: true } });
  }

  function toggleMute() {
    onCommand({ kind: 'preferences', change: conversationMuteChange(conversation) });
  }

  return (
    <>
      <Menu.Item value="read" className={overlays.menuItem} onSelect={toggleRead}>
        {isUnread ? <CheckCheck /> : <Circle />}
        {isUnread ? 'Mark as read' : 'Mark as unread'}
      </Menu.Item>
      <Menu.Item
        value="pin"
        className={overlays.menuItem}
        onSelect={() =>
          onCommand({ kind: 'preferences', change: { field: 'pin', rank: isPinned ? null : 0 } })
        }
      >
        {isPinned ? <PinOff /> : <Pin />}
        {isPinned ? 'Unpin conversation' : 'Pin conversation'}
      </Menu.Item>
      <Menu.Item value="mute" className={overlays.menuItem} onSelect={toggleMute}>
        {isMuted ? <Bell /> : <BellOff />}
        {isMuted ? 'Unmute' : 'Mute for one day'}
      </Menu.Item>
      <Menu.Item
        value="archive"
        className={overlays.menuItem}
        onSelect={() =>
          onCommand({
            kind: 'preferences',
            change: { field: 'archive', is_archived: !conversation.is_archived },
          })
        }
      >
        {conversation.is_archived ? <ArchiveRestore /> : <Archive />}
        {conversation.is_archived ? 'Unarchive' : 'Archive'}
      </Menu.Item>
    </>
  );
}
