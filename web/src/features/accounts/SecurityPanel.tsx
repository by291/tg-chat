import type { components } from '@/api/schema';
import { ApiError, SessionOwner, requirePayload } from '../auth/SessionOwner';
import { AccountForm, Field, textField } from './AccountForm';
import { DeleteAccountPanel } from './DeleteAccountPanel';
import styles from './Accounts.module.css';

type Profile = components['schemas']['PrivateProfile'];

/** Refresh recent password proof before device revocation or recovery-address changes. */
export function PasswordConfirmation({
  owner,
  onConfirmed,
}: {
  owner: SessionOwner;
  onConfirmed?: () => void;
}) {
  async function confirm(fields: FormData) {
    await owner.client.POST('/api/v1/auth/reauthenticate', {
      body: { password: textField(fields, 'password') },
    });
    onConfirmed?.();
  }

  return (
    <section className={styles.card}>
      <h3>Confirm your password</h3>
      <p className={styles.hint}>
        {onConfirmed
          ? 'Confirm your password to continue reviewing reports.'
          : 'For sensitive changes, confirm your password here and retry the action.'}
      </p>
      <AccountForm
        submitLabel="Confirm password"
        onSubmit={confirm}
        successMessage="Password confirmed. You can retry your sensitive change."
        shouldReset
      >
        <Field
          label="Password confirmation"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus={Boolean(onConfirmed)}
          required
        />
      </AccountForm>
    </section>
  );
}

/** Compare repeated passwords without trimming or truncating the submitted secret. */
export function newPassword(fields: FormData): string {
  const password = textField(fields, 'new_password');
  if (password !== textField(fields, 'repeat_password')) {
    throw new ApiError({ code: 'password_mismatch', message: 'The new passwords do not match.' });
  }

  return password;
}

/** Render new-password controls consistently for authenticated changes and recovery links. */
export function NewPasswordFields() {
  return (
    <>
      <Field
        label="New password"
        name="new_password"
        type="password"
        autoComplete="new-password"
        required
      />
      <Field
        label="Repeat new password"
        name="repeat_password"
        type="password"
        autoComplete="new-password"
        required
      />
      <p className={styles.hint}>Use at least 12 characters. Spaces and Unicode are supported.</p>
    </>
  );
}

/** Manage password rotation and optional verified recovery email with explicit recent-auth support. */
export function SecurityPanel({
  owner,
  profile,
  isEmailAvailable,
}: {
  owner: SessionOwner;
  profile: Profile;
  isEmailAvailable: boolean;
}) {
  async function changePassword(fields: FormData) {
    const revision = owner.getSnapshot().revision;
    const reply = await owner.client.POST('/api/v1/account/password', {
      body: {
        current_password: textField(fields, 'current_password'),
        new_password: newPassword(fields),
      },
    });
    if (owner.getSnapshot().revision !== revision) {
      return;
    }
    owner.accept(requirePayload(reply));
  }

  async function verifyEmail(fields: FormData) {
    await owner.client.POST('/api/v1/account/email/verification', {
      body: { email: textField(fields, 'email') },
    });
  }

  async function removeEmail() {
    await owner.client.DELETE('/api/v1/account/email');
    await owner.refresh();
  }

  return (
    <div className={styles.panel}>
      <section className={styles.card}>
        <h3>Change password</h3>
        <AccountForm submitLabel="Change password" onSubmit={changePassword} shouldReset>
          <Field
            label="Current password"
            name="current_password"
            type="password"
            autoComplete="current-password"
            required
          />
          <NewPasswordFields />
          <p className={styles.hint}>Changing your password signs out your other devices.</p>
        </AccountForm>
      </section>
      <PasswordConfirmation owner={owner} />
      <section className={styles.card}>
        <h3>Recovery email</h3>
        <p>{profile.email ?? 'No verified recovery email'}</p>
        {isEmailAvailable ? (
          <AccountForm
            submitLabel="Send verification email"
            onSubmit={verifyEmail}
            successMessage="Verification email queued. Open the link within 15 minutes."
          >
            <Field label="Recovery email" name="email" type="email" autoComplete="email" required />
            <p className={styles.hint}>
              Your previous verified address stays active until the replacement is confirmed.
            </p>
          </AccountForm>
        ) : (
          <p className={styles.hint}>Email recovery is not enabled on this server.</p>
        )}
        {profile.email && (
          <AccountForm
            submitLabel="Remove recovery email"
            onSubmit={removeEmail}
            successMessage="Recovery email removed."
          >
            <p className={styles.hint}>
              Without a verified email, forgotten passwords cannot be recovered.
            </p>
          </AccountForm>
        )}
      </section>
      <DeleteAccountPanel owner={owner} />
    </div>
  );
}
