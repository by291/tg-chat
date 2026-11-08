import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import type { components } from '@/api/schema';
import { AccountWorkspace } from '../accounts/AccountWorkspace';
import styles from '../accounts/Accounts.module.css';
import { AuthScreen } from './AuthScreen';
import { EmailLinkScreen } from './EmailLinkScreen';
import { ApiError, SessionOwner, isCancelled, requirePayload } from './SessionOwner';

const SESSION_REFRESH_INTERVAL_MS = 60_000;

/** Bootstrap only server-owned accounts and tear down the entire private subtree on session changes. */
export function AccountApplication() {
  const [owner] = useState(() => new SessionOwner({ baseUrl: window.location.origin }));
  const snapshot = useSyncExternalStore(owner.subscribe, owner.getSnapshot);
  const [capabilities, setCapabilities] = useState<components['schemas']['Capabilities']>();
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const path = window.location.pathname;
  const isEmailLink = path === '/account/verify-email' || path === '/account/reset-password';

  useLayoutEffect(() => {
    // The account entry renders its own loading state and never hydrates the demo chat shell.
    document.getElementById('startup-frame')?.remove();
  }, []);

  useEffect(() => {
    owner.connectBroadcast();
    if (isEmailLink) {
      return () => owner.dispose();
    }
    let isCurrent = true;
    async function bootstrap() {
      try {
        const reply = await owner.client.GET('/api/v1/capabilities');
        if (!isCurrent) {
          return;
        }
        setCapabilities(requirePayload(reply));
        await owner.refresh();
      } catch (failure) {
        if (isCurrent && !isCancelled(failure)) {
          setError(
            failure instanceof ApiError ? failure.message : 'Could not connect to the server.',
          );
        }
      } finally {
        if (isCurrent) {
          setIsLoading(false);
        }
      }
    }
    void bootstrap();
    function refreshActiveSession() {
      if (!owner.getSnapshot().auth) {
        return;
      }
      void owner.refresh().catch(() => undefined);
    }
    window.addEventListener('focus', refreshActiveSession);
    const timer = window.setInterval(refreshActiveSession, SESSION_REFRESH_INTERVAL_MS);

    return () => {
      isCurrent = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshActiveSession);
      owner.dispose();
    };
  }, [owner, isEmailLink]);

  if (isEmailLink) {
    return (
      <EmailLinkScreen
        owner={owner}
        purpose={path === '/account/reset-password' ? 'recovery' : 'verification'}
      />
    );
  }
  if (isLoading) {
    return (
      <main className={styles.authPage}>
        <p role="status">Connecting to your account…</p>
      </main>
    );
  }
  if (error || !capabilities) {
    return (
      <main className={styles.authPage}>
        <section className={styles.authCard}>
          <h1>Connection unavailable</h1>
          <p role="alert">{error || 'The server could not be reached.'}</p>
          <button type="button" className={styles.primary} onClick={() => window.location.reload()}>
            Try again
          </button>
        </section>
      </main>
    );
  }
  if (!snapshot.auth) {
    return <AuthScreen owner={owner} capabilities={capabilities} />;
  }

  return (
    <AccountWorkspace
      key={`${snapshot.auth.user.id}:${snapshot.auth.session.id}`}
      owner={owner}
      auth={snapshot.auth}
      capabilities={capabilities}
    />
  );
}
