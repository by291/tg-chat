// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { SessionOwner } from '@/features/auth/SessionOwner';
import type { PendingMessage } from '@/features/chat/data/pendingMessages';
import { renderPending } from '@/features/chat/data/messageModels';
import { ConnectedMediaContext } from '@/features/media/ConnectedMediaContext';
import { ConnectedMessageMedia } from './ConnectedMessageMedia';

const user = { id: 'sender', display_name: 'Sender' };

function renderMedia(pending: PendingMessage) {
  const actions = {
    session: {} as SessionOwner,
    cancel: vi.fn(),
    retry: vi.fn(),
    reselect: vi.fn(),
    notify: vi.fn(),
    jump: vi.fn(),
  };
  const message = renderPending({ pending, user, conversationId: 'saved' });
  const view = render(
    <ConnectedMediaContext.Provider value={actions}>
      <ConnectedMessageMedia message={message} />
    </ConnectedMediaContext.Provider>,
  );
  return { actions, view };
}

function pendingMessage(): PendingMessage {
  return {
    request: {
      operation_id: 'operation',
      message_id: 'message',
      destination: { kind: 'saved' },
      content: { schema_version: 1, text: '', custom_emoji: [] },
    },
    createdAt: 0,
    status: 'queued',
    media: [
      {
        occurrenceId: 'ready-image',
        uploadId: 'upload-first',
        filename: 'first.jpg',
        kind: 'image',
        sizeBytes: 4,
        fileId: 'ready-file',
      },
      {
        occurrenceId: 'active-image',
        uploadId: 'upload-second',
        filename: 'second.jpg',
        kind: 'image',
        sizeBytes: 12,
        blob: new Blob(['abcdefghijkl'], { type: 'image/jpeg' }),
      },
    ],
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('shows the active attachment’s own progress and cancels its pending message', () => {
  const pending = pendingMessage();
  const { actions } = renderMedia({
    ...pending,
    mediaProgress: {
      phase: 'uploading',
      bytes: 7,
      occurrenceId: 'active-image',
      occurrenceBytes: 3,
    },
  });

  const ready = within(screen.getByRole('group', { name: 'first.jpg' }));
  const active = within(screen.getByRole('group', { name: 'second.jpg' }));
  expect(ready.queryByRole('progressbar')).toBeNull();
  expect(active.getByRole('progressbar')).toHaveProperty('ariaValueNow', '25');
  expect(screen.getByRole('status').textContent).toBe('Uploading 44%');

  fireEvent.click(active.getByRole('button', { name: 'Cancel upload' }));
  expect(actions.cancel).toHaveBeenCalledExactlyOnceWith('message');
});

it('releases the local thumbnail when its pending bubble unmounts', () => {
  const createObjectURL = vi.fn(() => 'blob:pending-preview');
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL }));

  const pending = pendingMessage();
  const { view } = renderMedia(pending);
  const active = screen.getByRole('group', { name: 'second.jpg' });
  expect(active.querySelector('img')?.getAttribute('src')).toBe('blob:pending-preview');
  expect(createObjectURL).toHaveBeenCalledExactlyOnceWith(pending.media?.[1].blob);

  view.unmount();
  expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:pending-preview');
});

it('keeps retry and source selection available for the unfinished attachment after failure', () => {
  const pending = pendingMessage();
  const { actions } = renderMedia({
    ...pending,
    status: 'failed',
    error: 'Select the original file to continue this upload.',
  });
  const ready = within(screen.getByRole('group', { name: 'first.jpg' }));
  const failed = within(screen.getByRole('group', { name: 'second.jpg' }));
  expect(ready.queryByLabelText(/select file/i)).toBeNull();

  fireEvent.click(failed.getByRole('button', { name: 'Retry upload' }));
  expect(actions.retry).toHaveBeenCalledExactlyOnceWith('message');

  const file = new File(['original'], 'second.jpg');
  fireEvent.change(failed.getByLabelText('Select file for second.jpg'), {
    target: { files: [file] },
  });
  expect(actions.reselect).toHaveBeenCalledExactlyOnceWith({
    messageId: 'message',
    occurrenceId: 'active-image',
    file,
  });
});
