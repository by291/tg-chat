import { MoreHorizontal } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { memo, useEffect, useRef } from 'react';
import { MessageBody, MessageText } from './MessageBody';
import { MessageMetadata } from './MessageMetadata';
import { MessageTail } from './MessageTail';
import { useDeferredMediaSource } from './deferredMedia';
import { IconButton } from '../../components/IconButton';
import { describeMessage } from '../messageFormatting';
import { CURRENT_USER_ID, type Message, type MessageCommand } from '../model';
import styles from './MessageBubble.module.css';

const MESSAGE_ENTRY_DURATION = 0.2;

interface MessageBubbleProps {
  message: Message;
  isPreview?: boolean;
  isMenuOpen?: boolean;
  menuContentId?: string;
  idPrefix?: string;
  replyMessage?: Message;
  isGroupStart: boolean;
  isGroupEnd: boolean;
  isHighlighted: boolean;
  shouldAnimate: boolean;
  onAppear: (messageId: string) => void;
  onVote: (messageId: string, optionId: string) => void;
  onCommand: (command: MessageCommand) => void;
  onReact: (messageId: string, emoji: string) => void;
  onOpenMedia: (message: Message) => void;
  onJumpToMessage: (messageId: string) => void;
}

function getReplyThumbnailUrl(message?: Message) {
  if (message?.attachment) {
    return message.attachment.url;
  }
  if (message?.media?.kind === 'album') {
    return message.media.photos[0].url;
  }
  if (message?.media?.kind === 'video') {
    return message.media.poster;
  }
  return undefined;
}

function ReplyThumbnail({ source }: { source: string }) {
  const displayedSource = useDeferredMediaSource(source);
  return <img src={displayedSource} alt="" className={styles.replyThumbnail} decoding="async" />;
}

/** Render one message with sender grouping, media, reactions, and accessible context actions. */
export const MessageBubble = memo(function MessageBubble({
  message,
  isPreview = false,
  isMenuOpen = false,
  menuContentId,
  idPrefix,
  replyMessage,
  isGroupStart,
  isGroupEnd,
  isHighlighted,
  shouldAnimate,
  onAppear,
  onVote,
  onCommand,
  onReact,
  onOpenMedia,
  onJumpToMessage,
}: MessageBubbleProps) {
  const shouldReduceMotion = useReducedMotion();
  const isOwn = message.authorId === CURRENT_USER_ID;
  const shouldAnimateEntry = useRef(shouldAnimate);
  const isRoundVideo = message.media?.kind === 'video' && message.media.isRound;
  const isStandalone = Boolean(message.sticker || isRoundVideo);
  const hasVisualMedia = Boolean(
    message.attachment || message.media?.kind === 'album' || message.media?.kind === 'video',
  );
  const isMediaOnly = hasVisualMedia && !message.text;
  const hasOverlayTime = isMediaOnly && !isStandalone;
  const hasReactions = message.reactions.length > 0;
  const canHaveTail = !isStandalone && !isMediaOnly;
  const hasAuthor = !isOwn && isGroupStart && !isStandalone && !isMediaOnly;
  const hasHeader = Boolean(hasAuthor || message.forwardedFrom || message.replyToId);
  const hasCaption = Boolean(message.text);
  const isLinkPreview = message.media?.kind === 'link';
  const replyThumbnailUrl = getReplyThumbnailUrl(replyMessage);
  const messageIdPrefix = idPrefix ?? (isPreview ? 'preview-message' : 'message');
  const elementId = `${messageIdPrefix}-${message.id}`;

  useEffect(() => {
    onAppear(message.id);
  }, [message.id, onAppear]);

  if (message.isService) {
    return (
      <div id={elementId} className={styles.serviceRow}>
        <span>{message.text}</span>
      </div>
    );
  }

  return (
    <motion.article
      id={elementId}
      className={styles.messageRow}
      data-message-id={message.id}
      data-own={isOwn}
      data-group-start={isGroupStart}
      data-group-end={isGroupEnd}
      data-highlighted={isHighlighted}
      initial={
        shouldReduceMotion || !shouldAnimateEntry.current
          ? false
          : { opacity: 0, y: 16, scale: 0.96 }
      }
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: shouldReduceMotion ? 0 : MESSAGE_ENTRY_DURATION }}
    >
      {!isOwn && (
        <span className={styles.senderAvatar} data-visible={isGroupEnd} aria-hidden="true">
          {message.authorName.slice(0, 1)}
        </span>
      )}
      <div
        className={styles.bubble}
        data-group-start={isGroupStart}
        data-group-end={isGroupEnd}
        data-standalone={isStandalone}
        data-media-only={isMediaOnly}
        data-visual-media={hasVisualMedia}
        data-has-tail={canHaveTail && isGroupEnd}
        data-has-header={hasHeader}
        data-has-caption={hasCaption}
        onDoubleClick={(event) => {
          if (!(event.target as HTMLElement).closest('button, a, video, audio, input')) {
            onCommand({ action: 'reply', message });
          }
        }}
      >
        {canHaveTail && isGroupEnd && <MessageTail />}
        {hasAuthor && (
          <span className={styles.author} data-author={message.authorId}>
            {message.authorName}
          </span>
        )}
        {message.forwardedFrom && (
          <div className={styles.forwarded}>
            <span>Forwarded message</span>
            <strong>From {message.forwardedFrom}</strong>
          </div>
        )}
        {message.replyToId && (
          <button
            className={styles.replyPreview}
            onClick={() => onJumpToMessage(message.replyToId!)}
            disabled={!replyMessage}
          >
            {replyThumbnailUrl && <ReplyThumbnail source={replyThumbnailUrl} />}
            <span className={styles.replyText}>
              <strong>{replyMessage?.authorName || 'Message unavailable'}</strong>
              <span>{describeMessage(replyMessage)}</span>
            </span>
          </button>
        )}
        {isLinkPreview && (
          <div className={styles.messageContent}>
            <MessageText message={message} />
          </div>
        )}
        <div className={styles.mediaContent}>
          <MessageBody message={message} onOpenMedia={onOpenMedia} onVote={onVote} />
          {hasOverlayTime && <MessageMetadata message={message} />}
        </div>
        <div className={styles.messageContent}>
          {!isLinkPreview && <MessageText message={message} />}
          {!hasOverlayTime && !hasReactions && <MessageMetadata message={message} />}
        </div>
        {hasReactions && (
          <div className={styles.reactions} aria-label="Reactions">
            {message.reactions.map((emoji) => (
              <button
                key={emoji}
                aria-label={`Remove ${emoji} reaction`}
                onClick={() => onReact(message.id, emoji)}
              >
                {emoji} <span>1</span>
              </button>
            ))}
            {!hasOverlayTime && <MessageMetadata message={message} />}
          </div>
        )}
      </div>
      <IconButton
        label={`Actions for ${describeMessage(message)}`}
        className={styles.moreButton}
        data-message-menu-trigger
        aria-haspopup="menu"
        aria-expanded={isMenuOpen}
        aria-controls={isMenuOpen ? menuContentId : undefined}
      >
        <MoreHorizontal />
      </IconButton>
    </motion.article>
  );
});
