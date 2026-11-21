// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { components } from '@/api/schema';
import { ApiError, type SessionOwner } from '@/features/auth/SessionOwner';
import type { ChatOwner } from '../data/ChatOwner';
import { PollVotersPanel } from './PollVotersPanel';

type PollView = components['schemas']['PollView'];

const poll: PollView = {
  question: 'When should we meet?',
  version: '5',
  is_anonymous: false,
  is_multiple_choice: true,
  can_vote: true,
  can_revote: true,
  can_add_options: false,
  can_close: false,
  can_edit: false,
  hide_results_until_close: false,
  is_closed: false,
  is_quiz: false,
  selected_option_ids: [],
  voter_count: 2,
  options: [
    {
      id: 'morning',
      text: 'Morning',
      votes: 2,
    },
    {
      id: 'afternoon',
      text: 'Afternoon',
      votes: 1,
    },
    {
      id: 'evening',
      text: 'Evening',
      votes: 0,
    },
  ],
};

const session = {
  client: {
    async GET(_path: string, options: { params: { path: { user_id: string } } }) {
      if (options.params.path.user_id !== 'grace') {
        throw new Error('Unknown user');
      }
      return { data: { display_name: 'Grace Hopper', username: 'grace_hopper' } };
    },
  },
} as unknown as SessionOwner;

afterEach(cleanup);

it('shows distinct voters and loads more people only in the selected option', async () => {
  const ada = { user_id: 'ada', display_name: 'Ada' };
  const grace = { user_id: 'grace', display_name: 'Grace' };
  const owner: Pick<ChatOwner, 'loadPollVoters'> = {
    async loadPollVoters({ optionId, after }) {
      if (optionId === 'morning' && !after) {
        return { voters: [ada], next_after: ada.user_id };
      }
      if (optionId === 'morning' && after === ada.user_id) {
        return { voters: [grace], next_after: null };
      }
      if (optionId === 'afternoon') {
        return { voters: [grace], next_after: null };
      }
      throw new Error('Unexpected voter page');
    },
  };
  render(
    <PollVotersPanel
      owner={owner}
      session={session}
      isOpen
      messageId="poll-message"
      poll={poll}
      onClose={() => undefined}
    />,
  );

  const panel = within(screen.getByRole('complementary', { name: 'Poll voters' }));
  expect(panel.getByText(poll.question)).toBeTruthy();
  expect(panel.getByText('2 members voted')).toBeTruthy();
  const morning = within(panel.getByRole('region', { name: 'Morning' }));
  const afternoon = within(panel.getByRole('region', { name: 'Afternoon' }));
  const evening = within(panel.getByRole('region', { name: 'Evening' }));
  expect(morning.getByText('67%')).toBeTruthy();
  expect(morning.getByText('2 votes')).toBeTruthy();
  expect(afternoon.getByText('33%')).toBeTruthy();
  expect(afternoon.getByText('1 vote')).toBeTruthy();
  expect(evening.getByText('0 votes')).toBeTruthy();
  expect(await afternoon.findByText('Grace')).toBeTruthy();
  expect(await morning.findByText('Ada')).toBeTruthy();

  const voter = afternoon.getByRole('button', { name: /^Grace$/ });
  expect(voter.querySelector('time')).toBeNull();
  fireEvent.click(voter);
  expect(await screen.findByText('@grace_hopper')).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Close profile' }), { key: 'Escape' });
  expect(document.activeElement).toBe(voter);
  fireEvent.click(morning.getByRole('button', { name: 'Load more' }));

  expect(await morning.findByText('Grace')).toBeTruthy();
  expect(morning.getByText('Ada')).toBeTruthy();
  expect(afternoon.getByText('Grace')).toBeTruthy();
});

it('revokes the open voter profile when another option loses results access', async () => {
  let rejectPage!: (failure: Error) => void;
  const delayedPage = new Promise<never>((_resolve, reject) => {
    rejectPage = reject;
  });
  const owner: Pick<ChatOwner, 'loadPollVoters'> = {
    async loadPollVoters({ optionId }) {
      if (optionId === 'afternoon') {
        return delayedPage;
      }
      return { voters: [{ user_id: 'grace', display_name: 'Grace' }], next_after: null };
    },
  };
  render(
    <PollVotersPanel
      owner={owner}
      session={session}
      isOpen
      messageId="poll-message"
      poll={poll}
      onClose={() => undefined}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Grace' }));
  await screen.findByText('@grace_hopper');
  rejectPage(
    new ApiError({
      code: 'forbidden',
      message: 'Forbidden',
      status: 403,
    }),
  );

  expect((await screen.findByRole('alert')).textContent).toBe('Poll results are unavailable.');
  expect(screen.queryByText('@grace_hopper')).toBeNull();
  expect(screen.queryByText('Grace')).toBeNull();
});
