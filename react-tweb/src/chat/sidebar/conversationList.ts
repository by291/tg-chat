import type { ChatState, Conversation } from '../model';
import { conversations } from '../demo/fixtures';

export interface ConversationListEntry extends Conversation {
  isPinned: boolean;
  isArchived: boolean;
  isMarkedUnread: boolean;
  hasUnread: boolean;
  hasClearedHistory: boolean;
}

export type ConversationMenuAction =
  'open-tab' | 'preview' | 'select' | 'read' | 'pin' | 'mute' | 'archive' | 'clear' | 'delete';

/** Resolve persisted list changes and keep pinned conversations ahead of the remaining rows. */
export function getConversationList(state: ChatState): ConversationListEntry[] {
  const entries: ConversationListEntry[] = [];
  for (const conversation of conversations) {
    const preferences = state.conversationPreferences?.[conversation.id];
    if (preferences?.isDeleted) {
      continue;
    }

    const unreadCount = preferences?.unreadCount ?? conversation.unreadCount ?? 0;
    const isMarkedUnread = preferences?.isMarkedUnread ?? false;
    entries.push({
      ...conversation,
      unreadCount,
      isMuted: preferences?.isMuted ?? conversation.isMuted ?? false,
      isPinned: preferences?.isPinned ?? false,
      isArchived: preferences?.isArchived ?? false,
      isMarkedUnread,
      hasUnread: unreadCount > 0 || isMarkedUnread,
      hasClearedHistory: preferences?.hasClearedHistory ?? false,
    });
  }

  return entries.sort((first, second) => Number(second.isPinned) - Number(first.isPinned));
}

/** Use Telegram's conversation-specific wording for the destructive menu item. */
export function getDeleteConversationLabel(conversation: Conversation): string {
  if (conversation.kind === 'group') {
    return 'Delete Group';
  }
  if (conversation.kind === 'channel') {
    return 'Leave Channel';
  }
  return 'Delete Chat';
}
