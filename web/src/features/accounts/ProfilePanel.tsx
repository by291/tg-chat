import { useState } from 'react';
import type { components } from '@/api/schema';
import { Avatar } from '@/components/Avatar';
import { AvatarEditor } from '@/features/media/AvatarEditor';
import { SettingsAccountDetails } from '@/features/settings/profile/SettingsAccountDetails';
import { SessionOwner, requirePayload } from '../auth/SessionOwner';
import { AccountForm, Field, textField } from './AccountForm';
import styles from './Accounts.module.css';

type Profile = components['schemas']['PrivateProfile'];

/** Edit account-owned profile fields and publish a validated profile avatar. */
export function ProfilePanel({
  owner,
  profile,
  isAvatarAvailable = false,
}: {
  owner: SessionOwner;
  profile: Profile;
  isAvatarAvailable?: boolean;
}) {
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

  async function assignAvatar(fileId: string | null): Promise<void> {
    const reply = await owner.client.PUT('/api/v1/account/profile/avatar', {
      body: {
        operation_id: crypto.randomUUID(),
        expected_version: profile.version,
        file_id: fileId,
      },
    });
    owner.replaceProfile(requirePayload(reply));
  }

  return (
    <div className={styles.panel}>
      <section className={styles.card}>
        <div className={styles.profileHeading}>
          {isAvatarAvailable ? (
            <AvatarEditor
              session={owner}
              owner="user"
              id={profile.id}
              fileId={profile.avatar_file_id}
              initials={profile.display_name.slice(0, 2).toUpperCase()}
              size="large"
              onAssign={assignAvatar}
            />
          ) : (
            <>
              <Avatar initials={profile.display_name.slice(0, 2).toUpperCase()} size="large" />
              <button className={styles.textButton} disabled aria-describedby="avatar-unavailable">
                Change photo
              </button>
              <p id="avatar-unavailable" className={styles.hint}>
                Avatar uploads are disabled.
              </p>
            </>
          )}
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
    </div>
  );
}
