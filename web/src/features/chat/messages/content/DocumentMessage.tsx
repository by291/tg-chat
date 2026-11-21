import type { ReactNode } from 'react';
import { Download } from 'lucide-react';
import type { MessageMedia } from '@/domain/messages/media';
import styles from './DocumentMessage.module.css';

const BYTES_PER_UNIT = 1024;
const DOWNLOAD_ICON_SIZE = 24;
// prettier-ignore
const FILE_SIZE_UNITS = [
  'B',
  'KB',
  'MB',
  'GB',
  'TB',
  'PB',
];

type DocumentMedia = Extract<MessageMedia, { kind: 'document' }>;

function formatDocumentSize(bytes: number) {
  if (bytes === 0) {
    return '0 B';
  }

  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(BYTES_PER_UNIT)),
    FILE_SIZE_UNITS.length - 1,
  );
  const fractionDigits = Math.max(0, unitIndex - 1);
  const amount = bytes / BYTES_PER_UNIT ** unitIndex;
  return `${amount.toFixed(fractionDigits)} ${FILE_SIZE_UNITS[unitIndex]}`;
}

function getDocumentExtension(name: string) {
  const extensionIndex = name.lastIndexOf('.');
  const hasExtension = extensionIndex > 0 && extensionIndex < name.length - 1;
  if (!hasExtension) {
    return 'file';
  }

  return name.slice(extensionIndex + 1).toLowerCase();
}

/** Present a document's file type and size with its actual download link. */
export function DocumentMessage({
  media,
  metadata,
  onDownload,
}: {
  media: Pick<DocumentMedia, 'name' | 'size'> & { url?: string };
  onDownload?: () => void;
  metadata?: ReactNode;
}) {
  const extension = getDocumentExtension(media.name);

  const content = (
    <>
      <span className={styles.icon} aria-hidden="true">
        <span className={styles.extension}>{extension}</span>
        <Download className={styles.downloadIcon} size={DOWNLOAD_ICON_SIZE} />
      </span>
      <span className={styles.details}>
        <strong className={styles.name} title={media.name}>
          {media.name}
        </strong>
        <span className={styles.sizeRow}>
          <span className={styles.size}>{formatDocumentSize(media.size)}</span>
          {metadata}
        </span>
      </span>
    </>
  );
  const attributes = { className: styles.document, 'data-extension': extension };
  const label = `Download ${media.name}`;
  if (onDownload) {
    return (
      <button type="button" {...attributes} aria-label={label} onClick={onDownload}>
        {content}
      </button>
    );
  }
  if (!media.url) {
    return <div {...attributes}>{content}</div>;
  }
  return (
    <a {...attributes} href={media.url} download={media.name} aria-label={label}>
      {content}
    </a>
  );
}
