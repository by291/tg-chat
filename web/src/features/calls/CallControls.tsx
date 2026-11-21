import {
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Video,
  VideoOff,
  Volume2,
  type LucideIcon,
} from 'lucide-react';
import type { CallOwner } from './CallOwner';
import styles from './CallPanel.module.css';

export interface CallControlsProps {
  owner: CallOwner;
  snapshot: ReturnType<CallOwner['getSnapshot']>;
}

interface ActionProps {
  icon: LucideIcon;
  label: string;
  tone?: 'positive' | 'danger' | 'selected';
  isDisabled?: boolean;
  onClick: () => Promise<void>;
}

function Action({ icon: Icon, label, tone, isDisabled, onClick }: ActionProps) {
  return (
    <button
      className={styles.action}
      type="button"
      aria-label={label}
      title={label}
      disabled={isDisabled}
      data-tone={tone}
      onClick={() => void onClick()}
    >
      <span className={styles.circle}>
        <Icon aria-hidden="true" />
      </span>
      <span className={styles.caption}>{label}</span>
    </button>
  );
}

/** Keep the server actions and media controls accessible in their permitted call states. */
export function CallControls({
  owner,
  snapshot,
  isCompact,
  isExiting = false,
}: CallControlsProps & { isCompact: boolean; isExiting?: boolean }) {
  const { call, mediaStatus, isMuted, isCameraOn } = snapshot;
  const isBusy = snapshot.isBusy || isExiting;
  if (!call) {
    return null;
  }

  const allowed = call.allowed_actions;
  const hasMedia = mediaStatus === 'connected';
  const canControl = hasMedia && !snapshot.isMediaControlBusy && !isBusy;
  const canHangup = allowed.includes('hangup');
  const canJoin = !isCompact && canHangup && mediaStatus === 'idle';

  return (
    <div className={styles.actions} aria-label="Call controls" role="group">
      {allowed.includes('accept') && (
        <Action
          icon={Phone}
          label="Answer"
          tone="positive"
          isDisabled={isBusy}
          onClick={() => owner.answer()}
        />
      )}
      {allowed.includes('decline') && (
        <Action
          icon={PhoneOff}
          label="Decline"
          tone="danger"
          isDisabled={isBusy}
          onClick={() => owner.command('decline')}
        />
      )}
      {allowed.includes('cancel') && (
        <Action
          icon={PhoneOff}
          label="Cancel call"
          tone="danger"
          isDisabled={isBusy}
          onClick={() => owner.command('cancel')}
        />
      )}
      {canJoin && (
        <Action
          icon={Mic}
          tone="positive"
          isDisabled={isBusy}
          label={call.mode === 'video' ? 'Enable microphone and camera' : 'Enable microphone'}
          onClick={() => owner.activateMedia()}
        />
      )}
      {(hasMedia || isCompact) && (
        <Action
          icon={isMuted ? MicOff : Mic}
          label={isMuted ? 'Unmute' : 'Mute'}
          tone={isMuted ? 'selected' : undefined}
          isDisabled={!canControl}
          onClick={() => owner.toggleMute()}
        />
      )}
      {!isCompact && hasMedia && (
        <Action
          icon={isCameraOn ? Video : VideoOff}
          label={isCameraOn ? 'Turn camera off' : 'Turn camera on'}
          tone={isCameraOn ? 'selected' : undefined}
          isDisabled={!canControl}
          onClick={() => owner.toggleCamera()}
        />
      )}
      {!isCompact && hasMedia && snapshot.isAudioBlocked && (
        <Action
          icon={Volume2}
          label="Play call audio"
          isDisabled={!canControl}
          onClick={() => owner.playAudio()}
        />
      )}
      {canHangup && (
        <Action
          icon={PhoneOff}
          label="Hang up"
          tone="danger"
          isDisabled={isBusy}
          onClick={() => owner.command('hangup')}
        />
      )}
    </div>
  );
}
