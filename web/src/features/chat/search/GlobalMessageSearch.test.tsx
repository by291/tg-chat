// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError } from '@/features/auth/SessionOwner';
import { canonicalFixture } from '../data/messageFixtures.test-support';
import { GlobalMessageSearch } from './GlobalMessageSearch';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('keeps a sibling result selectable after a message in its conversation disappears', async () => {
  const resultsHeight = 200;
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(resultsHeight);
  const expired = canonicalFixture({ author_name: 'First author' });
  const available = canonicalFixture({ id: 'message-2', author_name: 'Second author' });
  const loadPage = async () => ({
    hits: [expired, available],
    observation_cursor: 'observation',
    is_truncated: false,
  });
  const onSelect = vi.fn(async (selection: { messageId: string }) => {
    if (selection.messageId === expired.id) {
      throw new ApiError({
        code: 'not_found',
        message: 'Message unavailable',
        status: 404,
      });
    }
  });
  render(
    <GlobalMessageSearch
      query="content"
      visibilityKey="current"
      loadPage={loadPage}
      onSelect={onSelect}
    />,
  );

  fireEvent.click(await screen.findByRole('button', { name: /First author/ }));
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: /First author/ })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: /Second author/ }));
  expect(onSelect).toHaveBeenLastCalledWith({
    conversationId: available.conversation_id,
    messageId: available.id,
  });
});
