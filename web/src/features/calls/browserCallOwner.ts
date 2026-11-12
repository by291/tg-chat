import { requirePayload, type SessionOwner } from '@/features/auth/SessionOwner';
import { CallOwner } from './CallOwner';
import { LiveKitMedia } from './LiveKitMedia';
import { ownCallTab } from './callTabOwner';

const REQUEST_TIMEOUT_MS = 8_000;

function requestSignal(signal: AbortSignal): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
}

/** Bind the call owner to authenticated API requests and the browser media adapter. */
export function createBrowserCallOwner(session: SessionOwner): CallOwner {
  return new CallOwner({
    getSession: () => {
      const { auth, revision } = session.getSnapshot();
      return auth ? { id: auth.session.id, revision } : undefined;
    },
    subscribeSession: session.subscribe,
    createMedia: (events) => new LiveKitMedia(events),
    ownTab: ownCallTab,
    transport: {
      current: async (signal) => {
        const reply = await session.client.GET('/api/v1/calls/current', {
          signal: requestSignal(signal),
        });
        return requirePayload(reply).call ?? null;
      },
      start: async (input, signal) => {
        const reply = await session.client.POST('/api/v1/calls', {
          body: {
            conversation_id: input.conversationId,
            mode: input.mode,
            operation_id: input.operationId,
          },
          signal: requestSignal(signal),
        });
        return requirePayload(reply);
      },
      command: async (input, signal) => {
        const reply = await session.client.POST('/api/v1/calls/{call_id}/commands', {
          params: { path: { call_id: input.callId } },
          body: { action: input.action, operation_id: input.operationId },
          signal: requestSignal(signal),
        });
        return requirePayload(reply);
      },
      outcome: async (callId, signal) => {
        const reply = await session.client.GET('/api/v1/calls/{call_id}/outcome', {
          params: { path: { call_id: callId } },
          signal: requestSignal(signal),
        });
        return requirePayload(reply).end_reason ?? null;
      },
      credentials: async (callId, signal) => {
        const reply = await session.client.POST('/api/v1/calls/{call_id}/credentials', {
          params: { path: { call_id: callId } },
          signal: requestSignal(signal),
        });
        return requirePayload(reply);
      },
    },
  });
}
