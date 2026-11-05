// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageComposer } from './MessageComposer';
import type { Attachment, Message } from './model';

const imageDecoders = vi.hoisted(() => new Map<string, (attachment: Attachment) => void>());

vi.mock('./attachments', () => ({
  createAttachment: (file: File) =>
    new Promise<Attachment>((resolve) => {
      imageDecoders.set(file.name, resolve);
    }),
}));

beforeEach(() => imageDecoders.clear());
afterEach(cleanup);

function renderComposer(editingMessage?: Message) {
  return render(
    <MessageComposer
      draft="A caption"
      editingMessage={editingMessage}
      onDraftChange={() => {}}
      onSubmit={() => {}}
      onCancelContext={() => {}}
      onNotify={() => {}}
    />,
  );
}

function pasteImage(name: string) {
  const file = new File(['image'], name, { type: 'image/png' });
  fireEvent.paste(screen.getByRole('textbox', { name: 'Message' }), {
    clipboardData: { files: [file] },
  });
}

async function finishDecoding(name: string) {
  await act(async () => {
    imageDecoders.get(name)?.({
      name,
      url: `/${name}`,
      width: 320,
      height: 240,
    });
  });
}

describe('image composition', () => {
  it('keeps send disabled when an obsolete image finishes before the newest image', async () => {
    renderComposer();
    pasteImage('older.png');
    pasteImage('newer.png');
    await finishDecoding('older.png');

    const sendButton = screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);
    expect(screen.queryByRole('img', { name: 'older.png' })).toBeNull();

    await finishDecoding('newer.png');
    expect(screen.getByRole('img', { name: 'newer.png' })).toBeTruthy();
    expect(sendButton.disabled).toBe(false);
  });

  it('does not replace a newer attachment when an older decode completes later', async () => {
    renderComposer();
    pasteImage('older.png');
    pasteImage('newer.png');
    await finishDecoding('newer.png');
    await finishDecoding('older.png');

    expect(screen.getByRole('img', { name: 'newer.png' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'older.png' })).toBeNull();
  });

  it('allows saving an empty caption when the edited message still contains an image', () => {
    renderComposer({
      id: 'image-message',
      chatId: 'dev',
      authorId: 'you',
      authorName: 'You',
      text: 'Old caption',
      createdAt: 1000,
      reactions: [],
      attachment: {
        name: 'photo.png',
        url: '/photo.png',
        width: 100,
        height: 100,
      },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
      target: { value: '' },
    });

    const saveButton = screen.getByRole('button', { name: 'Save message' }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(false);
  });
});
