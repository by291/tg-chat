/// <reference lib="webworker" />

import { notificationClickUrl, showIncomingPush } from './notificationPush';

const worker = globalThis as unknown as ServiceWorkerGlobalScope;

async function openNotification(payload: unknown): Promise<void> {
  const url = await notificationClickUrl({ origin: worker.location.origin, payload });
  const windows = await worker.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const app = windows.find((client) => {
    const current = new URL(client.url);
    return current.origin === url.origin && current.pathname === url.pathname;
  });
  if (app) {
    // Navigating also handles an app that is still bootstrapping or restoring an expired session.
    const navigated = await app.navigate(url.href).catch(() => null);
    if (navigated) {
      await navigated.focus();
      return;
    }
  }

  await worker.clients.openWindow(url.href);
}

worker.addEventListener('push', (event) => {
  let payload: unknown;
  try {
    payload = event.data?.json();
  } catch {
    return;
  }

  event.waitUntil(
    showIncomingPush({
      payload,
      showNotification: (title, options) => worker.registration.showNotification(title, options),
    }),
  );
});

worker.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(openNotification(event.notification.data));
});
