import { describe, expect, it } from 'vitest';
import { chatReducer } from './reducer';
import type { ChatState, Message } from './model';

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
