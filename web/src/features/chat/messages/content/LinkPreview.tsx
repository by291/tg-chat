import { Ripple } from '@/components/Ripple';
import { useDeferredMediaSource } from './media/deferredMedia';
import type { MessageMedia } from '@/domain/messages/media';
import styles from './LinkPreview.module.css';

const MAX_IMAGE_WIDTH = 420;
const MAX_IMAGE_HEIGHT = 380;
const HORIZONTAL_PADDING = 15;

/** Open the preview's source while reserving its image geometry before loading. */
export function LinkPreview({ media }: { media: Extract<MessageMedia, { kind: 'link' }> }) {
  const imageSource = useDeferredMediaSource(media.image?.url);
  let previewWidth: number | undefined;
  if (media.image) {
    const scale = Math.min(
      1,
      MAX_IMAGE_WIDTH / media.image.width,
      MAX_IMAGE_HEIGHT / media.image.height,
    );
    previewWidth = media.image.width * scale + HORIZONTAL_PADDING;
  }

  return (
    <a
      className={styles.preview}
      style={{ width: previewWidth }}
      href={media.url}
      target="_blank"
      rel="noreferrer"
      dir="auto"
    >
      <Ripple />
      <strong className={styles.site}>{media.site}</strong>
      <strong className={styles.title}>{media.title}</strong>
      <span className={styles.description}>{media.description}</span>
      {media.image && (
        <img
          className={styles.image}
          src={imageSource}
          alt={media.image.name}
          width={media.image.width}
          height={media.image.height}
          loading="lazy"
          decoding="async"
        />
      )}
    </a>
  );
}
