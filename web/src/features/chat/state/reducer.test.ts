// @vitest-environment jsdom

import { createInitialState } from '../demo/fixtures';
import { describe, expect, it } from 'vitest';
import { forwardMessages } from '../messages/forwarding/forwardMessages';
import { parseSavedState } from './storage';
import { chatReducer } from './reducer';
import type { ChatState } from '@/features/chat/state/chatState';
import type { Message } from '@/domain/messages/message';

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
  it('clears navigation without creating preferences for an empty conversation', () => {
    const state = createState();
    const cleared = chatReducer(state, { type: 'select-chat', chatId: '' });
    expect(cleared.activeChatId).toBe('');
    expect(cleared.conversationPreferences).toEqual(state.conversationPreferences);
    expect(cleared.drafts.dev).toBe('A draft');
  });

  it('applies an explicit pin state without reversing an already confirmed change', () => {
    const pinAction = {
      type: 'pin' as const,
      chatId: 'dev',
      messageId: ownMessage.id,
      isPinned: true,
    };
    const pinned = chatReducer(createState(), pinAction);
    const repeated = chatReducer(pinned, pinAction);
    expect(repeated.messages[0].isPinned).toBe(true);
    const unpinned = chatReducer(repeated, { ...pinAction, isPinned: false });
    expect(unpinned.messages[0].isPinned).toBe(false);
  });

  it('accepts structural rich messages and structural edits without plain fallback text', () => {
    const sent = chatReducer(createState(), {
      type: 'send',
      message: {
        ...ownMessage,
        id: 'divider',
        text: '',
        richText: '<hr>',
      },
    });
    expect(sent.messages.at(-1)?.richText).toBe('<hr>');

    const edited = chatReducer(sent, {
      type: 'edit',
      chatId: 'dev',
      messageId: ownMessage.id,
      text: '',
      richText: '<hr>',
    });
    expect(edited.messages[0].richText).toBe('<hr>');
  });

  it('restores formatted drafts and consumes formatting only when the draft is sent', () => {
    const richText = '<p><strong>Original message</strong></p>';
    const draft = chatReducer(createState(), {
      type: 'set-draft',
      chatId: 'dev',
      text: ownMessage.text,
      richText,
    });
    const restored = parseSavedState({ ...draft, version: 2 });
    expect(restored?.draftRichText?.dev).toBe(richText);

    const sent = chatReducer(draft, {
      type: 'send',
      message: {
        ...ownMessage,
        id: 'formatted',
        richText,
      },
    });
    expect(sent.messages.at(-1)?.richText).toBe(richText);
    expect(sent.draftRichText?.dev).toBe('');
  });

  it('applies formatting-only edits and can remove previous formatting', () => {
    const formatted = chatReducer(createState(), {
      type: 'edit',
      chatId: 'dev',
      messageId: ownMessage.id,
      text: ownMessage.text,
      richText: '<p><em>Original message</em></p>',
    });
    expect(formatted.messages[0].richText).toBe('<p><em>Original message</em></p>');
    expect(formatted.messages[0].isEdited).toBe(true);

    const plain = chatReducer(formatted, {
      type: 'edit',
      chatId: 'dev',
      messageId: ownMessage.id,
      text: ownMessage.text,
    });
    expect(plain.messages[0].richText).toBeUndefined();
  });

  it.each([
    { caption: 'Context', captionRichText: '<p><u>Context</u></p>' },
    { caption: '', captionRichText: '<hr>' },
  ])(
    'forwards formatted content without consuming the recipient draft',
    ({ caption, captionRichText }) => {
      const richText = '<p><strong>Original message</strong></p>';
      let state: ChatState = {
        ...createState(),
        draftRichText: { design: '<p>Another draft</p>' },
      };
      forwardMessages({
        messages: [{ ...ownMessage, richText }],
        chatId: 'design',
        caption,
        richText: captionRichText,
        dispatch: (action) => {
          state = chatReducer(state, action);
        },
      });

      expect(state.messages.at(-2)?.richText).toBe(captionRichText);
      expect(state.messages.at(-1)?.richText).toBe(richText);
      expect(state.draftRichText?.design).toBe('<p>Another draft</p>');
    },
  );

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
          {
            id: 'compact',
            text: 'Compact',
            votes: 3,
          },
          {
            id: 'spacious',
            text: 'Spacious',
            votes: 2,
          },
        ],
      },
    };
    const state = { ...initial, messages: [pollMessage] };
    const vote = {
      type: 'interact' as const,
      chatId: pollMessage.chatId,
      messageId: pollMessage.id,
      interaction: { type: 'vote' as const, optionIds: ['compact'] },
    };
    const firstVote = chatReducer(state, vote);
    const repeatedVote = chatReducer(firstVote, vote);
    const changedVote = chatReducer(repeatedVote, {
      ...vote,
      interaction: { type: 'vote', optionIds: ['spacious'] },
    });

    expect(changedVote.messages[0].media).toMatchObject({
      selectedOptionId: 'spacious',
      options: [
        { id: 'compact', votes: 3 },
        { id: 'spacious', votes: 3 },
      ],
    });
    expect(
      chatReducer(state, { ...vote, interaction: { type: 'vote', optionIds: ['missing'] } })
        .messages,
    ).toEqual(state.messages);
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
      customEmoji: [
        {
          documentId,
          offset: 5,
          length: 2,
        },
      ],
    });
    const restored = parseSavedState(JSON.parse(JSON.stringify({ ...draft, version: 2 })));
    expect(restored?.draftCustomEmoji?.dev).toEqual([
      {
        documentId,
        offset: 5,
        length: 2,
      },
    ]);

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
    expect(sent.messages.at(-1)?.customEmoji).toEqual([
      {
        documentId,
        offset: 3,
        length: 2,
      },
    ]);
    expect(sent.draftCustomEmoji?.dev).toEqual([]);

    const edited = chatReducer(sent, {
      type: 'edit',
      chatId: 'dev',
      messageId: 'custom-message',
      text: '  New 😂  ',
      customEmoji: [
        {
          documentId,
          offset: 6,
          length: 2,
        },
      ],
    });
    const source = edited.messages.find((message) => message.id === 'custom-message');
    expect(source?.customEmoji).toEqual([
      {
        documentId,
        offset: 4,
        length: 2,
      },
    ]);
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

