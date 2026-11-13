import { requirePayload, type SessionOwner } from '@/features/auth/SessionOwner';
import {
  clearBrowserSubscription,
  readBrowserSubscription,
  saveBrowserSubscription,
  withBrowserPushLock,
} from './notificationBrowserState';

const WORKER_PATH = '/notification-worker.js';
const WORKER_TIMEOUT_MS = 8_000;
const REQUEST_TIMEOUT_MS = 5_000;

type BrowserPushStatus =
  'loading' | 'unsupported' | 'unavailable' | 'denied' | 'disabled' | 'enabled';

interface BrowserPushSnapshot {
  status: BrowserPushStatus;
  isBusy: boolean;
  error?: string;
}

interface BrowserPushScope {
  sessionId: string;
  revision: number;
}

function canUsePush(): boolean {
  return (
    typeof Notification !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof PushManager !== 'undefined'
  );
}

function applicationServerKey(encoded: string): Uint8Array<ArrayBuffer> {
  const base64 = encoded.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const bytes = atob(padded);

  return Uint8Array.from(bytes, (character) => character.charCodeAt(0));
}

async function registerWorker(): Promise<ServiceWorkerRegistration> {
  const workers = navigator.serviceWorker;
  const registration = await workers.register(WORKER_PATH, { type: 'module', scope: '/' });
  if (registration.active) {
    return registration;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('The notification worker did not start.')),
        WORKER_TIMEOUT_MS,
      );
    });
    return await Promise.race([workers.ready, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function removeLocalSubscription(sessionId: string): Promise<void> {
  const mapping = await readBrowserSubscription();
  if (mapping?.sessionId !== sessionId) {
    return;
  }
  const didClear = await clearBrowserSubscription({ sessionId });
  if (!didClear || !('serviceWorker' in navigator)) {
    return;
  }
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager.getSubscription();
  await subscription?.unsubscribe();
  const notifications = (await registration?.getNotifications()) ?? [];
  for (const notification of notifications) {
    if (notification.data?.identity?.subscription_id === mapping.subscriptionId) {
      notification.close();
    }
  }
}

export class BrowserPushOwner {
  private readonly session: SessionOwner;
  private readonly listeners = new Set<() => void>();
  private scope?: BrowserPushScope;
  private vapidKey?: string;
  private refreshSequence = 0;
  private snapshot: BrowserPushSnapshot = { status: 'loading', isBusy: false };

  /** Own only the browser's opt-in, independently of the account's delivery preferences. */
  constructor({ session }: { session: SessionOwner }) {
    this.session = session;
  }

  /** Read the current browser permission, capability, and opt-in state. */
  getSnapshot = (): BrowserPushSnapshot => this.snapshot;

  /** Observe browser subscription state while the authenticated workspace is mounted. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Reconcile the local mapping without requesting permission or subscribing automatically. */
  connect(): () => void {
    const { auth, revision } = this.session.getSnapshot();
    if (!auth || this.scope) {
      return () => undefined;
    }

    const scope = { sessionId: auth.session.id, revision };
    this.scope = scope;
    const refresh = () => void this.refresh(scope);
    const unsubscribe = this.session.subscribe(() => {
      if (this.session.getSnapshot().revision === scope.revision) {
        return;
      }

      const cleanup = withBrowserPushLock(() => removeLocalSubscription(scope.sessionId));
      void cleanup.catch(() => undefined);
      disconnect();
    });
    const disconnect = () => {
      unsubscribe();
      window.removeEventListener('focus', refresh);
      if (this.scope === scope) {
        this.scope = undefined;
        this.vapidKey = undefined;
        this.publish({ status: 'loading', isBusy: false });
      }
    };
    window.addEventListener('focus', refresh);
    refresh();

    return disconnect;
  }

  /** Request permission from a user gesture and attach only to the still-current session. */
  async enable(): Promise<void> {
    const scope = this.scope;
    const key = this.vapidKey;
    if (!scope || !key || this.snapshot.isBusy || this.snapshot.status !== 'disabled') {
      return;
    }
    this.refreshSequence++;
    this.publish({ status: 'disabled', isBusy: true });
    try {
      const permission =
        Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      this.ensureCurrent(scope);
      if (permission !== 'granted') {
        const status = permission === 'denied' ? 'denied' : 'disabled';
        this.publish({ status, isBusy: false });
        return;
      }
      await withBrowserPushLock(() => this.attach({ scope, key }));
      this.ensureCurrent(scope);
      this.publish({ status: 'enabled', isBusy: false });
    } catch {
      if (this.isCurrent(scope)) {
        this.publish({
          status: 'disabled',
          isBusy: false,
          error: 'Could not enable browser notifications.',
        });
      }
    }
  }

  /** Clear local delivery and detach the authenticated session from the provider. */
  async disable(): Promise<void> {
    const scope = this.scope;
    if (!scope || this.snapshot.isBusy || this.snapshot.status !== 'enabled') {
      return;
    }
    this.refreshSequence++;
    this.publish({ status: 'enabled', isBusy: true });
    try {
      // Serialize detach with another tab's opt-in to the same browser registration.
      await withBrowserPushLock(async () => {
        this.ensureCurrent(scope);
        await removeLocalSubscription(scope.sessionId).catch(() => undefined);
        this.ensureCurrent(scope);
        await this.session.client.DELETE('/api/v1/notifications/subscription', {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      });
      this.ensureCurrent(scope);
      this.publish({ status: 'disabled', isBusy: false });
    } catch {
      if (this.isCurrent(scope)) {
        this.publish({
          status: 'disabled',
          isBusy: false,
          error: 'Could not confirm removal of the browser subscription.',
        });
      }
    }
  }

  private async refresh(scope: BrowserPushScope): Promise<void> {
    if (!this.isCurrent(scope) || this.snapshot.isBusy) {
      return;
    }
    const sequence = ++this.refreshSequence;
    try {
      const hasSubscription = await withBrowserPushLock(() => this.reconcile(scope));
      this.ensureCurrent(scope);
      if (sequence !== this.refreshSequence) {
        return;
      }
      if (!canUsePush()) {
        this.publish({ status: 'unsupported', isBusy: false });
        return;
      }
      const reply = await this.session.client.GET('/api/v1/notifications/capability', {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      this.ensureCurrent(scope);
      if (sequence !== this.refreshSequence) {
        return;
      }

      const capability = requirePayload(reply);
      this.vapidKey = capability.vapid_public_key ?? undefined;
      if (hasSubscription && Notification.permission === 'granted') {
        this.publish({
          status: 'enabled',
          isBusy: false,
          error: capability.available ? undefined : 'Web Push is unavailable on this deployment.',
        });
        return;
      }

      if (Notification.permission === 'denied') {
        this.publish({ status: 'denied', isBusy: false });
        return;
      }

      const status = capability.available && this.vapidKey ? 'disabled' : 'unavailable';
      this.publish({ status, isBusy: false });
    } catch {
      if (this.isCurrent(scope) && sequence === this.refreshSequence) {
        if (this.snapshot.status === 'enabled') {
          this.publish({
            status: 'enabled',
            isBusy: false,
            error: 'Could not check Web Push availability.',
          });
          return;
        }
        this.publish({ status: 'unavailable', isBusy: false });
      }
    }
  }

  private async reconcile(scope: BrowserPushScope): Promise<boolean> {
    this.ensureCurrent(scope);
    const mapping = await readBrowserSubscription();
    this.ensureCurrent(scope);
    if (!mapping) {
      return false;
    }
    if (mapping.sessionId !== scope.sessionId || !canUsePush()) {
      // An account switch must drop local ownership before another session can opt in.
      await removeLocalSubscription(mapping.sessionId);
      return false;
    }
    const registration = await navigator.serviceWorker.getRegistration('/');
    const subscription = await registration?.pushManager.getSubscription();
    this.ensureCurrent(scope);
    if (!subscription || Notification.permission !== 'granted') {
      await removeLocalSubscription(scope.sessionId);
      return false;
    }

    return true;
  }

  private async attach(input: { scope: BrowserPushScope; key: string }): Promise<void> {
    const { scope, key } = input;
    this.ensureCurrent(scope);
    const registration = await registerWorker();
    this.ensureCurrent(scope);
    const current = await readBrowserSubscription();
    if (current && current.sessionId !== scope.sessionId) {
      await removeLocalSubscription(current.sessionId);
    }
    this.ensureCurrent(scope);

    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(key),
      }));
    try {
      this.ensureCurrent(scope);
      const { endpoint, expirationTime, keys } = subscription.toJSON();
      if (!endpoint || !keys?.p256dh || !keys.auth) {
        throw new Error('The browser subscription is incomplete.');
      }
      const reply = await this.session.client.PUT('/api/v1/notifications/subscription', {
        body: {
          endpoint,
          p256dh: keys.p256dh,
          auth: keys.auth,
          expiration_time: expirationTime,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      this.ensureCurrent(scope);
      const { subscription_id } = requirePayload(reply);
      await saveBrowserSubscription({
        sessionId: scope.sessionId,
        subscriptionId: subscription_id,
      });
      if (!this.isCurrent(scope)) {
        await removeLocalSubscription(scope.sessionId);
      }
    } catch (error) {
      if (!existing || current?.sessionId !== scope.sessionId || !this.isCurrent(scope)) {
        await subscription.unsubscribe();
      }
      throw error;
    }
  }

  private isCurrent(scope: BrowserPushScope): boolean {
    return this.scope === scope && this.session.getSnapshot().revision === scope.revision;
  }

  private ensureCurrent(scope: BrowserPushScope): void {
    if (!this.isCurrent(scope)) {
      throw new DOMException('Browser notification request cancelled.', 'AbortError');
    }
  }

  private publish(snapshot: BrowserPushSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) {
      listener();
    }
  }
}
