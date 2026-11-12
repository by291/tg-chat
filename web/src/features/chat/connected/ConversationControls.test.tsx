// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { conversationFixture } from '../data/messageFixtures.test-support';
import { ConversationControls } from './ConversationControls';
import { ConnectedConversationRow } from './ConnectedConversationRow';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('connected conversation actions', () => {
  it('starts message selection from the community report entry', async () => {
    const onReport = vi.fn();
    render(
      <ConversationControls
        conversation={conversationFixture({ kind: 'channel', can_manage: false })}
        onCommand={vi.fn()}
        onConfirm={vi.fn()}
        onError={vi.fn()}
        onPins={vi.fn()}
        onReport={onReport}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Conversation options' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Report channel' }));
    expect(onReport).toHaveBeenCalledOnce();
  });

  it('offers personal actions in the header without granting subscriber management', async () => {
    render(
      <ConversationControls
        conversation={conversationFixture({ kind: 'channel', can_manage: false })}
        onCommand={vi.fn()}
        onConfirm={vi.fn()}
        onError={vi.fn()}
        onPins={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Conversation options' }));
    expect(await screen.findByRole('menuitem', { name: 'Clear history' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Close conversation' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Auto-delete messages' })).toBeNull();
  });

  it('marks all current unread messages read from the row without opening the chat', async () => {
    const onOpen = vi.fn();
    const onCommand = vi.fn();
    const conversation = conversationFixture({
      last_sequence: '12',
      read_through: '4',
      unread_count: '8',
    });

    render(
      <ConnectedConversationRow
        conversation={conversation}
        name="Ava"
        isSelected={false}
        onOpen={onOpen}
        onCommand={onCommand}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Conversation actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Mark as read' }));

    await waitFor(() => {
      expect(onCommand).toHaveBeenCalledWith({ kind: 'read', through: '12' });
    });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('applies an auto-delete period from the chat header menu', async () => {
    const onCommand = vi.fn().mockResolvedValue(undefined);
    render(
      <ConversationControls
        conversation={conversationFixture({ kind: 'direct', can_manage: true, expiry_days: 1 })}
        onCommand={onCommand}
        onConfirm={vi.fn()}
        onError={vi.fn()}
        onPins={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Conversation options' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Auto-delete messages' }));
    const week = await screen.findByRole('menuitemradio', { name: 'After 7 days' });
    await userEvent.click(week);

    await waitFor(() => {
      expect(onCommand).toHaveBeenCalledWith({ kind: 'expiry', days: 7 });
    });
  });
});
