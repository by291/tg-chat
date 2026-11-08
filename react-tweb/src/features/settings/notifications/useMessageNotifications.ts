import { useEffect, useEffectEvent, useRef } from 'react';
import { CURRENT_USER_ID } from '@/domain/identity';
import { type ChatState } from '@/features/chat/state/chatState';
import { useNotificationPreferences } from './notificationPreferences';
import { resolveMessageNotification } from './notificationPolicy';
import { playNotificationSound, showMessageNotification } from './notificationDelivery';

interface MessageNotificationsOptions {
  state: ChatState;
  isReady: boolean;
  isConversationVisible: boolean;
  onOpen: (chatId: string) => void;
}

/** Notify only about messages added after restoration, never history or ordinary edits. */
export function useMessageNotifications({
  state,
  isReady,
  isConversationVisible,
  onOpen,
}: MessageNotificationsOptions) {
  const preferences = useNotificationPreferences();
  const seenIds = useRef<Set<string> | undefined>(undefined);
  const notifications = useRef(new Map<string, Notification>());
  const openRef = useRef(onOpen);
  openRef.current = onOpen;

  useEffect(() => {
    const activeNotifications = notifications.current;
    return () => {
      for (const notification of activeNotifications.values()) {
        notification.close();
      }
      activeNotifications.clear();
    };
  }, []);

  useEffect(() => {
    function dismissReadNotifications() {
      const isForeground = document.visibilityState === 'visible' && document.hasFocus();
      const shouldDismissActive = isForeground && isConversationVisible;
      for (const [chatId, notification] of notifications.current) {
        const isActiveChat = shouldDismissActive && state.activeChatId === chatId;
        if (!preferences.shouldShowNotifications || isActiveChat) {
          notification.close();
          notifications.current.delete(chatId);
        }
      }
    }

    dismissReadNotifications();
    window.addEventListener('focus', dismissReadNotifications);
    document.addEventListener('visibilitychange', dismissReadNotifications);
    return () => {
      window.removeEventListener('focus', dismissReadNotifications);
      document.removeEventListener('visibilitychange', dismissReadNotifications);
    };
  }, [state.activeChatId, isConversationVisible, preferences.shouldShowNotifications]);

  const notifyNewMessages = useEffectEvent(() => {
    if (!seenIds.current) {
      seenIds.current = new Set(state.messages.map((message) => message.id));
      return;
    }
    const isForeground = document.visibilityState === 'visible' && document.hasFocus();
    for (const message of state.messages) {
      if (seenIds.current.has(message.id)) {
        continue;
      }
      seenIds.current.add(message.id);
      if (message.authorId === CURRENT_USER_ID) {
        if (preferences.shouldPlaySentSound && isForeground) {
          void playNotificationSound({ volume: preferences.volume, isSent: true });
        }
        continue;
      }
      const details = resolveMessageNotification({
        state,
        preferences,
        message,
        isChatVisible:
          isForeground && isConversationVisible && state.activeChatId === message.chatId,
        now: Date.now(),
      });
      if (!details) {
        continue;
      }
      if (preferences.shouldPlaySound) {
        void playNotificationSound({ volume: preferences.volume });
      }
      if (!preferences.shouldShowNotifications) {
        continue;
      }
      const notification = showMessageNotification({
        ...details,
        onOpen: (chatId) => openRef.current(chatId),
      });
      if (notification) {
        notifications.current.get(message.chatId)?.close();
        notifications.current.set(message.chatId, notification);
      }
    }
  });

  useEffect(() => {
    if (!isReady) {
      return;
    }

    // Arrival detection follows the collection; delivery reads the latest visibility and policy.
    notifyNewMessages();
  }, [state.messages, isReady]);
}
