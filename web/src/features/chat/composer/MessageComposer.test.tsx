// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageComposer } from './MessageComposer';
import { DEFAULT_APP_PREFERENCES, setAppPreferences } from '@/features/settings/appPreferences';
import type { Attachment } from '@/domain/messages/media';
import type { Message } from '@/domain/messages/message';

const imageDecoders = vi.hoisted(() => new Map<string, (attachment: Attachment) => void>());
const imageDecodeFailures = vi.hoisted(() => new Map<string, (error: Error) => void>());

function matchMobileViewport() {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

vi.mock('./attachments/attachments', async (importOriginal) => {
  const attachments = await importOriginal<typeof import('./attachments/attachments')>();
  return {
    ...attachments,
    createAttachment: (file: File) =>
      new Promise<Attachment>((resolve, reject) => {
        imageDecoders.set(file.name, resolve);
        imageDecodeFailures.set(file.name, reject);
      }),
  };
});

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
  imageDecodeFailures.clear();
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

function renderComposer(options: Partial<ComponentProps<typeof MessageComposer>> = {}) {
  const props: ComponentProps<typeof MessageComposer> = {
    draft: 'A caption',
    onDraftChange: () => {},
    onSubmit: () => {},
    onCancelContext: () => {},
    onJumpToMessage: () => {},
    onNotify: () => {},
    ...options,
  };
  const view = render(<MessageComposer {...props} />);

  return {
    ...view,
    rerenderComposer(nextOptions: Partial<ComponentProps<typeof MessageComposer>>) {
      view.rerender(<MessageComposer {...props} {...nextOptions} />);
    },
  };
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

it('carries the sender link preview opt-out with the message', async () => {
  matchMobileViewport();
  const user = userEvent.setup();
  const onSubmit = vi.fn();
  renderComposer({ draft: 'Read https://example.test/notes', isTextOnly: true, onSubmit });
  await user.click(screen.getByRole('checkbox', { name: 'Disable link preview' }));
  await user.click(screen.getByRole('button', { name: 'Send message' }));

  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ disableLinkPreview: true }));
});

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

  it('sends a file chosen in document mode with its original name and media type', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderComposer({ onSubmit });
    await user.click(screen.getByRole('button', { name: 'Attach' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Document' }));

    const file = new File(['A report'], 'report.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByLabelText('Choose an attachment'), {
      target: { files: [file] },
    });
    await screen.findByText('report.txt');
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        attachment: undefined,
        media: expect.objectContaining({
          kind: 'document',
          name: 'report.txt',
          mimeType: 'text/plain',
          size: file.size,
        }),
      }),
    );
  });

  it('treats a dropped image as media after the file chooser was opened in document mode', async () => {
    const user = userEvent.setup();
    renderComposer();
    await user.click(screen.getByRole('button', { name: 'Attach' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Document' }));

    const file = new File(['image'], 'dropped.png', { type: 'image/png' });
    fireEvent.drop(screen.getByRole('textbox', { name: 'Message' }), {
      dataTransfer: { files: [file] },
    });
    await finishDecoding('dropped.png');

    expect(screen.getByRole('img', { name: 'dropped.png' })).toBeTruthy();
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

  it('keeps a removed attachment cleared when its pending replacement finishes', async () => {
    renderComposer();
    pasteImage('first.png');
    await finishDecoding('first.png');
    pasteImage('replacement.png');

    fireEvent.click(screen.getByRole('button', { name: 'Remove attachment' }));
    await finishDecoding('replacement.png');

    expect(screen.queryByRole('button', { name: 'Remove attachment' })).toBeNull();
    expect(screen.queryByRole('img', { name: 'replacement.png' })).toBeNull();
    const sendButton = screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement;
    expect(sendButton.disabled).toBe(false);
  });

  it('restores the attachment draft after decoding finishes during message editing', async () => {
    const view = renderComposer();
    pasteImage('draft.png');
    const editingMessage: Message = {
      id: 'edited-message',
      chatId: 'dev',
      authorId: 'you',
      authorName: 'You',
      text: 'Existing message',
      createdAt: 1000,
      reactions: [],
    };
    view.rerenderComposer({ editingMessage });
    await finishDecoding('draft.png');

    expect(screen.queryByRole('img', { name: 'draft.png' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Message' }).textContent).toBe('Existing message');

    view.rerenderComposer({ editingMessage: undefined });

    expect(screen.getByRole('img', { name: 'draft.png' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Message' }).textContent).toBe('A caption');
  });

  it('submits the attachment once and clears its preview for the next message', async () => {
    matchMobileViewport();
    const onSubmit = vi.fn();
    renderComposer({ onSubmit });
    pasteImage('sent.png');
    await finishDecoding('sent.png');

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'A caption',
        attachment: {
          name: 'sent.png',
          url: '/sent.png',
          width: 320,
          height: 240,
        },
      }),
    );
    expect(screen.queryByRole('button', { name: 'Remove attachment' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ attachment: undefined, media: undefined }),
    );
  });

  it('does not report a decode failure after the composer unmounts', async () => {
    const onNotify = vi.fn();
    const view = renderComposer({ onNotify });
    pasteImage('unmounted.png');
    view.unmount();

    await act(async () => {
      imageDecodeFailures.get('unmounted.png')?.(new Error('The image could not be decoded.'));
    });

    expect(onNotify).not.toHaveBeenCalled();
  });

  it('allows saving an empty caption when the edited message still contains an image', () => {
    renderComposer({
      editingMessage: {
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
  matchMobileViewport();
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
    fireEvent.keyDown(editor, {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
    });
  });
  expect(onSubmit).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.keyDown(editor, {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      metaKey: true,
    });
  });
  expect(onSubmit).toHaveBeenCalledOnce();
});

it('keeps the text editor available while unsupported attachment controls are hidden', () => {
  renderComposer({ isTextOnly: true });
  expect(screen.queryByLabelText('Choose an attachment')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Attach' })).toBeNull();
  expect(screen.getByRole('textbox', { name: 'Message' })).toBeTruthy();
});

describe('connected attachment confirmation', () => {
  it('keeps the draft when closing a selected file without sending', async () => {
    const onMediaSubmit = vi.fn(async () => true);
    const onDraftChange = vi.fn();
    const file = new File(['photo'], 'sample.png', { type: 'image/png' });
    renderComposer({ isTextOnly: true, isMediaAvailable: true, onMediaSubmit, onDraftChange });

    fireEvent.change(screen.getByLabelText('Choose an attachment'), {
      target: { files: [file] },
    });

    await screen.findByRole('dialog', { name: 'Send attachments' });
    expect(screen.getByRole('textbox', { name: 'Caption' }).textContent).toBe('A caption');
    expect(screen.getByText('sample.png')).toBeTruthy();
    expect(onMediaSubmit).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('textbox', { name: 'Message' }).textContent).toBe('A caption');
    expect(onDraftChange).not.toHaveBeenCalled();
    expect(onMediaSubmit).not.toHaveBeenCalled();
  });

  it('adds and removes photos before explicitly sending the selection as a file', async () => {
    const onMediaSubmit = vi.fn(async () => false);
    const first = new File(['first'], 'first.png', { type: 'image/png' });
    const second = new File(['second'], 'second.png', { type: 'image/png' });
    renderComposer({ isTextOnly: true, isMediaAvailable: true, onMediaSubmit });

    fireEvent.change(screen.getByLabelText('Choose an attachment'), {
      target: { files: [first] },
    });
    await screen.findByRole('dialog', { name: 'Send attachments' });
    fireEvent.change(screen.getByLabelText('Choose more attachments'), {
      target: { files: [second] },
    });
    expect(screen.getByText('second.png')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Remove first.png' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Send as file' }));
    expect(onMediaSubmit).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Send attachments' }));
    expect(onMediaSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'A caption',
        files: [
          expect.objectContaining({ blob: second, filename: 'second.png', kind: 'document' }),
        ],
      }),
    );
    expect(screen.getByRole('dialog', { name: 'Send attachments' })).toBeTruthy();
    expect(screen.getByText('second.png')).toBeTruthy();
  });

  it('sends a separated batch with the open caption while preserving a newer draft', async () => {
    const onMediaSubmit = vi.fn(async () => true);
    const first = new File(['photo'], 'first.png', { type: 'image/png' });
    const second = new File(['video'], 'second.mp4', { type: 'video/mp4' });
    const view = renderComposer({
      isTextOnly: true,
      isMediaAvailable: true,
      onMediaSubmit,
      draftIdentity: 'first-draft',
    });

    fireEvent.change(screen.getByLabelText('Choose an attachment'), {
      target: { files: [first, second] },
    });
    await screen.findByRole('dialog', { name: 'Send attachments' });
    view.rerenderComposer({ draft: 'New draft from another tab', draftIdentity: 'newer-draft' });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Send as album' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send attachments' }));

    expect(onMediaSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'A caption',
        shouldSendFilesSeparately: true,
        shouldPreserveDraft: true,
        files: [
          expect.objectContaining({ blob: first, kind: 'image' }),
          expect.objectContaining({ blob: second, kind: 'video' }),
        ],
      }),
    );
    expect((await screen.findByRole('textbox', { name: 'Message' })).textContent).toBe(
      'New draft from another tab',
    );
  });
});
