import { update } from 'idb-keyval';

const FALLBACK_LEASE_MS = 90_000;
const RENEW_INTERVAL_MS = 20_000;

interface Lease {
  token: string;
  expiresAt: number;
}

interface SessionTransfer<T> {
  sessionId: string;
  run: (options: { hasBrowserLock: boolean }) => Promise<T>;
}

/** Share the transfer budget across chat and avatar uploads in the same browser session. */
export async function withMediaSession<T>(input: SessionTransfer<T>): Promise<T | undefined> {
  const key = `tg-chat:media-session:${input.sessionId}`;
  if (navigator.locks) {
    return navigator.locks.request(key, { ifAvailable: true }, async (lock) => {
      return lock ? input.run({ hasBrowserLock: true }) : undefined;
    });
  }

  const token = crypto.randomUUID();
  let hasLease = false;
  await update<Lease | null>(key, (current) => {
    const now = Date.now();
    if (current && current.expiresAt > now) {
      return current;
    }
    hasLease = true;
    return { token, expiresAt: now + FALLBACK_LEASE_MS };
  });
  if (!hasLease) {
    return undefined;
  }

  // A crashed tab leaves only an expiring lease on browsers without Web Locks.
  const timer = setInterval(() => {
    void update<Lease | null>(key, (current) => {
      if (current?.token !== token) {
        return current ?? null;
      }
      return { token, expiresAt: Date.now() + FALLBACK_LEASE_MS };
    }).catch(() => undefined);
  }, RENEW_INTERVAL_MS);
  try {
    return await input.run({ hasBrowserLock: false });
  } finally {
    clearInterval(timer);
    await update<Lease | null>(key, (current) => {
      return current?.token === token ? null : (current ?? null);
    });
  }
}
