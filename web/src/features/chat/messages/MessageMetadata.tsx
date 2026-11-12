import { useAppPreferences } from '@/features/settings/appPreferences';
import { Pin } from 'lucide-react';
import { formatMessageTime } from '../messageFormatting';
import type { Message } from '@/domain/messages/message';
import { useCurrentUserId } from '@/features/chat/CurrentUser';
import styles from './MessageBubble.module.css';

const deliveryLabels = {
  queued: 'Queued for sending',
  sending: 'Sending',
  accepted: 'Stored on server',
  failed: 'Send failed',
};

interface MessageMetadataProps {
  message: Message;
  onRetry?: () => void;
}

function SendingStatus({
  status,
  isRead,
  error,
  onRetry,
}: {
  status?: Message['deliveryStatus'];
  isRead?: boolean;
  error?: string;
  onRetry?: () => void;
}) {
  const hasCheck = !status || status === 'accepted';
  const hasSingleCheck = status === 'accepted' && !isRead;
  const hasClock = status === 'queued' || status === 'sending';
  const isFailed = status === 'failed';
  const canRetry = isFailed && Boolean(onRetry);

  let label = status ? deliveryLabels[status] : 'Stored locally';
  if (hasCheck && isRead) {
    label = 'Read';
  }

  const icon = (
    <svg
      className={styles.sendingStatus}
      viewBox="0 -2.5 19 19"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={canRetry ? undefined : label}
      aria-hidden={canRetry || undefined}
    >
      {hasCheck && (
        <path d={hasSingleCheck ? 'M2 8L5 11L12 3' : 'M2 8L5 11L12 3M9 10L10 11L17 3'} />
      )}
      {hasClock && (
        <>
          <circle cx="9.5" cy="7" r="5.5" />
          <path d="M9.5 3.7V7l2 1.2" />
        </>
      )}
      {isFailed && (
        <>
          <circle className={styles.sendingFailure} cx="9.5" cy="7" r="6.5" />
          <path stroke="white" d="M9.5 3.7v3.6m0 2.7h.01" />
        </>
      )}
    </svg>
  );

  if (!canRetry) {
    return icon;
  }

  return (
    <button
      type="button"
      className={styles.retrySend}
      aria-label="Retry sending message"
      aria-description={error ?? deliveryLabels.failed}
      title={error ?? 'Retry sending message'}
      onClick={onRetry}
    >
      {icon}
    </button>
  );
}

function MetadataContent({ message, onRetry }: MessageMetadataProps) {
  const currentUserId = useCurrentUserId();
  const timeFormat = useAppPreferences((preferences) => preferences.timeFormat);

  return (
    <>
      {message.isPinned && <Pin size={12} className={styles.metadataPinned} />}
      {message.isEdited && <span className={styles.metadataEdited}>edited</span>}
      <time dateTime={new Date(message.createdAt).toISOString()}>
        {formatMessageTime(message.createdAt, { timeFormat })}
      </time>
      {message.authorId === currentUserId && (
        <SendingStatus
          status={message.deliveryStatus}
          isRead={message.isRead}
          error={message.deliveryError}
          onRetry={onRetry}
        />
      )}
    </>
  );
}

/** Reserve the timestamp's inline width while positioning its visible copy on the last line. */
export function MessageMetadata({ message, onRetry }: MessageMetadataProps) {
  return (
    <span className={styles.metadata} data-message-metadata>
      {/* The hidden copy reserves timestamp width and cannot contain focusable controls. */}
      <span className={styles.metadataPlaceholder} aria-hidden="true">
        <MetadataContent message={message} />
      </span>
      <span className={styles.metadataInner}>
        <MetadataContent message={message} onRetry={onRetry} />
      </span>
    </span>
  );
}
