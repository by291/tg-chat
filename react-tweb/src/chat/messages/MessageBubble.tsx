import { Menu } from '@ark-ui/react/menu';
import { Portal } from '@ark-ui/react/portal';
import { Copy, MoreHorizontal, Pencil, Pin, Reply, Trash2 } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { MessageBody, MessageText } from './MessageBody';
import { MessageMetadata } from './MessageMetadata';
import { MessageTail } from './MessageTail';
import { IconButton } from '../../components/IconButton';
import { describeMessage } from '../messageFormatting';
import { CURRENT_USER_ID, type Message, type MessageCommand } from '../model';
import styles from './MessageBubble.module.css';
import overlays from '../overlays.module.css';

// prettier-ignore
const QUICK_REACTIONS = [
  '❤️',
  '👍',
  '🔥',
  '🥰',
  '👏',
  '😁',
];
const MESSAGE_ENTRY_DURATION = 0.2;

interface MessageBubbleProps {
  message: Message;
  isPreview?: boolean;
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

/** Render one message with sender grouping, media, reactions, and accessible context actions. */
export function MessageBubble({
  message,
  isPreview = false,
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
  const [isMenuOpen, setIsMenuOpen] = useState(false);
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

  function selectReaction(emoji: string) {
    onReact(message.id, emoji);
    setIsMenuOpen(false);
  }

  function selectMenuAction({ value }: { value: string }) {
    const reactionPrefix = 'react-';
    if (value.startsWith(reactionPrefix)) {
      selectReaction(value.slice(reactionPrefix.length));
      return;
    }

    switch (value) {
      case 'reply':
      case 'copy':
      case 'edit':
      case 'pin':
      case 'delete':
        onCommand({ action: value, message });
    }
  }

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
      <Menu.Root
        open={isMenuOpen}
        onOpenChange={(details) => setIsMenuOpen(details.open)}
        onSelect={selectMenuAction}
      >
        <Menu.ContextTrigger asChild>
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
                {replyThumbnailUrl && (
                  <img src={replyThumbnailUrl} alt="" className={styles.replyThumbnail} />
                )}
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
        </Menu.ContextTrigger>
        <Menu.Trigger asChild>
          <IconButton
            label={`Actions for ${describeMessage(message)}`}
            className={styles.moreButton}
          >
            <MoreHorizontal />
          </IconButton>
        </Menu.Trigger>
        <Portal>
          <Menu.Positioner>
            <Menu.Content className={overlays.menu}>
              <div className={overlays.reactionBar}>
                {QUICK_REACTIONS.map((emoji) => (
                  <Menu.Item
                    key={emoji}
                    value={`react-${emoji}`}
                    valueText={`React ${emoji}`}
                    className={overlays.reactionButton}
                    aria-label={`React ${emoji}`}
                  >
                    {emoji}
                  </Menu.Item>
                ))}
              </div>
              <Menu.Item value="reply" className={overlays.menuItem}>
                <Reply /> Reply
              </Menu.Item>
              <Menu.Item value="copy" className={overlays.menuItem}>
                <Copy /> Copy text
              </Menu.Item>
              {isOwn && !message.sticker && message.media?.kind !== 'poll' && (
                <Menu.Item value="edit" className={overlays.menuItem}>
                  <Pencil /> Edit
                </Menu.Item>
              )}
              <Menu.Item value="pin" className={overlays.menuItem}>
                <Pin /> {message.isPinned ? 'Unpin' : 'Pin'}
              </Menu.Item>
              <Menu.Separator className={overlays.menuSeparator} />
              <Menu.Item value="delete" className={`${overlays.menuItem} ${overlays.danger}`}>
                <Trash2 /> Delete
              </Menu.Item>
            </Menu.Content>
          </Menu.Positioner>
        </Portal>
      </Menu.Root>
    </motion.article>
  );
}
