// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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

  vi.stubGlobal('ClipboardEvent', Event);
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
    this.scrollTop = Math.max(0, options.top ?? 0);
    queueMicrotask(() => this.dispatchEvent(new Event('scroll')));
  };
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
    await waitFor(() => expect(editor.textContent).toBe(originalText));
    await user.click(editor);
    await user.keyboard('{Control>}a{/Control}');
    await user.paste('The edited message');
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
