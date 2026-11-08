import { useEffect, useState } from 'react';
import type { ChatState } from '@/features/chat/state/chatState';
import type { Conversation } from '@/domain/conversations/conversation';
import { getConversations } from '@/features/chat/state/conversations';

const MAX_TIMEOUT_DELAY = 2_147_483_647;

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
  const entries: ConversationListEntry[] = [];
  const conversations = getConversations(state);
  for (const [fixtureIndex, conversation] of conversations.entries()) {
    const preferences = state.conversationPreferences?.[conversation.id];
    if (preferences?.isDeleted) {
      continue;
    }

    const unreadCount = preferences?.unreadCount ?? conversation.unreadCount ?? 0;
    const isMarkedUnread = preferences?.isMarkedUnread ?? false;
    const hasMuteExpired = Boolean(preferences?.mutedUntil && preferences.mutedUntil <= now);
    const isMuted = preferences?.isMuted ?? conversation.isMuted ?? false;
    entries.push({
      ...conversation,
      unreadCount,
      isMuted: isMuted && !hasMuteExpired,
      isPinned: preferences?.isPinned ?? false,
      pinnedOrder: preferences?.pinnedOrder ?? fixtureIndex,
      isArchived: preferences?.isArchived ?? false,
      isMarkedUnread,
      hasUnread: unreadCount > 0 || isMarkedUnread,
      hasClearedHistory: preferences?.hasClearedHistory ?? false,
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

/** Refresh expired mute indicators while the page is open, including after a background pause. */
export function useConversationList(state: ChatState) {
  const [now, setNow] = useState(Date.now);
  const preferences = state.conversationPreferences;

  useEffect(() => {
    const currentTime = Date.now();
    let nextDeadline = Infinity;
    for (const preference of Object.values(preferences ?? {})) {
      const deadline = preference.mutedUntil;
      if (preference.isMuted && deadline && deadline > currentTime) {
        nextDeadline = Math.min(nextDeadline, deadline);
      }
    }

    function refreshTime() {
      setNow(Date.now());
    }
    window.addEventListener('focus', refreshTime);
    document.addEventListener('visibilitychange', refreshTime);
    const timer = Number.isFinite(nextDeadline)
      ? window.setTimeout(refreshTime, Math.min(nextDeadline - currentTime, MAX_TIMEOUT_DELAY))
      : undefined;

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', refreshTime);
      document.removeEventListener('visibilitychange', refreshTime);
    };
  }, [preferences, now]);

  return getConversationList(state, now);
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
