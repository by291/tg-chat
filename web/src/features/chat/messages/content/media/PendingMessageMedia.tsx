import { AudioLines, Check, File, FolderOpen, Image, RotateCcw, Video, X } from 'lucide-react';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import type { PendingMediaDisplay, PendingMediaDisplayItem } from '@/domain/messages/message';
import type { ConnectedMediaActions } from '@/features/media/ConnectedMediaContext';
import { isVisualKind, visualDimensions } from '@/features/media/connectedMediaReference';
import { DocumentMessage } from '../DocumentMessage';
import { AlbumLayoutFrame, photoFramePresentation } from './VisualMediaLayout';
import { VoiceMessage } from './VoiceMessage';
import frameStyles from '../MessageBody.module.css';
import styles from './ConnectedMessageMedia.module.css';

const RING_SIZE = 40;
const RING_CENTER = RING_SIZE / 2;
const RING_RADIUS = 18;
const RING_LENGTH = 100;
const PROCESSING_ARC = 28;

interface PendingMessageMediaProps {
  messageId: string;
  pending: PendingMediaDisplay;
  isFailed: boolean;
  hasCaption: boolean;
  metadata?: ReactNode;
  actions: Pick<ConnectedMediaActions, 'cancel' | 'retry' | 'reselect'>;
}

interface PendingTileProps extends Omit<PendingMessageMediaProps, 'pending'> {
  item: PendingMediaDisplayItem;
  isActive: boolean;
  canRestart?: boolean;
  isAlbum: boolean;
}

function useLocalPreview(source?: Blob): string | undefined {
  const [preview, setPreview] = useState<{ source: Blob; url: string }>();
  useEffect(() => {
    if (!source || typeof URL.createObjectURL !== 'function') {
      return;
    }

    const url = URL.createObjectURL(source);
    setPreview({ source, url });

    // The durable queue owns the source. Only this mounted row owns its URL.
    return () => URL.revokeObjectURL(url);
  }, [source]);

  return preview?.source === source ? preview?.url : undefined;
}

function fallbackIcon(kind: PendingMediaDisplayItem['kind']) {
  switch (kind) {
    case 'image':
      return Image;
    case 'video':
      return Video;
    case 'voice':
      return AudioLines;
    default:
      return File;
  }
}

function LocalPreview({ item }: { item: PendingMediaDisplayItem }) {
  const url = useLocalPreview(item.previewSource);
  if (url && item.kind === 'image') {
    return <img src={url} alt="" decoding="async" />;
  }
  if (url && item.kind === 'video') {
    return <video src={url} preload="metadata" muted playsInline aria-hidden="true" />;
  }

  const Icon = fallbackIcon(item.kind);
  return <Icon className={styles.pendingPlaceholder} aria-hidden="true" />;
}

function ProgressRing({ item }: { item: PendingMediaDisplayItem }) {
  const progress = item.progress;
  if (!progress) {
    return null;
  }

  const isProcessing = progress.phase === 'processing';
  const label = isProcessing ? 'Processing' : 'Uploading';
  const length = isProcessing ? PROCESSING_ARC : progress.percentage;
  return (
    <span
      className={styles.progressRing}
      data-processing={isProcessing}
      role="progressbar"
      aria-label={`${label} ${item.filename}`}
      aria-valuenow={isProcessing ? undefined : progress.percentage}
    >
      <svg viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} aria-hidden="true">
        <circle
          cx={RING_CENTER}
          cy={RING_CENTER}
          r={RING_RADIUS}
          pathLength={RING_LENGTH}
          className={styles.progressTrack}
        />
        <circle
          cx={RING_CENTER}
          cy={RING_CENTER}
          r={RING_RADIUS}
          pathLength={RING_LENGTH}
          strokeDasharray={`${length} ${RING_LENGTH}`}
          className={styles.progressValue}
        />
      </svg>
    </span>
  );
}

