import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { clearBrowserSubscription, saveBrowserSubscription } from './notificationBrowserState';
import { notificationClickUrl, showIncomingPush } from './notificationPush';

const ORIGIN = 'https://chat.example';
const SUBSCRIPTION = '00000000-0000-4000-8000-000000000001';
const PAYLOAD = {
  identity: {
    deployment_id: '00000000-0000-4000-8000-000000000002',
    message_id: '00000000-0000-4000-8000-000000000003',
    subscription_id: SUBSCRIPTION,
  },
  conversation_id: '00000000-0000-4000-8000-000000000004',
};

afterEach(() => clearBrowserSubscription({ subscriptionId: SUBSCRIPTION }));

it('shows one generic alert when an accepted push is delivered concurrently twice', async () => {
  await saveBrowserSubscription({ sessionId: 'session', subscriptionId: SUBSCRIPTION });
  const showNotification = vi.fn(async () => undefined);
  const input = {
    payload: { ...PAYLOAD, body: 'Private content' },
    showNotification,
  };
  await Promise.all([showIncomingPush(input), showIncomingPush(input)]);

  expect(showNotification).toHaveBeenCalledTimes(1);
  expect(showNotification).toHaveBeenCalledWith(
    'New message',
    expect.objectContaining({
      body: 'Open TG Chat to view it.',
      data: PAYLOAD,
    }),
  );
});

it('ignores stale push alerts and routes their clicks to the inbox', async () => {
  await saveBrowserSubscription({ sessionId: 'session', subscriptionId: SUBSCRIPTION });
  const activeUrl = await notificationClickUrl({ origin: ORIGIN, payload: PAYLOAD });
  expect(activeUrl.href).toBe(
    `${ORIGIN}/#notification=${PAYLOAD.conversation_id}&subscription=${SUBSCRIPTION}`,
  );

  await clearBrowserSubscription({ subscriptionId: SUBSCRIPTION });
  const showNotification = vi.fn(async () => undefined);
  await showIncomingPush({ payload: PAYLOAD, showNotification });
  expect(showNotification).not.toHaveBeenCalled();
  const url = await notificationClickUrl({ origin: ORIGIN, payload: PAYLOAD });
  expect(url.href).toBe(`${ORIGIN}/#notification=inbox`);
});
