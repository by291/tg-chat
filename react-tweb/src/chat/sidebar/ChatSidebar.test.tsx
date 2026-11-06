// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useReducer } from 'react';
import { chatReducer } from '../state/reducer';
import { afterEach, describe, expect, it } from 'vitest';
import { createInitialState } from '../demo/fixtures';
import { ChatSidebar } from './ChatSidebar';

afterEach(cleanup);

function SidebarTestScreen() {
  const [state, dispatch] = useReducer(chatReducer, undefined, createInitialState);

  return (
    <>
      <ChatSidebar
        state={state}
        dispatch={dispatch}
        onSelectChat={(chatId) => dispatch({ type: 'select-chat', chatId })}
        onToggleTheme={() => dispatch({ type: 'toggle-theme' })}
      />
      <output aria-label="Selected conversation">{state.activeChatId}</output>
    </>
  );
}

describe('sidebar search', () => {
  it('restores the full list and keyboard focus when search is dismissed', async () => {
    const user = userEvent.setup();
    render(<SidebarTestScreen />);
    const search = screen.getByRole('textbox', { name: 'Search conversations' });
    await user.click(search);
    await user.type(search, 'does not exist');
    expect(screen.getByText('No conversations found')).toBeTruthy();

    await user.keyboard('{Escape}');

    expect((search as HTMLInputElement).value).toBe('');
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