function TransferControls({
  item,
  actions,
  messageId,
  isFailed,
  canRestart,
  isAlbum,
}: PendingTileProps) {
  const retryLabel = canRestart ? 'Send again' : 'Retry upload';
  const cancelTitle = isAlbum ? 'Cancel all attachments in this message' : 'Cancel upload';
  return (
    <>
      <div className={styles.pendingControl}>
        {!isFailed && <ProgressRing item={item} />}
        <button
          type="button"
          className={styles.pendingButton}
          aria-label={isFailed ? retryLabel : 'Cancel upload'}
          title={isFailed ? retryLabel : cancelTitle}
          onClick={() => {
            if (isFailed) {
              actions.retry(messageId);
              return;
            }
            actions.cancel(messageId);
          }}
        >
          {isFailed ? <RotateCcw aria-hidden="true" /> : <X aria-hidden="true" />}
        </button>
      </div>
      {isFailed && (
        <button
          type="button"
          className={styles.pendingCancel}
          aria-label="Cancel upload"
          onClick={() => actions.cancel(messageId)}
        >
          <X aria-hidden="true" />
        </button>
      )}
    </>
  );
}

function PendingTile(props: PendingTileProps) {
  const { item, isAlbum, hasCaption, isActive, metadata } = props;
  const isVisual = isVisualKind(item.kind);
  const dimensions = visualDimensions(item);
  const frame =
    isVisual && !isAlbum ? photoFramePresentation({ ...dimensions, hasCaption }) : undefined;
  let preview: ReactNode;
  if (isVisual) {
    preview = <LocalPreview item={item} />;
  } else if (item.kind === 'voice') {
    preview = (
      <VoiceMessage
        media={{
          kind: 'voice',
          url: '',
          duration: 0,
          waveform: [],
        }}
        metadata={metadata}
      />
    );
  } else {
    preview = (
      <DocumentMessage media={{ name: item.filename, size: item.sizeBytes }} metadata={metadata} />
    );
  }
  return (
    <div
      className={`${styles.pendingTile} ${frame ? frameStyles.photoFrame : ''}`}
      style={frame?.style}
      data-visual={isVisual}
      data-album={isAlbum}
      role="group"
      aria-label={item.filename}
    >
      {preview}
      {!isActive && item.isReady && (
        <Check className={styles.readyMark} role="img" aria-label="Attachment ready" />
      )}
      {isActive && <TransferControls {...props} />}
      {props.isFailed && !item.isReady && (
        <label className={styles.pendingRecovery} title={`Select file for ${item.filename}`}>
          <FolderOpen aria-hidden="true" />
          <input
            type="file"
            aria-label={`Select file for ${item.filename}`}
            onChange={(event) => {
              const input = event.currentTarget;
              const file = input.files?.[0];
              if (file) {
                props.actions.reselect({
                  messageId: props.messageId,
                  occurrenceId: item.occurrenceId,
                  file,
                });
              }
              input.value = '';
            }}
          />
        </label>
      )}
    </div>
  );
}

/** Keep pending controls inside the final geometry and recovery actions available without bytes. */
export function PendingMessageMedia({ pending, ...props }: PendingMessageMediaProps) {
  const isVisual = pending.items.every((item) => isVisualKind(item.kind));
  const isAlbum = isVisual && pending.items.length > 1;
  const tiles = pending.items.map((item, index) => ({
    id: item.occurrenceId,
    ...visualDimensions(item),
    content: (
      <PendingTile
        {...props}
        item={item}
        isActive={item.occurrenceId === pending.activeOccurrenceId}
        canRestart={pending.canRestart}
        isAlbum={isAlbum}
        metadata={index === pending.items.length - 1 ? props.metadata : undefined}
      />
    ),
  }));
  return (
    <div className={styles.pending} data-visual={isVisual}>
      {isAlbum ? (
        <AlbumLayoutFrame tiles={tiles} />
      ) : (
        tiles.map((tile) => <Fragment key={tile.id}>{tile.content}</Fragment>)
      )}
      <span className={styles.pendingStatus} role="status" title={pending.error}>
        {pending.status}
        {pending.error && <span className={styles.pendingError}> · {pending.error}</span>}
      </span>
    </div>
  );
}
