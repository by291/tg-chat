// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { createChatOwnerFixture, SAVED } from '../chat/data/chatOwner.test-support';
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
});

function renderWorkspace() {
  class LayoutObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', LayoutObserver);
  vi.stubGlobal('IntersectionObserver', LayoutObserver);
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
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
