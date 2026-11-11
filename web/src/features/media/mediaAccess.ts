import type { components } from '@/api/schema';
import { requirePayload, type SessionOwner } from '@/features/auth/SessionOwner';

export type MediaVariant = components['schemas']['MediaVariant'];
export type AttachmentView = components['schemas']['AttachmentView'];

interface MessageUrlRequest {
  session: SessionOwner;
  messageId: string;
  occurrenceId: string;
  variant: MediaVariant;
  signal?: AbortSignal;
}

/** Resolve a download through the current session and specific message occurrence. */
export async function messageMediaUrl(request: MessageUrlRequest): Promise<string> {
  const reply = await request.session.client.GET(
    '/api/v1/media/messages/{message_id}/attachments/{occurrence_id}/{variant}',
    {
      params: {
        path: {
          message_id: request.messageId,
          occurrence_id: request.occurrenceId,
          variant: request.variant,
        },
      },
      signal: request.signal,
    },
  );
  return requirePayload(reply).url;
}

/** Resolve the currently visible thumbnail for a profile or community. */
export async function avatarUrl(input: {
  session: SessionOwner;
  owner: components['schemas']['AvatarOwner'];
  id: string;
  signal: AbortSignal;
}): Promise<string> {
  const reply = await input.session.client.GET(
    '/api/v1/media/avatars/{owner_kind}/{owner_id}/{variant}',
    {
      params: { path: { owner_kind: input.owner, owner_id: input.id, variant: 'thumbnail' } },
      signal: input.signal,
    },
  );
  return requirePayload(reply).url;
}

/** Navigate to an authorized attachment response without exposing its URL in the chat cache. */
export function downloadMedia(url: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noreferrer';
  link.click();
}
