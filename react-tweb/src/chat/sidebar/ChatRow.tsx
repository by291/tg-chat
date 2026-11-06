import { BadgeCheck, BellOff, Check, CheckCheck, Pin } from 'lucide-react';
import { Avatar } from '../../components/Avatar';
import { Ripple } from '../../components/Ripple';
import { describeMessage, formatMessageTime } from '../messageFormatting';
import type { ChatState } from '../model';
import { ConversationMenu } from './ConversationMenu';
import type { ConversationListEntry, ConversationMenuAction } from './conversationList';
import styles from './ChatSidebar.module.css';

interface ChatRowProps {
  conversation: ConversationListEntry;
  isSelecting: boolean;
  isSelected: boolean;
  onMenuAction: (action: ConversationMenuAction) => void;
  state: ChatState;
  onSelect: () => void;
}

/** Render a conversation preview with independent metadata and unread alignment. */
export function ChatRow({
  conversation,
  state,
  onSelect,
  isSelecting,
  isSelected,
  onMenuAction,
}: ChatRowProps) {
  const messages = state.messages.filter((message) => message.chatId === conversation.id);
  const lastMessage = messages.at(-1);
  const draft = state.drafts[conversation.id];
  const isActive = state.activeChatId === conversation.id;
  const hasUnread = conversation.hasUnread;
  const fallbackPreview = conversation.hasClearedHistory ? '' : conversation.preview;
  const preview = lastMessage ? describeMessage(lastMessage) : fallbackPreview;
  const time = lastMessage ? formatMessageTime(lastMessage.createdAt) : conversation.time;

  return (
    <ConversationMenu conversation={conversation} isSelecting={isSelecting} onAction={onMenuAction}>
      <button
        type="button"
        className={styles.chatRow}
        data-active={isActive}
        data-selected={isSelected}
        aria-pressed={isSelecting ? isSelected : undefined}
        aria-current={isActive ? 'page' : undefined}
        onClick={onSelect}
      >
        <span className={styles.avatarContainer}>
          <Avatar initials={conversation.initials} color={conversation.color} />
          {isSelecting && (
            <span className={styles.selectionCheck} data-checked={isSelected}>
              {isSelected && <Check size={14} />}
            </span>
          )}
        </span>
        <span className={styles.rowContent}>
          <span className={styles.rowHeading}>
            <span className={styles.chatTitle}>{conversation.title}</span>
            {conversation.isVerified && <BadgeCheck className={styles.verified} size={17} />}
            {conversation.isMuted && <BellOff className={styles.mutedIcon} size={14} />}
            <span className={styles.chatTime}>
              {lastMessage?.authorId === 'you' && <CheckCheck size={16} />}
              {time}
            </span>
          </span>
          <span className={styles.rowPreview}>
            <span className={styles.previewText}>
              {draft && <span className={styles.draftLabel}>Draft: </span>}
              {draft || preview}
            </span>
            {conversation.isPinned && !hasUnread && (
              <Pin className={styles.pinnedIcon} size={16} aria-label="Pinned" />
            )}
            {hasUnread && (
              <span
                className={styles.unread}
                data-muted={conversation.isMuted}
                aria-label={
                  conversation.unreadCount
                    ? `${conversation.unreadCount} unread messages`
                    : 'Marked as unread'
                }
              >
                {Boolean(conversation.unreadCount) && conversation.unreadCount}
              </span>
            )}
          </span>
        </span>
        <Ripple />
      </button>
    </ConversationMenu>
  );
}
