import { useEffect, useState } from 'react';
import type { MediaSelection } from '@/features/media/uploadTransfer';
import styles from '../MessageComposer.module.css';

const MAX_ALBUM_ITEMS = 10;
const IMAGE_BYTES = 25 * 1024 * 1024;
const FILE_BYTES = 100 * 1024 * 1024;

function kindFor(file: File, mode: 'media' | 'document'): MediaSelection['kind'] {
  if (mode === 'document') {
    return 'document';
  }
  if (file.type.startsWith('image/')) {
    return 'image';
  }
  if (file.type.startsWith('video/')) {
    return 'video';
  }
  return 'document';
}

/** Convert browser files into the ordered selection accepted by the durable composer. */
export function selectConnectedFiles(input: {
  current: MediaSelection[];
  files: File[];
  mode: 'media' | 'document';
}): MediaSelection[] {
  const incoming = input.files.map((file) => {
    const kind = kindFor(file, input.mode);
    const limit = kind === 'image' ? IMAGE_BYTES : FILE_BYTES;
    if (file.size === 0 || file.size > limit) {
      throw new Error(`${file.name} is empty or exceeds its upload limit.`);
    }
    return { blob: file, kind, filename: file.name };
  });
  const selection = [...input.current, ...incoming];
  if (selection.length > MAX_ALBUM_ITEMS) {
    throw new Error('Choose at most ten photos or videos per album.');
  }
  const hasSingleFile = selection.some((item) => item.kind === 'document' || item.kind === 'voice');
  if (hasSingleFile && selection.length > 1) {
    throw new Error('Send documents and voice messages individually.');
  }

  return selection;
}

/** Show the selected source while keeping its temporary URL tied to the mounted preview. */
export function ConnectedAttachmentPreview({
  selection,
  onRemove,
}: {
  selection: MediaSelection;
  onRemove: () => void;
}) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (selection.kind === 'document' || typeof URL.createObjectURL !== 'function') {
      return;
    }
    const objectUrl = URL.createObjectURL(selection.blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [selection]);

  return (
    <div className={styles.connectedPreview}>
      {url && selection.kind === 'image' && <img src={url} alt="" />}
      {url && selection.kind === 'video' && <video src={url} muted preload="metadata" />}
      {url && selection.kind === 'voice' && <audio src={url} controls />}
      <span>{selection.filename}</span>
      <button type="button" onClick={onRemove} aria-label={`Remove ${selection.filename}`}>
        ×
      </button>
    </div>
  );
}
