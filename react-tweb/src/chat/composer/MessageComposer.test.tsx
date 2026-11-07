// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageComposer } from './MessageComposer';
import type { Attachment, Message } from '../model';

const imageDecoders = vi.hoisted(() => new Map<string, (attachment: Attachment) => void>());

vi.mock('./attachments', () => ({
  createAttachment: (file: File) =>
    new Promise<Attachment>((resolve) => {
      imageDecoders.set(file.name, resolve);
    }),
}));

const resizeCallbacks = new Map<Element, () => void>();
let measuredEditorHeight = 33;

class TestResizeObserver {
  private callback: () => void;

  constructor(callback: (entries: ResizeObserverEntry[]) => void) {
    this.callback = () => callback([]);
  }

  observe(element: Element) {
    resizeCallbacks.set(element, this.callback);
  }

  disconnect() {
    for (const [element, callback] of resizeCallbacks) {
      if (callback === this.callback) {
        resizeCallbacks.delete(element);
      }
    }
  }
}

beforeEach(() => {
  imageDecoders.clear();
  resizeCallbacks.clear();
  measuredEditorHeight = 33;
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return new DOMRect(0, 0, 400, measuredEditorHeight);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderComposer(editingMessage?: Message) {
  return render(
    <MessageComposer
      draft="A caption"
      editingMessage={editingMessage}
      onDraftChange={() => {}}
      onSubmit={() => {}}
      onCancelContext={() => {}}
      onJumpToMessage={() => {}}
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
    const editor = screen.getByRole('textbox', { name: 'Message' });
    editor.textContent = '';
    fireEvent.input(editor, { inputType: 'deleteContentBackward' });

    const saveButton = screen.getByRole('button', { name: 'Save message' }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(false);
  });
});

describe('multiline composition', () => {
  it('keeps the draft and editor mounted when expanding and collapsing with Escape', () => {
    renderComposer();
    const editor = screen.getByRole('textbox', { name: 'Message' });
    expect(screen.queryByRole('button', { name: 'Expand message editor' })).toBeNull();

    act(() => {
      measuredEditorHeight = 96;
      resizeCallbacks.get(editor)?.();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Expand message editor' }));
    expect(screen.getByRole('button', { name: 'Collapse message editor' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Message' })).toBe(editor);
    expect(editor.textContent).toBe('A caption');

    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Expand message editor' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Message' })).toBe(editor);
    expect(editor.textContent).toBe('A caption');

    act(() => {
      measuredEditorHeight = 33;
      resizeCallbacks.get(editor)?.();
    });
    expect(screen.queryByRole('button', { name: 'Expand message editor' })).toBeNull();
  });
});
