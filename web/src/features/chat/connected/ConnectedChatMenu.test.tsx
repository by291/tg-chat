// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConnectedChatMenu } from './ConnectedChatMenu';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('opens the appropriate creation flow from each main menu action', async () => {
  const onCreate = vi.fn();
  render(
    <ConnectedChatMenu
      onOpenSaved={vi.fn()}
      onOpenArchived={vi.fn()}
      onOpenHidden={vi.fn()}
      onCreate={onCreate}
    />,
  );

  const mainMenu = screen.getByRole('button', { name: 'Main menu' });
  await userEvent.click(mainMenu);
  await userEvent.click(await screen.findByRole('menuitem', { name: 'New Group' }));
  await waitFor(() => expect(onCreate).toHaveBeenLastCalledWith('group'));

  await userEvent.click(mainMenu);
  await userEvent.click(await screen.findByRole('menuitem', { name: 'New Channel' }));
  await waitFor(() => expect(onCreate).toHaveBeenLastCalledWith('channel'));
});
