import { describe, expect, it } from 'vitest';
import { createInitialState } from './fixtures';
import { parseSavedState } from './storage';

describe('saved conversations', () => {
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
