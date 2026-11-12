import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Message } from '@/domain/messages/message';
import type { SessionOwner } from '@/features/auth/SessionOwner';
import { ConnectedMediaContext } from '@/features/media/ConnectedMediaContext';
import { MediaViewer } from '@/features/media/MediaViewer';
import {
  downloadMedia,
  messageMediaUrl,
  type AttachmentView,
  type MediaVariant,
} from '@/features/media/mediaAccess';
import { useAuthorizedMediaUrl } from '@/features/media/useAuthorizedMediaUrl';
import { PendingMessageMedia } from './PendingMessageMedia';
import { VoiceMessage } from './VoiceMessage';
import styles from './ConnectedMessageMedia.module.css';

const MILLISECONDS_PER_SECOND = 1000;
const WAVEFORM_PEAK = 100;
const DEFAULT_WIDTH = 240;
const DEFAULT_HEIGHT = 160;

interface MediaReference {
  session: SessionOwner;
  message: Message;
  attachment: AttachmentView;
}

function previewVariant(attachment: AttachmentView): MediaVariant {
  switch (attachment.file.kind) {
    case 'video':
      return 'poster';
    case 'voice':
      return 'playback';
    default:
      return 'thumbnail';
  }
}

function duration(attachment: AttachmentView): number {
  return Math.max(
    0.001,
    (attachment.file.duration_ms ?? MILLISECONDS_PER_SECOND) / MILLISECONDS_PER_SECOND,
  );
}

function urlFor(input: {
  reference: MediaReference;
  variant: MediaVariant;
  signal?: AbortSignal;
}): Promise<string> {
  const { session, message, attachment } = input.reference;
  return messageMediaUrl({
    session,
    messageId: message.id,
    occurrenceId: attachment.occurrence_id,
    variant: input.variant,
    signal: input.signal,
  });
}

async function galleryItem(reference: MediaReference, signal: AbortSignal): Promise<Message> {
  const { message, attachment } = reference;
  const file = attachment.file;
  const width = file.width ?? DEFAULT_WIDTH;
  const height = file.height ?? DEFAULT_HEIGHT;
  const preview = await urlFor({ reference, variant: previewVariant(attachment), signal });
  const base: Message = {
    ...message,
    id: attachment.occurrence_id,
    remoteAttachments: undefined,
    downloadOriginalUrl: (signal) => urlFor({ reference, variant: 'original', signal }),
  };
  if (file.kind === 'image') {
    return {
      ...base,
      attachment: { name: attachment.file_name, url: preview, width, height },
      renewPreviewUrl: (signal) => urlFor({ reference, variant: 'thumbnail', signal }),
    };
  }

  const renew = (nextSignal: AbortSignal) =>
    urlFor({ reference, variant: 'playback', signal: nextSignal });
  const url = await renew(signal);
  return {
    ...base,
    media: { kind: 'video', url, poster: preview, width, height, duration: duration(attachment) },
    renewPlaybackUrl: renew,
  };
}

function RemoteTile({
  reference,
  onOpen,
  onError,
}: {
  reference: MediaReference;
  onOpen: () => void;
  onError: (message: string) => void;
}) {
  const { attachment, session, message } = reference;
  const variant = previewVariant(attachment);
  const isDocument = attachment.file.kind === 'document';
  const authorize = useCallback(
    (signal: AbortSignal) =>
      messageMediaUrl({
        session,
        messageId: message.id,
        occurrenceId: attachment.occurrence_id,
        variant,
        signal,
      }),
    [session, message.id, attachment.occurrence_id, variant],
  );
  const signed = useAuthorizedMediaUrl({
    key: isDocument ? undefined : `${message.id}:${attachment.occurrence_id}`,
    authorize,
  });
  const hasRetriedPreview = useRef(false);
  const renewPreview = () => {
    if (!hasRetriedPreview.current) {
      hasRetriedPreview.current = true;
      signed.renew();
    }
  };
  const download = () => {
    void urlFor({ reference, variant: 'original' }).then(downloadMedia, (error: unknown) => {
      onError(error instanceof Error ? error.message : 'Download unavailable.');
    });
  };

  if (isDocument) {
    return (
      <button className={styles.document} type="button" onClick={download}>
        Download {attachment.file_name}
      </button>
    );
  }
  if (attachment.file.kind === 'voice') {
    const waveform = (attachment.file.waveform ?? []).map((peak) => peak / WAVEFORM_PEAK);
    return signed.url ? (
      <VoiceMessage
        media={{ kind: 'voice', url: signed.url, duration: duration(attachment), waveform }}
        renewSource={authorize}
      />
    ) : (
      <span role="status">{signed.error || 'Loading voice message…'}</span>
    );
  }

  const width = attachment.file.width ?? DEFAULT_WIDTH;
  const height = attachment.file.height ?? DEFAULT_HEIGHT;
  return (
    <div className={styles.tile}>
      <button
        type="button"
        className={styles.visual}
        style={{ aspectRatio: `${width} / ${height}` }}
        aria-label={`Open ${attachment.file_name}`}
        onClick={onOpen}
      >
        {signed.url ? (
          <img src={signed.url} crossOrigin="anonymous" alt="" onError={renewPreview} />
        ) : (
          <span>{signed.error || attachment.file_name}</span>
        )}
        {attachment.file.kind === 'video' && <span className={styles.play}>▶</span>}
      </button>
      <button className={styles.original} type="button" onClick={download}>
        Download original
      </button>
    </div>
  );
}

/** Render authorized media and pending progress in the existing message row. */
export function ConnectedMessageMedia({ message }: { message: Message }) {
  const actions = useContext(ConnectedMediaContext);
  const [gallery, setGallery] = useState<Message[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const viewerRequest = useRef<AbortController>(undefined);
  useEffect(() => () => viewerRequest.current?.abort(), [message.id, actions?.session]);

  if (!actions) {
    return null;
  }
  const pending = message.pendingMedia;
  if (pending) {
    return (
      <PendingMessageMedia
        messageId={message.id}
        pending={pending}
        isFailed={message.deliveryStatus === 'failed'}
        actions={actions}
      />
    );
  }

  const attachments = message.remoteAttachments ?? [];
  const session = actions.session;
  const open = (occurrenceId: string) => {
    viewerRequest.current?.abort();
    const controller = new AbortController();
    viewerRequest.current = controller;
    const visual = attachments.filter((item) => ['image', 'video'].includes(item.file.kind));
    const loaded = visual.map((attachment) => {
      return galleryItem({ session, message, attachment }, controller.signal);
    });
    void Promise.all(loaded).then(
      (items) => {
        if (!controller.signal.aborted) {
          setGallery(items);
          setActiveId(occurrenceId);
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          actions.notify(error instanceof Error ? error.message : 'Media unavailable.');
        }
      },
    );
  };

  return (
    <>
      <div className={styles.grid} data-album={attachments.length > 1}>
        {attachments.map((attachment) => (
          <RemoteTile
            key={attachment.occurrence_id}
            reference={{ session, message, attachment }}
            onOpen={() => open(attachment.occurrence_id)}
            onError={actions.notify}
          />
        ))}
      </div>
      {gallery.length > 0 && (
        <MediaViewer
          message={gallery.find((item) => item.id === activeId)}
          messages={gallery}
          onClose={() => setActiveId(undefined)}
          onNavigate={(item) => setActiveId(item.id)}
          onCommand={({ action }) => {
            if (action === 'go-to-message') {
              setActiveId(undefined);
              actions.jump(message.id);
            }
          }}
          onNotify={actions.notify}
        />
      )}
    </>
  );
}
