import { Send } from 'lucide-react';
import { useState } from 'react';
import type { components } from '@/api/schema';
import { describeCurrentDevice } from '@/features/settings/devices/currentDevice';
import { AccountForm, Field, textField } from '../accounts/AccountForm';
import styles from '../accounts/Accounts.module.css';
import { SessionOwner } from './SessionOwner';

type Capabilities = components['schemas']['Capabilities'];
type AuthMode = 'login' | 'register' | 'recovery';

interface AuthScreenProps {
  owner: SessionOwner;
  capabilities: Capabilities;
}

interface CredentialsFormProps {
  owner: SessionOwner;
  mode: Exclude<AuthMode, 'recovery'>;
}

function CredentialsForm({ owner, mode }: CredentialsFormProps) {
  const isRegistration = mode === 'register';

  async function submit(fields: FormData) {
    const credentials = {
      username: textField(fields, 'username'),
      password: textField(fields, 'password'),
      device_name: describeCurrentDevice(navigator).browser,
    };
    if (isRegistration) {
      await owner.register({ ...credentials, display_name: textField(fields, 'display_name') });
      return;
    }

    await owner.login(credentials);
  }

  return (
    <AccountForm
      key={mode}
      submitLabel={isRegistration ? 'Create account' : 'Sign in'}
      onSubmit={submit}
    >
      <Field
        label="Username"
        name="username"
        autoComplete="username"
        required
        pattern="[A-Za-z0-9_]{3,32}"
      />
      {isRegistration && (
        <Field
          label="Display name"
          name="display_name"
          autoComplete="nickname"
          required
          maxLength={80}
        />
      )}
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete={isRegistration ? 'new-password' : 'current-password'}
        required
      />
      {isRegistration && (
        <p className={styles.hint}>
          Use at least 12 characters. Email is optional and can be added later.
        </p>
      )}
    </AccountForm>
  );
}

function RecoveryForm({ owner }: { owner: SessionOwner }) {
  async function submit(fields: FormData) {
    await owner.client.POST('/api/v1/auth/recovery', {
      body: { email: textField(fields, 'email') },
    });
  }

  return (
    <AccountForm
      submitLabel="Send recovery link"
      onSubmit={submit}
      successMessage="If a verified account uses this email, a recovery link will arrive shortly."
    >
      <Field label="Verified email" name="email" type="email" autoComplete="email" required />
      <p className={styles.hint}>
        Recovery is available only for an email you verified before losing access.
      </p>
    </AccountForm>
  );
}

/** Present real account admission with explicit registration and email-recovery capabilities. */
export function AuthScreen({ owner, capabilities }: AuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const title = {
    login: 'Welcome to TG Chat',
    register: 'Create your account',
    recovery: 'Recover your account',
  }[mode];

  return (
    <main className={styles.authPage}>
      <section className={styles.authCard}>
        <span className={styles.brandIcon}>
          <Send aria-hidden="true" />
        </span>
        <h1>{title}</h1>
        {mode === 'recovery' ? (
          <RecoveryForm owner={owner} />
        ) : (
          <CredentialsForm owner={owner} mode={mode} />
        )}
        <div className={styles.authActions}>
          {mode !== 'login' && (
            <button type="button" onClick={() => setMode('login')}>
              Back to sign in
            </button>
          )}
          {mode === 'login' && (
            <button
              type="button"
              disabled={!capabilities.registration_open}
              onClick={() => setMode('register')}
            >
              Create an account
            </button>
          )}
          {mode === 'login' && (
            <button
              type="button"
              disabled={!capabilities.email_recovery_available}
              onClick={() => setMode('recovery')}
            >
              Forgot password
            </button>
          )}
        </div>
        {!capabilities.registration_open && (
          <p className={styles.hint}>Registration is currently closed.</p>
        )}
        {!capabilities.email_recovery_available && (
          <p className={styles.hint}>Email recovery is not enabled on this server.</p>
        )}
        <a className={styles.demoLink} href="/demo">
          Explore the chat demo
        </a>
      </section>
    </main>
  );
}
