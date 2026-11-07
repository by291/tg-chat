// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { get, set } from 'idb-keyval';
import { createInitialState } from '../demo/fixtures';
import { loadChatState, parseSavedState, saveChatState } from './storage';
import { chatReducer } from './reducer';
import { getConversations } from './conversations';

vi.mock('idb-keyval', () => ({ get: vi.fn(), set: vi.fn() }));

describe('saved conversations', () => {
  it('restores content without reopening the previous session selection', async () => {
    const state = createInitialState();
    state.activeChatId = 'dev';
    state.drafts.dev = 'Keep this draft';
    vi.mocked(get).mockResolvedValue(state);

    const restored = await loadChatState();

    expect(restored?.activeChatId).toBe('');
    expect(restored?.drafts.dev).toBe('Keep this draft');
    expect(restored?.messages).toEqual(state.messages);
  });

  it('restores a locally created group and its profile edits alongside existing chats', async () => {
    const group = {
      id: 'local-reading',
      title: 'Reading club',
      subtitle: '2 members',
      initials: 'R',
      color: 'blue',
      kind: 'group' as const,
      preview: '',
      time: '',
      memberIds: ['you', 'alex'],
    };
    let state = chatReducer(createInitialState(), {
      type: 'save-conversation',
      conversation: group,
    });
    state = chatReducer(state, {
      type: 'save-conversation',
      conversation: { ...group, title: 'Book club' },
    });
    state = chatReducer(state, { type: 'select-chat', chatId: group.id });
    vi.mocked(set).mockImplementation(async (_key, snapshot) => {
      vi.mocked(get).mockResolvedValue(snapshot);
    });

    await saveChatState(state);
    const restored = await loadChatState();
    expect(restored).toBeDefined();
    const catalog = getConversations(restored!);
    expect(catalog.filter((conversation) => conversation.id === group.id)).toEqual([
      { ...group, title: 'Book club' },
    ]);
    expect(catalog.some((conversation) => conversation.id === 'dev')).toBe(true);
  });

  it('retains messages and drafts when no conversation is selected', () => {
    const state = createInitialState();
    state.activeChatId = '';
    state.drafts.dev = 'Keep this draft';

    const restored = parseSavedState(state);

    expect(restored?.drafts.dev).toBe('Keep this draft');
    expect(restored?.messages).toEqual(state.messages);
  });

  it('sanitizes restored message content and drafts without dropping their formatting', () => {
    const state = createInitialState();
    const unsafeRichText =
      '<p onclick="alert(1)"><strong>Keep</strong><script>alert(1)</script></p>';
    state.messages = [{ ...state.messages[0], richText: unsafeRichText }];
    state.draftRichText = { dev: unsafeRichText };

    const restoredState = parseSavedState(state);

    expect(restoredState?.messages[0].richText).toBe('<p><strong>Keep</strong></p>');
    expect(restoredState?.draftRichText?.dev).toBe('<p><strong>Keep</strong></p>');
  });

  it('rejects timestamps outside the JavaScript date range', () => {
    const state = createInitialState();
    const messages = [{ ...state.messages[0], createdAt: 1e20 }];

    expect(parseSavedState({ ...state, messages })).toBeUndefined();
  });

  it('restores message content, image dimensions, and independent drafts', () => {
    const state = createInitialState();
    state.drafts.dev = 'Unsent thought';
    const restoredState = parseSavedState(JSON.parse(JSON.stringify(state)));

    expect(restoredState?.drafts.dev).toBe('Unsent thought');
    const attachment = restoredState?.messages.find((message) => message.attachment)?.attachment;
    expect(attachment?.width).toBe(960);
    expect(attachment?.height).toBe(600);
    expect(restoredState?.messages[0].text).toBe('A little space to build things together. 👋');
  });

  it('rejects malformed records and unknown selected conversations', () => {
    expect(parseSavedState({ messages: 'broken' })).toBeUndefined();
    expect(parseSavedState({ ...createInitialState(), activeChatId: 'missing' })).toBeUndefined();
    expect(
      parseSavedState({ ...createInitialState(), messages: [{ text: 'Incomplete' }] }),
    ).toBeUndefined();
  });
});

describe('history study upgrade', () => {
  it('adds the study history once while retaining existing edits and drafts', () => {
    const legacy = createInitialState();
    legacy.messages = legacy.messages.filter((message) => message.chatId !== 'lab');
    legacy.drafts.dev = 'Keep this draft';
    const restored = parseSavedState({ ...legacy, version: 1 });

    expect(restored?.messages.some((message) => message.chatId === 'lab')).toBe(true);
    expect(restored?.drafts.dev).toBe('Keep this draft');
    const withoutStudy = { ...restored, messages: legacy.messages };
    expect(parseSavedState(withoutStudy)?.messages).toEqual(legacy.messages);
  });
});
