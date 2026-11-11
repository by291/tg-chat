import { Fragment, type ReactNode } from 'react';
import { CustomEmojiText } from '@/features/emoji/CustomEmojiText';
import { splitEmojiText } from '@/domain/messages/customEmoji';
import { MessageCode } from '../../rich-text/MessageCode';
import { MessageQuote } from '../../rich-text/MessageQuote';
import { RichMessageText } from '../../rich-text/RichMessageText';
import { linkText } from '../../rich-text/linkText';
import { AlbumFrame, PhotoFrame, VideoFrame } from './media/MessageMediaFrames';
import { ContactCard, DocumentCard, LinkPreview } from './MessageCards';
import { ChecklistMessage } from './checklist/ChecklistMessage';
import { PollMessage } from './poll/PollMessage';
import { VoiceMessage } from './media/VoiceMessage';
import { ConnectedMessageMedia } from './media/ConnectedMessageMedia';
import { findSticker, STICKER_MESSAGE_SIZE } from '@/features/stickers/stickerCatalog';
import { StickerArtwork } from '@/features/stickers/StickerArtwork';
import type { Message } from '@/domain/messages/message';
import type { MessageInteraction } from '@/domain/messages/interaction';
import styles from './MessageBody.module.css';

interface MessageBodyProps {
  message: Message;
  metadata?: ReactNode;
  onOpenMedia: (message: Message) => void;
  onInteract: (messageId: string, interaction: MessageInteraction) => void | Promise<boolean>;
}

/** Select one explicit content renderer while the bubble keeps ownership of shared chrome. */
export function MessageBody({ message, metadata, onOpenMedia, onInteract }: MessageBodyProps) {
  if (message.pendingMedia || message.remoteAttachments?.length) {
    return <ConnectedMessageMedia message={message} />;
  }
  if (message.attachment) {
    return (
      <PhotoFrame
        messageId={message.id}
        photo={message.attachment}
        hasCaption={Boolean(message.text || message.replyToId)}
        onOpen={() => onOpenMedia(message)}
      />
    );
  }
  if (message.sticker) {
    const sticker = findSticker(message.sticker);
    if (sticker) {
      return (
        <div style={{ width: STICKER_MESSAGE_SIZE, height: STICKER_MESSAGE_SIZE }}>
          <StickerArtwork sticker={sticker} />
        </div>
      );
    }
    return <p>Sticker unavailable</p>;
  }

  const media = message.media;
  switch (media?.kind) {
    case 'album':
      return <AlbumFrame message={message} photos={media.photos} onOpenMedia={onOpenMedia} />;
    case 'video':
      return (
        <VideoFrame
          media={media}
          messageId={message.id}
          hasCaption={Boolean(message.text || message.replyToId)}
          onOpen={() => onOpenMedia(message)}
        />
      );
    case 'voice':
      return <VoiceMessage media={media} metadata={metadata} />;
    case 'document':
      return <DocumentCard media={media} metadata={metadata} />;
    case 'link':
      return <LinkPreview media={media} />;
    case 'contact':
      return <ContactCard media={media} />;
    case 'poll':
      return (
        <PollMessage
          messageId={message.id}
          poll={media}
          onInteract={(interaction) => onInteract(message.id, interaction)}
        />
      );
    case 'checklist':
      return (
        <ChecklistMessage
          message={message}
          checklist={media}
          onInteract={(interaction) => onInteract(message.id, interaction)}
        />
      );
    default:
      return null;
  }
}

/** Render safe rich content while preserving legacy text, code, and quote messages. */
export function MessageText({ message }: { message: Message }) {
  if (message.richText) {
    return <RichMessageText richText={message.richText} />;
  }
  if (!message.text) {
    return null;
  }
  if (message.textStyle === 'code') {
    return <MessageCode source={message.text} />;
  }
  if (message.textStyle === 'quote') {
    return (
      <MessageQuote>
        <CustomEmojiText {...message} />
      </MessageQuote>
    );
  }

  return (
    <span className={styles.text}>
      {splitEmojiText(message).map((part) => (
        <Fragment key={part.offset}>
          {part.documentId ? (
            <CustomEmojiText
              text={part.text}
              customEmoji={[{ documentId: part.documentId, offset: 0, length: part.text.length }]}
            />
          ) : (
            (linkText(part.text) ?? part.text)
          )}
        </Fragment>
      ))}
    </span>
  );
}
