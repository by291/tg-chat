// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createInitialState } from '../../chat/demo/fixtures';
import type { Message } from '../../chat/model';
import { useMessageNotifications } from './useMessageNotifications';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  setNotificationPreferences,
} from './notificationPreferences';

const delivered: FakeNotification[] = [];

class FakeNotification {
  static permission = 'granted';
  onclick?: () => void;
  isClosed = false;

  constructor(
    public title: string,
    public options: NotificationOptions,
  ) {
    delivered.push(this);
  }

  close() {
    this.isClosed = true;
  }
}

const incoming: Message = {
  id: 'incoming-alert',
  chatId: 'dev',
  authorId: 'alex',
  authorName: 'Alex',
  text: 'New arrival',
  createdAt: 100,
  reactions: [],
};

beforeEach(() => {
  delivered.length = 0;
  FakeNotification.permission = 'granted';
  vi.stubGlobal('Notification', FakeNotification);
  vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  vi.spyOn(window, 'focus').mockImplementation(() => {});
  setNotificationPreferences({
    ...structuredClone(DEFAULT_NOTIFICATION_PREFERENCES),
    shouldPlaySound: false,
    shouldPlaySentSound: false,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('skips restored history and edits, then opens the chat from a new notification', () => {
  const restored = { ...createInitialState(), messages: [incoming] };
  const onOpen = vi.fn();
  const { rerender } = renderHook(
    ({ state, isReady }) =>
      useMessageNotifications({ state, isReady, isConversationVisible: false, onOpen }),
    { initialProps: { state: restored, isReady: false } },
  );
  rerender({ state: restored, isReady: true });
  expect(delivered).toHaveLength(0);
  const message = { ...incoming, id: 'next-alert' };
  const updated = { ...restored, messages: [...restored.messages, message] };
  rerender({ state: updated, isReady: true });
  expect(delivered).toHaveLength(1);
  expect(delivered[0].options.body).toBe('Alex: New arrival');
  rerender({ state: { ...updated, drafts: { dev: 'typing' } }, isReady: true });
  expect(delivered).toHaveLength(1);
  act(() => delivered[0].onclick?.());
  expect(onOpen).toHaveBeenCalledWith('dev');
  expect(delivered[0].isClosed).toBe(true);
});

it('does not show desktop notifications without permission or when disabled', () => {
  FakeNotification.permission = 'denied';
  const initial = { ...createInitialState(), messages: [] as Message[] };
  const { rerender } = renderHook(
    ({ state }) =>
      useMessageNotifications({
        state,
        isReady: true,
        isConversationVisible: false,
        onOpen: () => {},
      }),
    { initialProps: { state: initial } },
  );
  rerender({ state: { ...initial, messages: [incoming] } });
  expect(delivered).toHaveLength(0);
  FakeNotification.permission = 'granted';
  act(() => setNotificationPreferences({ shouldShowNotifications: false }));
  rerender({ state: { ...initial, messages: [incoming, { ...incoming, id: 'disabled-alert' }] } });
  expect(delivered).toHaveLength(0);
});

it('dismisses an unread alert when its chat becomes visible again', () => {
  const initial = { ...createInitialState(), activeChatId: 'dev', messages: [] as Message[] };
  const { rerender } = renderHook(
    ({ state }) =>
      useMessageNotifications({
        state,
        isReady: true,
        isConversationVisible: true,
        onOpen: () => {},
      }),
    { initialProps: { state: initial } },
  );
  rerender({ state: { ...initial, messages: [incoming] } });
  expect(delivered[0].isClosed).toBe(false);

  vi.mocked(document.hasFocus).mockReturnValue(true);
  act(() => window.dispatchEvent(new Event('focus')));
  expect(delivered[0].isClosed).toBe(true);
});
