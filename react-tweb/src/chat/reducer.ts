import { CURRENT_USER_ID, type ChatAction, type ChatState, type Message } from './model';

type MessageChange = Extract<ChatAction, { messageId: string }>;

function updateMessage(message: Message, action: MessageChange): Message {
  const isTarget = message.id === action.messageId && message.chatId === action.chatId;
  if (!isTarget) {
    return message;
  }

  if (action.type === 'edit') {
    const hasContent = action.text.trim().length > 0 || Boolean(message.attachment);
    const canEdit = message.authorId === CURRENT_USER_ID && hasContent;
    if (!canEdit) {
      return message;
    }

    return { ...message, text: action.text.trim(), isEdited: true };
  }

  if (action.type === 'pin') {
    return { ...message, isPinned: !message.isPinned };
  }

  if (action.type === 'react') {
    const hasReaction = message.reactions.includes(action.emoji);
    const reactions = hasReaction
      ? message.reactions.filter((emoji) => emoji !== action.emoji)
      : [...message.reactions, action.emoji];

    return { ...message, reactions };
  }

  return message;
}

/** Apply one conversation action without mutating the previous state. */
export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'restore':
      return action.state;
    case 'select-chat':
      return { ...state, activeChatId: action.chatId };
    case 'toggle-theme':
      return { ...state, isDark: !state.isDark };
    case 'set-draft':
      return {
        ...state,
        drafts: { ...state.drafts, [action.chatId]: action.text },
      };
    case 'send': {
      const message = action.message;
      const hasContent = message.text.trim() || message.attachment || message.sticker;
      const isDuplicate = state.messages.some((entry) => entry.id === message.id);
      if (!hasContent || isDuplicate) {
        return state;
      }

      return {
        ...state,
        messages: [...state.messages, { ...message, text: message.text.trim() }],
        drafts: message.sticker ? state.drafts : { ...state.drafts, [message.chatId]: '' },
      };
    }
    case 'delete':
      return {
        ...state,
        messages: state.messages.filter((message) => {
          return message.id !== action.messageId || message.chatId !== action.chatId;
        }),
      };
    case 'edit':
    case 'react':
    case 'pin':
      return {
        ...state,
        messages: state.messages.map((message) => updateMessage(message, action)),
      };
  }
}