describe('structured message interactions', () => {
  it('saves a complete multi-answer vote and rejects revoting when disabled', () => {
    const state = createState();
    state.messages[0].media = {
      kind: 'poll',
      question: 'Pick two',
      options: [
        {
          id: 'first',
          text: 'First',
          votes: 0,
        },
        {
          id: 'second',
          text: 'Second',
          votes: 0,
        },
      ],
      canChooseMultiple: true,
      canRevote: false,
    };
    const action = {
      type: 'interact' as const,
      chatId: 'dev',
      messageId: ownMessage.id,
      interaction: { type: 'vote' as const, optionIds: ['first', 'second'] },
    };
    const voted = chatReducer(state, action);
    expect(voted.messages[0].media).toMatchObject({
      selectedOptionIds: ['first', 'second'],
      options: [{ votes: 1 }, { votes: 1 }],
    });
    const revised = chatReducer(voted, {
      ...action,
      interaction: { type: 'vote', optionIds: ['second'] },
    });
    expect(revised.messages).toEqual(voted.messages);
  });

  it('rejects a vote after the poll deadline', () => {
    const state = createState();
    state.messages[0].media = {
      kind: 'poll',
      question: 'Closed',
      options: [
        {
          id: 'first',
          text: 'First',
          votes: 0,
        },
        {
          id: 'second',
          text: 'Second',
          votes: 0,
        },
      ],
      closesAt: 1,
    };
    const next = chatReducer(state, {
      type: 'interact',
      chatId: 'dev',
      messageId: ownMessage.id,
      interaction: { type: 'vote', optionIds: ['first'] },
    });
    expect(next.messages).toEqual(state.messages);
  });

  it('enforces checklist permissions for another author and preserves completed tasks', () => {
    const state = createState();
    state.messages[0].authorId = 'mia';
    state.messages[0].media = {
      kind: 'checklist',
      title: 'Release',
      items: [
        {
          id: 'ship',
          text: 'Ship',
          isCompleted: false,
        },
      ],
      canOthersComplete: false,
      canOthersAppend: true,
    };
    const action = {
      type: 'interact' as const,
      chatId: 'dev',
      messageId: ownMessage.id,
      interaction: { type: 'toggle-task' as const, taskId: 'ship' },
    };
    expect(chatReducer(state, action).messages).toEqual(state.messages);
    state.messages[0].media.canOthersComplete = true;
    const completed = chatReducer(state, action);
    const restored = parseSavedState(completed);
    expect(restored?.messages[0].media).toMatchObject({
      kind: 'checklist',
      items: [
        {
          id: 'ship',
          isCompleted: true,
          completedBy: { id: 'you', name: 'You' },
        },
      ],
      canOthersAppend: true,
    });
    const uncompleted = chatReducer(completed, action);
    const checklist = uncompleted.messages[0].media;
    expect(checklist?.kind === 'checklist' && checklist.items[0].isCompleted).toBe(false);
    expect(checklist?.kind === 'checklist' && checklist.items[0].completedBy).toBeUndefined();
  });
});
