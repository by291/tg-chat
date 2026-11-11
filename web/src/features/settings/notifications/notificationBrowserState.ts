import { createStore, get, update } from 'idb-keyval';

const NOTIFICATION_LOCK = 'tg-chat:browser-push';
const STATE_KEY = 'browser-notifications';
const MAX_RECEIPTS = 256;
const RECEIPT_LIFETIME_MS = 10 * 60 * 1000;
const store = createStore('tg-chat-notifications-v1', 'notification-state');

interface SubscriptionMapping {
  sessionId: string;
  subscriptionId: string;
}

interface PushIdentity {
  deployment_id: string;
  message_id: string;
  subscription_id: string;
}

interface Receipt {
  identity: string;
  expiresAt: number;
}

interface BrowserState {
  subscription?: SubscriptionMapping;
  receipts: Receipt[];
}

type SubscriptionOwner = { sessionId: string } | { subscriptionId: string };

/** Serialize browser operations with worker display across cooperating tabs when available. */
export function withBrowserPushLock<T>(run: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks;
  return locks ? locks.request(NOTIFICATION_LOCK, run) : run();
}

/** Read the session-bound subscription without storing an endpoint or its keys. */
export async function readBrowserSubscription(): Promise<SubscriptionMapping | undefined> {
  const state = await get<BrowserState>(STATE_KEY, store);
  return state?.subscription;
}

/** Replace the active mapping and discard another session's receipts. */
export async function saveBrowserSubscription(subscription: SubscriptionMapping): Promise<void> {
  await update<BrowserState>(
    STATE_KEY,
    (state) => {
      const current = state?.subscription;
      if (
        state &&
        current?.sessionId === subscription.sessionId &&
        current.subscriptionId === subscription.subscriptionId
      ) {
        return state;
      }

      return { subscription, receipts: [] };
    },
    store,
  );
}

/** Clear browser state only when the expected subscription or session still owns it. */
export async function clearBrowserSubscription(owner: SubscriptionOwner): Promise<boolean> {
  let didClear = false;
  await update<BrowserState>(
    STATE_KEY,
    (state) => {
      const current = state?.subscription;
      const ownsSubscription =
        'sessionId' in owner
          ? owner.sessionId === current?.sessionId
          : owner.subscriptionId === current?.subscriptionId;
      if (ownsSubscription) {
        didClear = true;
        return { receipts: [] };
      }

      return state ?? { receipts: [] };
    },
    store,
  );
  return didClear;
}

/** Scope system tags and persisted duplicate detection to the accepted delivery identity. */
export function pushReceiptKey(identity: PushIdentity): string {
  return `tg-chat:${identity.deployment_id}:${identity.subscription_id}:${identity.message_id}`;
}

/** Atomically admit one receipt only for the subscription currently active in this browser. */
export async function claimPushReceipt(identity: PushIdentity): Promise<boolean> {
  let didClaim = false;
  const key = pushReceiptKey(identity);
  const now = Date.now();
  await update<BrowserState>(
    STATE_KEY,
    (state) => {
      if (state?.subscription?.subscriptionId !== identity.subscription_id) {
        return state ?? { receipts: [] };
      }
      const live = state.receipts.filter((receipt) => receipt.expiresAt > now);
      if (live.some((receipt) => receipt.identity === key)) {
        return state;
      }

      didClaim = true;
      const receipts = live.slice(1 - MAX_RECEIPTS);
      receipts.push({ identity: key, expiresAt: now + RECEIPT_LIFETIME_MS });
      return { ...state, receipts };
    },
    store,
  );
  return didClaim;
}

/** Release an undelivered receipt so a provider retry can still display it. */
export async function releasePushReceipt(identity: PushIdentity): Promise<void> {
  const key = pushReceiptKey(identity);
  await update<BrowserState>(
    STATE_KEY,
    (state) => {
      if (state?.subscription?.subscriptionId !== identity.subscription_id) {
        return state ?? { receipts: [] };
      }
      const receipts = state.receipts.filter((receipt) => receipt.identity !== key);
      return { ...state, receipts };
    },
    store,
  );
}
