// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useReducer, useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ConversationPane } from './ConversationPane';
import { conversations, createInitialState } from './demo/fixtures';
import { chatReducer } from './state/reducer';

beforeAll(() => {
  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

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
  Element.prototype.scrollTo = () => {};
  Element.prototype.scrollIntoView = () => {};
});

afterEach(cleanup);

function ConversationTestScreen({ chatId = 'dev' }: { chatId?: string }) {
  const [state, dispatch] = useReducer(chatReducer, undefined, createInitialState);
  const [notice, setNotice] = useState('');

  return (
    <>
      <ConversationPane
        conversation={conversations.find((conversation) => conversation.id === chatId)!}
        state={state}
        dispatch={dispatch}
        onPrepareForward={() => {}}
        onClearForward={() => {}}
        onOpenDetails={() => {}}
        onOpenMedia={() => {}}
        onBack={() => {}}
        onNotify={setNotice}
      />
      <output>{notice}</output>
    </>
  );
}

describe('conversation interaction', () => {
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
    await waitFor(() => expect((editor as HTMLTextAreaElement).value).toBe(originalText));
    await user.clear(editor);
    await user.type(editor, 'The edited message');
    await user.click(screen.getByRole('button', { name: 'Save message' }));

    expect(screen.getByText('The edited message')).toBeTruthy();
    expect(screen.queryByText(originalText)).toBeNull();
  });

  it('lets a keyboard user select a quick reaction from the message menu', async () => {
    const user = userEvent.setup();
    render(<ConversationTestScreen />);
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

    const reply = screen.getByRole('button', {
      name: /^Alex\s*Archive note 12: a small detail worth keeping\.$/,
    });
    expect((reply as HTMLButtonElement).disabled).toBe(false);
    await user.click(reply);
    expect(screen.queryByRole('textbox', { name: 'Search in this conversation' })).toBeNull();
  });
});
