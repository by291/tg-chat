import { BadgeCheck, BellOff, CheckCheck } from 'lucide-react';
import { Avatar } from '../../components/Avatar';
import { Ripple } from '../../components/Ripple';
import { describeMessage, formatMessageTime } from '../messageFormatting';
import type { ChatState, Conversation } from '../model';
import styles from './ChatSidebar.module.css';

interface ChatRowProps {
  conversation: Conversation;
  state: ChatState;
  onSelect: () => void;
}

/** Render a conversation preview with independent metadata and unread alignment. */
export function ChatRow({ conversation, state, onSelect }: ChatRowProps) {
  const messages = state.messages.filter((message) => message.chatId === conversation.id);
  const lastMessage = messages.at(-1);
  const draft = state.drafts[conversation.id];
  const isActive = state.activeChatId === conversation.id;
  const hasUnread = (conversation.unreadCount ?? 0) > 0 && !isActive;
  const preview = lastMessage ? describeMessage(lastMessage) : conversation.preview;
  const time = lastMessage ? formatMessageTime(lastMessage.createdAt) : conversation.time;

  return (
    <button
      type="button"
      className={styles.chatRow}
      data-active={isActive}
      aria-current={isActive ? 'page' : undefined}
      onClick={onSelect}
    >
      <Avatar initials={conversation.initials} color={conversation.color} />
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
          {hasUnread && (
            <span
              className={styles.unread}
              data-muted={conversation.isMuted}
              aria-label={`${conversation.unreadCount} unread messages`}
            >
              {conversation.unreadCount}
            </span>
          )}
        </span>
      </span>
      <Ripple />
    </button>
  );
}
