import { Forward, Pencil, Reply, X } from 'lucide-react';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { IconButton } from '@/components/IconButton';
import { Ripple } from '@/components/Ripple';
import { CustomEmojiText } from '@/features/emoji/CustomEmojiText';
import { describeMessage } from '../../messageFormatting';
import type { Message } from '@/domain/messages/message';
import { findSticker } from '@/features/stickers/stickerCatalog';
import styles from './ComposerContextBar.module.css';

interface ComposerContextBarProps {
  linkPreview?: ReactNode;
  replyMessage?: Message;
  editingMessage?: Message;
  forwardMessages?: Message[];
  onJumpToMessage: (messageId: string) => void;
  onCancel: () => void;
}

interface ComposerContext {
  kind: 'reply' | 'edit' | 'forward';
  title: string;
  description: string;
  message?: Message;
}

function getContext(options: ComposerContextBarProps): ComposerContext | undefined {
  const message = options.editingMessage ?? options.replyMessage;
  if (message) {
    return {
      kind: options.editingMessage ? 'edit' : 'reply',
      title: options.editingMessage ? 'Edit message' : `Reply to ${message.authorName}`,
      description: describeMessage(message),
      message,
    };
  }

  const forwarded = options.forwardMessages;
  if (!forwarded?.length) {
    return undefined;
  }

  const authors = [...new Set(forwarded.map((entry) => entry.authorName))];

  return {
    kind: 'forward',
    title: `Forward ${forwarded.length} ${forwarded.length === 1 ? 'message' : 'messages'}`,
    description: authors.join(', '),
  };
}

function getThumbnail(message: Message) {
  if (message.sticker) {
    return findSticker(message.sticker)?.preview;
  }
  if (message.attachment) {
    return message.attachment.url;
  }

  switch (message.media?.kind) {
    case 'album':
      return message.media.photos[0]?.url;
    case 'video':
      return message.media.poster;
    case 'link':
      return message.media.image?.url;
    default:
      return undefined;
  }
}

function ContextContent({ context }: { context: ComposerContext }) {
  const thumbnail = context.message && getThumbnail(context.message);
  const isRound = context.message?.media?.kind === 'video' && context.message.media.isRound;

  return (
    <>
      {thumbnail && (
        <img
          className={styles.thumbnail}
          data-round={isRound}
          data-sticker={Boolean(context.message?.sticker)}
          src={thumbnail}
          alt="Message preview"
        />
      )}
      <span className={styles.summary}>
        <strong>{context.title}</strong>
        <span className={styles.description}>
          {context.message?.text ? <CustomEmojiText {...context.message} /> : context.description}
        </span>
      </span>
    </>
  );
}

function ContextActions({
  context,
  onJumpToMessage,
  onCancel,
}: Pick<ComposerContextBarProps, 'onJumpToMessage' | 'onCancel'> & { context: ComposerContext }) {
  let ContextIcon = Reply;
  if (context.kind === 'edit') {
    ContextIcon = Pencil;
  } else if (context.kind === 'forward') {
    ContextIcon = Forward;
  }

  return (
    <div
      className={styles.bar}
      data-reply-author={context.kind === 'reply' ? context.message?.authorId : undefined}
    >
      <ContextIcon className={styles.icon} size={24} aria-hidden="true" />
      {context.message ? (
        <button
          type="button"
          className={styles.preview}
          aria-label={
            context.kind === 'edit' ? 'Jump to edited message' : 'Jump to replied message'
          }
          onClick={() => {
            if (context.message) {
              onJumpToMessage(context.message.id);
            }
          }}
        >
          <ContextContent context={context} />
          <Ripple />
        </button>
      ) : (
        <div className={styles.preview}>
          <ContextContent context={context} />
        </div>
      )}
      <IconButton
        label={context.kind === 'forward' ? 'Cancel forwarding' : 'Cancel reply or edit'}
        onClick={onCancel}
      >
        <X />
      </IconButton>
    </div>
  );
}

/** Keep a single animated slot for the visible preview, reply, forward or edit. */
export function ComposerContextBar(props: ComposerContextBarProps) {
  const context = getContext(props);
  const previousContext = useRef(context);
  useLayoutEffect(() => {
    // Retain the reply during collapse, while dismissed link metadata is removed immediately.
    if (context) {
      previousContext.current = context;
    }
  }, [context]);

  const displayed = context ?? previousContext.current;
  const contextBar = displayed && (
    <ContextActions
      context={displayed}
      onJumpToMessage={props.onJumpToMessage}
      onCancel={props.onCancel}
    />
  );
  const isOpen = Boolean(props.linkPreview || context);
  return (
    <div className={styles.slot} data-open={isOpen} aria-hidden={!isOpen} inert={!isOpen}>
      {props.linkPreview ?? contextBar}
    </div>
  );
}
