import { useCallback } from 'react';
import { SettingsHeader } from '@/features/settings/SettingsControls';
import { SessionOwner, requirePayload } from '../auth/SessionOwner';
import { useOperation } from './AccountForm';
import { PasswordConfirmation } from './SecurityPanel';
import { useAccountResource } from './useAccountResource';
import styles from './Accounts.module.css';

/** Show authoritative sessions and revoke peer devices without exposing another account's metadata. */
export function DevicesPanel({ owner, onBack }: { owner: SessionOwner; onBack: () => void }) {
  const load = useCallback(
    async () => requirePayload(await owner.client.GET('/api/v1/account/devices')),
    [owner],
  );
  const devices = useAccountResource(load);
  const action = useOperation();

  function revoke(sessionId: string) {
    void action.run({
      operation: async () => {
        await owner.client.POST('/api/v1/account/devices/revoke', {
          body: { session_id: sessionId },
        });
        devices.reload();
      },
      successMessage: 'Device signed out.',
    });
  }

  function revokeOthers() {
    void action.run({
      operation: async () => {
        await owner.client.POST('/api/v1/account/devices/revoke-others');
        devices.reload();
      },
      successMessage: 'Other devices signed out.',
    });
  }

  return (
    <>
      <SettingsHeader title="Active Sessions" backLabel="Back to profile" onBack={onBack} />
      <div className={styles.panel}>
        <section className={styles.card}>
          <h2>Your devices</h2>
          {devices.isLoading && <p role="status">Loading sessions…</p>}
          {(devices.error || action.error) && (
            <p role="alert" className={styles.error}>
              {devices.error || action.error}
            </p>
          )}
          {action.notice && (
            <p role="status" className={styles.notice}>
              {action.notice}
            </p>
          )}
          <ul className={styles.list}>
            {devices.value?.map((session) => (
              <li key={session.id} className={styles.listRow}>
                <div>
                  <strong>{session.device_name}</strong>
                  {session.is_current && <p>This browser</p>}
                  <p className={styles.hint}>
                    Last active: {new Date(session.last_seen_at).toLocaleString()}
                  </p>
                  <p className={styles.hint}>
                    Expires: {new Date(session.expires_at).toLocaleString()}
                  </p>
                </div>
                {!session.is_current && (
                  <button
                    type="button"
                    className={styles.textButton}
                    disabled={action.isPending}
                    onClick={() => revoke(session.id)}
                  >
                    Revoke {session.device_name}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className={styles.textButton}
            disabled={action.isPending || !devices.value?.some((session) => !session.is_current)}
            onClick={revokeOthers}
          >
            Sign out other devices
          </button>
          <p className={styles.hint}>
            Sessions expire after 30 days, or after seven days without activity.
          </p>
        </section>
        <PasswordConfirmation owner={owner} />
      </div>
    </>
  );
}
