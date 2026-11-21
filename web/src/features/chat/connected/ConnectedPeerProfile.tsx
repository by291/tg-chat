import { useCallback } from 'react';
import { useAccountResource } from '@/features/accounts/useAccountResource';
import { requirePayload, type SessionOwner } from '@/features/auth/SessionOwner';
import { RemoteAvatar } from '@/features/media/RemoteAvatar';
import { InformationPanel } from '../details/InformationPanel';
import styles from './ConnectedChat.module.css';

interface PeerProfileProps {
  session: SessionOwner;
  peerId: string;
  title: string;
  isOpen: boolean;
  onClose: () => void;
}

/** Resolve the selected peer's public information within the current authenticated session. */
export function ConnectedPeerProfile({
  session,
  peerId,
  title,
  isOpen,
  onClose,
}: PeerProfileProps) {
  const load = useCallback(async () => {
    const reply = await session.client.GET('/api/v1/users/{user_id}', {
      params: { path: { user_id: peerId } },
    });
    return requirePayload(reply);
  }, [session, peerId]);
  const profile = useAccountResource(load);
  const name = profile.value?.display_name ?? title;
  const username = profile.value?.username;
  const biography = profile.value?.biography;

  return (
    <InformationPanel
      title="User Info"
      closeLabel="Close profile"
      isOpen={isOpen}
      onClose={onClose}
    >
      <div className={styles.peerInformation}>
        <div className={styles.profileIdentity}>
          <RemoteAvatar
            session={session}
            owner="user"
            id={peerId}
            fileId={profile.value?.avatar_file_id}
            initials={name.slice(0, 2).toUpperCase()}
            size="large"
          />
          <h3>{name}</h3>
        </div>
        {profile.isLoading && <p role="status">Loading profile…</p>}
        {profile.error && <p role="alert">{profile.error}</p>}
        {(username || biography) && (
          <dl>
            {username && (
              <div className={styles.profileField}>
                <dt>Username</dt>
                <dd>@{username}</dd>
              </div>
            )}
            {biography && (
              <div className={styles.profileField}>
                <dt>Bio</dt>
                <dd>{biography}</dd>
              </div>
            )}
          </dl>
        )}
      </div>
    </InformationPanel>
  );
}
