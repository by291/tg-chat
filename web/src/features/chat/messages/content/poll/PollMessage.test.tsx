// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PollMedia } from '@/domain/messages/media';
import { canonicalFixture } from '../../../data/messageFixtures.test-support';
import { renderMessage } from '../../../data/messageModels';
import { MessageMenu } from '../../menu/MessageMenu';
import { PollMessage } from './PollMessage';
import { createPollAnimationClock } from './pollAnimationClock.test-support';
import {
  StructuredMessageActionsProvider,
  useStructuredMessageActions,
} from '../../StructuredMessageActions';

const RESULT_SETTLE_MS = 1600;
const POLL_CLOSE_DELAY_MS = 2000;

let animationClock: ReturnType<typeof createPollAnimationClock>;

const poll: PollMedia = {
  kind: 'poll',
  question: 'Choose a detail',
  options: [
    {
      id: 'layout',
      text: 'Layout',
      votes: 0,
    },
    {
      id: 'motion',
      text: 'Motion',
      votes: 0,
    },
  ],
};

function VotingPoll() {
  const [currentPoll, setCurrentPoll] = useState(poll);

  return (
    <PollMessage
      poll={currentPoll}
      onInteract={(interaction) => {
        if (interaction.type !== 'vote') {
          return;
        }

        setCurrentPoll({
          ...poll,
          selectedOptionIds: interaction.optionIds,
          voterCount: 1,
          options: [
            {
              id: 'layout',
              text: 'Layout',
              votes: 1,
            },
            {
              id: 'motion',
              text: 'Motion',
              votes: 0,
            },
          ],
        });
      }}
    />
  );
}

function ChangeVoteButton() {
  const { dispatch } = useStructuredMessageActions();
  return (
    <button onClick={() => dispatch({ messageId: 'poll', action: 'change-vote' })}>
      Change vote
    </button>
  );
}

beforeEach(() => {
  animationClock = createPollAnimationClock();
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});

afterEach(() => {
  cleanup();
  animationClock.restore();
  vi.unstubAllGlobals();
});

