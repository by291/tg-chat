// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { createChatOwnerFixture, DIRECT, SAVED } from '../chat/data/chatOwner.test-support';
import * as notificationNavigation from '../settings/notifications/notificationNavigation';
import { AccountWorkspace } from './AccountWorkspace';

vi.mock('../settings/appearance/ThemeEmoji', () => ({ ThemeEmoji: () => null }));

const CAPABILITIES = {
  avatars_available: false,
  calls_available: false,
  email_recovery_available: false,
  messaging_available: true,
  registration_open: false,
};

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function dispatchNotification(started: Promise<void>) {
  await screen.findByRole('button', { name: /Saved Messages/ });
  await act(async () => {
    window.history.replaceState(window.history.state, '', '/#notification=inbox');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await started;
  });
}

function pendingHistory() {
  const history = deferred<Response>();
  const requested = deferred<void>();
  function load() {
    requested.resolve();
    return history.promise;
  }
  return {
    load,
    requested: requested.promise,
    complete: () => history.resolve(Response.json({ messages: [] })),
  };
}

function renderWorkspace(
  options: {
    chat?: Parameters<typeof createChatOwnerFixture>[0];
    handheldQuery?: EventTarget & { matches: boolean };
  } = {},
) {
  class LayoutObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', LayoutObserver);
  vi.stubGlobal('IntersectionObserver', LayoutObserver);
  vi.stubGlobal('matchMedia', (query: string) => {
    if (options.handheldQuery && query === '(max-width: 760px)') {
      return options.handheldQuery;
    }
    return {
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    };
  });
  const user = userEvent.setup();
  const { session } = createChatOwnerFixture({
    conversation: {
      ...SAVED,
      draft: {
        version: '1',
        content: {
          schema_version: 1,
          text: 'Unsent',
          custom_emoji: [],
        },
      },
    },
    transport: async () =>
      Response.json({
        messages: [],
        users: [],
        items: [],
      }),
    ...options.chat,
  });
  const auth = session.getSnapshot().auth!;
  render(
    <BrowserRouter>
      <AccountWorkspace owner={session} auth={auth} capabilities={CAPABILITIES} />
    </BrowserRouter>,
  );

  return user;
}

it('returns through local settings with focus, the same editor, and its unsent text', async () => {
  const user = renderWorkspace();
  const saved = await screen.findByRole('button', { name: /Saved Messages/ });
  await user.click(saved);
  const editor = await screen.findByRole('textbox', { name: 'Message' });
  await waitFor(() => expect(editor.textContent).toBe('Unsent'));
  await user.click(screen.getByRole('button', { name: 'Account settings' }));
  const general = await screen.findByRole('button', { name: 'General Settings' });
  await user.click(general);
  const wallpaper = screen.getByRole('button', { name: 'Chat Wallpaper' });
  await user.click(wallpaper);

  await act(async () => window.history.back());
  await waitFor(() => expect(document.activeElement).toBe(wallpaper));
  await user.keyboard('{Escape}');
  await waitFor(() => expect(document.activeElement).toBe(general));
  await user.click(screen.getByRole('button', { name: 'Keyboard Shortcuts' }));
  expect(screen.getByRole('button', { name: 'Send message shortcut' })).toBeTruthy();
  await user.keyboard('{Escape}');
  await user.keyboard('{Escape}');

  expect(await screen.findByRole('button', { name: 'Account settings' })).toBe(
    document.activeElement,
  );
  expect(screen.getByRole('textbox', { name: 'Message' })).toBe(editor);
  expect(editor.textContent).toBe('Unsent');
});

it('restores the invitations trigger after Back from the invitation form', async () => {
  const user = renderWorkspace();
  await user.click(await screen.findByRole('button', { name: 'Communities' }));
  const invitations = screen.getByRole('button', { name: 'Invitations' });
  await user.click(invitations);
  await user.click(screen.getByRole('textbox', { name: 'Invitation link or secret' }));

  await act(async () => window.history.back());
  await waitFor(() => expect(document.activeElement).toBe(invitations));
});

it('leaves desktop search open while Settings owns Escape and restores sidebar focus', async () => {
  const user = renderWorkspace();
  await user.click(await screen.findByRole('button', { name: /Saved Messages/ }));
  await user.click(await screen.findByRole('button', { name: 'Search this conversation' }));
  const search = screen.getByRole('textbox', { name: 'Search in this conversation' });
  const settings = screen.getByRole('button', { name: 'Account settings' });
  await user.click(settings);

  await user.keyboard('{Escape}');
  await waitFor(() => expect(document.activeElement).toBe(settings));
  expect(search.isConnected).toBe(true);
});

