import { Download, FileText, UserRound } from 'lucide-react';
import { useDeferredMediaSource } from './deferredMedia';
import type { MessageMedia } from '../messageMedia';
import styles from './MessageBody.module.css';

const BYTES_PER_KILOBYTE = 1024;

/** Present document identity and an actual download action. */
export function DocumentCard({ media }: { media: Extract<MessageMedia, { kind: 'document' }> }) {
  const size = Math.max(1, Math.round(media.size / BYTES_PER_KILOBYTE));
  return (
    <a className={styles.documentCard} href={media.url} download={media.name}>
      <span className={styles.fileIcon}>
        <FileText />
      </span>
      <span className={styles.cardText}>
        <strong>{media.name}</strong>
        <small>
          {size} KB · {media.mimeType}
        </small>
      </span>
      <Download size={18} />
    </a>
  );
}

/** Show a link preview as a semantic link with its own media geometry. */
export function LinkPreview({ media }: { media: Extract<MessageMedia, { kind: 'link' }> }) {
  const imageSource = useDeferredMediaSource(media.image?.url);
  return (
    <a className={styles.linkPreview} href={media.url} target="_blank" rel="noreferrer">
      <strong className={styles.linkSite}>{media.site}</strong>
      <strong>{media.title}</strong>
      <span>{media.description}</span>
      {media.image && (
        <img
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

/** Make a shared contact readable and expose its telephone link. */
export function ContactCard({ media }: { media: Extract<MessageMedia, { kind: 'contact' }> }) {
  return (
    <a className={styles.contactCard} href={`tel:${media.phone}`}>
      <span className={styles.fileIcon}>
        <UserRound />
      </span>
      <span className={styles.cardText}>
        <strong>{media.name}</strong>
        <span>{media.phone}</span>
        <small>View contact</small>
      </span>
    </a>
  );
}