describe('poll result transitions', () => {
  it('keeps management controls off the poll while preserving its results footer', () => {
    render(
      <PollMessage
        poll={{
          ...poll,
          canEdit: true,
          canClose: true,
          canVote: true,
          selectedOptionIds: ['layout'],
          voterCount: 1,
        }}
        onInteract={vi.fn()}
      />,
    );

    expect(screen.getByText('1 member voted')).toBeTruthy();
    const management = screen.queryAllByRole('button', {
      name: /change vote|edit poll|close poll/i,
    });
    expect(management).toHaveLength(0);
  });

  it('opens public voter details from the count shown after a vote', () => {
    const publicPoll = {
      ...poll,
      shouldShowVoters: true,
      canViewVoters: true,
      voterCount: 1,
    };
    const onInteract = vi.fn();
    const view = render(<PollMessage poll={publicPoll} onInteract={onInteract} />);
    expect(screen.queryByRole('button', { name: 'View voters' })).toBeNull();

    view.rerender(
      <PollMessage
        poll={{ ...publicPoll, selectedOptionIds: ['layout'] }}
        onInteract={onInteract}
      />,
    );
    const resultsButton = screen.getByRole('button', { name: 'View voters' });
    expect(resultsButton.textContent).toBe('1 member voted');
    fireEvent.click(resultsButton);
    expect(onInteract).toHaveBeenCalledWith({ type: 'view-voters' });
  });

  it('labels an unanswered server quiz without exposing an answer', () => {
    const quiz = { ...poll, isQuiz: true };
    render(<PollMessage poll={quiz} onInteract={() => undefined} />);

    expect(screen.getByText('Anonymous Quiz')).toBeTruthy();
    expect(screen.queryByText('100%')).toBeNull();
  });

  it('reveals results progressively after voting without delaying the saved result on remount', async () => {
    const view = render(<VotingPoll />);
    fireEvent.click(screen.getByRole('button', { name: 'Layout' }));
    expect(screen.queryByText('100%')).toBeNull();

    await animationClock.advance(RESULT_SETTLE_MS);
    expect(screen.getByText('100%')).toBeTruthy();
    expect(screen.getByText('0%')).toBeTruthy();
    expect(screen.getByText('1 member voted')).toBeTruthy();
    view.unmount();

    render(
      <PollMessage
        poll={{
          ...poll,
          selectedOptionIds: ['layout'],
          voterCount: 1,
          options: [
            {
              id: 'layout',
              text: 'Layout',
              votes: 1,
            },
            {
              id: 'motion',
              text: 'Motion',
              votes: 0,
            },
          ],
        }}
        onInteract={() => {}}
      />,
    );
    expect(screen.getByText('100%')).toBeTruthy();
  });

  it('shows results immediately when reduced motion is requested', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    render(<VotingPoll />);
    fireEvent.click(screen.getByRole('button', { name: 'Layout' }));
    expect(screen.getByText('100%')).toBeTruthy();
  });

  it('keeps hidden results private after voting', () => {
    render(
      <PollMessage
        poll={{
          ...poll,
          selectedOptionIds: ['layout'],
          shouldHideResults: true,
        }}
        onInteract={() => {}}
      />,
    );
    expect(screen.queryByText(/\d+%/)).toBeNull();
    expect(screen.getByText('Results hidden until the poll closes')).toBeTruthy();
  });

  it('identifies a revealed quiz answer while keeping vote totals private', () => {
    render(
      <PollMessage
        poll={{
          ...poll,
          isQuiz: true,
          hasVisibleResults: false,
          shouldHideResults: true,
          selectedOptionIds: ['motion'],
          correctOptionIds: ['layout'],
          explanation: 'Layout was chosen for the release.',
        }}
        onInteract={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: 'Layout, correct answer' })).toBeTruthy();
    expect(screen.getByText('Layout was chosen for the release.')).toBeTruthy();
    expect(screen.queryByText(/\d+%/)).toBeNull();
  });

  it('distributes rounded percentages over selected answers without counting people twice', () => {
    render(
      <PollMessage
        poll={{
          ...poll,
          canChooseMultiple: true,
          voterCount: 1,
          // prettier-ignore
          selectedOptionIds: [
            'layout',
            'motion',
            'color'
          ],
          options: [
            {
              id: 'layout',
              text: 'Layout',
              votes: 1,
            },
            {
              id: 'motion',
              text: 'Motion',
              votes: 1,
            },
            {
              id: 'color',
              text: 'Color',
              votes: 1,
            },
          ],
        }}
        onInteract={() => {}}
      />,
    );
    expect(screen.getByText('34%')).toBeTruthy();
    expect(screen.getAllByText('33%')).toHaveLength(2);
    expect(screen.getByText('1 member voted')).toBeTruthy();
  });

  it('reveals final results if the poll closes while a replacement vote is being edited', async () => {
    render(
      <StructuredMessageActionsProvider>
        <ChangeVoteButton />
        <PollMessage
          messageId="poll"
          poll={{
            ...poll,
            selectedOptionIds: ['layout'],
            closesAt: Date.now() + POLL_CLOSE_DELAY_MS,
            options: [
              {
                id: 'layout',
                text: 'Layout',
                votes: 1,
              },
              {
                id: 'motion',
                text: 'Motion',
                votes: 0,
              },
            ],
          }}
          onInteract={() => {}}
        />
      </StructuredMessageActionsProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Change vote' }));
    expect(screen.queryByText('100%')).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Layout' }).disabled).toBe(false);

    await animationClock.advance(POLL_CLOSE_DELAY_MS - 1);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Layout' }).disabled).toBe(false);

    await animationClock.advance(1);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /^Layout,/ }).disabled).toBe(true);
    await animationClock.advance(RESULT_SETTLE_MS);
    expect(screen.getByText('100%')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /^Layout,/ }).disabled).toBe(true);
  });
});

it('drops a queued poll management request after permissions are revoked', () => {
  const onInteract = vi.fn();
  function MenuTrigger() {
    const { dispatch } = useStructuredMessageActions();
    return (
      <button onClick={() => dispatch({ messageId: 'poll', action: 'close-poll' })}>
        Request close
      </button>
    );
  }

  const card = ({ canClose }: { canClose: boolean }) => (
    <StructuredMessageActionsProvider>
      <MenuTrigger />
      <PollMessage messageId="poll" poll={{ ...poll, canClose }} onInteract={onInteract} />
    </StructuredMessageActionsProvider>
  );
  const view = render(card({ canClose: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Request close' }));
  expect(onInteract).toHaveBeenCalledWith({ type: 'close-poll' });

  onInteract.mockClear();
  view.rerender(card({ canClose: false }));
  fireEvent.click(screen.getByRole('button', { name: 'Request close' }));
  expect(onInteract).not.toHaveBeenCalled();
});

it('withdraws management items from an open menu when the poll reaches its deadline', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  const message = {
    ...renderMessage(canonicalFixture()),
    media: {
      ...poll,
      selectedOptionIds: ['layout'],
      canClose: true,
      canEdit: true,
      closesAt: Date.now() + POLL_CLOSE_DELAY_MS,
    },
  };
  const target = {
    row: document.body,
    messageId: message.id,
    point: { x: 0, y: 0 },
  };
  render(
    <MessageMenu
      contentId="poll-menu"
      target={target}
      isOpen
      message={message}
      onClose={vi.fn()}
      onExitComplete={vi.fn()}
      onCommand={vi.fn()}
      onReact={vi.fn()}
    />,
  );
  const management = () =>
    screen.queryAllByRole('menuitem', { name: /change vote|edit poll|close poll/i });
  expect(management()).toHaveLength(3);
  await animationClock.advance(POLL_CLOSE_DELAY_MS);
  expect(management()).toHaveLength(0);
  expect(screen.getByRole('menuitem', { name: 'Reply' })).toBeTruthy();
});
