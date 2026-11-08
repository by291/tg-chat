// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { createInitialState } from '../../chat/demo/fixtures';
import type { Message } from '../../chat/model';
import { DEFAULT_NOTIFICATION_PREFERENCES } from './notificationPreferences';
import { resolveMessageNotification } from './notificationPolicy';

const message: Message = {
  id: 'notification-message',
  chatId: 'dev',
  authorId: 'alex',
  authorName: 'Alex',
  text: 'A new message',
  createdAt: 100,
  reactions: [],
};

function resolve(overrides: Partial<Parameters<typeof resolveMessageNotification>[0]> = {}) {
  return resolveMessageNotification({
    state: createInitialState(),
    preferences: DEFAULT_NOTIFICATION_PREFERENCES,
    message,
    isChatVisible: false,
    now: 200,
    ...overrides,
  });
}

it('suppresses self messages, service messages, and the chat being read', () => {
  expect(resolve({ message: { ...message, authorId: 'you' } })).toBeUndefined();
  expect(resolve({ message: { ...message, isService: true } })).toBeUndefined();
  expect(resolve({ isChatVisible: true })).toBeUndefined();
});

it('honors category switches and hides message text when previews are disabled', () => {
  const preferences = structuredClone(DEFAULT_NOTIFICATION_PREFERENCES);
  preferences.group.shouldNotify = false;
  expect(resolve({ preferences })).toBeUndefined();
  preferences.group.shouldNotify = true;
  preferences.group.shouldShowPreview = false;
  expect(resolve({ preferences })?.body).toBe('New message');
  expect(resolve()?.body).toContain('A new message');
});

it('respects individual mute deadlines and excludes deleted conversations', () => {
  const state = createInitialState();
  state.conversationPreferences = { dev: { isMuted: true, mutedUntil: 300 } };
  expect(resolve({ state, now: 200 })).toBeUndefined();
  expect(resolve({ state, now: 301 })?.body).toContain('A new message');
  state.conversationPreferences.dev = { isDeleted: true };
  expect(resolve({ state })).toBeUndefined();
});
