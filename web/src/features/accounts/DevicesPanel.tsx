import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { SidebarNavigation } from '@/layouts/sidebar/SidebarNavigation';
import { useAccountDetail, type AccountDetailNavigation } from './accountDetail';
import { Monitor } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { components } from '@/api/schema';
import dialogs from '@/components/overlays/dialogs.module.css';
import overlays from '@/components/overlays/overlays.module.css';
import { SettingsHeader, SettingsRow } from '@/features/settings/SettingsControls';
import { ApiError, SessionOwner, requirePayload } from '../auth/SessionOwner';
import { useOperation } from './AccountForm';
import { PasswordConfirmation } from './SecurityPanel';
import { useAccountResource } from './useAccountResource';
import styles from './Accounts.module.css';

type Device = components['schemas']['SessionView'];
type SignOutTarget = { kind: 'device'; device: Device } | { kind: 'others' };

function activityTime(device: Device): string {
  return new Date(device.last_seen_at).toLocaleString();
}

/** Show the current and peer sessions separately and confirm peer device sign-out. */
export function DevicesPanel({
  owner,
  onBack,
  navigation,
}: {
  owner: SessionOwner;
  onBack: () => void;
  navigation?: AccountDetailNavigation;
}) {
  const load = useCallback(
    async () => requirePayload(await owner.client.GET('/api/v1/account/devices')),
    [owner],
  );
  const devices = useAccountResource(load);
  const action = useOperation();
  const { value: selectedId, open: setSelectedId } = useAccountDetail(navigation);
  const [target, setTarget] = useState<SignOutTarget>();
  const [needsPassword, setNeedsPassword] = useState(false);
  const sessions = devices.value ?? [];
  const selected = sessions.find((device) => device.id === selectedId);
  const current = sessions.find((device) => device.is_current);
  const others = sessions.filter((device) => !device.is_current);

  function openConfirmation(target: SignOutTarget) {
    setNeedsPassword(false);
    setTarget(target);
  }

  async function revoke(target: SignOutTarget) {
    if (target.kind === 'device') {
      await owner.client.POST('/api/v1/account/devices/revoke', {
        body: { session_id: target.device.id },
      });
      return;
    }

    await owner.client.POST('/api/v1/account/devices/revoke-others');
  }

  function signOut(target: SignOutTarget) {
    void action.run({
      operation: async () => {
        try {
          await revoke(target);
        } catch (failure) {
          setNeedsPassword(
            failure instanceof ApiError && failure.code === 'recent_authentication_required',
          );
          throw failure;
        }

        setSelectedId(undefined);
        setTarget(undefined);
        devices.reload();
      },
      successMessage: target.kind === 'device' ? 'Device signed out.' : 'Other devices signed out.',
    });
  }

  const status = (
    <>
      {devices.isLoading && <p role="status">Loading sessions…</p>}
      {devices.error && (
        <p role="alert" className={styles.error}>
          {devices.error}
        </p>
      )}
      {action.notice && (
        <p role="status" className={styles.notice}>
          {action.notice}
        </p>
      )}
    </>
  );
  const overview = (
    <div className={styles.accountPage}>
      <SettingsHeader title="Active Sessions" backLabel="Back to settings" onBack={onBack} />
      <div className={styles.panel}>
        {status}
        {current && (
          <section className={styles.settingsGroup} aria-label="Current session">
            <h3>Current session</h3>
            <SettingsRow
              label={current.device_name}
              icon={Monitor}
              color="blue"
              value="This browser"
              onClick={() => setSelectedId(current.id)}
            />
            {others.length > 0 && (
              <button
                type="button"
                className={styles.textButton}
                onClick={() => openConfirmation({ kind: 'others' })}
              >
                Sign out other devices
              </button>
            )}
          </section>
        )}
        {others.length > 0 && (
          <section className={styles.settingsGroup} aria-label="Other sessions">
            <h3>Other sessions</h3>
            {others.map((device) => (
              <SettingsRow
                key={device.id}
                label={device.device_name}
                icon={Monitor}
                color="purple"
                value={activityTime(device)}
                onClick={() => setSelectedId(device.id)}
              />
            ))}
          </section>
        )}
      </div>
    </div>
  );

  return (
    <>
      <SidebarNavigation
        isSecondaryOpen={Boolean(selected)}
        primary={overview}
        secondary={
          selected && (
            <div className={styles.accountPage}>
              <SettingsHeader
                title="Device details"
                backLabel="Back to active sessions"
                onBack={() => setSelectedId(undefined)}
              />
              <div className={styles.panel}>
                {status}
                <section className={styles.settingsGroup} aria-label="Session information">
                  <h3>{selected.device_name}</h3>
                  {selected.is_current && <p>This browser</p>}
                  <p>Last active: {activityTime(selected)}</p>
                  <p>Expires: {new Date(selected.expires_at).toLocaleString()}</p>
                  {!selected.is_current && (
                    <button
                      type="button"
                      className={styles.textButton}
                      onClick={() => openConfirmation({ kind: 'device', device: selected })}
                    >
                      Sign out this device
                    </button>
                  )}
                </section>
              </div>
            </div>
          )
        }
      />
      <Dialog.Root
        open={Boolean(target)}
        onOpenChange={(details) => {
          if (!details.open && !action.isPending) {
            setTarget(undefined);
          }
        }}
        lazyMount
        unmountOnExit
      >
        <Portal>
          <Dialog.Backdrop className={dialogs.backdrop} />
          <Dialog.Positioner className={overlays.dialogPositioner}>
            <Dialog.Content className={`${overlays.dialog} ${dialogs.confirmation}`}>
              <Dialog.Title>Confirm sign-out</Dialog.Title>
              <Dialog.Description>
                {target?.kind === 'device'
                  ? `End the session on ${target.device.device_name}?`
                  : 'End every session except this browser?'}
              </Dialog.Description>
              {action.error && (
                <p role="alert" className={styles.error}>
                  {action.error}
                </p>
              )}
              {needsPassword && <PasswordConfirmation owner={owner} />}
              <div className={overlays.dialogActions}>
                <Dialog.CloseTrigger
                  type="button"
                  className={overlays.textButton}
                  disabled={action.isPending}
                >
                  Cancel
                </Dialog.CloseTrigger>
                <button
                  type="button"
                  className={overlays.textButton}
                  disabled={action.isPending}
                  onClick={() => {
                    if (target) {
                      signOut(target);
                    }
                  }}
                >
                  Sign out
                </button>
              </div>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </>
  );
}
