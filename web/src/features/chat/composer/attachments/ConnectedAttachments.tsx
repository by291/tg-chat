import { Film, Image, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { IconButton } from '@/components/IconButton';
import { DocumentMessage } from '../../messages/content/DocumentMessage';
import { AlbumLayoutFrame } from '../../messages/content/media/VisualMediaLayout';
import { fitMediaWithin } from '@/features/media/mediaGeometry';
import { visualDimensions } from '@/features/media/connectedMediaReference';
import type { MediaSelection } from '@/features/media/uploadTransfer';
import styles from './ConnectedAttachmentDialog.module.css';

const PREVIEW_WIDTH = 384;
const PREVIEW_HEIGHT = 320;
const MAX_ATTACHMENTS = 10;
const IMAGE_BYTES = 25 * 1024 * 1024;
const FILE_BYTES = 100 * 1024 * 1024;

export type AttachmentMode = 'media' | 'document';

export interface AttachmentItem {
  id: string;
  selection: MediaSelection;
  hasReadDimensions: boolean;
}

interface SourceDimensions {
  width: number;
  height: number;
}

interface AttachmentPreviewProps {
  items: AttachmentItem[];
  isAlbum: boolean;
  isDisabled: boolean;
  onRemove: (id: string) => void;
  onMeasure: (id: string, size?: SourceDimensions) => void;
}

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
  existingCount?: number;
  files: File[];
  mode: AttachmentMode;
}): MediaSelection[] {
  const selectionCount = (input.existingCount ?? 0) + input.files.length;
  if (selectionCount > MAX_ATTACHMENTS) {
    throw new Error('Choose at most ten attachments at a time.');
  }

  return input.files.map((file): MediaSelection => {
    const kind = input.mode === 'document' ? 'document' : (visualKind(file) ?? 'document');
    // prettier-ignore
    const selection: MediaSelection = {
      blob: file,
      kind,
      filename: file.name,
    };
    validateSize(selection);
    return selection;
  });
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

function SourcePreview({
  item,
  onMeasure,
}: {
  item: AttachmentItem;
  onMeasure: AttachmentPreviewProps['onMeasure'];
}) {
  const { blob, kind, filename } = item.selection;
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (typeof URL.createObjectURL !== 'function') {
      return;
    }

    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  if (!url) {
    const Icon = kind === 'video' ? Film : Image;
    return <Icon aria-hidden="true" />;
  }

  // Unsupported local codecs can still be uploaded for processing by the server.
  const failed = () => onMeasure(item.id);
  if (kind === 'video') {
    return (
      <video
        src={url}
        aria-label={filename}
        muted
        preload="metadata"
        playsInline
        onError={failed}
        onLoadedMetadata={({ currentTarget }) =>
          onMeasure(item.id, { width: currentTarget.videoWidth, height: currentTarget.videoHeight })
        }
      />
    );
  }
  return (
    <img
      src={url}
      alt={filename}
      onError={failed}
      onLoad={({ currentTarget }) =>
        onMeasure(item.id, {
          width: currentTarget.naturalWidth,
          height: currentTarget.naturalHeight,
        })
      }
    />
  );
}

/** Display each selection at its measured size, grouping only the files that will form an album. */
export function ConnectedAttachmentPreview(props: AttachmentPreviewProps) {
  const tiles = props.items.map((item) => {
    const { selection, id } = item;
    const { kind, filename, blob } = selection;
    const dimensions = visualDimensions(selection);
    const isFile = kind === 'document';
    const isSingleVisual = !isFile && !props.isAlbum;
    const fit = fitMediaWithin({
      ...dimensions,
      maximumWidth: PREVIEW_WIDTH,
      maximumHeight: PREVIEW_HEIGHT,
    });
    const style = isSingleVisual
      ? { width: fit.width, aspectRatio: `${fit.width} / ${fit.height}` }
      : undefined;

    const content = (
      <div
        key={id}
        className={styles.preview}
        data-file={isFile}
        data-album={props.isAlbum}
        style={style}
        role="group"
        aria-label={filename}
      >
        {isFile ? (
          <DocumentMessage media={{ name: filename, size: blob.size }} />
        ) : (
          <SourcePreview item={item} onMeasure={props.onMeasure} />
        )}
        <IconButton
          label={`Remove ${filename}`}
          onClick={() => props.onRemove(id)}
          disabled={props.isDisabled}
        >
          <X aria-hidden="true" />
        </IconButton>
      </div>
    );
    return {
      id,
      ...dimensions,
      content,
    };
  });

  return (
    <div className={styles.previews} role="group" aria-label="Selected attachments">
      {props.isAlbum ? (
        <AlbumLayoutFrame tiles={tiles} maximumWidth={PREVIEW_WIDTH} />
      ) : (
        tiles.map((tile) => tile.content)
      )}
    </div>
  );
}
