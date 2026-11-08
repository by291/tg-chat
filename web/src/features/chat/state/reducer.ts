import { trimEmojiText } from '@/domain/messages/customEmoji';
import { sanitizeRichText } from '@/domain/messages/richText';
import { applyMessageInteraction } from './messageInteractions';
import { receiveMessage } from './incomingMessages';
import {
  clearConversations,
  reorderPinnedConversations,
  updateConversations,
} from './conversationActions';
import { CURRENT_USER_ID } from '@/domain/identity';
import { type ChatAction } from '@/features/chat/state/chatActions';
import { type ChatState } from '@/features/chat/state/chatState';
import { type Message } from '@/domain/messages/message';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

type MessageChange = Extract<ChatAction, { messageId: string }>;

function assignMessageExpiration({ state, message }: { state: ChatState; message: Message }) {
  const autoDeleteDays = state.conversationPreferences?.[message.chatId]?.autoDeleteDays;
  // Keep old history untouched; each new message captures the timer active when it arrives.
  const expiresAt = autoDeleteDays
    ? message.createdAt + autoDeleteDays * MILLISECONDS_PER_DAY
    : undefined;
  return { ...message, expiresAt };
}

function prepareOutgoingMessages({
  state,
  messages,
}: {
  state: ChatState;
  messages: Message[];
}): Message[] {
  const knownIds = new Set(state.messages.map((message) => message.id));
  const acceptedMessages: Message[] = [];

  for (const message of messages) {
    if (knownIds.has(message.id)) {
      continue;
    }
    const content = trimEmojiText(message);
    const hasContent = Boolean(
      content.text || content.richText || message.attachment || message.sticker || message.media,
    );
    if (!hasContent) {
      continue;
    }

    knownIds.add(message.id);
    acceptedMessages.push({
      ...assignMessageExpiration({ state, message }),
      ...content,
    });
  }

  return acceptedMessages;
}

function deleteMessages({
  state,
  chatId,
  messageIds,
}: {
  state: ChatState;
  chatId: string;
  messageIds: string[];
}): ChatState {
  const selectedIds = new Set(messageIds);
  const messages = state.messages.filter((message) => {
    return message.chatId !== chatId || !selectedIds.has(message.id);
  });

  return messages.length === state.messages.length ? state : { ...state, messages };
}

function updateMessage(message: Message, action: MessageChange): Message {
  const isTarget = message.id === action.messageId && message.chatId === action.chatId;
  if (!isTarget) {
    return message;
  }

  if (action.type === 'interact') {
    return applyMessageInteraction(message, action.interaction);
  }

  if (action.type === 'edit') {
    const content = trimEmojiText(action);
    const hasContent = Boolean(
      content.text || content.richText || message.attachment || message.media,
    );
    const canEdit = message.authorId === CURRENT_USER_ID && hasContent;
    if (!canEdit) {
      return message;
    }

    return {
      ...message,
      ...content,
      isEdited: true,
    };
  }

  if (action.type === 'pin') {
    return { ...message, isPinned: action.isPinned };
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
    case 'save-conversation': {
      const remainingConversations = (state.localConversations ?? []).filter(
        (conversation) => conversation.id !== action.conversation.id,
      );
      return {
        ...state,
        localConversations: [action.conversation, ...remainingConversations],
      };
    }
    case 'expire-messages': {
      const messages = state.messages.filter((message) => {
        return !message.expiresAt || message.expiresAt > action.now;
      });
      if (messages.length === state.messages.length) {
        return state;
      }
      return { ...state, messages };
    }
    case 'update-archive-preferences':
      return {
        ...state,
        archivePreferences: { ...state.archivePreferences, ...action.changes },
      };
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
      if (!action.chatId) {
        return { ...state, activeChatId: '' };
      }
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
        draftRichText: {
          ...state.draftRichText,
          [action.chatId]: sanitizeRichText(action.richText ?? ''),
        },
        draftCustomEmoji: {
          ...state.draftCustomEmoji,
          [action.chatId]: action.customEmoji ?? [],
        },
      };
    case 'forward-messages':
    case 'forward': {
      const messages = action.type === 'forward-messages' ? action.messages : [action.message];
      const acceptedMessages = prepareOutgoingMessages({ state, messages });
      if (!acceptedMessages.length) {
        return state;
      }

      // The recipient's saved draft belongs to its composer, not the forwarding dialog.
      return { ...state, messages: [...state.messages, ...acceptedMessages] };
    }
    case 'send': {
      const [message] = prepareOutgoingMessages({ state, messages: [action.message] });
      if (!message) {
        return state;
      }

      const shouldPreserveDraft = Boolean(message.sticker);
      const drafts = shouldPreserveDraft ? state.drafts : { ...state.drafts, [message.chatId]: '' };
      return {
        ...state,
        messages: [...state.messages, message],
        draftCustomEmoji: shouldPreserveDraft
          ? state.draftCustomEmoji
          : { ...state.draftCustomEmoji, [message.chatId]: [] },
        draftRichText: shouldPreserveDraft
          ? state.draftRichText
          : { ...state.draftRichText, [message.chatId]: '' },
        drafts,
      };
    }
    case 'receive':
      return receiveMessage({
        state,
        message: assignMessageExpiration({ state, message: action.message }),
      });
    case 'delete':
      return deleteMessages({
        state,
        chatId: action.chatId,
        messageIds: [action.messageId],
      });
    case 'delete-messages':
      return deleteMessages({
        state,
        chatId: action.chatId,
        messageIds: action.messageIds,
      });
    case 'edit':
    case 'react':
    case 'pin':
    case 'interact':
      return {
        ...state,
        messages: state.messages.map((message) => updateMessage(message, action)),
      };
  }
}
