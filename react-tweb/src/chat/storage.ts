import { get, set } from 'idb-keyval';
import { chatStateSchema, type ChatState } from './model';
import { conversations } from './fixtures';

const STORAGE_KEY = 'react-tweb.conversations.v1';

/** Validate stored content before it reaches the conversation renderer. */
export function parseSavedState(value: unknown): ChatState | undefined {
  const result = chatStateSchema.safeParse(value);
  if (!result.success) {
    return undefined;
  }

  const hasConversation = conversations.some((conversation) => {
    return conversation.id === result.data.activeChatId;
  });

  return hasConversation ? result.data : undefined;
}

/** Restore the local conversation state from IndexedDB. */
export async function loadChatState(): Promise<ChatState | undefined> {
  const savedState: unknown = await get(STORAGE_KEY);
  return parseSavedState(savedState);
}

/** Persist a complete snapshot, including image data, in one IndexedDB write. */
export async function saveChatState(state: ChatState): Promise<void> {
  await set(STORAGE_KEY, state);
}
