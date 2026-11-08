import { useAppPreferences } from '@/features/settings/appPreferences';
import { Pin } from 'lucide-react';
import { formatMessageTime } from '../messageFormatting';
import type { Message } from '@/domain/messages/message';
import { useCurrentUserId } from '@/features/chat/CurrentUser';
import styles from './MessageBubble.module.css';

function SendingStatus({ status }: { status?: Message['deliveryStatus'] }) {
  const labels = {
    queued: 'Queued for sending',
    sending: 'Sending',
    accepted: 'Stored on server',
    failed: 'Send failed',
  };
  if (status && status !== 'accepted') {
    return (
      <span role="img" aria-label={labels[status]}>
        {status === 'failed' ? '!' : '·'}
      </span>
    );
  }

  return (
    <svg
      className={styles.sendingStatus}
      viewBox="0 -2.5 19 19"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={status ? labels[status] : 'Stored locally'}
    >
      <path d={status ? 'M2 8L5 11L12 3' : 'M2 8L5 11L12 3M9 10L10 11L17 3'} />
    </svg>
  );
}

function MetadataContent({ message }: { message: Message }) {
  const currentUserId = useCurrentUserId();
  const timeFormat = useAppPreferences((preferences) => preferences.timeFormat);
  return (
    <>
      {message.isPinned && <Pin size={12} className={styles.metadataPinned} />}
      {message.isEdited && <span className={styles.metadataEdited}>edited</span>}
      <time dateTime={new Date(message.createdAt).toISOString()}>
        {formatMessageTime(message.createdAt, { timeFormat })}
      </time>
      {message.authorId === currentUserId && <SendingStatus status={message.deliveryStatus} />}
    </>
  );
}

/** Reserve the timestamp's inline width while positioning its visible copy on the last line. */
export function MessageMetadata({ message }: { message: Message }) {
  return (
    <span className={styles.metadata} data-message-metadata>
      {/* The hidden copy reserves edited/pinned widths without duplicating accessible content. */}
      <span className={styles.metadataPlaceholder} aria-hidden="true">
        <MetadataContent message={message} />
      </span>
      <span className={styles.metadataInner}>
        <MetadataContent message={message} />
      </span>
    </span>
  );
}
