import { Check, Quote } from 'lucide-react';
import { memo, useLayoutEffect, useRef } from 'react';
import { useAppPreferences } from '@/features/settings/appPreferences';
import { getLargeEmojiSize } from './content/largeEmoji';
import { Ripple } from '@/components/Ripple';
import { MessageBody, MessageText } from './content/MessageBody';
import { MessageMetadata } from './MessageMetadata';
import { MessageReaction } from './reactions/MessageReaction';
import { finishReactionLayout } from './reactions/reactionLayoutTransition';
import { MessageTail } from './MessageTail';
import { useDeferredMediaSource } from './content/media/deferredMedia';
import { describeMessage } from '../messageFormatting';
import { useCurrentUserId } from '@/features/chat/CurrentUser';
import { type Message } from '@/domain/messages/message';
import type { MessageInteraction } from '@/domain/messages/interaction';
import type { OutgoingMessageMount } from './transitions/outgoingMessageTransition';
import styles from './MessageBubble.module.css';

interface MessageBubbleProps {
  onMount?: (options: OutgoingMessageMount) => (() => void) | undefined;
  message: Message;
  shouldShowSender?: boolean;
  isPreview?: boolean;
  isSelecting?: boolean;
  isSelected?: boolean;
  idPrefix?: string;
  replyMessage?: Message;
  isGroupStart: boolean;
  isGroupEnd: boolean;
  isHighlighted: boolean;
  onInteract: (messageId: string, interaction: MessageInteraction) => void;
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
  shouldShowSender = false,
  onMount,
  isPreview = false,
  isSelecting = false,
  isSelected = false,
  idPrefix,
  replyMessage,
  isGroupStart,
  isGroupEnd,
  isHighlighted,
  onInteract,
  onReact,
  onOpenMedia,
  onJumpToMessage,
}: MessageBubbleProps) {
  const shouldUseLargeEmoji = useAppPreferences((preferences) => preferences.shouldUseLargeEmoji);
  const largeEmojiSize = shouldUseLargeEmoji ? getLargeEmojiSize(message) : undefined;
  const rowRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (row) {
      finishReactionLayout({ row });
    }
  }, [message.reactions]);
  useLayoutEffect(() => {
    const element = rowRef.current;
    if (element) {
      // The conversation owns the flight. Strict Mode replays row effects, and disposing here
      // would reveal the real bubble before the first animation frame.
      onMount?.({ messageId: message.id, element });
    }
  }, [message.id, onMount]);
  const currentUserId = useCurrentUserId();
  const isOwn = message.authorId === currentUserId;
  const isRoundVideo = message.media?.kind === 'video' && message.media.isRound;
  const isStandalone = Boolean(message.sticker || isRoundVideo || largeEmojiSize);
  const hasVisualMedia = Boolean(
    message.attachment || message.media?.kind === 'album' || message.media?.kind === 'video',
  );
  const isMediaOnly = hasVisualMedia && !message.text;
  const hasOverlayTime = isMediaOnly && !isStandalone;
  const hasReactions = message.reactions.length > 0;
  const canHaveTail = !isStandalone;
  const hasSender = !isOwn && shouldShowSender;
  const hasAuthor =
    hasSender && isGroupStart && !isStandalone && !isMediaOnly && !message.forwardedFrom;
  const hasHeader = Boolean(hasAuthor || message.forwardedFrom || message.replyToId);
  const hasCaption = Boolean(message.text);
  const hasInlineMediaMetadata =
    !hasCaption &&
    !hasReactions &&
    (message.media?.kind === 'voice' || message.media?.kind === 'document');
  const isLinkPreview = message.media?.kind === 'link';
  const replyThumbnailUrl = getReplyThumbnailUrl(replyMessage);
  const hasReplyQuote = Boolean(message.replyQuote?.text);
  const replyDescription = message.replyQuote?.text || describeMessage(replyMessage);
  const messageIdPrefix = idPrefix ?? (isPreview ? 'preview-message' : 'message');
  const elementId = `${messageIdPrefix}-${message.id}`;

  if (message.isService) {
    return (
      <div id={elementId} className={styles.serviceRow}>
        <span>{message.text}</span>
      </div>
    );
  }

  return (
    <article
      ref={rowRef}
      id={elementId}
      className={styles.messageRow}
      data-selecting={isSelecting}
      data-selected={isSelected}
      data-own={isOwn}
      data-has-sender={hasSender}
      data-group-start={isGroupStart}
      data-group-end={isGroupEnd}
      data-highlighted={isHighlighted}
    >
      <button
        className={styles.selectionCheckbox}
        role="checkbox"
        tabIndex={isSelecting ? 0 : -1}
        aria-hidden={!isSelecting}
        aria-checked={isSelected}
        aria-label={`Select message from ${message.authorName}`}
      >
        {isSelected && <Check size={16} />}
      </button>
      <div
        className={styles.bubble}
        data-message-content
        data-group-start={isGroupStart}
        data-group-end={isGroupEnd}
        data-standalone={isStandalone}
        data-media-only={isMediaOnly}
        data-visual-media={hasVisualMedia}
        data-has-tail={canHaveTail && isGroupEnd}
        data-has-header={hasHeader}
        data-has-caption={hasCaption}
        data-structured={message.media?.kind}
      >
        {canHaveTail && isGroupEnd && <MessageTail />}
        {hasAuthor && (
          <span className={styles.author} data-author={message.authorId}>
            {message.authorName}
          </span>
        )}
        {message.forwardedFrom && (
          <div className={styles.forwarded}>
            <span>Forwarded from</span>
            <span>{message.forwardedFrom}</span>
          </div>
        )}
        {message.replyToId && (
          <button
            type="button"
            className={styles.replyPreview}
            data-author={replyMessage?.authorId}
            data-quote={hasReplyQuote}
            dir="auto"
            onClick={() => onJumpToMessage(message.replyToId!)}
            disabled={!replyMessage}
          >
            <Ripple />
            {hasReplyQuote && (
              <Quote className={styles.replyQuoteIcon} aria-hidden="true" fill="currentColor" />
            )}
            <span className={styles.replyText}>
              {replyThumbnailUrl && <ReplyThumbnail source={replyThumbnailUrl} />}
              <strong>{replyMessage?.authorName || 'Message unavailable'}</strong>
              <span className={styles.replyDescription}>{replyDescription}</span>
            </span>
          </button>
        )}
        {isLinkPreview && (
          <div className={styles.messageContent} data-message-text>
            <MessageText message={message} />
          </div>
        )}
        <div className={styles.mediaContent} data-message-media>
          {largeEmojiSize && (
            <div className={styles.largeEmoji} style={{ fontSize: largeEmojiSize }}>
              <MessageText message={message} />
            </div>
          )}
          <MessageBody
            message={message}
            onOpenMedia={onOpenMedia}
            onInteract={onInteract}
            metadata={hasInlineMediaMetadata ? <MessageMetadata message={message} /> : undefined}
          />
          {hasOverlayTime && <MessageMetadata message={message} />}
        </div>
        <div className={styles.messageContent} data-message-text>
          {!isLinkPreview && !largeEmojiSize && <MessageText message={message} />}
          {!hasOverlayTime && !hasReactions && !hasInlineMediaMetadata && (
            <MessageMetadata message={message} />
          )}
        </div>
        {hasReactions && (
          <div className={styles.reactions} aria-label="Reactions">
            {message.reactions.map((emoji) => (
              <MessageReaction key={emoji} emoji={emoji} messageId={message.id} onReact={onReact} />
            ))}
            {!hasOverlayTime && <MessageMetadata message={message} />}
          </div>
        )}
      </div>
    </article>
  );
});
