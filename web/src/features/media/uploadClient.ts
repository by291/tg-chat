import { ApiError, requirePayload, type SessionOwner } from '@/features/auth/SessionOwner';
import type { UploadTransport, UploadWrite } from './uploadTransfer';

const WRITE_TIMEOUT_MS = 60_000;

function transferFailure(status: number): ApiError {
  return new ApiError({
    code: 'network_unavailable',
    message: status ? `Upload interrupted (HTTP ${status}).` : 'Upload interrupted.',
  });
}

function putSigned(input: UploadWrite): Promise<void> {
  input.signal.throwIfAborted();

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    const finish = (error?: unknown) => {
      input.signal.removeEventListener('abort', abort);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    request.open('PUT', input.request.url);
    request.timeout = WRITE_TIMEOUT_MS;
    for (const [name, value] of Object.entries(input.request.headers)) {
      request.setRequestHeader(name, value);
    }
    request.upload.addEventListener('progress', (event) => input.onProgress(event.loaded));
    request.addEventListener('load', () => {
      const isSuccessful = request.status >= 200 && request.status < 300;
      finish(isSuccessful ? undefined : transferFailure(request.status));
    });
    request.addEventListener('error', () => finish(transferFailure(request.status)));
    request.addEventListener('timeout', () => finish(transferFailure(request.status)));
    request.addEventListener('abort', () => finish(input.signal.reason));
    input.signal.addEventListener('abort', abort, { once: true });
    request.send(input.blob);
  });
}

/** Use the session client for control requests and credential-free XHR for signed writes. */
export function uploadClient(session: SessionOwner): UploadTransport {
  const client = session.client;
  return {
    async status(uploadId, signal) {
      try {
        const reply = await client.GET('/api/v1/media/uploads/{upload_id}', {
          params: { path: { upload_id: uploadId } },
          signal,
        });
        return requirePayload(reply);
      } catch (error) {
        if (error instanceof ApiError && error.code === 'not_found') {
          return undefined;
        }
        throw error;
      }
    },
    async reserve(body, signal) {
      const reply = await client.POST('/api/v1/media/uploads', { body, signal });
      return requirePayload(reply);
    },
    async plan({ uploadId, partNumbers, signal }) {
      const reply = await client.POST('/api/v1/media/uploads/{upload_id}/transfer', {
        params: { path: { upload_id: uploadId } },
        body: { part_numbers: partNumbers },
        signal,
      });
      return requirePayload(reply);
    },
    put: putSigned,
    async complete(uploadId, signal) {
      const reply = await client.POST('/api/v1/media/uploads/{upload_id}/complete', {
        params: { path: { upload_id: uploadId } },
        signal,
      });
      return requirePayload(reply);
    },
  };
}
