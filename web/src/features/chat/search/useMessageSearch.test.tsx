// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { canonicalFixture } from '../data/messageFixtures.test-support';
import { useMessageSearch, type MessageSearchPage } from './useMessageSearch';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function pendingPage() {
  let resolve!: (value: MessageSearchPage) => void;
  const promise = new Promise<MessageSearchPage>((complete) => {
    resolve = complete;
  });

  return { promise, resolve };
}

function page(id: string, nextCursor?: string): MessageSearchPage {
  return {
    hits: [canonicalFixture({ id })],
    next_cursor: nextCursor,
    observation_cursor: 'observation',
    is_truncated: false,
  };
}

it('discards a late search response after the visibility identity changes', async () => {
  vi.useFakeTimers();
  const previous = pendingPage();
  const next = pendingPage();
  const loadPage = vi.fn().mockReturnValueOnce(previous.promise).mockReturnValueOnce(next.promise);
  const view = renderHook(
    ({ visibilityKey }) => useMessageSearch({ loadPage, visibilityKey, query: { query: 'word' } }),
    { initialProps: { visibilityKey: 'before-hide' } },
  );

  await act(async () => vi.runOnlyPendingTimersAsync());
  const firstSignal = loadPage.mock.calls[0][0].signal as AbortSignal;
  view.rerender({ visibilityKey: 'after-hide' });
  expect(firstSignal.aborted).toBe(true);
  await act(async () => vi.runOnlyPendingTimersAsync());

  await act(async () => previous.resolve(page('hidden')));
  expect(view.result.current.page).toBeUndefined();
  await act(async () => next.resolve(page('visible')));
  expect(view.result.current.page?.hits.map((message) => message.id)).toEqual(['visible']);
});

it('uses the next cursor for the same query and preserves server order across pages', async () => {
  vi.useFakeTimers();
  const loadPage = vi.fn();
  loadPage.mockResolvedValueOnce(page('newer', 'next-cursor')).mockResolvedValueOnce(page('older'));
  const view = renderHook(() =>
    useMessageSearch({ loadPage, visibilityKey: 'current', query: { query: 'word' } }),
  );

  await act(async () => vi.runOnlyPendingTimersAsync());
  await act(async () => view.result.current.loadMore());
  expect(loadPage.mock.calls[1][0].query).toEqual({ query: 'word', cursor: 'next-cursor' });
  expect(view.result.current.page?.hits.map((message) => message.id)).toEqual(['newer', 'older']);
});
