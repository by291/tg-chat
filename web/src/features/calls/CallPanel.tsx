import { ChevronDown, Maximize, Minimize, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Avatar } from '@/components/Avatar';
import type { CallOwner } from './CallOwner';
import type { CallVideo, CallView, MediaStatus } from './callModels';
import { CallControls, type CallControlsProps } from './CallControls';
import { CallDeviceSettings } from './CallDeviceSettings';
import { CallGradient, type CallTone } from './CallGradient';
import { useCallFullscreen } from './useCallFullscreen';
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

interface CallPanelProps {
  owner: CallOwner;
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
  }, [video.stream]);

  return (
    <video
      ref={element}
      aria-label={video.isLocal ? 'Your camera' : 'Peer camera'}
      className={styles.video}
      data-local={video.isLocal || undefined}
      data-mirrored={video.isMirrored || undefined}
      autoPlay
      playsInline
      muted
    />
  );
}

/** Keep the call accessible from any authenticated workspace page. */
export function CallPanel({ owner }: CallPanelProps) {
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

  if (!call || !ownsTab) {
    return (
      <section className={styles.notice} aria-label="Call">
        {error ? (
          <p role="alert">{error}</p>
        ) : (
          <p role="status">{call ? 'Call is open in another tab.' : 'Starting call…'}</p>
        )}
        {!call && error && (
          <button
            className={styles.tool}
            type="button"
            aria-label="Dismiss call message"
            onClick={() => owner.dismiss()}
          >
            <X aria-hidden="true" />
          </button>
        )}
      </section>
    );
  }

  return <CallPanelContents key={call.id} call={call} snapshot={snapshot} owner={owner} />;
}

function CallPanelContents({ call, snapshot, owner }: CallControlsProps & { call: CallView }) {
  const mediaId = useId();
  const statusId = useId();
  const [isMinimized, setIsMinimized] = useState(false);
  const fullscreen = useCallFullscreen();
  const { videos, mediaStatus, error } = snapshot;
  const canCollapse = call.allowed_actions.includes('hangup');
  const isCollapsed = canCollapse && isMinimized;
  const isRinging = call.phase === 'ringing';
  const isReconnecting = Boolean(call.reconnect_deadline) || mediaStatus === 'reconnecting';
  const startedAt = call.active_at ? Date.parse(call.active_at) : NaN;
  const hasDuration = call.phase === 'active' && Number.isFinite(startedAt);
  const hasPeerVideo = videos.some((video) => !video.isLocal);
  const compactLabel = isCollapsed ? 'Restore call panel' : 'Collapse call panel';
  const fullscreenLabel = fullscreen.isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen';

  let tone: CallTone = 'connecting';
  let status = MEDIA_STATUS[mediaStatus];
  if (isReconnecting) {
    tone = 'weak';
    status = MEDIA_STATUS.reconnecting;
  } else if (isRinging) {
    status =
      call.direction === 'outgoing'
        ? `Outgoing ${call.mode} call · Ringing…`
        : `Incoming ${call.mode} call`;
  } else if (mediaStatus === 'connected') {
    tone = 'active';
  }

  async function toggleCompact() {
    // Keep fullscreen bound to the expanded panel until the browser confirms its exit.
    if (fullscreen.isFullscreen && !(await fullscreen.exit())) {
      return;
    }
    setIsMinimized(!isCollapsed);
  }

  return (
    <section
      ref={fullscreen.panelRef}
      className={styles.panel}
      aria-label="Call"
      data-collapsed={isCollapsed || undefined}
      data-video={videos.length > 0 || undefined}
    >
      <CallGradient tone={tone} />
      {/* Hiding the video layer leaves both the node and its playing MediaStream attached. */}
      <div
        id={mediaId}
        className={styles.videos}
        hidden={isCollapsed}
        data-has-peer={hasPeerVideo || undefined}
      >
        {videos.map((video) => (
          <CallVideoTile key={video.id} video={video} />
        ))}
      </div>
      <div className={styles.toolbar}>
        {canCollapse && (
          <button
            type="button"
            className={styles.collapse}
            aria-label={compactLabel}
            title={compactLabel}
            aria-controls={mediaId}
            aria-describedby={isCollapsed ? statusId : undefined}
            aria-expanded={!isCollapsed}
            disabled={fullscreen.isPending}
            onClick={() => void toggleCompact()}
          >
            <ChevronDown aria-hidden="true" />
          </button>
        )}
        {!isCollapsed && (
          <div className={styles.tools}>
            {mediaStatus === 'connected' && (
              <CallDeviceSettings snapshot={snapshot} owner={owner} />
            )}
            {fullscreen.isSupported && (
              <button
                type="button"
                className={styles.tool}
                aria-label={fullscreenLabel}
                title={fullscreenLabel}
                disabled={fullscreen.isPending}
                onClick={() => void fullscreen.toggle()}
              >
                {fullscreen.isFullscreen ? <Minimize aria-hidden /> : <Maximize aria-hidden />}
              </button>
            )}
          </div>
        )}
      </div>
      <div className={styles.identity}>
        <Avatar initials={call.peer_display_name.slice(0, 2).toUpperCase()} />
        <h2>{call.peer_display_name}</h2>
        <div className={styles.statusLine}>
          <span id={statusId} role="status">
            {status}
          </span>
          {hasDuration && <CallDuration startedAt={startedAt} />}
        </div>
      </div>
      {(error || fullscreen.error) && (
        <p className={styles.error} role="alert">
          {error || fullscreen.error}
        </p>
      )}
      <CallControls owner={owner} snapshot={snapshot} isCompact={isCollapsed} />
    </section>
  );
}
