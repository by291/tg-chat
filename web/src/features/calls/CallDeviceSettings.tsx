import { Settings } from 'lucide-react';
import { useId, useState } from 'react';
import type { CallOwner } from './CallOwner';
import type { DeviceKind } from './callModels';
import type { CallControlsProps } from './CallControls';
import styles from './CallPanel.module.css';

function DevicePicker({
  kind,
  devices,
  selectedDevice,
  owner,
  isDisabled,
}: {
  kind: DeviceKind;
  devices: MediaDeviceInfo[];
  selectedDevice?: string;
  owner: CallOwner;
  isDisabled: boolean;
}) {
  const available = devices.filter((device) => device.kind === kind && device.deviceId);
  if (!available.length) {
    return null;
  }

  const label = kind === 'audioinput' ? 'Microphone' : 'Camera';
  return (
    <label className={styles.device}>
      {label}
      <select
        value={selectedDevice ?? ''}
        disabled={isDisabled}
        onChange={(event) => void owner.selectDevice({ kind, deviceId: event.target.value })}
      >
        <option value="">System default</option>
        {available.map((device, index) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || `${label} ${index + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Offer the permitted input devices only after the user opens call settings. */
export function CallDeviceSettings({ owner, snapshot }: CallControlsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const settingsId = useId();
  const hasDevices = snapshot.devices.some((device) => device.deviceId);
  const isDisabled = snapshot.isMediaControlBusy;
  return (
    <div className={styles.settings}>
      <button
        className={styles.tool}
        type="button"
        aria-label="Device settings"
        title="Device settings"
        aria-expanded={isOpen}
        aria-controls={settingsId}
        onClick={() => setIsOpen(!isOpen)}
      >
        <Settings aria-hidden="true" />
      </button>
      {isOpen && (
        <div id={settingsId} className={styles.devices} role="group" aria-label="Device settings">
          <DevicePicker
            kind="audioinput"
            devices={snapshot.devices}
            selectedDevice={snapshot.selectedDevices.audioinput}
            owner={owner}
            isDisabled={isDisabled}
          />
          <DevicePicker
            kind="videoinput"
            devices={snapshot.devices}
            selectedDevice={snapshot.selectedDevices.videoinput}
            owner={owner}
            isDisabled={isDisabled}
          />
          {!hasDevices && <p>No other inputs are available.</p>}
        </div>
      )}
    </div>
  );
}
