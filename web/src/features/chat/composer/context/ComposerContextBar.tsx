import { Forward, Pencil, Reply, X } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import { IconButton } from '@/components/IconButton';
import { Ripple } from '@/components/Ripple';
import { CustomEmojiText } from '@/features/emoji/CustomEmojiText';
import { describeMessage } from '../../messageFormatting';
import type { Message } from '@/domain/messages/message';
import { findSticker } from '@/features/stickers/stickerCatalog';
import styles from './ComposerContextBar.module.css';

interface ComposerContextBarProps {
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

/** Keep the preview mounted during collapse so its height animates the floating composer. */
export function ComposerContextBar(props: ComposerContextBarProps) {
  const context = getContext(props);
  const lastContextRef = useRef(context);
  useLayoutEffect(() => {
    if (context) {
      lastContextRef.current = context;
    }
  }, [context]);

  const displayed = context ?? lastContextRef.current;
  const isOpen = Boolean(context);
  let ContextIcon = Reply;
  if (displayed?.kind === 'edit') {
    ContextIcon = Pencil;
  } else if (displayed?.kind === 'forward') {
    ContextIcon = Forward;
  }

  return (
    <div className={styles.slot} data-open={isOpen} aria-hidden={!isOpen} inert={!isOpen}>
      {displayed && (
        <div
          className={styles.bar}
          data-reply-author={displayed.kind === 'reply' ? displayed.message?.authorId : undefined}
        >
          <ContextIcon className={styles.icon} size={24} aria-hidden="true" />
          {displayed.message ? (
            <button
              type="button"
              className={styles.preview}
              aria-label={
                displayed.kind === 'edit' ? 'Jump to edited message' : 'Jump to replied message'
              }
              onClick={() => {
                if (displayed.message) {
                  props.onJumpToMessage(displayed.message.id);
                }
              }}
            >
              <ContextContent context={displayed} />
              <Ripple />
            </button>
          ) : (
            <div className={styles.preview}>
              <ContextContent context={displayed} />
            </div>
          )}
          <IconButton
            label={displayed.kind === 'forward' ? 'Cancel forwarding' : 'Cancel reply or edit'}
            onClick={props.onCancel}
          >
            <X />
          </IconButton>
        </div>
      )}
    </div>
  );
}
