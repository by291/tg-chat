import { Menu } from '@ark-ui/react/menu';
import { Portal } from '@ark-ui/react/portal';
import { CheckCheck, Copy, MoreHorizontal, Pencil, Pin, Reply, Trash2 } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { IconButton } from '../shared/IconButton';
import { describeMessage, formatMessageTime } from './messageFormatting';
import { CURRENT_USER_ID, type Message, type MessageCommand } from './model';
import styles from './MessageBubble.module.css';
import overlays from './overlays.module.css';

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
  replyMessage?: Message;
  isGroupStart: boolean;
  isGroupEnd: boolean;
  isHighlighted: boolean;
  onCommand: (command: MessageCommand) => void;
  onReact: (messageId: string, emoji: string) => void;
  onOpenMedia: (message: Message) => void;
  onJumpToMessage: (messageId: string) => void;
}

function MessageMetadata({ message }: { message: Message }) {
  return (
    <span className={styles.metadata}>
      {message.isPinned && <Pin size={11} />}
      {message.isEdited && <span>edited</span>}
      <time dateTime={new Date(message.createdAt).toISOString()}>
        {formatMessageTime(message.createdAt)}
      </time>
      {message.authorId === CURRENT_USER_ID && <CheckCheck size={16} aria-label="Stored locally" />}
    </span>
  );
}

/** Render one message with sender grouping, media, reactions, and accessible context actions. */
export function MessageBubble({
  message,
  replyMessage,
  isGroupStart,
  isGroupEnd,
  isHighlighted,
  onCommand,
  onReact,
  onOpenMedia,
  onJumpToMessage,
}: MessageBubbleProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const shouldReduceMotion = useReducedMotion();
  const isOwn = message.authorId === CURRENT_USER_ID;

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

  return (
    <motion.article
      id={`message-${message.id}`}
      className={styles.messageRow}
      data-own={isOwn}
      data-group-start={isGroupStart}
      data-highlighted={isHighlighted}
      initial={shouldReduceMotion ? false : { opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: shouldReduceMotion ? 0 : MESSAGE_ENTRY_DURATION }}
    >
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
            data-sticker={Boolean(message.sticker)}
            onDoubleClick={() => onCommand({ action: 'reply', message })}
          >
            {!isOwn && isGroupStart && !message.sticker && (
              <span className={styles.author} data-author={message.authorId}>
                {message.authorName}
              </span>
            )}
            {message.replyToId && (
              <button
                className={styles.replyPreview}
                onClick={() => onJumpToMessage(message.replyToId!)}
                disabled={!replyMessage}
              >
                <strong>{replyMessage?.authorName || 'Message unavailable'}</strong>
                <span>{describeMessage(replyMessage)}</span>
              </button>
            )}
            {message.attachment && (
              <button
                className={styles.imageButton}
                onClick={() => onOpenMedia(message)}
                aria-label={`Open image: ${message.attachment.name}`}
              >
                <img
                  src={message.attachment.url}
                  alt={message.attachment.name}
                  width={message.attachment.width}
                  height={message.attachment.height}
                  loading="lazy"
                />
              </button>
            )}
            {message.sticker && <div className={styles.sticker}>{message.sticker}</div>}
            <div className={styles.messageContent}>
              {message.text && <span className={styles.messageText}>{message.text}</span>}
              <MessageMetadata message={message} />
            </div>
            {message.reactions.length > 0 && (
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
              {isOwn && !message.sticker && (
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
