// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { components } from '@/api/schema';
import { createChatOwnerFixture, SAVED } from '../data/chatOwner.test-support';
import { canonicalFixture, cursorFixture } from '../data/messageFixtures.test-support';
import { PollCloseConfirmation } from './PollCloseConfirmation';

const START = new Date('2026-11-21T12:00:00Z');
const DEADLINE = new Date('2026-11-21T12:01:00Z');
const POLL: components['schemas']['PollView'] = {
  question: 'When?',
  version: '1',
  is_anonymous: true,
  is_multiple_choice: false,
  can_vote: true,
  can_revote: true,
  can_add_options: false,
  can_close: true,
  can_edit: true,
  hide_results_until_close: false,
  is_closed: false,
  is_quiz: false,
  selected_option_ids: [],
  voter_count: 0,
  options: [],
  closes_at: DEADLINE.toISOString(),
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// prettier-ignore
const OUTCOMES = [
  'admitted',
  'expired',
  'revoked',
  'deleted',
] as const;

it.each(OUTCOMES)('checks the live poll before enqueueing a close when %s', async (outcome) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(START);
  const message = canonicalFixture({
    conversation_id: SAVED.id,
    body: { ...POLL, kind: 'poll' },
  });
  const writes: string[] = [];
  const { owner } = createChatOwnerFixture({
    history: async () =>
      Response.json({
        messages: [message],
        generation: SAVED.generation,
        has_older: false,
        has_newer: false,
        observation_cursor: cursorFixture(0),
      }),
    commands: async (request) => {
      const command = await request.json();
      writes.push(command.action.kind);
      return Response.json({ observation_cursor: cursorFixture(0), conversation: SAVED });
    },
  });
  try {
    await owner.start();
    await owner.select({ destination: { kind: 'saved' }, title: 'Saved Messages' });
    let submit: (() => Promise<void>) | undefined;
    render(
      <PollCloseConfirmation
        owner={owner}
        messageId={message.id}
        isBusy={false}
        onCancel={() => {}}
        onChoose={(action) => {
          submit = action;
        }}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Close poll' }));
    expect(submit).toBeDefined();

    // Change the projection or clock between confirmation and the admitted operation.
    if (outcome === 'expired') {
      vi.setSystemTime(DEADLINE);
    } else if (outcome !== 'admitted') {
      message.is_deleted = outcome === 'deleted';
      message.body = {
        ...POLL,
        kind: 'poll',
        can_close: outcome !== 'revoked',
      };
      message.version = '2';
      await act(() => owner.jumpToMessage(message.id, { shouldRevalidate: true }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }

    await act(() => submit!());
    if (outcome === 'admitted') {
      expect(writes).toEqual(['close_poll']);
    } else {
      expect(writes).toEqual([]);
    }
  } finally {
    owner.dispose();
  }
});
