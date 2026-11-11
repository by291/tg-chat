import { useEffect, useRef, useState } from 'react';
import { isCancelled } from '@/features/auth/SessionOwner';
import { pendingMedia, resumeUpload } from './uploadTransfer';
import { uploadClient } from './uploadClient';
import { withMediaSession } from './mediaSessionLock';
import { RemoteAvatar, type RemoteAvatarProps } from './RemoteAvatar';

const MAX_AVATAR_BYTES = 25 * 1024 * 1024;

interface AvatarEditorProps extends RemoteAvatarProps {
  onAssign: (fileId: string | null) => Promise<void>;
}

/** Prepare a replacement avatar before publishing it through its owning profile or community. */
export function AvatarEditor({ onAssign, ...avatar }: AvatarEditorProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const active = useRef<AbortController>(undefined);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const isBusy = Boolean(status);

  useEffect(() => () => active.current?.abort(), []);

  async function change(file: File): Promise<void> {
    if (!file.size || file.size > MAX_AVATAR_BYTES) {
      setError('Choose a photo no larger than 25 MiB.');
      return;
    }
    setError('');
    setStatus('Uploading photo…');
    const controller = new AbortController();
    active.current = controller;
    const item = pendingMedia({ blob: file, filename: file.name, kind: 'avatar' });
    try {
      const sessionId = avatar.session.getSnapshot().auth?.session.id;
      if (!sessionId) {
        throw new Error('Sign in before changing the photo.');
      }
      const ready = await withMediaSession({
        sessionId,
        run: () =>
          resumeUpload({
            item,
            transport: uploadClient(avatar.session),
            signal: controller.signal,
            checkpoint: async () => controller.signal.throwIfAborted(),
            onProgress: ({ phase }) => {
              if (phase === 'processing') {
                setStatus('Preparing photo…');
              }
            },
          }),
      });
      if (!ready) {
        throw new Error('Another upload is active. Try again after it finishes.');
      }
      controller.signal.throwIfAborted();
      if (!ready.file_id) {
        throw new Error('The photo could not be prepared.');
      }
      await onAssign(ready.file_id);
    } catch (failure) {
      if (!isCancelled(failure)) {
        setError(failure instanceof Error ? failure.message : 'Photo upload failed.');
      }
    } finally {
      if (!controller.signal.aborted) {
        setStatus('');
      }
    }
  }

  async function remove(): Promise<void> {
    setError('');
    setStatus('Removing photo…');
    try {
      await onAssign(null);
    } catch (failure) {
      if (!isCancelled(failure)) {
        setError(failure instanceof Error ? failure.message : 'Photo removal failed.');
      }
    } finally {
      setStatus('');
    }
  }

  return (
    <div>
      <RemoteAvatar {...avatar} />
      <button type="button" disabled={isBusy} onClick={() => fileInput.current?.click()}>
        Change photo
      </button>
      {avatar.fileId && (
        <button type="button" disabled={isBusy} onClick={() => void remove()}>
          Remove photo
        </button>
      )}
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        aria-label="Choose avatar photo"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) {
            void change(file);
          }
        }}
      />
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
