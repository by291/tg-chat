import { SortableChatRow } from './PinnedConversationSorting';
import { useAppPreferences } from '@/features/settings/appPreferences';
import { BadgeCheck, Check, CheckCheck, Pin, VolumeX } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Avatar } from '@/components/Avatar';
import { Ripple } from '@/components/Ripple';
import {
  describeMessage,
  formatConversationTime,
  formatMessageTime,
} from '@/features/chat/messageFormatting';
import { memo } from 'react';
import type { Message } from '@/domain/messages/message';
import { ConversationMenu } from './ConversationMenu';
import type { ConversationListEntry, ConversationMenuAction } from './conversationList';
import styles from './ChatSidebar.module.css';
import { readPreviewAnchor, type PreviewAnchor } from './previewPosition';

const MUTE_FADE_SECONDS = 0.2;
const BADGE_SCALE_SECONDS = 0.25;
// prettier-ignore
const BADGE_ENTER_EASING = [
  0.35,
  0.35,
  0.47,
  1.34,
] as const;

interface ChatRowProps {
  conversation: ConversationListEntry;
  isSelecting: boolean;
  isSelected: boolean;
  onMenuAction: (
    conversation: ConversationListEntry,
    action: ConversationMenuAction,
    anchor?: PreviewAnchor,
  ) => void;
  lastMessage?: Message;
  draft?: string;
  isActive: boolean;
  onSelect: (chatId: string) => void;
}

/** Render a conversation preview with independent metadata and unread alignment. */
export const ChatRow = memo(function ChatRow({
  conversation,
  lastMessage,
  draft,
  isActive,
  onSelect,
  isSelecting,
  isSelected,
  onMenuAction,
}: ChatRowProps) {
  const hasUnread = conversation.hasUnread;
  const fallbackPreview = conversation.hasClearedHistory ? '' : conversation.preview;
  const preview = lastMessage ? describeMessage(lastMessage) : fallbackPreview;
  const timeFormat = useAppPreferences((preferences) => preferences.timeFormat);
  const time = lastMessage
    ? formatMessageTime(lastMessage.createdAt, { timeFormat })
    : formatConversationTime(conversation.time, { timeFormat });
  const shouldReduceMotion = useReducedMotion();
  const badgeDuration = shouldReduceMotion ? 0 : BADGE_SCALE_SECONDS;
  const canReorder = isSelecting && conversation.isPinned;

  const row = (
    <ConversationMenu
      conversation={conversation}
      isSelecting={isSelecting}
      onAction={(action, anchor) => onMenuAction(conversation, action, anchor)}
    >
      <button
        type="button"
        className={styles.chatRow}
        data-active={isActive}
        data-selected={isSelected}
        data-selecting={isSelecting}
        data-reorderable={canReorder}
        aria-pressed={isSelecting ? isSelected : undefined}
        aria-current={isActive ? 'page' : undefined}
        onClick={(event) => {
          if (event.shiftKey && !isSelecting) {
            onMenuAction(conversation, 'preview', readPreviewAnchor(event.currentTarget));
            return;
          }

          onSelect(conversation.id);
        }}
      >
        <span className={styles.selectionCheck} data-checked={isSelected} aria-hidden="true">
          <Check size={16} />
        </span>
        <span className={styles.avatarContainer}>
          <Avatar initials={conversation.initials} color={conversation.color} />
        </span>
        <span className={styles.rowContent}>
          <span className={styles.rowHeading}>
            <span className={styles.chatTitle}>{conversation.title}</span>
            {conversation.isVerified && <BadgeCheck className={styles.verified} size={17} />}
            <AnimatePresence initial={false}>
              {conversation.isMuted && (
                <motion.span
                  key="muted"
                  className={styles.mutedIcon}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: shouldReduceMotion ? 0 : MUTE_FADE_SECONDS }}
                  aria-label="Muted"
                >
                  <VolumeX size={18} />
                </motion.span>
              )}
            </AnimatePresence>
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
            <AnimatePresence initial={false}>
              {conversation.isPinned && !hasUnread && (
                <motion.span
                  key="pinned"
                  className={styles.pinnedIcon}
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  transition={{ duration: badgeDuration, ease: BADGE_ENTER_EASING }}
                >
                  <Pin size={16} aria-label="Pinned" />
                </motion.span>
              )}
              {hasUnread && (
                <motion.span
                  key="unread"
                  className={styles.unread}
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  transition={{ duration: badgeDuration, ease: BADGE_ENTER_EASING }}
                  data-muted={conversation.isMuted}
                  aria-label={
                    conversation.unreadCount
                      ? `${conversation.unreadCount} unread messages`
                      : 'Marked as unread'
                  }
                >
                  {Boolean(conversation.unreadCount) && conversation.unreadCount}
                </motion.span>
              )}
            </AnimatePresence>
          </span>
        </span>
        <Ripple />
      </button>
    </ConversationMenu>
  );

  return (
    <SortableChatRow
      id={conversation.id}
      isDisabled={!canReorder}
      title={conversation.title}
      isActive={isActive}
    >
      {row}
    </SortableChatRow>
  );
});
