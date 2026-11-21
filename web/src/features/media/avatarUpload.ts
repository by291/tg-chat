import { ApiError, type SessionOwner } from '@/features/auth/SessionOwner';
import { withMediaSession } from './mediaSessionLock';
import { uploadClient } from './uploadClient';
import { pendingMedia, resumeUpload } from './uploadTransfer';

const MAX_AVATAR_BYTES = 25 * 1024 * 1024;

/** Keep a selected avatar's transfer identity through reservation, processing and retries. */
export function prepareAvatar(file: File) {
  if (!file.size || file.size > MAX_AVATAR_BYTES) {
    throw new ApiError({
      code: 'invalid_avatar',
      message: 'Choose a photo no larger than 25 MiB.',
    });
  }
  // prettier-ignore
  let item = pendingMedia({
    blob: file,
    filename: file.name,
    kind: 'avatar',
  });

  return async function upload(options: {
    session: SessionOwner;
    signal: AbortSignal;
    onProcessing?: () => void;
  }) {
    const { session, signal } = options;
    const sessionId = session.getSnapshot().auth?.session.id;
    if (!sessionId) {
      throw new DOMException('Account request cancelled.', 'AbortError');
    }
    const status = await withMediaSession({
      sessionId,
      run: () =>
        resumeUpload({
          item,
          transport: uploadClient(session),
          signal,
          checkpoint: async (checkpoint) => {
            signal.throwIfAborted();
            item = checkpoint;
          },
          onProgress: ({ phase }) => {
            if (phase === 'processing') {
              options.onProcessing?.();
            }
          },
        }),
    });
    signal.throwIfAborted();
    if (!status?.file_id) {
      throw new ApiError({
        code: 'upload_busy',
        message: 'Another upload is active. Try again after it finishes.',
      });
    }
    return status.file_id;
  };
}
