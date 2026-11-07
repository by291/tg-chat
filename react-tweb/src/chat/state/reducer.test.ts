import { createInitialState } from '../demo/fixtures';
import { describe, expect, it } from 'vitest';
import { forwardMessages } from '../messages/forwardMessages';
import { parseSavedState } from './storage';
import { chatReducer } from './reducer';
import type { ChatState, Message } from '../model';

const ownMessage: Message = {
  id: 'message-1',
  chatId: 'dev',
  authorId: 'you',
  authorName: 'You',
  text: 'Original message',
  createdAt: 1000,
  reactions: [],
};

function createState(): ChatState {
  return {
    version: 1,
    activeChatId: 'dev',
    messages: [ownMessage],
    drafts: {
      dev: 'A draft',
      design: 'Another draft',
    },
    isDark: false,
  };
}

describe('conversation changes', () => {
  it('allows clearing an image caption without removing its attachment', () => {
    const state = createState();
    state.messages[0] = {
      ...ownMessage,
      attachment: {
        name: 'photo.png',
        url: '/photo.png',
        width: 200,
        height: 200,
      },
    };
    const nextState = chatReducer(state, {
      type: 'edit',
      chatId: 'dev',
      messageId: 'message-1',
      text: '',
    });

    expect(nextState.messages[0].text).toBe('');
    expect(nextState.messages[0].attachment?.name).toBe('photo.png');
  });

  it('preserves an unsent text draft when a sticker is sent independently', () => {
    const nextState = chatReducer(createState(), {
      type: 'send',
      message: {
        ...ownMessage,
        id: 'sticker-message',
        text: '',
        sticker: '👋',
      },
    });

    expect(nextState.messages.at(-1)?.sticker).toBe('👋');
    expect(nextState.drafts.dev).toBe('A draft');
  });

  it('appends a sent message and clears only its conversation draft', () => {
    const state = createState();
    const message = {
      ...ownMessage,
      id: 'message-2',
      text: 'Hello',
    };
    const nextState = chatReducer(state, { type: 'send', message });

    expect(nextState.messages.map((entry) => entry.text)).toEqual(['Original message', 'Hello']);
    expect(nextState.drafts).toEqual({ dev: '', design: 'Another draft' });
    expect(state.messages).toHaveLength(1);
  });

  it('rejects empty messages but accepts an image without a caption', () => {
    const state = createState();
    const emptyMessage = {
      ...ownMessage,
      id: 'empty',
      text: ' \n ',
    };
    expect(chatReducer(state, { type: 'send', message: emptyMessage })).toEqual(state);

    const imageMessage = {
      ...emptyMessage,
      attachment: {
        name: 'example.png',
        url: '/example.png',
        width: 400,
        height: 300,
      },
    };
    const nextState = chatReducer(state, { type: 'send', message: imageMessage });
    expect(nextState.messages.at(-1)?.attachment?.name).toBe('example.png');
  });

  it('preserves drafts when switching between conversations', () => {
    const nextState = chatReducer(createState(), { type: 'select-chat', chatId: 'design' });

    expect(nextState.activeChatId).toBe('design');
    expect(nextState.drafts.dev).toBe('A draft');
  });

  it('edits only an owned message in the requested conversation', () => {
    const state = createState();
    const wrongChat = chatReducer(state, {
      type: 'edit',
      chatId: 'design',
      messageId: 'message-1',
      text: 'Wrong chat',
    });
    expect(wrongChat.messages[0].text).toBe('Original message');

    const nextState = chatReducer(state, {
      type: 'edit',
      chatId: 'dev',
      messageId: 'message-1',
      text: 'Updated message',
    });
    expect(nextState.messages[0].text).toBe('Updated message');
    expect(nextState.messages[0].isEdited).toBe(true);
  });

  it('does not erase an existing message with a blank edit', () => {
    const state = createState();
    const nextState = chatReducer(state, {
      type: 'edit',
      chatId: 'dev',
      messageId: 'message-1',
      text: '   ',
    });
    expect(nextState.messages[0].text).toBe('Original message');
  });

  it('toggles a reaction without duplicating it', () => {
    const action = {
      type: 'react' as const,
      chatId: 'dev',
      messageId: 'message-1',
      emoji: '👍',
    };
    const reactedState = chatReducer(createState(), action);
    expect(reactedState.messages[0].reactions).toEqual(['👍']);

    const nextState = chatReducer(reactedState, action);
    expect(nextState.messages[0].reactions).toEqual([]);
  });

  it('preserves replies when their source message is deleted', () => {
    const state = createState();
    state.messages.push({
      ...ownMessage,
      id: 'reply',
      text: 'A reply',
      replyToId: ownMessage.id,
    });
    const nextState = chatReducer(state, {
      type: 'delete',
      chatId: 'dev',
      messageId: 'message-1',
    });

    expect(nextState.messages).toHaveLength(1);
    expect(nextState.messages[0].text).toBe('A reply');
    expect(nextState.messages[0].replyToId).toBe('message-1');
  });
});

