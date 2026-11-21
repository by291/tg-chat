import type { Message } from '@/domain/messages/message';
import type { SessionOwner } from '@/features/auth/SessionOwner';
import { messageMediaUrl, type AttachmentView, type MediaVariant } from './mediaAccess';

const MILLISECONDS_PER_SECOND = 1000;
const DEFAULT_WIDTH = 240;
const DEFAULT_HEIGHT = 160;

export interface MediaReference {
  session: SessionOwner;
  message: Message;
  attachment: AttachmentView;
}

/** Reserve a consistent fallback for legacy sources until authoritative dimensions exist. */
export function visualDimensions(item: { width?: number | null; height?: number | null }) {
  const { width, height } = item;
  if (width && height && width > 0 && height > 0) {
    return { width, height };
  }
  return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
}

/** Identify media that shares the bounded photo and album presentation. */
export function isVisualKind(kind: AttachmentView['file']['kind']): boolean {
  return kind === 'image' || kind === 'video';
}

/** Select the signed rendition suitable for a history thumbnail. */
export function previewVariant(attachment: AttachmentView): MediaVariant {
  switch (attachment.file.kind) {
    case 'video':
      return 'poster';
    case 'voice':
      return 'playback';
    default:
      return 'thumbnail';
  }
}

/** Convert the server duration into player seconds. */
export function mediaDuration(attachment: AttachmentView): number {
  return Math.max(
    1 / MILLISECONDS_PER_SECOND,
    (attachment.file.duration_ms ?? MILLISECONDS_PER_SECOND) / MILLISECONDS_PER_SECOND,
  );
}

/** Authorize a single occurrence in the current session. */
export function urlFor(input: {
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

/** Project a signed occurrence into the shared viewer, reserving its geometry while loading. */
export function galleryMessage(
  reference: MediaReference,
  sources: { preview?: string; playback?: string } = {},
): Message {
  const { message, attachment } = reference;
  const file = attachment.file;
  const { width, height } = visualDimensions(file);
  const preview = sources.preview ?? '';
  const base: Message = {
    ...message,
    id: attachment.occurrence_id,
    remoteAttachments: undefined,
    downloadOriginalUrl: (signal) =>
      urlFor({
        reference,
        variant: 'original',
        signal,
      }),
  };
  if (file.kind === 'image') {
    return {
      ...base,
      attachment: {
        name: attachment.file_name,
        url: preview,
        width,
        height,
      },
      renewPreviewUrl: (signal) =>
        urlFor({
          reference,
          variant: 'thumbnail',
          signal,
        }),
    };
  }

  const renew = (nextSignal: AbortSignal) =>
    urlFor({
      reference,
      variant: 'playback',
      signal: nextSignal,
    });
  const url = sources.playback ?? '';
  return {
    ...base,
    media: {
      kind: 'video',
      url,
      poster: preview,
      width,
      height,
      duration: mediaDuration(attachment),
    },
    renewPlaybackUrl: renew,
  };
}
