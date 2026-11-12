import { BellOff, Pin } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { RemoteAvatar } from '@/features/media/RemoteAvatar';
import { useAppPreferences } from '@/features/settings/appPreferences';
import type { SessionOwner } from '@/features/auth/SessionOwner';
import { formatMessageTime } from '../messageFormatting';
import { isConversationMuted, type Conversation } from '../data/messageModels';
import styles from './ConnectedChat.module.css';

const DAYS_IN_WEEK = 7;
const weekdayFormatter = new Intl.DateTimeFormat('en', { weekday: 'short' });
const dateFormatter = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });
const yearFormatter = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

interface ConversationRowProps {
  conversation: Conversation;
  name: string;
  isSelected: boolean;
  session?: SessionOwner;
  onOpen: () => void;
}

function formatSummaryTime(value: string, timeFormat: 'h12' | 'h23'): string {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return formatMessageTime(date.getTime(), { timeFormat });
  }

  const weekStart = new Date();
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - DAYS_IN_WEEK);
  if (date >= weekStart && date < today) {
    return weekdayFormatter.format(date);
  }

  const formatter = date.getFullYear() === today.getFullYear() ? dateFormatter : yearFormatter;
  return formatter.format(date);
}

/** Present one authorized conversation with its visible summary time and unread state. */
export function ConnectedConversationRow({
  conversation,
  name,
  isSelected,
  session,
  onOpen,
}: ConversationRowProps) {
  const timeFormat = useAppPreferences((preferences) => preferences.timeFormat);
  const isSaved = conversation.kind === 'saved';
  const initials = isSaved ? 'saved' : name.slice(0, 2).toUpperCase();
  const draft = conversation.draft.content?.text;
  const summary = conversation.summary_text || 'Start a conversation';
  const timestamp = conversation.summary_created_at;
  const unread = conversation.unread_count !== '0' ? conversation.unread_count : undefined;
  const isUnread = Boolean(unread) || conversation.is_manually_unread;
  const isMuted = isConversationMuted(conversation);
  const isPinned = conversation.pin_rank !== null;
  const fileId = conversation.avatar_file_id ?? conversation.peer_avatar_file_id;

  return (
    <button
      type="button"
      className={styles.conversation}
      aria-pressed={isSelected}
      onClick={onOpen}
    >
      {session && fileId && !isSaved ? (
        <RemoteAvatar
          session={session}
          owner={conversation.avatar_file_id ? 'conversation' : 'user'}
          id={conversation.avatar_file_id ? conversation.id : conversation.peer_id}
          fileId={fileId}
          initials={initials}
        />
      ) : (
        <Avatar initials={initials} />
      )}
      <span className={styles.summary}>
        <span className={styles.summaryTitle}>
          <strong>{name}</strong>
          {isMuted && <BellOff size={14} aria-label="Muted" />}
        </span>
        <span className={styles.summaryText}>
          {draft ? (
            <>
              <span className={styles.draftLabel}>Draft: </span>
              {draft}
            </>
          ) : (
            summary
          )}
        </span>
      </span>
      <span className={styles.summaryMeta}>
        {timestamp && <time dateTime={timestamp}>{formatSummaryTime(timestamp, timeFormat)}</time>}
        <span className={styles.summaryIndicators}>
          {isPinned && <Pin size={14} aria-label="Pinned" />}
          {isUnread && (
            <span
              className={styles.unreadBadge}
              data-muted={isMuted || undefined}
              data-unread-dot={unread === undefined || undefined}
              aria-label={unread ? `${unread} unread messages` : 'Unread'}
            >
              {unread}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}
