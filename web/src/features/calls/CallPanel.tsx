import { Maximize2, Minimize2, Phone, PhoneOff, Video, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Avatar } from '@/components/Avatar';
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

const RINGTONE_SOURCE = {
  incoming: '/assets/audio/call-incoming.wav',
  outgoing: '/assets/audio/call-outgoing.wav',
};

const MILLISECONDS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * MINUTES_PER_HOUR;

type CallSnapshot = ReturnType<CallOwner['getSnapshot']>;

interface CallPanelProps {
  owner: CallOwner;
  isChatOpen: boolean;
}

function callTitle(call: CallView): string {
  if (call.phase === 'ringing') {
    return call.direction === 'incoming'
      ? `Incoming ${call.mode} call`
      : `Outgoing ${call.mode} call`;
  }
  return call.mode === 'video' ? 'Video call' : 'Voice call';
}

function CallDuration({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), MILLISECONDS_PER_SECOND);
    return () => window.clearInterval(interval);
  }, []);

  const elapsed = Math.max(0, Math.floor((now - startedAt) / MILLISECONDS_PER_SECOND));
  const hours = Math.floor(elapsed / SECONDS_PER_HOUR);
  const minutes = Math.floor((elapsed % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = elapsed % SECONDS_PER_MINUTE;
  const clock = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  return (
    <span className={styles.duration} role="timer" aria-label="Call duration">
      {hours > 0 ? `${hours}:${clock}` : clock}
    </span>
  );
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
      data-local={video.isLocal || undefined}
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
export function CallPanel({ owner, isChatOpen }: CallPanelProps) {
  const snapshot = useSyncExternalStore(owner.subscribe, owner.getSnapshot);
  const { call, ownsTab, isBusy, error } = snapshot;
  const ringingCall = ownsTab && !isBusy && call?.phase === 'ringing' ? call : undefined;
  const ringingId = ringingCall?.id;
  const ringingDirection = ringingCall?.direction;

  useEffect(() => {
    if (!ringingId || !ringingDirection) {
      return;
    }

    const ringtone = new Audio(RINGTONE_SOURCE[ringingDirection]);
    ringtone.loop = true;
    // A browser may require prior user activation for audible playback.
    void ringtone.play().catch(() => undefined);
    return () => ringtone.pause();
  }, [ringingId, ringingDirection]);

  if (!call && !error && !isBusy) {
    return null;
  }

  return (
    <CallPanelContents key={call?.id} snapshot={snapshot} owner={owner} isChatOpen={isChatOpen} />
  );
}

function CallPanelContents({
  snapshot,
  owner,
  isChatOpen,
}: CallPanelProps & { snapshot: CallSnapshot }) {
  const detailsId = useId();
  const [isMinimized, setIsMinimized] = useState(false);
  const { call, ownsTab, isBusy, error, mediaStatus } = snapshot;
  const isElsewhere = call && !ownsTab;
  const title = call && !isElsewhere ? callTitle(call) : 'Call';
  const status = call?.reconnect_deadline ? MEDIA_STATUS.reconnecting : MEDIA_STATUS[mediaStatus];
  const isRinging = call?.phase === 'ringing';
  const isIncoming = isRinging && call.direction === 'incoming';
  const canCollapse = ownsTab && Boolean(call?.allowed_actions.includes('hangup'));
  const isCollapsed = canCollapse && isMinimized;
  const startedAt = call?.active_at ? Date.parse(call.active_at) : NaN;
  const canShowDuration = ownsTab && call?.phase === 'active' && Number.isFinite(startedAt);
  const ToggleIcon = isCollapsed ? Maximize2 : Minimize2;
  const Icon = call?.mode === 'video' ? Video : Phone;

  return (
    <section
      className={styles.panel}
      aria-label="Call"
      data-chat-open={isChatOpen || undefined}
      data-collapsed={isCollapsed || undefined}
    >
      <div className={styles.heading}>
        {call && !isCollapsed ? (
          <Avatar initials={call.peer_display_name.slice(0, 2).toUpperCase()} />
        ) : (
          <Icon size={20} aria-hidden="true" />
        )}
        <div className={styles.identity}>
          <h2 aria-live="polite">{title}</h2>
          {call && <p>{call.peer_display_name}</p>}
        </div>
        {canShowDuration && <CallDuration startedAt={startedAt} />}
        {canCollapse && (
          <button
            className={styles.toggle}
            type="button"
            aria-label={isCollapsed ? 'Restore call panel' : 'Collapse call panel'}
            aria-controls={detailsId}
            aria-expanded={!isCollapsed}
            onClick={() => setIsMinimized(!isMinimized)}
          >
            <ToggleIcon size={18} aria-hidden="true" />
          </button>
        )}
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
      {ownsTab && call && !isRinging && (
        <p className={styles.status} role="status">
          {status}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {call && ownsTab && (
        // Keeping the details mounted preserves attached video tracks during a collapse.
        <div id={detailsId} className={styles.details} hidden={isCollapsed}>
          <CallPanelDetails snapshot={snapshot} owner={owner} />
        </div>
      )}
    </section>
  );
}

function CallPanelDetails({ snapshot, owner }: { snapshot: CallSnapshot; owner: CallOwner }) {
  const { call, isBusy, mediaStatus } = snapshot;
  const isRinging = call?.phase === 'ringing';
  const isIncoming = isRinging && call.direction === 'incoming';
  const canControlMedia = mediaStatus === 'connected' && !snapshot.isMediaControlBusy;
  const canJoin = !isRinging && call && mediaStatus === 'idle';
  const canHangup = call?.allowed_actions.includes('hangup');
  const hasPeerVideo = snapshot.videos.some((video) => !video.isLocal);

  return (
    <>
      {snapshot.videos.length > 0 && (
        <div className={styles.videos} data-has-peer={hasPeerVideo || undefined}>
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
        {isIncoming && (
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
        {isRinging && !isIncoming && (
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
    </>
  );
}
