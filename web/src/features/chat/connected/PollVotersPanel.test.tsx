// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useRef } from 'react';
import { BrowserRouter, useNavigate } from 'react-router';
import { HandheldPanelHistory, useHandheldPanel, type PanelEntry } from './HandheldPanelHistory';
import type { VoterTarget } from './useConversationInformation';
import type { components } from '@/api/schema';
import { ApiError, type SessionOwner } from '@/features/auth/SessionOwner';
import type { ChatOwner } from '../data/ChatOwner';
import { PollVotersPanel } from './PollVotersPanel';

type PollView = components['schemas']['PollView'];

// prettier-ignore
const VOTER_RESTORATION_SCENARIOS = [
  'an available row',
  'a withdrawn row',
  'a failed first page',
] as const;

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

function HandheldResults({ owner }: { owner: Pick<ChatOwner, 'loadPollVoters'> }) {
  const navigate = useNavigate();
  const layer = useHandheldPanel({ kind: 'information', isValid: () => true });
  const rememberedVoter = useRef<PanelEntry<VoterTarget>>(undefined);

  return (
    <>
      <button onClick={() => navigate(-1)}>Browser Back</button>
      <button onClick={() => navigate(1)}>Browser Forward</button>
      <button onClick={() => layer.open('poll')}>Open results</button>
      {layer.selection && (
        <PollVotersPanel
          owner={owner}
          session={session}
          messageId="poll"
          poll={poll}
          rememberedVoter={rememberedVoter}
          isOpen
          onClose={layer.close}
        />
      )}
    </>
  );
}

it.each(VOTER_RESTORATION_SCENARIOS)(
  'reauthorizes a later-page voter on Forward with %s',
  async (scenario) => {
    window.history.replaceState(null, '', '/');
    const handheld = Object.assign(new EventTarget(), { matches: true });
    vi.stubGlobal('matchMedia', () => handheld);
    const ada = { user_id: 'ada', display_name: 'Ada' };
    const grace = { user_id: 'grace', display_name: 'Grace' };
    let laterVoters = [grace];
    let hasReadRestoredPage = false;
    let isRestoring = false;
    const shouldRetryFirstPage = scenario === 'a failed first page';
    let canReadFirstPage = true;
    const owner: Pick<ChatOwner, 'loadPollVoters'> = {
      async loadPollVoters({ optionId, after }) {
        if (optionId !== 'morning') {
          return { voters: [], next_after: null };
        }
        if (!after && !canReadFirstPage) {
          canReadFirstPage = true;
          throw new Error('Temporary voter lookup failure.');
        }
        if (isRestoring && after === 'next-morning') {
          hasReadRestoredPage = true;
        }
        return after
          ? { voters: laterVoters, next_after: null }
          : { voters: [ada], next_after: 'next-morning' };
      },
    };
    const click = async (name: string) => {
      fireEvent.click(await screen.findByRole('button', { name }));
    };
    const results = () => screen.queryByRole('complementary', { name: 'Poll voters' });
    const expectVoterFocus = () => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Grace' }));
    };
    try {
      render(
        <BrowserRouter>
          <HandheldPanelHistory captureIntent={() => () => true}>
            <HandheldResults owner={owner} />
          </HandheldPanelHistory>
        </BrowserRouter>,
      );

      await click('Open results');
      await click('Load more');
      await click('Grace');
      await screen.findByText('@grace_hopper');
      await click('Browser Back');
      await waitFor(expectVoterFocus);
      await click('Browser Back');
      await waitFor(() => expect(results()).toBeNull());
      isRestoring = true;
      const isWithdrawn = scenario === 'a withdrawn row';
      laterVoters = isWithdrawn ? [] : [grace];
      canReadFirstPage = !shouldRetryFirstPage;

      await click('Browser Forward');
      const firstPageAction = shouldRetryFirstPage ? 'Retry' : 'Ada';
      await screen.findByRole('button', { name: firstPageAction });
      await click('Browser Forward');
      if (!isWithdrawn) {
        await screen.findByText('@grace_hopper');
        await click('Browser Back');
        await waitFor(expectVoterFocus);
      } else {
        await waitFor(() => expect(hasReadRestoredPage).toBe(true));
        // A missing private target returns to results without consuming the next user Back.
        await waitFor(() => expect(window.history.state?.usr?.chatPanels?.voter).toBeUndefined());
        expect(screen.queryByText('@grace_hopper')).toBeNull();
      }
      if (shouldRetryFirstPage) {
        await click('Retry');
        await screen.findByRole('button', { name: 'Ada' });
        const morning = within(screen.getByRole('region', { name: 'Morning' }));
        expect(morning.getAllByRole('button')).toEqual([
          morning.getByRole('button', { name: 'Ada' }),
          morning.getByRole('button', { name: 'Grace' }),
        ]);
      }
      await click('Browser Back');
      await waitFor(() => expect(results()).toBeNull());
    } finally {
      vi.unstubAllGlobals();
    }
  },
);
