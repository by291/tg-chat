// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Message } from '@/domain/messages/message';
import { createInitialState } from '../demo/fixtures';
import { forwardMessages } from '../messages/forwarding/forwardMessages';
import { chatReducer } from './reducer';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const AUTO_DELETE_DAYS = 7;
const source: Message = {
  id: 'source',
  chatId: 'dev',
  authorId: 'alex',
  authorName: 'Alex',
  text: 'First message',
  createdAt: 1000,
  reactions: ['👍'],
  isPinned: true,
  replyToId: 'earlier',
};

describe('message batches', () => {
  it('deletes selected messages only in their conversation and preserves replies', () => {
    const reply = {
      ...source,
      id: 'reply',
      replyToId: source.id,
    };
    const otherConversation = { ...source, chatId: 'design' };
    const initial = {
      ...createInitialState(),
      // prettier-ignore
      messages: [
        source,
        { ...source, id: 'second' },
        reply,
        otherConversation,
      ],
    };

    const next = chatReducer(initial, {
      type: 'delete-messages',
      chatId: 'dev',
      // prettier-ignore
      messageIds: [
        source.id,
        'second',
        source.id,
        'missing',
      ],
    });

    expect(next.messages).toEqual([reply, otherConversation]);
    expect(initial.messages).toHaveLength(4);
  });

  it('accepts valid forwards in order, rejects duplicates, and preserves recipient drafts', () => {
    const initial = {
      ...createInitialState(),
      messages: [source],
      drafts: { design: 'Unsent draft' },
      draftRichText: { design: '<p>Unsent draft</p>' },
      draftCustomEmoji: { design: [] },
      conversationPreferences: { design: { autoDeleteDays: AUTO_DELETE_DAYS } },
    };
    const next = chatReducer(initial, {
      type: 'forward-messages',
      messages: [
        source,
        {
          ...source,
          id: 'empty',
          text: '  ',
        },
        {
          ...source,
          id: 'first',
          chatId: 'design',
          text: '  Accepted  ',
        },
        {
          ...source,
          id: 'first',
          text: 'Duplicate inside the batch',
        },
        {
          ...source,
          id: 'second',
          chatId: 'design',
          text: '',
          richText: '<hr>',
        },
      ],
    });

    // prettier-ignore
    expect(next.messages.map((message) => message.id)).toEqual([
      source.id,
      'first',
      'second',
    ]);
    expect(next.messages[1].text).toBe('Accepted');
    expect(next.messages[1].expiresAt).toBe(
      source.createdAt + AUTO_DELETE_DAYS * MILLISECONDS_PER_DAY,
    );
    expect(next.messages[2].richText).toBe('<hr>');
    expect(next.drafts).toEqual(initial.drafts);
    expect(next.draftRichText).toEqual(initial.draftRichText);
    expect(next.draftCustomEmoji).toEqual(initial.draftCustomEmoji);
    expect(initial.messages).toEqual([source]);
  });

  it('places the caption before independent copies without carrying source message state', () => {
    const initial = { ...createInitialState(), messages: [source] };
    let state = initial;

    forwardMessages({
      messages: [
        source,
        {
          ...source,
          id: 'second',
          text: 'Second message',
        },
      ],
      chatId: 'design',
      caption: 'Context',
      dispatch: (action) => {
        state = chatReducer(state, action);
      },
    });

    const copies = state.messages.slice(1);
    expect(copies.map((message) => message.text)).toEqual([
      'Context',
      'First message',
      'Second message',
    ]);
    expect(new Set(state.messages.map((message) => message.id)).size).toBe(4);
    for (const copy of copies) {
      expect(copy.chatId).toBe('design');
      expect(copy.isPinned).toBeUndefined();
      expect(copy.replyToId).toBeUndefined();
      expect(copy.reactions).toEqual([]);
    }
    expect(copies[1].forwardedFrom).toBe('Alex');
    expect(initial.messages).toEqual([source]);
  });
});
