import { Avatar } from '@/components/Avatar';
import { Ripple } from '@/components/Ripple';
import { ConversationMenu } from '../ConversationMenu';
import type { ConversationListEntry, ConversationMenuAction } from '../conversationList';
import { readPreviewAnchor, type PreviewAnchor } from '../previewPosition';
import styles from '../ChatSidebar.module.css';

interface SidebarSearchResultsProps {
  conversations: ConversationListEntry[];
  isSearching: boolean;
  isArchiveScope: boolean;
  onSelectChat: (chatId: string) => void;
  onMenuAction: (
    conversation: ConversationListEntry,
    action: ConversationMenuAction,
    anchor?: PreviewAnchor,
  ) => void;
}

/** Display matching conversations with the same selection and preview commands as list rows. */
export function SidebarSearchResults({
  conversations,
  isSearching,
  isArchiveScope,
  onSelectChat,
  onMenuAction,
}: SidebarSearchResultsProps) {
  return (
    <nav
      className={styles.searchPanel}
      aria-label="Search results"
      aria-hidden={!isSearching}
      inert={!isSearching}
    >
      <div className={styles.searchCard}>
        <h2>{isArchiveScope ? 'Archived Chats' : 'Chats'}</h2>
        {conversations.map((conversation) => (
          <ConversationMenu
            key={conversation.id}
            conversation={conversation}
            isSelecting={false}
            onAction={(action, anchor) => onMenuAction(conversation, action, anchor)}
          >
            <button
              type="button"
              className={styles.searchResult}
              onClick={(event) => {
                if (event.shiftKey) {
                  onMenuAction(conversation, 'preview', readPreviewAnchor(event.currentTarget));
                  return;
                }
                onSelectChat(conversation.id);
              }}
            >
              <Avatar initials={conversation.initials} color={conversation.color} size="small" />
              <span className={styles.rowContent}>
                <span className={styles.resultTitle}>{conversation.title}</span>
                <span className={styles.resultSubtitle}>{conversation.subtitle}</span>
              </span>
              <Ripple />
            </button>
          </ConversationMenu>
        ))}
        {conversations.length === 0 && <p className={styles.empty}>No conversations found</p>}
      </div>
    </nav>
  );
}
