import { File } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { getPhotoMessages } from '../media/photoGallery';
import type { MessageMedia } from '../messageMedia';
import { useVisiblePlayback } from '../messages/useVisiblePlayback';
import { VoiceMessage } from '../messages/VoiceMessage';
import type { Message } from '../model';
import styles from './ChatDetails.module.css';

interface ChatSharedMediaProps {
  category: string;
  messages: Message[];
  isActive: boolean;
  onOpenMedia: (message: Message) => void;
}

function pauseSharedMedia(container: HTMLDivElement | null) {
  const players = container?.querySelectorAll<HTMLMediaElement>('audio, video') ?? [];
  for (const player of players) {
    if (!player.paused) {
      player.pause();
    }
  }
}

function SharedVideo({ media }: { media: Extract<MessageMedia, { kind: 'video' }> }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useVisiblePlayback(videoRef);
  return (
    <video
      ref={videoRef}
      src={media.url}
      poster={media.poster}
      controls
      playsInline
      preload="none"
      aria-label="Shared video"
    />
  );
}

/** Render the selected shared-content category using the conversation's actual attachments. */
export function ChatSharedMedia({
  category,
  messages,
  isActive,
  onOpenMedia,
}: ChatSharedMediaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = containerRef.current;
    // The profile stays mounted for its exit animation; its media must stop as soon as it closes.
    if (!isActive) {
      pauseSharedMedia(container);
    }
    return () => pauseSharedMedia(container);
  }, [isActive]);

  if (category === 'media') {
    const photos = getPhotoMessages(messages);
    const videos = messages.filter((message) => message.media?.kind === 'video');
    return (
      <div ref={containerRef}>
        <div className={styles.gallery}>
          {photos.map((message) => (
            <button key={message.id} onClick={() => onOpenMedia(message)}>
              <img src={message.attachment!.url} alt={message.attachment!.name} />
            </button>
          ))}
          {videos.map((message) => {
            if (message.media?.kind !== 'video') {
              return null;
            }
            return <SharedVideo key={message.id} media={message.media} />;
          })}
        </div>
        {photos.length + videos.length === 0 && <p className={styles.empty}>No shared media yet</p>}
      </div>
    );
  }

  const matchingMessages = messages.filter((message) => {
    return message.media?.kind === (category === 'files' ? 'document' : 'voice');
  });
  return (
    <div ref={containerRef} className={styles.sharedList}>
      {matchingMessages.map((message) => {
        const media = message.media;
        if (media?.kind === 'voice') {
          return (
            <article key={message.id}>
              <VoiceMessage media={media} />
            </article>
          );
        }
        if (media?.kind === 'document') {
          return (
            <a key={message.id} className={styles.file} href={media.url} download={media.name}>
              <File />
              <span>{media.name}</span>
            </a>
          );
        }
        return null;
      })}
      {matchingMessages.length === 0 && (
        <p className={styles.empty}>
          {category === 'files' ? 'No shared files yet' : 'No shared voice messages yet'}
        </p>
      )}
    </div>
  );
}
