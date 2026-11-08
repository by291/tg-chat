// @vitest-environment jsdom
import { ConversationDirectoryProvider } from '@/features/conversations/ConversationDirectory';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useReducer, useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ConversationPane } from './ConversationPane';
import { conversations, createInitialState } from './demo/fixtures';
import { chatReducer } from './state/reducer';
import type { MediaViewerCommand } from '@/features/media/mediaViewerCommands';
import type { Message } from '@/domain/messages/message';

interface ConversationTestScreenProps {
  chatId?: string;
  mediaAction?: MediaViewerCommand['action'];
  onFinishMediaCommand?: (options: { shouldRestoreViewer: boolean }) => void;
  onPrepareForward?: (options: { chatId: string; messages: Message[] }) => void;
}

beforeAll(() => {
  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  vi.stubGlobal('ClipboardEvent', Event);
  vi.stubGlobal('DragEvent', class extends Event {});
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  vi.stubGlobal('IntersectionObserver', TestResizeObserver);
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 696,
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return this.getAttribute('aria-label') === 'Message history' ? 800 : 80;
    },
  });
  // jsdom has no layout engine, but Lexical measures the caret when restoring focus.
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  const emptyRectangles: DOMRect[] = [];
  Range.prototype.getClientRects = () => ({
    length: 0,
    item: () => null,
    [Symbol.iterator]: () => emptyRectangles.values(),
  });
  Element.prototype.getBoundingClientRect = function () {
    return new DOMRect(0, 0, this.clientWidth, this.clientHeight);
  };
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      const content = this.firstElementChild;
      if (!(content instanceof HTMLElement)) {
        return 0;
      }
      return Number.parseFloat(content.style.height || '0');
    },
  });
  Element.prototype.scrollTo = function (options?: ScrollToOptions | number) {
    if (!options || typeof options === 'number') {
      return;
    }

    const nextScrollTop = Math.max(0, options.top ?? 0);
    if (nextScrollTop !== this.scrollTop) {
      this.scrollTop = nextScrollTop;
      queueMicrotask(() => this.dispatchEvent(new Event('scroll')));
    }
  };
  Element.prototype.scrollIntoView = () => {};
});

afterEach(cleanup);

function ConversationTestScreen({
  chatId = 'dev',
  mediaAction,
  onFinishMediaCommand,
  onPrepareForward = () => {},
}: ConversationTestScreenProps) {
  const [state, dispatch] = useReducer(chatReducer, undefined, createInitialState);
  const [notice, setNotice] = useState('');
  const [requestedMediaCommand] = useState<MediaViewerCommand | undefined>(() => {
    const message = state.messages.find((entry) => entry.chatId === chatId && entry.attachment);
    return mediaAction && message ? { action: mediaAction, message } : undefined;
  });

  return (
    <ConversationDirectoryProvider state={state}>
      <ConversationPane
        conversation={conversations.find((conversation) => conversation.id === chatId)!}
        state={state}
        dispatch={dispatch}
        requestedMediaCommand={requestedMediaCommand}
        onFinishMediaCommand={onFinishMediaCommand}
        onPrepareForward={onPrepareForward}
        onClearForward={() => {}}
        onOpenDetails={() => {}}
        onOpenMedia={() => {}}
        onBack={() => {}}
        onNotify={setNotice}
      />
      <output>{notice}</output>
    </ConversationDirectoryProvider>
  );
}

async function openMessageAction(options: {
  user: ReturnType<typeof userEvent.setup>;
  text: string;
  action: string;
}) {
  await options.user.click(screen.getByRole('group', { name: `Message: ${options.text}` }));
  await options.user.keyboard('{Shift>}{F10}{/Shift}');
  await options.user.click(await screen.findByRole('menuitem', { name: options.action }));
}

async function replaceComposerText(options: {
  user: ReturnType<typeof userEvent.setup>;
  text: string;
}) {
  await options.user.click(screen.getByRole('textbox', { name: 'Message' }));
  await options.user.keyboard('{Control>}a{/Control}');
  if (options.text) {
    await options.user.paste(options.text);
  } else {
    await options.user.keyboard('{Backspace}');
  }
}

async function waitForInitialHistoryPosition() {
  const history = screen.getByLabelText('Message history');
  // Real interaction follows the first paint; jsdom can type before its initial scroll frame.
  await waitFor(() => {
    const bottomOffset = Math.max(0, history.scrollHeight - history.clientHeight);
    expect(history.scrollTop).toBe(bottomOffset);
  });
}

