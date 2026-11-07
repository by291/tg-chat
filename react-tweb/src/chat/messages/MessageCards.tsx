import { Download, FileText } from 'lucide-react';
import type { MessageMedia } from '../messageMedia';
import styles from './MessageBody.module.css';

export { ContactMessage as ContactCard } from './ContactMessage';

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

export { LinkPreview } from './LinkPreview';
