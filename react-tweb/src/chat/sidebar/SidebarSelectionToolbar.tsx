import { Archive, ArchiveRestore, Bell, BellOff, MailOpen, Trash2, X } from 'lucide-react';
import { IconButton } from '../../components/IconButton';
import type { ConversationPreferences } from '../model';
import type { ConversationListEntry } from './conversationList';
import styles from './ChatSidebar.module.css';

interface SidebarSelectionToolbarProps {
  conversations: ConversationListEntry[];
  onClear: () => void;
  onUpdate: (changes: ConversationPreferences) => void;
  onDelete: () => void;
}

/** Apply list actions to the explicitly selected conversations. */
export function SidebarSelectionToolbar({
  conversations,
  onClear,
  onUpdate,
  onDelete,
}: SidebarSelectionToolbarProps) {
  const isEveryConversationMuted = conversations.every((conversation) => conversation.isMuted);
  const isEveryConversationArchived = conversations.every(
    (conversation) => conversation.isArchived,
  );
  const canMuteOrArchive = conversations.every((conversation) => conversation.kind !== 'saved');

  return (
    <div className={styles.selectionToolbar} role="toolbar" aria-label="Selected conversations">
      <IconButton label="Cancel selection" onClick={onClear}>
        <X />
      </IconButton>
      <strong className={styles.selectionCount}>{conversations.length}</strong>
      <IconButton
        label="Mark selected as read"
        onClick={() => onUpdate({ unreadCount: 0, isMarkedUnread: false })}
      >
        <MailOpen />
      </IconButton>
      {canMuteOrArchive && (
        <>
          <IconButton
            label={isEveryConversationMuted ? 'Unmute selected' : 'Mute selected'}
            onClick={() => onUpdate({ isMuted: !isEveryConversationMuted })}
          >
            {isEveryConversationMuted ? <Bell /> : <BellOff />}
          </IconButton>
          <IconButton
            label={isEveryConversationArchived ? 'Unarchive selected' : 'Archive selected'}
            onClick={() => onUpdate({ isArchived: !isEveryConversationArchived })}
          >
            {isEveryConversationArchived ? <ArchiveRestore /> : <Archive />}
          </IconButton>
        </>
      )}
      <IconButton label="Delete selected conversations" onClick={onDelete}>
        <Trash2 />
      </IconButton>
    </div>
  );
}
