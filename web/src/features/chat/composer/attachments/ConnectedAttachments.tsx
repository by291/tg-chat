import { File, Film, Image, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { IconButton } from '@/components/IconButton';
import type { MediaSelection } from '@/features/media/uploadTransfer';
import styles from './ConnectedAttachmentDialog.module.css';

const MAX_ATTACHMENTS = 10;
const IMAGE_BYTES = 25 * 1024 * 1024;
const FILE_BYTES = 100 * 1024 * 1024;

export type AttachmentMode = 'media' | 'document';

function visualKind(file: Blob): 'image' | 'video' | undefined {
  if (file.type.startsWith('image/')) {
    return 'image';
  }
  if (file.type.startsWith('video/')) {
    return 'video';
  }
  return undefined;
}

function validateSize(selection: MediaSelection): void {
  const limit = selection.kind === 'image' ? IMAGE_BYTES : FILE_BYTES;
  if (selection.blob.size === 0 || selection.blob.size > limit) {
    throw new Error(`${selection.filename} is empty or exceeds its upload limit.`);
  }
}

/** Validate ordered sources before showing them in the attachment confirmation. */
export function selectConnectedFiles(input: {
  current: MediaSelection[];
  files: File[];
  mode: AttachmentMode;
}): MediaSelection[] {
  const selectionCount = input.current.length + input.files.length;
  if (selectionCount > MAX_ATTACHMENTS) {
    throw new Error('Choose at most ten attachments at a time.');
  }

  const incoming = input.files.map((file): MediaSelection => {
    const kind = input.mode === 'document' ? 'document' : (visualKind(file) ?? 'document');
    const selection: MediaSelection = { blob: file, kind, filename: file.name };
    validateSize(selection);
    return selection;
  });
  return [...input.current, ...incoming];
}

/** Check whether a source can switch between visual media and a file. */
export function isVisualAttachment(selection: MediaSelection): boolean {
  return Boolean(visualKind(selection.blob));
}

/** Switch a selected source to the requested delivery mode without changing its bytes. */
export function changeAttachmentMode(input: {
  selection: MediaSelection;
  mode: AttachmentMode;
}): MediaSelection {
  const { selection, mode } = input;
  const kind = mode === 'document' ? 'document' : visualKind(selection.blob);
  if (!kind) {
    throw new Error(`${selection.filename} cannot be sent as visual media.`);
  }

  const updated: MediaSelection = { ...selection, kind };
  validateSize(updated);
  return updated;
}

/** Preview each selected source and release its temporary URL when the row closes. */
export function ConnectedAttachmentPreview({
  selection,
  isDisabled,
  onRemove,
}: {
  selection: MediaSelection;
  isDisabled: boolean;
  onRemove: () => void;
}) {
  const [url, setUrl] = useState<string>();
  const { blob, kind, filename } = selection;
  useEffect(() => {
    if (kind === 'document' || typeof URL.createObjectURL !== 'function') {
      setUrl(undefined);
      return;
    }

    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob, kind]);

  const hasThumbnail = Boolean(url && (kind === 'image' || kind === 'video'));
  let FallbackIcon = File;
  if (kind === 'image') {
    FallbackIcon = Image;
  } else if (kind === 'video') {
    FallbackIcon = Film;
  }

  return (
    <li className={styles.preview}>
      <div className={styles.thumbnail}>
        {url && kind === 'image' && <img src={url} alt="" />}
        {url && kind === 'video' && <video src={url} muted preload="metadata" playsInline />}
        {!hasThumbnail && <FallbackIcon aria-hidden="true" />}
      </div>
      <span className={styles.filename} title={filename}>
        {filename}
      </span>
      <IconButton label={`Remove ${filename}`} onClick={onRemove} disabled={isDisabled}>
        <X aria-hidden="true" />
      </IconButton>
    </li>
  );
}
