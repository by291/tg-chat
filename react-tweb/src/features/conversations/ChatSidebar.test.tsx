// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useReducer } from 'react';
import { MemoryRouter } from 'react-router';
import { chatReducer } from '@/features/chat/state/reducer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from '@/features/chat/demo/fixtures';
import type { ChatState } from '@/features/chat/state/chatState';
import { ChatSidebar } from './ChatSidebar';

// Theme artwork requires browser asset decoding, outside sidebar navigation behavior.
vi.mock('@/features/settings/appearance/ThemeEmoji', () => ({ ThemeEmoji: () => null }));

const RETAINED_SCROLL_OFFSET = 144;

interface SidebarTestScreenProps {
  initialState?: ChatState;
}

beforeEach(() => {
  // Floating menus observe their anchor after the positioning frame in a real browser.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  // jsdom does not provide the media query API used by the playback preference.
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function SidebarTestScreen({ initialState }: SidebarTestScreenProps) {
  const [state, dispatch] = useReducer(
    chatReducer,
    initialState,
    (savedState) => savedState ?? createInitialState(),
  );

  return (
    <MemoryRouter>
      <ChatSidebar
        state={state}
        dispatch={dispatch}
        onSelectChat={(chatId) => dispatch({ type: 'select-chat', chatId })}
        onToggleTheme={() => dispatch({ type: 'toggle-theme' })}
      />
      <output aria-label="Selected conversation">{state.activeChatId}</output>
    </MemoryRouter>
  );
}

describe('sidebar search', () => {
  it('opens sticker preferences through settings and returns one level at a time', async () => {
    const user = userEvent.setup();
    render(<SidebarTestScreen />);

    await user.click(screen.getByRole('button', { name: 'Main menu' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Settings' }));
    await user.click(await screen.findByRole('button', { name: 'Stickers and Emoji' }));
    const loopSwitch = screen.getByRole('checkbox', { name: 'Loop Animated Stickers' });
    const wasChecked = (loopSwitch as HTMLInputElement).checked;
    await user.click(loopSwitch);
    expect((loopSwitch as HTMLInputElement).checked).toBe(!wasChecked);
    expect(localStorage.getItem('react-tweb.sticker-playback.v1')).toBe(String(!wasChecked));
    await user.click(loopSwitch);

    await user.keyboard('{Escape}');
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Main menu' })).toBeTruthy();
    expect(screen.getByLabelText('Selected conversation').textContent).toBe('');
  });

  it('finds preferences from settings search and keeps the query on return', async () => {
    const user = userEvent.setup();
    render(<SidebarTestScreen />);

    await user.click(screen.getByRole('button', { name: 'Main menu' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Settings' }));
    await user.click(await screen.findByRole('button', { name: 'Search settings' }));
    await user.type(screen.getByRole('textbox', { name: 'Search settings' }), 'dark');
    await user.click(screen.getByRole('button', { name: 'General Settings' }));
    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect((screen.getByRole('radio', { name: 'Dark' }) as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Back from general settings' }));
    expect(
      (screen.getByRole('textbox', { name: 'Search settings' }) as HTMLInputElement).value,
    ).toBe('dark');
  });

  it('requires a group name and opens the created local group', async () => {
    const user = userEvent.setup();
    render(<SidebarTestScreen />);

    await user.click(screen.getByRole('button', { name: 'New Chats' }));
    await user.click(await screen.findByRole('menuitem', { name: 'New Group' }));
    await user.click(screen.getByRole('checkbox', { name: /Alex Morgan/ }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(
      (screen.getByRole('button', { name: 'Create Group' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.type(screen.getByRole('textbox', { name: 'Group Name' }), 'Reading club');
    await user.click(screen.getByRole('button', { name: 'Create Group' }));

    expect(screen.getByLabelText('Selected conversation').textContent).toMatch(/^local-/);
    await user.type(screen.getByRole('textbox', { name: 'Search conversations' }), 'Reading club');
    expect(screen.getByRole('button', { name: /Reading club/ })).toBeTruthy();
  });

  it('opens and dismisses creation choices without selecting a conversation', async () => {
    const user = userEvent.setup();
    render(<SidebarTestScreen />);

    expect(screen.getByLabelText('Selected conversation').textContent).toBe('');
    await user.click(screen.getByRole('button', { name: 'New Chats' }));
    expect(await screen.findByRole('menuitem', { name: 'New Group' })).toBeTruthy();
    expect(screen.getByLabelText('Selected conversation').textContent).toBe('');
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('menu', { name: 'New Chats' }));
    });
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('menuitem', { name: 'New Group' })).toBeNull();
    });
  });

  it('opens a private chat only after choosing a contact', async () => {
    const user = userEvent.setup();
    render(<SidebarTestScreen />);

    await user.click(screen.getByRole('button', { name: 'New Chats' }));
    await user.click(await screen.findByRole('menuitem', { name: 'New Private Chat' }));
    expect(screen.getByLabelText('Selected conversation').textContent).toBe('');
    await user.click(screen.getByRole('button', { name: /Alex Morgan/ }));

    expect(screen.getByLabelText('Selected conversation').textContent).toBe('alex');
  });

  it('restores the list position and keyboard focus when search is dismissed', async () => {
    const user = userEvent.setup();
    render(<SidebarTestScreen />);
    const conversations = screen.getByRole('navigation', { name: 'Conversations' });
    fireEvent.scroll(conversations, { target: { scrollTop: RETAINED_SCROLL_OFFSET } });
    const search = screen.getByRole('textbox', { name: 'Search conversations' });
    await user.click(search);
    await user.type(search, 'does not exist');
    expect(screen.getByText('No conversations found')).toBeTruthy();

    await user.keyboard('{Escape}');

    expect((search as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('navigation', { name: 'Conversations' }).scrollTop).toBe(
      RETAINED_SCROLL_OFFSET,
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Main menu' }));
  });

  it('focuses archive search after leaving its menu and can broaden the scope', async () => {
    const user = userEvent.setup();
    const initialState = chatReducer(createInitialState(), {
      type: 'update-conversations',
      chatIds: ['design'],
      changes: { isArchived: true },
    });
    render(<SidebarTestScreen initialState={initialState} />);

    await user.click(screen.getByRole('button', { name: 'Main menu' }));
    await user.click(await screen.findByRole('menuitem', { name: /Archived Chats/ }));
    await user.click(await screen.findByRole('button', { name: 'Archive options' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Search' }));

    const search = await screen.findByRole('textbox', { name: 'Search conversations' });
    await waitFor(() => expect(document.activeElement).toBe(search));
    expect(screen.getByRole('button', { name: /Design conversations/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Alex Morgan/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Search all chats' }));
    expect(screen.getByRole('button', { name: /Alex Morgan/ })).toBeTruthy();
    await user.click(search);
    await user.keyboard('{Escape}');
    expect(screen.getByRole('navigation', { name: 'Conversations' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Main menu' }));
  });

  it('clears the query without leaving search, then selects a matching chat', async () => {
    const user = userEvent.setup();
    render(<SidebarTestScreen />);
    const search = screen.getByRole('textbox', { name: 'Search conversations' });
    await user.type(search, 'not a chat');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(document.activeElement).toBe(search);
    expect(screen.getByRole('button', { name: 'Close search' })).toBeTruthy();

    await user.type(search, 'design');
    await user.click(screen.getByRole('button', { name: /Design conversations/ }));

    expect(screen.getByLabelText('Selected conversation').textContent).toBe('design');
    expect(screen.queryByRole('button', { name: 'Close search' })).toBeNull();
    expect((search as HTMLInputElement).value).toBe('');
  });

  it('keeps account menu actions operable after leaving search', async () => {
    const user = userEvent.setup();
    render(<SidebarTestScreen />);
    await user.click(screen.getByRole('textbox', { name: 'Search conversations' }));
    await user.click(screen.getByRole('button', { name: 'Close search' }));
    await user.click(screen.getByRole('button', { name: 'Main menu' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Saved Messages' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Selected conversation').textContent).toBe('saved');
    });
  });
});
