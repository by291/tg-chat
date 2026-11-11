import {
  claimPushReceipt,
  pushReceiptKey,
  readBrowserSubscription,
  releasePushReceipt,
  withBrowserPushLock,
} from './notificationBrowserState';

const UUID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

interface PushPayload {
  identity: {
    deployment_id: string;
    message_id: string;
    subscription_id: string;
  };
  conversation_id: string;
}

/** Validate the opaque IDs shared by the worker and authorized application navigation. */
export function isNotificationId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function parsePayload(raw: unknown): PushPayload | undefined {
  if (!raw || typeof raw !== 'object') {
    return;
  }
  const { identity, conversation_id } = raw as Partial<PushPayload>;
  if (!identity || typeof identity !== 'object' || !isNotificationId(conversation_id)) {
    return;
  }
  const { deployment_id, message_id, subscription_id } = identity;
  if (
    !isNotificationId(deployment_id) ||
    !isNotificationId(message_id) ||
    !isNotificationId(subscription_id)
  ) {
    return;
  }

  // Project only opaque identifiers even if an incompatible delivery includes other fields.
  return {
    identity: {
      deployment_id,
      message_id,
      subscription_id,
    },
    conversation_id,
  };
}

/** Display a generic notification once for the browser's active subscription. */
export async function showIncomingPush(input: {
  payload: unknown;
  showNotification: (title: string, options: NotificationOptions) => Promise<void>;
}): Promise<void> {
  const payload = parsePayload(input.payload);
  if (!payload) {
    return;
  }

  await withBrowserPushLock(async () => {
    if (!(await claimPushReceipt(payload.identity))) {
      return;
    }
    try {
      await input.showNotification('New message', {
        body: 'Open TG Chat to view it.',
        tag: pushReceiptKey(payload.identity),
        data: payload,
      });
    } catch (error) {
      await releasePushReceipt(payload.identity);
      throw error;
    }
  });
}

/** Build a same-origin app target with an inbox fallback for a stale or invalid notification. */
export async function notificationClickUrl(input: {
  origin: string;
  payload: unknown;
}): Promise<URL> {
  const url = new URL('/', input.origin);
  const payload = parsePayload(input.payload);
  const subscription = await readBrowserSubscription().catch(() => undefined);
  const isCurrent = payload && payload.identity.subscription_id === subscription?.subscriptionId;
  const query = new URLSearchParams({
    notification: isCurrent ? payload.conversation_id : 'inbox',
  });
  if (isCurrent) {
    query.set('subscription', payload.identity.subscription_id);
  }
  // Fragments keep the private target out of web server request logs.
  url.hash = query.toString();

  return url;
}
