// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SessionOwner } from '@/features/auth/SessionOwner';
import { MessageReadTimeLine, MessageReadTimeScope } from './MessageReadTimeScope';

const READ_AT = '2026-11-13T01:14:00Z';

afterEach(cleanup);

it('loads and renders an exact read time only in a private chat', async () => {
  const fetch = vi.fn(async (_request: Request) => Response.json({ read_at: READ_AT }));
  const session = new SessionOwner({ baseUrl: 'https://chat.test', fetch });
  const view = render(
    <MessageReadTimeScope session={session} isDirect={false}>
      <MessageReadTimeLine messageId="private-message" />
    </MessageReadTimeScope>,
  );
  expect(fetch).not.toHaveBeenCalled();

  view.rerender(
    <MessageReadTimeScope session={session} isDirect>
      <MessageReadTimeLine messageId="private-message" />
    </MessageReadTimeScope>,
  );
  const timestamp = await screen.findByText(/^Read /);
  expect(timestamp.getAttribute('datetime')).toBe(READ_AT);
  expect(fetch.mock.calls[0]?.[0].url).toBe(
    'https://chat.test/api/v1/messages/private-message/read-time',
  );
});

it('omits an unavailable time rather than inferring one from message state', async () => {
  const fetch = vi.fn(async () => Response.json({ read_at: null }));
  const session = new SessionOwner({ baseUrl: 'https://chat.test', fetch });
  render(
    <MessageReadTimeScope session={session} isDirect>
      <MessageReadTimeLine messageId="old-message" />
    </MessageReadTimeScope>,
  );
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  expect(screen.queryByText(/^Read /)).toBeNull();
});