it('keeps the active settings layer during IME Escape', async () => {
  const user = renderWorkspace();
  await screen.findByRole('button', { name: /Saved Messages/ });
  await user.click(screen.getByRole('button', { name: 'Account settings' }));
  await user.click(screen.getByRole('button', { name: 'General Settings' }));
  await user.click(screen.getByRole('button', { name: 'Chat Wallpaper' }));
  const back = screen.getByRole('button', { name: 'Back from wallpaper' });
  fireEvent.keyDown(back, { key: 'Escape', isComposing: true });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(screen.getByRole('button', { name: 'Back from wallpaper' })).toBe(back);
});

it('tracks peer activity for the visible pane across desktop Back and a narrow sidebar', async () => {
  const presenceLifetimeMs = 30_000;
  const handheld = Object.assign(new EventTarget(), { matches: false });
  const user = renderWorkspace({
    handheldQuery: handheld,
    chat: {
      conversation: { ...DIRECT, peer_name: 'Bob' },
      transport: async (request) => {
        if (request.url.includes('/activity/presence/')) {
          return Response.json({ online_for_ms: presenceLifetimeMs, typing_for_ms: 0 });
        }
        return Response.json({ items: [] });
      },
    },
  });
  const peer = await screen.findByRole('button', { name: /Bob.*Start a conversation/ });
  await user.click(peer);
  await screen.findByText('Online');
  await act(async () => window.history.back());
  await waitFor(() => expect(window.location.search).toBe(''));
  expect(screen.getByText('Online')).toBeTruthy();

  await user.click(peer);
  await user.click(screen.getByRole('button', { name: 'Account settings' }));
  act(() => {
    handheld.matches = true;
    handheld.dispatchEvent(new Event('change'));
  });
  await waitFor(() => expect(screen.queryByText('Online')).toBeNull());
  act(() => {
    handheld.matches = false;
    handheld.dispatchEvent(new Event('change'));
  });
  expect(await screen.findByText('Online')).toBeTruthy();
});

it('keeps Settings when notification lookup finishes after a later navigation', async () => {
  const lookup = deferred<typeof SAVED>();
  const requested = deferred<void>();
  vi.spyOn(notificationNavigation, 'resolveNotificationTarget').mockImplementation(() => {
    requested.resolve();
    return lookup.promise;
  });
  const user = renderWorkspace();
  await dispatchNotification(requested.promise);
  await user.click(screen.getByRole('button', { name: 'Account settings' }));
  const back = screen.getByRole('button', { name: 'Back to chats' });
  expect(document.activeElement).toBe(back);

  await act(async () => lookup.resolve(SAVED));
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Saved Messages' })).toBeNull());
  expect(document.activeElement).toBe(back);
  expect(window.location.search).toContain('account=settings');
});

it('keeps Settings when an admitted community finishes loading its history', async () => {
  const history = pendingHistory();
  const user = renderWorkspace({
    chat: {
      conversation: { ...SAVED, kind: 'group', title: 'Readers' },
      history: history.load,
    },
  });
  await user.click(await screen.findByRole('button', { name: 'Communities' }));
  await user.click(await screen.findByRole('button', { name: 'Open Readers' }));
  await history.requested;
  await user.keyboard('{Escape}');
  await user.click(await screen.findByRole('button', { name: 'Account settings' }));
  const back = screen.getByRole('button', { name: 'Back to chats' });
  await act(async () => history.complete());
  expect(window.location.search).toContain('account=settings');
  expect(document.activeElement).toBe(back);
});

it('keeps Settings when notification history arrives after chat admission', async () => {
  const history = pendingHistory();
  vi.spyOn(notificationNavigation, 'resolveNotificationTarget').mockResolvedValue(SAVED);
  const user = renderWorkspace({
    chat: {
      history: history.load,
    },
  });
  await dispatchNotification(history.requested);
  await user.click(screen.getByRole('button', { name: 'Account settings' }));
  const back = screen.getByRole('button', { name: 'Back to chats' });
  await act(async () => history.complete());
  expect(window.location.search).toContain('account=settings');
  expect(document.activeElement).toBe(back);
});
