import { CheckCheck, Pin } from 'lucide-react';
import { formatMessageTime } from './messageFormatting';
import type { Message } from './model';
import { CURRENT_USER_ID } from './model';
import styles from './MessageBubble.module.css';

function MetadataContent({ message }: { message: Message }) {
  return (
    <>
      {message.isPinned && <Pin size={12} />}
      {message.isEdited && <span>edited</span>}
      <time dateTime={new Date(message.createdAt).toISOString()}>
        {formatMessageTime(message.createdAt)}
      </time>
      {message.authorId === CURRENT_USER_ID && <CheckCheck size={19} aria-label="Stored locally" />}
    </>
  );
}

/** Reserve the timestamp's inline width while positioning its visible copy on the last line. */
export function MessageMetadata({ message }: { message: Message }) {
  return (
    <span className={styles.metadata}>
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
