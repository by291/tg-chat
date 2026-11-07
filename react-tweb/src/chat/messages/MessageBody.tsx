import { CustomEmojiText } from '../emoji/CustomEmojiText';
import { AlbumFrame, PhotoFrame, VideoFrame } from './MessageMediaFrames';
import { ContactCard, DocumentCard, LinkPreview } from './MessageCards';
import { PollMessage } from './PollMessage';
import { VoiceMessage } from './VoiceMessage';
import { findSticker, STICKER_MESSAGE_SIZE } from '../stickers/stickerCatalog';
import { StickerArtwork } from '../stickers/StickerArtwork';
import type { Message } from '../model';
import styles from './MessageBody.module.css';

interface MessageBodyProps {
  message: Message;
  onOpenMedia: (message: Message) => void;
  onVote: (messageId: string, optionId: string) => void;
}

/** Select one explicit content renderer while the bubble keeps ownership of shared chrome. */
export function MessageBody({ message, onOpenMedia, onVote }: MessageBodyProps) {
  if (message.attachment) {
    return (
      <PhotoFrame
        photo={message.attachment}
        hasCaption={Boolean(message.text)}
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
      return <VideoFrame media={media} hasCaption={Boolean(message.text)} />;
    case 'voice':
      return <VoiceMessage media={media} />;
    case 'document':
      return <DocumentCard media={media} />;
    case 'link':
      return <LinkPreview media={media} />;
    case 'contact':
      return <ContactCard media={media} />;
    case 'poll':
      return <PollMessage poll={media} onVote={(optionId) => onVote(message.id, optionId)} />;
    default:
      return null;
  }
}

/** Preserve text, code, and quote semantics without interpreting user content as HTML. */
export function MessageText({ message }: { message: Message }) {
  if (!message.text) {
    return null;
  }
  if (message.textStyle === 'code') {
    return (
      <pre className={styles.code}>
        <code>{message.text}</code>
      </pre>
    );
  }
  if (message.textStyle === 'quote') {
    return (
      <blockquote className={styles.quote}>
        <CustomEmojiText {...message} />
      </blockquote>
    );
  }
  return (
    <span className={styles.text}>
      <CustomEmojiText {...message} />
    </span>
  );
}
