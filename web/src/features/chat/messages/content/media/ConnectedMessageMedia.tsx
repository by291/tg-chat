import { Play } from 'lucide-react';
import { Fragment, useCallback, useContext, useRef, type ReactNode } from 'react';
import type { Message } from '@/domain/messages/message';
import { ConnectedMediaContext } from '@/features/media/ConnectedMediaContext';
import {
  isVisualKind,
  mediaDuration,
  previewVariant,
  visualDimensions,
  type MediaReference,
} from '@/features/media/connectedMediaReference';
import { useOriginalDownload } from '@/features/media/useOriginalDownload';
import { messageMediaUrl, type MediaVariant } from '@/features/media/mediaAccess';
import { rememberPhotoSource } from '@/features/media/mediaViewerTransition';
import { useAuthorizedMediaUrl } from '@/features/media/useAuthorizedMediaUrl';
import { DocumentMessage } from '../DocumentMessage';
import { PhotoFrame, VideoFrame } from './MessageMediaFrames';
import { AlbumLayoutFrame } from './VisualMediaLayout';
import { PendingMessageMedia } from './PendingMessageMedia';
import { VoiceMessage } from './VoiceMessage';
import styles from './ConnectedMessageMedia.module.css';

const WAVEFORM_PEAK = 100;

function useOccurrenceAuthorization(reference: MediaReference, variant: MediaVariant) {
  const { session, message, attachment } = reference;
  const messageId = message.id;
  const occurrenceId = attachment.occurrence_id;
  return useCallback(
    (signal: AbortSignal) =>
      messageMediaUrl({
        session,
        messageId,
        occurrenceId,
        variant,
        signal,
      }),
    // prettier-ignore
    [
      session,
      messageId,
      occurrenceId,
      variant,
    ],
  );
}

function useSignedRendition(reference: MediaReference, variant?: MediaVariant) {
  const authorize = useOccurrenceAuthorization(reference, variant ?? 'thumbnail');
  const signed = useAuthorizedMediaUrl({
    key: variant && `${reference.message.id}:${reference.attachment.occurrence_id}:${variant}`,
    authorize,
  });
  const hasRetried = useRef(false);
  function renewAfterError() {
    if (!hasRetried.current) {
      hasRetried.current = true;
      signed.renew();
    }
  }
  return {
    ...signed,
    authorize,
    renewAfterError,
  };
}

function RemoteDocument({
  reference,
  metadata,
  onError,
}: {
  reference: MediaReference;
  metadata?: ReactNode;
  onError: (message: string) => void;
}) {
  const authorize = useOccurrenceAuthorization(reference, 'original');
  const download = useOriginalDownload({ authorize, onError });

  const { file_name, file } = reference.attachment;
  return (
    <DocumentMessage
      media={{ name: file_name, size: file.size_bytes }}
      metadata={metadata}
      onDownload={download}
    />
  );
}

function RemoteVoice({ reference, metadata }: { reference: MediaReference; metadata?: ReactNode }) {
  const playback = useSignedRendition(reference, 'playback');
  const { attachment } = reference;
  const waveform = (attachment.file.waveform ?? []).map((peak) => peak / WAVEFORM_PEAK);
  return (
    <>
      <VoiceMessage
        media={{
          kind: 'voice',
          url: playback.url ?? '',
          duration: mediaDuration(attachment),
          waveform,
        }}
        renewSource={playback.authorize}
        metadata={metadata}
      />
      {playback.error && <button onClick={playback.renew}>Retry voice message</button>}
    </>
  );
}

function RemoteVisual({
  reference,
  isAlbum,
  onOpen,
}: {
  reference: MediaReference;
  isAlbum: boolean;
  onOpen: () => void;
}) {
  const { message, attachment } = reference;
  const preview = useSignedRendition(reference, previewVariant(attachment));
  const isVideo = attachment.file.kind === 'video';
  const playback = useSignedRendition(reference, isVideo && !isAlbum ? 'playback' : undefined);
  const dimensions = visualDimensions(attachment.file);
  const hasCaption = Boolean(message.text || message.replyToId);
  const id = attachment.occurrence_id;
  const name = attachment.file_name;

  if (isAlbum) {
    return (
      <button
        type="button"
        aria-label={`Open ${name}`}
        data-photo-id={id}
        onClick={(event) => {
          rememberPhotoSource(id, event.currentTarget);
          onOpen();
        }}
      >
        <img
          src={preview.url}
          crossOrigin="anonymous"
          alt={name}
          onError={preview.renewAfterError}
        />
        {isVideo && <Play className={styles.play} aria-hidden="true" />}
      </button>
    );
  }
  if (isVideo) {
    return (
      <VideoFrame
        media={{
          kind: 'video',
          url: playback.url ?? '',
          poster: preview.url ?? '',
          ...dimensions,
          duration: mediaDuration(attachment),
        }}
        messageId={id}
        label={`Open ${name}`}
        hasCaption={hasCaption}
        onPlaybackError={playback.renewAfterError}
        onOpen={onOpen}
      />
    );
  }
  return (
    <PhotoFrame
      messageId={id}
      photo={{
        name,
        url: preview.url ?? '',
        ...dimensions,
      }}
      hasCaption={hasCaption}
      onImageError={preview.renewAfterError}
      onOpen={onOpen}
    />
  );
}

/** Render authenticated occurrences and their local predecessors through the same media layout. */
export function ConnectedMessageMedia({
  message,
  metadata,
}: {
  message: Message;
  metadata?: ReactNode;
}) {
  const actions = useContext(ConnectedMediaContext);
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
        hasCaption={Boolean(message.text || message.replyToId)}
        metadata={metadata}
        actions={actions}
      />
    );
  }
  const attachments = message.remoteAttachments ?? [];
  const isAlbum =
    attachments.length > 1 && attachments.every((item) => isVisualKind(item.file.kind));
  const tiles = attachments.map((attachment, index) => {
    const reference = {
      session: actions.session,
      message,
      attachment,
    };
    const id = attachment.occurrence_id;
    const inlineMetadata = index === attachments.length - 1 ? metadata : undefined;
    let content: ReactNode;
    switch (attachment.file.kind) {
      case 'voice':
        content = <RemoteVoice reference={reference} metadata={inlineMetadata} />;
        break;
      case 'document':
        content = (
          <RemoteDocument
            reference={reference}
            metadata={inlineMetadata}
            onError={actions.notify}
          />
        );
        break;
      default:
        content = (
          <RemoteVisual
            reference={reference}
            isAlbum={isAlbum}
            onOpen={() => actions.openGallery({ message, occurrenceId: id })}
          />
        );
    }
    return {
      id,
      ...visualDimensions(attachment.file),
      content,
    };
  });
  if (isAlbum) {
    return <AlbumLayoutFrame tiles={tiles} />;
  }
  return tiles.map((tile) => <Fragment key={tile.id}>{tile.content}</Fragment>);
}