describe('conversation interaction', () => {
  it('keeps a message unpinned when the pin confirmation is cancelled', async () => {
    const user = userEvent.setup();
    render(<ConversationTestScreen />);
    await openMessageAction({
      user,
      text: 'This feels familiar ✨',
      action: 'Pin',
    });
    const confirmation = await screen.findByRole('alertdialog', { name: 'Pin message' });
    expect(screen.queryByRole('button', { name: /^Pinned Message:/ })).toBeNull();
    await user.click(within(confirmation).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.queryByRole('button', { name: /^Pinned Message:/ })).toBeNull();
  });

  it('confirms pinning and unpinning from both message and topbar actions', async () => {
    const user = userEvent.setup();
    render(<ConversationTestScreen />);
    const text = 'This feels familiar ✨';
    // prettier-ignore
    await openMessageAction({
      user,
      text,
      action: 'Pin',
    });
    const pinDialog = await screen.findByRole('alertdialog', { name: 'Pin message' });
    await user.click(within(pinDialog).getByRole('button', { name: 'Pin' }));
    await screen.findByRole('button', { name: `Pinned Message: ${text}` });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    // prettier-ignore
    await openMessageAction({
      user,
      text,
      action: 'Unpin',
    });
    const unpinDialog = await screen.findByRole('alertdialog', { name: 'Unpin message' });
    await user.click(within(unpinDialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByRole('button', { name: `Pinned Message: ${text}` })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Unpin message' }));
    const topbarDialog = await screen.findByRole('alertdialog', { name: 'Unpin message' });
    await user.click(within(topbarDialog).getByRole('button', { name: 'Unpin' }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^Pinned Message:/ })).toBeNull();
    });
  });

  it('returns to the viewer when its deletion confirmation is cancelled', async () => {
    const user = userEvent.setup();
    const onFinishMediaCommand = vi.fn();
    render(
      <ConversationTestScreen mediaAction="delete" onFinishMediaCommand={onFinishMediaCommand} />,
    );

    const confirmation = await screen.findByRole('alertdialog', { name: 'Delete message?' });
    await user.click(within(confirmation).getByRole('button', { name: 'Cancel' }));

    expect(onFinishMediaCommand).toHaveBeenCalledWith({ shouldRestoreViewer: true });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByRole('img', { name: 'Quiet hills.svg' })).toBeTruthy();
  });

  it('removes the confirmed image without restoring a viewer for the deleted message', async () => {
    const user = userEvent.setup();
    const onFinishMediaCommand = vi.fn();
    render(
      <ConversationTestScreen mediaAction="delete" onFinishMediaCommand={onFinishMediaCommand} />,
    );

    const confirmation = await screen.findByRole('alertdialog', { name: 'Delete message?' });
    await user.click(within(confirmation).getByRole('button', { name: 'Delete' }));

    expect(onFinishMediaCommand).toHaveBeenCalledWith({ shouldRestoreViewer: false });
    await waitFor(() => expect(screen.queryByRole('img', { name: 'Quiet hills.svg' })).toBeNull());
  });

  it('returns to the viewer when its forward recipient picker is closed', async () => {
    const user = userEvent.setup();
    const onFinishMediaCommand = vi.fn();
    render(
      <ConversationTestScreen mediaAction="forward" onFinishMediaCommand={onFinishMediaCommand} />,
    );

    await user.click(await screen.findByRole('button', { name: 'Close forwarding' }));

    await waitFor(() => {
      expect(onFinishMediaCommand).toHaveBeenCalledWith({ shouldRestoreViewer: true });
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Share with' })).toBeNull());
  });

  it('finishes a viewer forward immediately when Saved is chosen', async () => {
    const user = userEvent.setup();
    const onFinishMediaCommand = vi.fn();
    const onPrepareForward = vi.fn();
    render(
      <ConversationTestScreen
        mediaAction="forward"
        onFinishMediaCommand={onFinishMediaCommand}
        onPrepareForward={onPrepareForward}
      />,
    );

    const picker = await screen.findByRole('dialog', { name: 'Share with' });
    await user.click(within(picker).getByRole('button', { name: /^Saved$/ }));

    await waitFor(() => {
      expect(onFinishMediaCommand).toHaveBeenCalledWith({ shouldRestoreViewer: false });
    });
    expect(onPrepareForward).not.toHaveBeenCalled();
    expect(screen.getByText('Messages forwarded')).toBeTruthy();
  });

  it('clears reply context and selection when handing a forward draft to another chat', async () => {
    const user = userEvent.setup();
    const onPrepareForward = vi.fn();
    render(<ConversationTestScreen onPrepareForward={onPrepareForward} />);
    const originalText = 'The floating layout is so nice.';
    await replaceComposerText({ user, text: 'Keep this draft' });
    await openMessageAction({
      user,
      text: originalText,
      action: 'Reply',
    });
    await openMessageAction({
      user,
      text: originalText,
      action: 'Select',
    });
    await user.click(screen.getByRole('button', { name: 'Forward selected messages' }));
    const picker = await screen.findByRole('dialog', { name: 'Share with' });
    await user.click(within(picker).getByRole('button', { name: /Alex Morgan/ }));

    await waitFor(() => {
      expect(onPrepareForward).toHaveBeenCalledWith({
        chatId: 'alex',
        messages: [expect.objectContaining({ text: originalText })],
      });
    });
    expect(screen.queryByRole('button', { name: 'Jump to replied message' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Forward selected messages' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Message' }).textContent).toBe('Keep this draft');
    expect(screen.queryByText('Messages forwarded')).toBeNull();
  });

  it('keeps accepting input after applying a link to the controlled draft', async () => {
    const user = userEvent.setup();
    render(<ConversationTestScreen />);
    await replaceComposerText({ user, text: 'A link' });
    await user.keyboard('{Control>}a{/Control}{Control>}k{/Control}');
    await user.type(await screen.findByRole('textbox', { name: 'URL' }), 'https://telegram.org');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    const editor = screen.getByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(document.activeElement).toBe(editor));
    // jsdom does not implement the browser's ArrowRight selection-collapse default action.
    await act(async () => {
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      fireEvent(document, new Event('selectionchange'));
    });
    await user.paste(' continued');
    expect(editor.textContent).toBe('A link continued');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    const message = await screen.findByRole('group', { name: 'Message: A link continued' });
    expect(within(message).getByRole('link').textContent).toBe('A link');
    expect(screen.getByRole('textbox', { name: 'Message' }).textContent).toBe('');
  });

  it('clears a formatted draft after sending and restores its formatting when editing', async () => {
    const user = userEvent.setup();
    render(<ConversationTestScreen />);
    await replaceComposerText({ user, text: 'A formatted message' });
    await user.keyboard('{Control>}a{/Control}{Control>}b{/Control}');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    const message = await screen.findByRole('group', { name: 'Message: A formatted message' });
    expect(message.querySelector('strong')?.textContent).toBe('A formatted message');
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Message' }).textContent).toBe('');
    });

    await openMessageAction({
      user,
      text: 'A formatted message',
      action: 'Edit',
    });
    const editor = screen.getByRole('textbox', { name: 'Message' });
    expect(editor.querySelector('strong')?.textContent).toBe('A formatted message');
    await user.click(editor);
    await user.keyboard('{Control>}a{/Control}{Control>}i{/Control}');
    await user.keyboard('{Control>}k{/Control}');
    await user.type(await screen.findByRole('textbox', { name: 'URL' }), 'https://telegram.org');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await user.click(screen.getByRole('button', { name: 'Save message' }));
    expect(message.querySelector('em, i')?.textContent).toBe('A formatted message');
    expect(within(message).getByRole('link').getAttribute('href')).toBe('https://telegram.org');
    expect(screen.getByRole('textbox', { name: 'Message' }).textContent).toBe('');
  });

  it('exits an unchanged edit without a confirmation or an edited marker', async () => {
    const user = userEvent.setup();
    render(<ConversationTestScreen />);
    const originalText = 'The floating layout is so nice.';
    await openMessageAction({
      user,
      text: originalText,
      action: 'Edit',
    });
    await user.click(screen.getByRole('button', { name: 'Cancel reply or edit' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save message' })).toBeNull();

    await openMessageAction({
      user,
      text: originalText,
      action: 'Edit',
    });
    await user.click(screen.getByRole('button', { name: 'Save message' }));
    const message = screen.getByRole('group', { name: `Message: ${originalText}` });
    expect(within(message).queryByText('edited')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save message' })).toBeNull();
  });

  it('keeps an edited message until discard is confirmed, then restores the unsent draft', async () => {
    const user = userEvent.setup();
    render(<ConversationTestScreen />);
    await replaceComposerText({ user, text: 'My unsent draft' });
    await openMessageAction({
      user,
      text: 'The floating layout is so nice.',
      action: 'Edit',
    });
    await replaceComposerText({ user, text: 'An unsaved edit' });
    await user.click(screen.getByRole('button', { name: 'Cancel reply or edit' }));

    const confirmation = await screen.findByRole('alertdialog', { name: 'Discard changes?' });
    await user.click(within(confirmation).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByRole('textbox', { name: 'Message' }).textContent).toBe('An unsaved edit');

    await user.click(screen.getByRole('textbox', { name: 'Message' }));
    await user.keyboard('{Escape}');
    const secondConfirmation = await screen.findByRole('alertdialog', { name: 'Discard changes?' });
    await user.click(within(secondConfirmation).getByRole('button', { name: 'Discard' }));

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Message' }).textContent).toBe('My unsent draft');
    });
    expect(
      screen.getByRole('group', { name: 'Message: The floating layout is so nice.' }),
    ).toBeTruthy();
  });

  it('asks before deleting an edited text message whose content was cleared', async () => {
    const user = userEvent.setup();
    render(<ConversationTestScreen />);
    const originalText = 'The floating layout is so nice.';
    await openMessageAction({
      user,
      text: originalText,
      action: 'Edit',
    });
    await replaceComposerText({ user, text: '' });
    await user.click(screen.getByRole('button', { name: 'Save message' }));

    const confirmation = await screen.findByRole('alertdialog', { name: 'Delete message?' });
    await user.click(within(confirmation).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByRole('textbox', { name: 'Message' }).textContent).toBe('');
    expect(screen.getByRole('button', { name: 'Save message' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Save message' }));
    const secondConfirmation = await screen.findByRole('alertdialog', { name: 'Delete message?' });
    await user.click(within(secondConfirmation).getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(screen.queryByRole('group', { name: `Message: ${originalText}` })).toBeNull();
    });
    expect(screen.queryByRole('button', { name: 'Save message' })).toBeNull();
  });

  it('preserves the draft when jumping to and cancelling a reply', async () => {
    const user = userEvent.setup();
    render(<ConversationTestScreen />);
    await replaceComposerText({ user, text: 'A reply draft' });
    await openMessageAction({
      user,
      text: 'The floating layout is so nice.',
      action: 'Reply',
    });
    await user.click(screen.getByRole('button', { name: 'Jump to replied message' }));
    expect(screen.getByRole('textbox', { name: 'Message' }).textContent).toBe('A reply draft');
    await user.click(screen.getByRole('button', { name: 'Cancel reply or edit' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Jump to replied message' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Message' }).textContent).toBe('A reply draft');
  });

  it.each(['Reply', 'Edit'])(
    'restores the draft when the %s target is removed through selection',
    async (action) => {
      const user = userEvent.setup();
      render(<ConversationTestScreen />);
      const originalText = 'The floating layout is so nice.';
      await replaceComposerText({ user, text: 'Keep this draft' });
      await openMessageAction({
        user,
        text: originalText,
        action,
      });
      await openMessageAction({
        user,
        text: originalText,
        action: 'Select',
      });
      await user.click(screen.getByRole('button', { name: 'Delete selected messages' }));
      const confirmation = await screen.findByRole('dialog', { name: 'Delete Messages' });
      await user.click(within(confirmation).getByRole('button', { name: 'Delete' }));

      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: 'Delete Messages' })).toBeNull();
      });
      expect(screen.queryByRole('group', { name: `Message: ${originalText}` })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Save message' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Jump to replied message' })).toBeNull();
      expect(screen.getByRole('textbox', { name: 'Message' }).textContent).toBe('Keep this draft');
    },
  );

  it('opens the editor through keyboard menu selection and saves the changed message', async () => {
    const user = userEvent.setup();
    render(<ConversationTestScreen />);
    const originalText = 'The floating layout is so nice.';
    await user.click(screen.getByRole('group', { name: `Message: ${originalText}` }));
    await user.keyboard('{Shift>}{F10}{/Shift}');
    await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('menu'));
    await user.keyboard('e');
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'Edit' }).hasAttribute('data-highlighted')).toBe(
        true,
      ),
    );
    await user.keyboard('{Enter}');

    const editor = screen.getByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(editor.textContent).toBe(originalText));
    await user.click(editor);
    await user.keyboard('{Control>}a{/Control}');
    await user.paste('The edited message');
    await user.click(screen.getByRole('button', { name: 'Save message' }));

    expect(screen.getByText('The edited message')).toBeTruthy();
    expect(screen.queryByRole('group', { name: `Message: ${originalText}` })).toBeNull();
  });

  it('lets a keyboard user select a quick reaction from the message menu', async () => {
    const user = userEvent.setup();
    render(<ConversationTestScreen />);
    await waitForInitialHistoryPosition();
    await user.click(screen.getByRole('group', { name: 'Message: This feels familiar ✨' }));
    await user.keyboard('{Shift>}{F10}{/Shift}');
    await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('menu'));
    await user.keyboard('{Home}');
    await waitFor(() =>
      expect(
        screen.getByRole('menuitem', { name: 'React ❤️' }).hasAttribute('data-highlighted'),
      ).toBe(true),
    );
    await user.keyboard('{Enter}');

    expect(await screen.findByRole('button', { name: 'Remove ❤️ reaction' })).toBeTruthy();
  });

  it('finds and applies an emoji outside the quick reaction list', async () => {
    const user = userEvent.setup();
    render(<ConversationTestScreen />);
    await waitForInitialHistoryPosition();
    await user.click(screen.getByRole('group', { name: 'Message: This feels familiar ✨' }));
    await user.keyboard('{Shift>}{F10}{/Shift}');
    await user.click(await screen.findByRole('menuitem', { name: 'More reactions' }));

    const picker = await screen.findByRole('dialog', { name: 'Choose reaction' });
    await waitFor(() => {
      expect(screen.queryByRole('menu', { name: 'Message actions' })).toBeNull();
    });
    await user.type(within(picker).getByRole('textbox', { name: 'Search reactions' }), 'turtle');
    await user.click(await within(picker).findByRole('button', { name: 'React 🐢' }));

    expect(await screen.findByRole('button', { name: 'Remove 🐢 reaction' })).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Choose reaction' })).toBeNull();
    });
  });

  it('selects a supported custom emoji as its own reaction', async () => {
    const user = userEvent.setup();
    render(<ConversationTestScreen />);
    await waitForInitialHistoryPosition();
    await user.click(screen.getByRole('group', { name: 'Message: This feels familiar ✨' }));
    await user.keyboard('{Shift>}{F10}{/Shift}');
    await user.click(await screen.findByRole('menuitem', { name: 'More reactions' }));

    const picker = await screen.findByRole('dialog', { name: 'Choose reaction' });
    await user.type(
      within(picker).getByRole('textbox', { name: 'Search reactions' }),
      'Face Emoji 01',
    );
    await user.click(within(picker).getByRole('button', { name: 'Face Emoji' }));
    await user.click(await within(picker).findByRole('button', { name: 'React Face Emoji 01' }));

    const reaction = await screen.findByRole('button', { name: 'Remove Face Emoji 01 reaction' });
    expect(reaction.querySelector('img')?.src).toContain('5249007745805328497.webp');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Choose reaction' })).toBeNull();
    });
    await user.click(reaction);
    expect(screen.queryByRole('button', { name: 'Remove Face Emoji 01 reaction' })).toBeNull();
  });

  it('dismisses an expanded reaction picker without reopening the message menu', async () => {
    const user = userEvent.setup();
    render(<ConversationTestScreen />);
    await waitForInitialHistoryPosition();
    const messageRow = screen.getByRole('group', { name: 'Message: This feels familiar ✨' });
    await user.click(messageRow);
    await user.keyboard('{Shift>}{F10}{/Shift}');
    await user.click(await screen.findByRole('menuitem', { name: 'More reactions' }));
    const picker = await screen.findByRole('dialog', { name: 'Choose reaction' });
    await user.click(within(picker).getByRole('textbox', { name: 'Search reactions' }));
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Choose reaction' })).toBeNull();
      expect(screen.queryByRole('menu', { name: 'Message actions' })).toBeNull();
    });
  });
});

describe('search reply navigation', () => {
  it('keeps unmatched reply targets available in search results', async () => {
    const user = userEvent.setup();
    render(<ConversationTestScreen chatId="lab" />);
    await user.click(screen.getByRole('button', { name: /^Search messages$/ }));
    await user.type(
      screen.getByRole('textbox', { name: 'Search in this conversation' }),
      'Scroll up to explore',
    );

    const sourceMessage = await screen.findByRole('group', {
      name: /^Message: Scroll up to explore/,
    });
    const reply = within(sourceMessage).getByRole('button', {
      name: /^Alex\s*Archive note 12: a small detail worth keeping\.$/,
    });
    expect((reply as HTMLButtonElement).disabled).toBe(false);
    await user.click(reply);
    await waitFor(() => {
      expect(screen.queryByRole('textbox', { name: 'Search in this conversation' })).toBeNull();
    });
  });
});
