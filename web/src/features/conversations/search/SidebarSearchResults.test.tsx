// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createInitialState } from '@/features/chat/demo/fixtures';
import { getConversationList } from '../conversationList';
import { SidebarSearchResults } from './SidebarSearchResults';

const EXIT_SETTLE_TIME = 200;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('retains the search shell while releasing closed results after their exit transition', () => {
  vi.useFakeTimers();
  const conversations = getConversationList(createInitialState());
  const onSelectChat = vi.fn();
  const props = {
    conversations,
    isArchiveScope: false,
    onSelectChat,
    onMenuAction: vi.fn(),
  };
  const view = render(<SidebarSearchResults {...props} isSearching={false} />);
  const shell = view.container.querySelector('nav')!;
  expect(shell.querySelectorAll('button')).toHaveLength(0);

  view.rerender(<SidebarSearchResults {...props} isSearching />);
  const results = screen.getByRole('navigation', { name: 'Search results' });
  fireEvent.click(within(results).getByRole('button', { name: /^dev/ }));
  expect(onSelectChat).toHaveBeenCalledWith('dev');

  view.rerender(<SidebarSearchResults {...props} isSearching={false} />);
  expect(shell.querySelectorAll('button').length).toBeGreaterThan(0);
  act(() => vi.advanceTimersByTime(EXIT_SETTLE_TIME));
  expect(view.container.querySelector('nav')).toBe(shell);
  expect(shell.querySelectorAll('button')).toHaveLength(0);
});

it('keeps a focused result available for activation when scrolling a large result set', () => {
  const resultCount = 120;
  const viewportHeight = 280;
  const scrollOffset = 5_000;
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(viewportHeight);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(320);
  const originalConversation = getConversationList(createInitialState())[0];
  const conversations = Array.from({ length: resultCount }, (_, index) => ({
    ...originalConversation,
    id: `result-${index}`,
    title: `Result ${index}`,
  }));
  const onSelectChat = vi.fn();
  render(
    <SidebarSearchResults
      conversations={conversations}
      isSearching
      isArchiveScope={false}
      onSelectChat={onSelectChat}
      onMenuAction={vi.fn()}
    />,
  );
  const results = screen.getByRole('navigation', { name: 'Search results' });
  const firstResult = within(results).getByRole('button', { name: /^Result 0/ });
  act(() => firstResult.focus());
  fireEvent.scroll(results, { target: { scrollTop: scrollOffset } });

  expect(firstResult.isConnected).toBe(true);
  expect(document.activeElement).toBe(firstResult);
  expect(within(results).getAllByRole('button').length).toBeLessThan(resultCount);
  fireEvent.click(firstResult);
  expect(onSelectChat).toHaveBeenCalledWith('result-0');
});
