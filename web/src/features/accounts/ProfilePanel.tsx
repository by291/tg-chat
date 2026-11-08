import { useState } from 'react';
import type { components } from '@/api/schema';
import { Avatar } from '@/components/Avatar';
import { SettingsAccountDetails } from '@/features/settings/profile/SettingsAccountDetails';
import { SessionOwner, requirePayload } from '../auth/SessionOwner';
import { AccountForm, Field, textField } from './AccountForm';
import styles from './Accounts.module.css';

type Profile = components['schemas']['PrivateProfile'];

/** Edit account-owned profile fields while keeping immutable identity and unavailable uploads clear. */
export function ProfilePanel({ owner, profile }: { owner: SessionOwner; profile: Profile }) {
  const [notice, setNotice] = useState('');

  async function save(fields: FormData) {
    const reply = await owner.client.PATCH('/api/v1/account/profile', {
      body: {
        version: profile.version,
        display_name: textField(fields, 'display_name'),
        biography: textField(fields, 'biography'),
        phone: textField(fields, 'phone') || null,
      },
    });
    owner.replaceProfile(requirePayload(reply));
    setNotice('Profile saved.');
  }

  return (
    <div className={styles.panel}>
      <section className={styles.card}>
        <div className={styles.profileHeading}>
          <Avatar initials={profile.display_name.slice(0, 2).toUpperCase()} size="large" />
          <div>
            <h2>Profile</h2>
            <button className={styles.textButton} disabled aria-describedby="avatar-unavailable">
              Change photo
            </button>
            <p id="avatar-unavailable" className={styles.hint}>
              Avatar uploads are not available yet.
            </p>
          </div>
        </div>
        <AccountForm
          key={profile.version}
          submitLabel="Save profile"
          onSubmit={save}
          successMessage="Profile saved."
        >
          <Field
            label="Display name"
            name="display_name"
            defaultValue={profile.display_name}
            required
            maxLength={80}
          />
          <label className={styles.field}>
            <span>Biography</span>
            <textarea name="biography" defaultValue={profile.biography} maxLength={500} />
          </label>
          <Field
            label="Phone (private)"
            name="phone"
            type="tel"
            defaultValue={profile.phone ?? ''}
            maxLength={40}
          />
          <p className={styles.hint}>
            Your phone is private account text. It is not used for login or directory search.
          </p>
        </AccountForm>
        {notice && (
          <p role="status" className={styles.notice}>
            {notice}
          </p>
        )}
      </section>
      <SettingsAccountDetails profile={{ username: profile.username, email: profile.email }} />
      <section className={styles.card}>
        <h3>Conversations</h3>
        <p className={styles.hint}>
          Messaging is coming soon. Your account settings and contacts are ready to use.
        </p>
        <a className={styles.textButton} href="/demo">
          Explore sample conversations
        </a>
      </section>
    </div>
  );
}
