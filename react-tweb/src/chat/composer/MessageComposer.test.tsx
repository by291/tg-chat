// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageComposer } from './MessageComposer';
import { DEFAULT_APP_PREFERENCES, setAppPreferences } from '../../app/settings/appPreferences';
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

  unobserve(element: Element) {
    resizeCallbacks.delete(element);
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
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return new DOMRect(0, 0, 400, measuredEditorHeight);
  });
});

afterEach(() => {
  cleanup();
  setAppPreferences(DEFAULT_APP_PREFERENCES);
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
  it('opens attachment choices without requesting a file or losing the draft', async () => {
    const user = userEvent.setup();
    renderComposer();
    const chooseFile = vi.spyOn(HTMLInputElement.prototype, 'click');
    await user.click(screen.getByRole('button', { name: 'Attach' }));
    expect(await screen.findByRole('menuitem', { name: 'Photo or Video' })).toBeTruthy();
    expect(chooseFile).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Dismiss attachment menu' }));

    expect(screen.getByRole('textbox', { name: 'Message' }).textContent).toBe('A caption');
    expect(chooseFile).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Attach' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Photo or Video' }));
    expect(chooseFile).toHaveBeenCalledOnce();
  });

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

it('applies send shortcut changes to an already mounted composer', async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Macintosh');
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const onSubmit = vi.fn();
  render(
    <MessageComposer
      draft="Shortcut check"
      onDraftChange={() => {}}
      onSubmit={onSubmit}
      onCancelContext={() => {}}
      onJumpToMessage={() => {}}
      onNotify={() => {}}
    />,
  );
  const editor = screen.getByRole('textbox', { name: 'Message' });
  act(() => setAppPreferences({ sendShortcut: 'ctrlEnter' }));
  await act(async () => {
    fireEvent.focus(editor);
    fireEvent.keyDown(editor, { key: 'Enter', code: 'Enter', keyCode: 13 });
  });
  expect(onSubmit).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.keyDown(editor, { key: 'Enter', code: 'Enter', keyCode: 13, metaKey: true });
  });
  expect(onSubmit).toHaveBeenCalledOnce();
});
