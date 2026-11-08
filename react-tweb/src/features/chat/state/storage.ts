import { createHistoryMessages } from '../demo/historyFixtures';
import { get, set } from 'idb-keyval';
import { chatStateSchema, type ChatState } from '@/features/chat/state/chatState';
import { getConversations } from './conversations';

const STORAGE_KEY = 'react-tweb.conversations.v1';

/** Validate stored content before it reaches the conversation renderer. */
export function parseSavedState(value: unknown): ChatState | undefined {
  const result = chatStateSchema.safeParse(value);
  if (!result.success) {
    return undefined;
  }

  const hasConversation = getConversations(result.data).some((conversation) => {
    return conversation.id === result.data.activeChatId;
  });

  if (result.data.activeChatId && !hasConversation) {
    return undefined;
  }

  if (result.data.version === 1) {
    return {
      ...result.data,
      version: 2,
      messages: [...result.data.messages, ...createHistoryMessages()],
    };
  }

  return result.data;
}

/** Restore the local conversation state from IndexedDB. */
export async function loadChatState(): Promise<ChatState | undefined> {
  const savedState: unknown = await get(STORAGE_KEY);
  const state = parseSavedState(savedState);
  // Selection belongs to this navigation session, not the persisted conversation content.
  return state ? { ...state, activeChatId: '' } : undefined;
}

/** Persist a complete snapshot, including image data, in one IndexedDB write. */
export async function saveChatState(state: ChatState): Promise<void> {
  await set(STORAGE_KEY, state);
}
