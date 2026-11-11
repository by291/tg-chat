import type { SessionOwner } from '@/features/auth/SessionOwner';
import type { Conversation } from '@/features/chat/data/messageModels';
import { readBrowserSubscription } from './notificationBrowserState';
import { isNotificationId } from './notificationPush';

type NotificationTarget =
  { kind: 'inbox' } | { kind: 'conversation'; conversationId: string; subscriptionId: string };

interface NotificationChat {
  catchUp(): Promise<void>;
  getSnapshot(): { conversations: readonly Conversation[] };
}

/** Consume a worker link once while leaving other application fragments alone. */
export function takeNotificationTarget(): NotificationTarget | undefined {
  const params = new URLSearchParams(window.location.hash.slice(1));
  if (!params.has('notification')) {
    return;
  }
  const { pathname, search } = window.location;
  window.history.replaceState(window.history.state, '', pathname + search);
  const conversationId = params.get('notification');
  const subscriptionId = params.get('subscription');
  if (!isNotificationId(conversationId) || !isNotificationId(subscriptionId)) {
    return { kind: 'inbox' };
  }

  return {
    kind: 'conversation',
    conversationId,
    subscriptionId,
  };
}

/** Resolve a notification only through the current session's authorized conversation history. */
export async function resolveNotificationTarget(input: {
  target: NotificationTarget;
  session: SessionOwner;
  chat: NotificationChat;
}): Promise<Conversation | undefined> {
  const { target, session, chat } = input;
  const { auth, revision } = session.getSnapshot();
  if (target.kind !== 'conversation' || !auth) {
    return;
  }
  try {
    const subscription = await readBrowserSubscription();
    if (
      session.getSnapshot().revision !== revision ||
      subscription?.sessionId !== auth.session.id ||
      subscription.subscriptionId !== target.subscriptionId
    ) {
      return;
    }

    // The durable directory may still contain a stale projection from before access was removed.
    await chat.catchUp();
    if (session.getSnapshot().revision !== revision) {
      return;
    }
    await session.client.GET('/api/v1/conversations/{conversation_id}/history', {
      params: {
        path: { conversation_id: target.conversationId },
        query: { limit: 1 },
      },
    });
    if (session.getSnapshot().revision !== revision) {
      return;
    }
    const { conversations } = chat.getSnapshot();

    return conversations.find((conversation) => conversation.id === target.conversationId);
  } catch {
    return;
  }
}
