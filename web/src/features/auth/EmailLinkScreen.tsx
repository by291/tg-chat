import { useEffect, useState } from 'react';
import { AccountForm } from '../accounts/AccountForm';
import { NewPasswordFields, newPassword } from '../accounts/SecurityPanel';
import styles from '../accounts/Accounts.module.css';
import { SessionOwner } from './SessionOwner';

/** Consume fragment tokens in memory and remove them from the address bar before any submission. */
export function EmailLinkScreen({
  owner,
  purpose,
}: {
  owner: SessionOwner;
  purpose: 'verification' | 'recovery';
}) {
  const [token, setToken] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '',
  );
  const [isComplete, setIsComplete] = useState(false);
  const isRecovery = purpose === 'recovery';
  useEffect(() => {
    function consumeFragment() {
      const clean = new URL(window.location.href);
      const nextToken = new URLSearchParams(clean.hash.slice(1)).get('token');
      if (nextToken) {
        setToken(nextToken);
        setIsComplete(false);
      }
      clean.hash = '';
      window.history.replaceState(window.history.state, '', clean);
    }

    consumeFragment();
    window.addEventListener('hashchange', consumeFragment);
    return () => window.removeEventListener('hashchange', consumeFragment);
  }, []);

  async function submit(fields: FormData) {
    if (isRecovery) {
      await owner.client.POST('/api/v1/auth/recovery/reset', {
        body: { token, new_password: newPassword(fields) },
      });
      owner.invalidate();
    } else {
      await owner.client.POST('/api/v1/auth/email/confirm', { body: { token } });
    }
    setIsComplete(true);
  }

  return (
    <main className={styles.authPage}>
      <section className={styles.authCard}>
        <h1>{isRecovery ? 'Reset your password' : 'Verify your email'}</h1>
        {!token && (
          <p role="alert" className={styles.error}>
            This link is missing its token. Request a new email and open its link.
          </p>
        )}
        {isComplete ? (
          <p role="status">
            {isRecovery
              ? 'Password reset. Sign in again with your new password.'
              : 'Email verified. Your recovery address is ready.'}
          </p>
        ) : (
          token && (
            <AccountForm
              submitLabel={isRecovery ? 'Reset password' : 'Verify email'}
              onSubmit={submit}
              shouldReset
            >
              {isRecovery ? (
                <NewPasswordFields />
              ) : (
                <p className={styles.hint}>Confirm that this email address belongs to you.</p>
              )}
            </AccountForm>
          )
        )}
        <a className={styles.demoLink} href="/">
          Return to your account
        </a>
      </section>
    </main>
  );
}
