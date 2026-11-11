// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PollMedia } from '@/domain/messages/media';
import { PollMessage } from './PollMessage';
import {
  StructuredMessageActionsProvider,
  useStructuredMessageActions,
} from '../../StructuredMessageActions';

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
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('poll result transitions', () => {
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

    expect(await screen.findByText('100%', {}, { timeout: 2000 })).toBeTruthy();
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
            closesAt: Date.now() + 2000,
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

    expect(await screen.findByText('100%', {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /^Layout,/ }).disabled).toBe(true);
  });
});
