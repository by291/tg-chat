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
  it('keeps personal preferences available without granting subscriber management', () => {
    render(
      <ConversationControls
        conversation={conversationFixture({ kind: 'channel', can_manage: false })}
        onCommand={vi.fn()}
        onConfirm={vi.fn()}
        onError={vi.fn()}
        onPins={vi.fn()}
      />,
    );
    expect(screen.getByRole('combobox', { hidden: true }).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByText('Close conversation')).toBeNull();
    expect(screen.getByText('Clear history')).toBeTruthy();
    expect(screen.getByText('Archive')).toBeTruthy();
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
});
