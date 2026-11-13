import { Phone, PhoneOff, Video, X } from 'lucide-react';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { CallOwner } from './CallOwner';
import type { CallVideo, CallView, DeviceKind, MediaStatus } from './callModels';
import styles from './CallPanel.module.css';

const MEDIA_STATUS: Record<MediaStatus, string> = {
  idle: 'Ready to join',
  preparing: 'Waiting for device permission…',
  waiting: 'Preparing the call…',
  joining: 'Connecting media…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
};

function callTitle(call: CallView): string {
  if (call.phase === 'ringing') {
    return call.direction === 'incoming'
      ? `Incoming ${call.mode} call`
      : `Outgoing ${call.mode} call`;
  }
  return call.mode === 'video' ? 'Video call' : 'Voice call';
}

function CallVideoTile({ video }: { video: CallVideo }) {
  const element = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const current = element.current;
    if (!current) {
      return;
    }

    current.srcObject = video.stream;
    return () => {
      current.srcObject = null;
    };
  }, [video]);

  return (
    <video
      ref={element}
      aria-label={video.isLocal ? 'Your camera' : 'Peer camera'}
      className={styles.video}
      autoPlay
      playsInline
      muted
    />
  );
}

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

/** Keep the call accessible from any authenticated workspace page. */
export function CallPanel({ owner, isChatOpen }: { owner: CallOwner; isChatOpen: boolean }) {
  const snapshot = useSyncExternalStore(owner.subscribe, owner.getSnapshot);
  const { call, ownsTab, isBusy, error, mediaStatus } = snapshot;
  if (!call && !error && !isBusy) {
    return null;
  }

  const isElsewhere = call && !ownsTab;
  const title = call && !isElsewhere ? callTitle(call) : 'Call';
  const status = call?.reconnect_deadline ? MEDIA_STATUS.reconnecting : MEDIA_STATUS[mediaStatus];
  const canControlMedia = mediaStatus === 'connected' && !snapshot.isMediaControlBusy;
  const isRinging = call?.phase === 'ringing';
  const isIncoming = isRinging && call.direction === 'incoming';
  const canJoin = ownsTab && !isRinging && call && mediaStatus === 'idle';
  const canHangup = ownsTab && call?.allowed_actions.includes('hangup');
  const Icon = call?.mode === 'video' ? Video : Phone;
  return (
    <section className={styles.panel} aria-label="Call" data-chat-open={isChatOpen || undefined}>
      <div className={styles.heading}>
        <Icon size={20} aria-hidden="true" />
        <div>
          <h2 aria-live="polite">{title}</h2>
          {call && <p>{call.peer_display_name}</p>}
        </div>
        {!call && error && (
          <button
            className={styles.close}
            type="button"
            aria-label="Dismiss call message"
            onClick={() => owner.dismiss()}
          >
            <X size={18} aria-hidden="true" />
          </button>
        )}
      </div>
      {!call && isBusy && <p role="status">Starting call…</p>}
      {isElsewhere && !error && <p role="status">Call is open in another tab.</p>}
      {ownsTab && isRinging && !isIncoming && <p role="status">Ringing…</p>}
      {ownsTab && call && !isRinging && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
      {snapshot.videos.length > 0 && (
        <div className={styles.videos}>
          {snapshot.videos.map((video) => (
            <CallVideoTile key={video.id} video={video} />
          ))}
        </div>
      )}
      {mediaStatus === 'connected' && (
        <div className={styles.devices}>
          <DevicePicker
            kind="audioinput"
            devices={snapshot.devices}
            selectedDevice={snapshot.selectedDevices.audioinput}
            owner={owner}
            isDisabled={!canControlMedia}
          />
          <DevicePicker
            kind="videoinput"
            devices={snapshot.devices}
            selectedDevice={snapshot.selectedDevices.videoinput}
            owner={owner}
            isDisabled={!canControlMedia}
          />
        </div>
      )}
      <div className={styles.actions}>
        {isIncoming && ownsTab && (
          <>
            <button
              className={styles.primary}
              type="button"
              disabled={isBusy}
              onClick={() => void owner.answer()}
            >
              Answer
            </button>
            <button
              className={styles.danger}
              type="button"
              disabled={isBusy}
              onClick={() => void owner.command('decline')}
            >
              Decline
            </button>
          </>
        )}
        {isRinging && !isIncoming && ownsTab && (
          <button
            className={styles.danger}
            type="button"
            disabled={isBusy}
            onClick={() => void owner.command('cancel')}
          >
            Cancel call
          </button>
        )}
        {canJoin && (
          <button
            className={styles.primary}
            type="button"
            disabled={isBusy}
            onClick={() => void owner.activateMedia()}
          >
            {call.mode === 'video' ? 'Enable microphone and camera' : 'Enable microphone'}
          </button>
        )}
        {mediaStatus === 'connected' && (
          <>
            <button
              type="button"
              disabled={!canControlMedia}
              onClick={() => void owner.toggleMute()}
            >
              {snapshot.isMuted ? 'Unmute' : 'Mute'}
            </button>
            <button
              type="button"
              disabled={!canControlMedia}
              onClick={() => void owner.toggleCamera()}
            >
              {snapshot.isCameraOn ? 'Turn camera off' : 'Turn camera on'}
            </button>
            {snapshot.isAudioBlocked && (
              <button
                type="button"
                disabled={!canControlMedia}
                onClick={() => void owner.playAudio()}
              >
                Play call audio
              </button>
            )}
          </>
        )}
        {canHangup && (
          <button
            className={styles.danger}
            type="button"
            disabled={isBusy}
            onClick={() => void owner.command('hangup')}
          >
            <PhoneOff size={16} aria-hidden="true" /> Hang up
          </button>
        )}
      </div>
    </section>
  );
}
