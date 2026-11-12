// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { components } from '@/api/schema';
import type { ChatOwner } from '../data/ChatOwner';
import { PollVotersDialog } from './PollVotersDialog';

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
    <PollVotersDialog
      owner={owner}
      messageId="poll-message"
      poll={poll}
      onClose={() => undefined}
    />,
  );

  const dialog = within(screen.getByRole('dialog', { name: 'Poll voters' }));
  expect(dialog.getByText(poll.question)).toBeTruthy();
  expect(dialog.getByText('2 members voted')).toBeTruthy();
  const morning = within(dialog.getByRole('region', { name: 'Morning' }));
  const afternoon = within(dialog.getByRole('region', { name: 'Afternoon' }));
  const evening = within(dialog.getByRole('region', { name: 'Evening' }));
  expect(morning.getByText('67%')).toBeTruthy();
  expect(morning.getByText('2 votes')).toBeTruthy();
  expect(afternoon.getByText('33%')).toBeTruthy();
  expect(afternoon.getByText('1 vote')).toBeTruthy();
  expect(evening.getByText('0 votes')).toBeTruthy();
  expect(await afternoon.findByText('Grace')).toBeTruthy();
  expect(await morning.findByText('Ada')).toBeTruthy();

  fireEvent.click(morning.getByRole('button', { name: 'Load more' }));

  expect(await morning.findByText('Grace')).toBeTruthy();
  expect(morning.getByText('Ada')).toBeTruthy();
  expect(afternoon.getByText('Grace')).toBeTruthy();
});