describe('local poll voting', () => {
  it('moves a vote between options without counting duplicate selections', () => {
    const initial = createInitialState();
    const pollMessage = {
      ...initial.messages[0],
      media: {
        kind: 'poll' as const,
        question: 'Which layout?',
        options: [
          { id: 'compact', text: 'Compact', votes: 3 },
          { id: 'spacious', text: 'Spacious', votes: 2 },
        ],
      },
    };
    const state = { ...initial, messages: [pollMessage] };
    const vote = {
      type: 'vote' as const,
      chatId: pollMessage.chatId,
      messageId: pollMessage.id,
      optionId: 'compact',
    };
    const firstVote = chatReducer(state, vote);
    const repeatedVote = chatReducer(firstVote, vote);
    const changedVote = chatReducer(repeatedVote, { ...vote, optionId: 'spacious' });

    expect(changedVote.messages[0].media).toMatchObject({
      selectedOptionId: 'spacious',
      options: [
        { id: 'compact', votes: 3 },
        { id: 'spacious', votes: 3 },
      ],
    });
    expect(chatReducer(state, { ...vote, optionId: 'missing' }).messages).toEqual(state.messages);
  });
});

describe('custom emoji message identity', () => {
  it('keeps emoji ranges aligned through draft restore, sending, editing and forwarding', () => {
    const documentId = '5249007745805328497';
    const original = createState();
    const draft = chatReducer(original, {
      type: 'set-draft',
      chatId: 'dev',
      text: '  Hi 😂  ',
      customEmoji: [{ documentId, offset: 5, length: 2 }],
    });
    const restored = parseSavedState(JSON.parse(JSON.stringify({ ...draft, version: 2 })));
    expect(restored?.draftCustomEmoji?.dev).toEqual([{ documentId, offset: 5, length: 2 }]);

    const sent = chatReducer(draft, {
      type: 'send',
      message: {
        ...ownMessage,
        id: 'custom-message',
        text: draft.drafts.dev,
        customEmoji: draft.draftCustomEmoji?.dev,
      },
    });
    expect(sent.messages.at(-1)?.text).toBe('Hi 😂');
    expect(sent.messages.at(-1)?.customEmoji).toEqual([{ documentId, offset: 3, length: 2 }]);
    expect(sent.draftCustomEmoji?.dev).toEqual([]);

    const edited = chatReducer(sent, {
      type: 'edit',
      chatId: 'dev',
      messageId: 'custom-message',
      text: '  New 😂  ',
      customEmoji: [{ documentId, offset: 6, length: 2 }],
    });
    const source = edited.messages.find((message) => message.id === 'custom-message');
    expect(source?.customEmoji).toEqual([{ documentId, offset: 4, length: 2 }]);
    if (!source) {
      throw new Error('Expected the edited message to remain available.');
    }
    let forwarded = edited;
    forwardMessages({
      messages: [source],
      chatId: 'design',
      dispatch: (action) => {
        forwarded = chatReducer(forwarded, action);
      },
    });
    expect(forwarded.messages.at(-1)?.customEmoji).toEqual(source.customEmoji);
    expect(forwarded.messages.at(-1)?.text).toBe('New 😂');
    expect(forwarded.drafts.design).toBe('Another draft');
  });
});
