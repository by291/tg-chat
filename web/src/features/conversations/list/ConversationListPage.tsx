import { Archive } from 'lucide-react';
import type { ReactNode } from 'react';
import { Ripple } from '@/components/Ripple';
import { ArchiveMenu, type ArchiveMenuAction } from '../archive/ArchiveMenu';
import { NewChatMenu, type NewChatMode } from '../creation/NewChatMenu';
import type { ConversationListEntry } from '../conversationList';
import { VirtualConversationList } from '../VirtualConversationList';
import styles from '../ChatSidebar.module.css';

interface ConversationListPageProps {
  conversations: ConversationListEntry[];
  archivedConversations: ConversationListEntry[];
  isSearching: boolean;
  isArchiveShown: boolean;
  archiveUnreadCount: number;
  initialOffset: number;
  header: ReactNode;
  searchResults: ReactNode;
  onScrollOffsetChange: (offset: number) => void;
  onReorderPinned: (chatIds: string[]) => void;
  onOpenArchive: () => void;
  onArchiveAction: (action: ArchiveMenuAction) => void;
  onCreateChat: (mode: NewChatMode) => void;
  renderRow: (conversation: ConversationListEntry) => ReactNode;
}

/** Keep the inbox mounted under search while presenting archive access and chat creation. */
export function ConversationListPage({
  conversations,
  archivedConversations,
  isSearching,
  isArchiveShown,
  archiveUnreadCount,
  initialOffset,
  header,
  searchResults,
  onScrollOffsetChange,
  onReorderPinned,
  onOpenArchive,
  onArchiveAction,
  onCreateChat,
  renderRow,
}: ConversationListPageProps) {
  const shouldShowArchiveEntry = isArchiveShown && archivedConversations.length > 0;
  const archiveTitles = archivedConversations.map((conversation) => conversation.title).join(', ');

  return (
    <>
      {header}
      <div className={styles.content}>
        <div className={styles.conversationsPanel} inert={isSearching} aria-hidden={isSearching}>
          <VirtualConversationList
            conversations={conversations}
            label="Conversations"
            initialOffset={initialOffset}
            onScrollOffsetChange={onScrollOffsetChange}
            onReorderPinned={onReorderPinned}
            archiveEntry={
              shouldShowArchiveEntry ? (
                <ArchiveMenu
                  trigger="context"
                  isShownInChatList={isArchiveShown}
                  hasUnread={archiveUnreadCount > 0}
                  onAction={onArchiveAction}
                >
                  <button className={styles.archiveEntry} onClick={onOpenArchive}>
                    <span className={styles.archiveAvatar}>
                      <Archive />
                    </span>
                    <span className={styles.rowContent}>
                      <strong>Archived Chats</strong>
                      <span>{archiveTitles}</span>
                    </span>
                    {archiveUnreadCount > 0 && (
                      <span className={styles.archiveCount}>{archiveUnreadCount}</span>
                    )}
                    <Ripple />
                  </button>
                </ArchiveMenu>
              ) : undefined
            }
            renderRow={renderRow}
          />
          <div className={styles.footer}>
            <NewChatMenu onChoose={onCreateChat} />
          </div>
        </div>
        {searchResults}
      </div>
    </>
  );
}
