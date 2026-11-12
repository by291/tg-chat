import { AudioLines, Check, File, Image, RotateCcw, Video, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { PendingMediaDisplay, PendingMediaDisplayItem } from '@/domain/messages/message';
import type { ConnectedMediaActions } from '@/features/media/ConnectedMediaContext';
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
  actions: Pick<ConnectedMediaActions, 'cancel' | 'retry' | 'reselect'>;
}

interface PendingTileProps extends Omit<PendingMessageMediaProps, 'pending'> {
  item: PendingMediaDisplayItem;
  isActive: boolean;
  canRestart?: boolean;
  hasAlbum: boolean;
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

function PendingTile({
  messageId,
  actions,
  isActive,
  isFailed,
  canRestart,
  hasAlbum,
  item,
}: PendingTileProps) {
  const isVisual = item.kind === 'image' || item.kind === 'video';
  const retryLabel = canRestart ? 'Send again' : 'Retry upload';
  const cancelTitle = hasAlbum ? 'Cancel all attachments in this message' : 'Cancel upload';
  const canReselect = isFailed && !item.isReady;

  return (
    <div className={styles.pendingTile} role="group" aria-label={item.filename}>
      <div className={styles.pendingSurface} data-visual={isVisual}>
        <LocalPreview item={item} />
        {!isActive && item.isReady && (
          <Check className={styles.readyMark} role="img" aria-label="Attachment ready" />
        )}
        {isActive && (
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
        )}
      </div>
      <span className={styles.pendingName} title={item.filename}>
        {item.filename}
      </span>
      {isActive && isFailed && (
        <button
          type="button"
          className={styles.pendingCancel}
          onClick={() => actions.cancel(messageId)}
        >
          Cancel upload
        </button>
      )}
      {canReselect && (
        <label className={styles.pendingRecovery}>
          Select file for {item.filename}
          <input
            type="file"
            onChange={(event) => {
              const input = event.currentTarget;
              const file = input.files?.[0];
              if (file) {
                actions.reselect({ messageId, occurrenceId: item.occurrenceId, file });
              }
              input.value = '';
            }}
          />
        </label>
      )}
    </div>
  );
}

/** Show the local media and the active transfer inside its original pending bubble. */
export function PendingMessageMedia({ pending, ...props }: PendingMessageMediaProps) {
  const hasAlbum = pending.items.length > 1;

  return (
    <div className={styles.pending}>
      <div className={styles.grid} data-album={hasAlbum}>
        {pending.items.map((item) => (
          <PendingTile
            key={item.occurrenceId}
            item={item}
            isActive={item.occurrenceId === pending.activeOccurrenceId}
            canRestart={pending.canRestart}
            hasAlbum={hasAlbum}
            {...props}
          />
        ))}
      </div>
      <span className={styles.pendingStatus} role="status">
        {pending.status}
      </span>
      {pending.error && <span className={styles.pendingError}>{pending.error}</span>}
    </div>
  );
}
