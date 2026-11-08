import { ArrowLeft, MoreVertical } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton } from '@/components/IconButton';
import { ArchiveMenu, type ArchiveMenuAction } from './ArchiveMenu';
import type { ConversationListEntry } from '../conversationList';
import { SidebarPageHeader } from '../SidebarPageHeader';
import { VirtualConversationList } from '../VirtualConversationList';
import styles from '../ChatSidebar.module.css';

interface ArchivePageProps {
  conversations: ConversationListEntry[];
  isShownInChatList: boolean;
  hasUnread: boolean;
  initialOffset: number;
  selection: ReactNode;
  onBack: () => void;
  onAction: (action: ArchiveMenuAction) => void;
  onScrollOffsetChange: (offset: number) => void;
  onReorderPinned: (chatIds: string[]) => void;
  renderRow: (conversation: ConversationListEntry) => ReactNode;
}

/** Display the archive header, commands, and independently scrolled conversation list. */
export function ArchivePage({
  conversations,
  isShownInChatList,
  hasUnread,
  initialOffset,
  selection,
  onBack,
  onAction,
  onScrollOffsetChange,
  onReorderPinned,
  renderRow,
}: ArchivePageProps) {
  return (
    <>
      <SidebarPageHeader selection={selection}>
        <div className={styles.header}>
          <IconButton label="Back to conversations" onClick={onBack}>
            <ArrowLeft />
          </IconButton>
          <h2 className={styles.archiveTitle}>Archived Chats</h2>
          <ArchiveMenu
            trigger="button"
            isShownInChatList={isShownInChatList}
            hasUnread={hasUnread}
            onAction={onAction}
          >
            <IconButton label="Archive options">
              <MoreVertical />
            </IconButton>
          </ArchiveMenu>
        </div>
      </SidebarPageHeader>
      <VirtualConversationList
        conversations={conversations}
        label="Archived conversations"
        initialOffset={initialOffset}
        onScrollOffsetChange={onScrollOffsetChange}
        onReorderPinned={onReorderPinned}
        renderRow={renderRow}
      />
    </>
  );
}
