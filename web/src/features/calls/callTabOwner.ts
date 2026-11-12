export interface CallTabRequest {
  sessionId: string;
  callId: string;
  signal: AbortSignal;
  activate: () => Promise<void>;
}

/** Hold an exclusive call lease until the owner releases it or the page exits. */
export async function ownCallTab(request: CallTabRequest): Promise<void> {
  const key = `tg-chat:call:${request.sessionId}:${request.callId}`;
  await navigator.locks.request(key, { signal: request.signal }, async () => {
    if (!request.signal.aborted) {
      await request.activate();
    }
  });
}

/** Require secure capture and exclusive tab ownership for browser calls. */
export function isCallSupported(): boolean {
  return Boolean(
    window.isSecureContext &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof navigator.locks?.request === 'function' &&
    window.RTCPeerConnection,
  );
}
