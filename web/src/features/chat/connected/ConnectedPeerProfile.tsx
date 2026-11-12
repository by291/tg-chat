import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { X } from 'lucide-react';
import { useCallback } from 'react';
import { IconButton } from '@/components/IconButton';
import dialogs from '@/components/overlays/dialogs.module.css';
import overlays from '@/components/overlays/overlays.module.css';
import { useAccountResource } from '@/features/accounts/useAccountResource';
import { requirePayload, type SessionOwner } from '@/features/auth/SessionOwner';
import { RemoteAvatar } from '@/features/media/RemoteAvatar';
import styles from './ConnectedChat.module.css';

interface PeerProfileProps {
  session: SessionOwner;
  peerId: string;
  title: string;
  onClose: () => void;
}

/** Resolve the selected peer's public information within the current authenticated session. */
export function ConnectedPeerProfile({ session, peerId, title, onClose }: PeerProfileProps) {
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
    <Dialog.Root
      open
      onOpenChange={({ open }) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <Portal>
        <Dialog.Backdrop className={`${dialogs.backdrop} ${styles.profileBackdrop}`} />
        <Dialog.Positioner className={`${overlays.dialogPositioner} ${styles.profilePositioner}`}>
          <Dialog.Content className={`${overlays.dialog} ${styles.profileDialog}`}>
            <header>
              <Dialog.Title>User Info</Dialog.Title>
              <Dialog.CloseTrigger asChild>
                <IconButton label="Close profile">
                  <X />
                </IconButton>
              </Dialog.CloseTrigger>
            </header>
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
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
