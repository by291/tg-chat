import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { CircleMinus, Globe } from 'lucide-react';
import { useState } from 'react';
import {
  describeCurrentDevice,
  MAX_DEVICE_NAME_LENGTH,
  readDeviceName,
  saveDeviceName,
  type CurrentDevice,
} from './currentDevice';
import { Ripple } from '@/components/Ripple';
import { showToast } from '@/components/toastStore';
import { SettingsHeader, SettingsSwitch } from '../SettingsControls';
import { SidebarNavigation } from '@/layouts/sidebar/SidebarNavigation';
import styles from '../SettingsPage.module.css';
import devices from './DevicesSettingsPage.module.css';
import dialogs from '@/features/conversations/ConversationDialogs.module.css';
import overlays from '@/features/chat/overlays.module.css';

/** Show local device information while keeping server-owned session actions unavailable. */
export function DevicesSettingsPage({ onBack }: { onBack: () => void }) {
  const [device] = useState(() => describeCurrentDevice(navigator));
  const [deviceName, setDeviceName] = useState(readDeviceName);
  const [draftName, setDraftName] = useState('');
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const displayName = deviceName || device.browser;

  function openRename() {
    setDraftName(deviceName);
    setIsRenameOpen(true);
  }

  function renameDevice() {
    const name = draftName.trim();
    if (!saveDeviceName(name)) {
      showToast('Could not save the device name on this browser.');
      return;
    }
    setDeviceName(name);
    setIsRenameOpen(false);
  }

  const overview = (
    <section className={styles.page} aria-label="Devices">
      <SettingsHeader title="Active Sessions" backLabel="Back from devices" onBack={onBack} />
      <div className={styles.scrollContent}>
        <section className={styles.section} aria-label="This device">
          <div className={devices.sectionHeading}>
            <h3>This device</h3>
            <button className={devices.rename} onClick={openRename}>
              Rename
            </button>
          </div>
          <button
            className={`${styles.row} ${devices.sessionRow}`}
            aria-label="View current device"
            onClick={() => setIsDetailsOpen(true)}
          >
            <span className={styles.icon} data-color="purple">
              <Globe aria-hidden="true" />
            </span>
            <span className={devices.sessionText}>
              <strong>React study Web</strong>
              <span>
                {displayName}, {device.system}
              </span>
              <span className={devices.secondary}>This browser · Local only</span>
            </span>
            <Ripple />
          </button>
          <button className={devices.terminate} disabled aria-describedby="terminate-unavailable">
            <CircleMinus aria-hidden="true" />
            Terminate All Other Sessions
          </button>
        </section>
        <p id="terminate-unavailable" className={styles.caption}>
          Requires backend. Signing out other devices is not available yet.
        </p>
        <section className={styles.section} aria-label="Active sessions">
          <h3>Active sessions</h3>
          <div className={devices.unavailable}>
            <span className={devices.status}>Requires backend</span>
            <p>Other signed-in devices will appear here when account sessions are connected.</p>
          </div>
        </section>
        <section className={styles.section} aria-label="Automatically Terminate Old Sessions">
          <h3>Automatically Terminate Old Sessions</h3>
          <button className={devices.inactivity} disabled>
            <span>If Inactive For</span>
            <span className={devices.secondary}>Not available</span>
          </button>
        </section>
        <p className={styles.caption}>
          Requires backend. Automatic sign-out is not configured or enforced locally.
        </p>
      </div>
    </section>
  );

  return (
    <div
      className={styles.page}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && isDetailsOpen && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          setIsDetailsOpen(false);
        }
      }}
    >
      <SidebarNavigation
        isSecondaryOpen={isDetailsOpen}
        primary={overview}
        secondary={
          <DeviceDetails
            device={device}
            name={displayName}
            onBack={() => setIsDetailsOpen(false)}
          />
        }
      />
      <Dialog.Root
        open={isRenameOpen}
        onOpenChange={({ open }) => setIsRenameOpen(open)}
        lazyMount
        unmountOnExit
      >
        <Portal>
          <Dialog.Backdrop className={dialogs.backdrop} />
          <Dialog.Positioner className={overlays.dialogPositioner}>
            <Dialog.Content className={`${overlays.dialog} ${dialogs.confirmation}`}>
              <Dialog.Title>Rename Device</Dialog.Title>
              <Dialog.Description>
                This name is saved only in this browser until account sync is available.
              </Dialog.Description>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  renameDevice();
                }}
              >
                <label className={devices.nameField}>
                  <span>Device Name</span>
                  <input
                    autoFocus
                    value={draftName}
                    placeholder={device.browser}
                    maxLength={MAX_DEVICE_NAME_LENGTH}
                    onChange={(event) => setDraftName(event.target.value)}
                  />
                </label>
                <p className={devices.nameHint}>Leave empty to use the browser name.</p>
                <div className={overlays.dialogActions}>
                  <Dialog.CloseTrigger type="button" className={overlays.textButton}>
                    Cancel
                  </Dialog.CloseTrigger>
                  <button type="submit" className={overlays.textButton}>
                    Save
                  </button>
                </div>
              </form>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </div>
  );
}

function DeviceDetails({
  device,
  name,
  onBack,
}: {
  device: CurrentDevice;
  name: string;
  onBack: () => void;
}) {
  return (
    <section className={styles.page} aria-label="Device details">
      <SettingsHeader title="Device" backLabel="Back from device details" onBack={onBack} />
      <div className={styles.scrollContent}>
        <div className={devices.hero}>
          <span className={devices.deviceIcon}>
            <Globe aria-hidden="true" />
          </span>
          <h3>{name}</h3>
          <p>This browser</p>
        </div>
        <section className={styles.section} aria-label="Device information">
          <h3>Info</h3>
          <dl className={devices.details}>
            <div>
              <dt>Application</dt>
              <dd>React study Web</dd>
            </div>
            <div>
              <dt>Browser</dt>
              <dd>{device.browser}</dd>
            </div>
            <div>
              <dt>System</dt>
              <dd>{device.system}</dd>
            </div>
            <div>
              <dt>IP address</dt>
              <dd>Requires backend</dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>Requires backend</dd>
            </div>
            <div>
              <dt>Last active</dt>
              <dd>Requires backend</dd>
            </div>
          </dl>
        </section>
        <p className={styles.caption}>
          Browser-reported information. Account session data is not connected.
        </p>
        <section className={styles.section}>
          <h3>This device accepts</h3>
          <SettingsSwitch label="Incoming Calls" isChecked={false} isDisabled onChange={() => {}} />
        </section>
        <p className={styles.caption}>
          Requires backend. Incoming call permissions are not available yet.
        </p>
      </div>
    </section>
  );
}
