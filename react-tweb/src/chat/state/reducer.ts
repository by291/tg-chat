import { applyPollVote } from './pollVoting';
import {
  clearConversations,
  reorderPinnedConversations,
  updateConversations,
} from './conversationActions';
import { CURRENT_USER_ID, type ChatAction, type ChatState, type Message } from '../model';

type MessageChange = Extract<ChatAction, { messageId: string }>;

function updateMessage(message: Message, action: MessageChange): Message {
  const isTarget = message.id === action.messageId && message.chatId === action.chatId;
  if (!isTarget) {
    return message;
  }

  if (action.type === 'vote') {
    return applyPollVote(message, action.optionId);
  }

  if (action.type === 'edit') {
    const hasContent =
      action.text.trim().length > 0 || Boolean(message.attachment || message.media);
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
    case 'reorder-pinned-conversations':
      return reorderPinnedConversations({ state, chatIds: action.chatIds });
    case 'update-conversations':
      return updateConversations({
        state,
        chatIds: action.chatIds,
        changes: action.changes,
      });
    case 'clear-conversations':
      return clearConversations({
        state,
        chatIds: action.chatIds,
        mode: action.mode,
      });
    case 'restore':
      return action.state;
    case 'select-chat': {
      const nextState = updateConversations({
        state,
        chatIds: [action.chatId],
        changes: {
          unreadCount: 0,
          isMarkedUnread: false,
          isDeleted: false,
        },
      });
      return { ...nextState, activeChatId: action.chatId };
    }
    case 'toggle-theme':
      return { ...state, isDark: !state.isDark };
    case 'set-draft':
      return {
        ...state,
        drafts: { ...state.drafts, [action.chatId]: action.text },
      };
    case 'send': {
      const message = action.message;
      const hasContent =
        message.text.trim() || message.attachment || message.sticker || message.media;
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
    case 'vote':
      return {
        ...state,
        messages: state.messages.map((message) => updateMessage(message, action)),
      };
  }
}
