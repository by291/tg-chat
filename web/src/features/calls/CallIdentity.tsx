import { useEffect, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import type { CallView, MediaStatus } from './callModels';
import type { CallTone } from './CallGradient';
import styles from './CallPanel.module.css';

const MEDIA_STATUS: Record<MediaStatus, string> = {
  idle: 'Ready to join',
  preparing: 'Waiting for device permission…',
  waiting: 'Preparing the call…',
  joining: 'Connecting media…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
};

const MILLISECONDS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * MINUTES_PER_HOUR;

export interface CallIdentityProps {
  name: string;
  startedAt: number;
  status: string;
  statusId?: string;
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

/** Derive live status and palette from the server and media owner snapshots. */
export function callPresentation(call: CallView, mediaStatus: MediaStatus) {
  const isRinging = call.phase === 'ringing';
  const isReconnecting = Boolean(call.reconnect_deadline) || mediaStatus === 'reconnecting';
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

  const activation = call.phase === 'active' ? call.active_at : undefined;
  const startedAt = activation ? Date.parse(activation) : NaN;
  return {
    name: call.peer_display_name,
    startedAt,
    tone,
    status,
  };
}

/** Show the same participant, connection status and activation clock in both call surfaces. */
export function CallIdentity({ name, status, startedAt, statusId }: CallIdentityProps) {
  return (
    <div className={styles.identity}>
      <Avatar initials={name.slice(0, 2).toUpperCase()} />
      <h2>{name}</h2>
      <div className={styles.statusLine}>
        <span id={statusId} role="status">
          {status}
        </span>
        {Number.isFinite(startedAt) && <CallDuration startedAt={startedAt} />}
      </div>
    </div>
  );
}
