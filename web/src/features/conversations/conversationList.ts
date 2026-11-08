import type { ChatState } from '@/features/chat/state/chatState';
import type { Conversation } from '@/domain/conversations/conversation';
import { getConversations } from '@/features/chat/state/conversations';

export interface ConversationListEntry extends Conversation {
  isPinned: boolean;
  pinnedOrder: number;
  isArchived: boolean;
  isMarkedUnread: boolean;
  hasUnread: boolean;
  hasClearedHistory: boolean;
}

export type ConversationMenuAction =
  'open-tab' | 'preview' | 'select' | 'read' | 'pin' | 'mute' | 'archive' | 'clear' | 'delete';

/** Resolve persisted list changes and keep pinned conversations ahead of the remaining rows. */
export function getConversationList(state: ChatState, now = Date.now()): ConversationListEntry[] {
  return resolveConversationEntries({
    conversations: getConversations(state),
    preferences: state.conversationPreferences,
    now,
  });
}

/** Apply list preferences to a shared catalog at the current mute deadline. */
export function resolveConversationEntries({
  conversations,
  preferences,
  now,
}: {
  conversations: Conversation[];
  preferences: ChatState['conversationPreferences'];
  now: number;
}): ConversationListEntry[] {
  const entries: ConversationListEntry[] = [];
  for (const [fixtureIndex, conversation] of conversations.entries()) {
    const preference = preferences?.[conversation.id];
    if (preference?.isDeleted) {
      continue;
    }

    const unreadCount = preference?.unreadCount ?? conversation.unreadCount ?? 0;
    const isMarkedUnread = preference?.isMarkedUnread ?? false;
    const hasMuteExpired = Boolean(preference?.mutedUntil && preference.mutedUntil <= now);
    const isMuted = preference?.isMuted ?? conversation.isMuted ?? false;
    entries.push({
      ...conversation,
      unreadCount,
      isMuted: isMuted && !hasMuteExpired,
      isPinned: preference?.isPinned ?? false,
      pinnedOrder: preference?.pinnedOrder ?? fixtureIndex,
      isArchived: preference?.isArchived ?? false,
      isMarkedUnread,
      hasUnread: unreadCount > 0 || isMarkedUnread,
      hasClearedHistory: preference?.hasClearedHistory ?? false,
    });
  }

  return entries.sort((first, second) => {
    if (first.isPinned !== second.isPinned) {
      return first.isPinned ? -1 : 1;
    }
    if (first.isPinned && second.isPinned) {
      return first.pinnedOrder - second.pinnedOrder;
    }

    return 0;
  });
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
