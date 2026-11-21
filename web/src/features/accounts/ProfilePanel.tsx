import type { components } from '@/api/schema';
import { Avatar } from '@/components/Avatar';
import { AvatarEditor } from '@/features/media/AvatarEditor';
import { SettingsAccountDetails } from '@/features/settings/profile/SettingsAccountDetails';
import { SessionOwner, requirePayload } from '../auth/SessionOwner';
import { ProfileTextForm } from './ProfileTextForm';
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
        <ProfileTextForm key={profile.id} owner={owner} profile={profile} />
      </section>
      <SettingsAccountDetails profile={{ username: profile.username, email: profile.email }} />
    </div>
  );
}
