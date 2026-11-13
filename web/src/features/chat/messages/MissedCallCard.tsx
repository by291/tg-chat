import { PhoneMissed, Video } from 'lucide-react';
import type { CallMode } from '@/features/calls/callModels';
import { useAppPreferences } from '@/features/settings/appPreferences';
import { formatMessageTime } from '../messageFormatting';
import styles from './MessageBubble.module.css';

interface MissedCallCardProps {
  mode: CallMode;
  isOutgoing: boolean;
  createdAt: number;
  onRedial?: (mode: CallMode) => void;
}

/** Show the direction and time of an unanswered call and offer same-mode redial. */
export function MissedCallCard({ mode, isOutgoing, createdAt, onRedial }: MissedCallCardProps) {
  const timeFormat = useAppPreferences((preferences) => preferences.timeFormat);
  const time = formatMessageTime(createdAt, { timeFormat });
  const direction = isOutgoing ? 'outgoing' : 'incoming';
  const title = `Missed ${direction} ${mode} call`;
  const label = `Redial ${mode} call`;
  const CallIcon = mode === 'video' ? Video : PhoneMissed;
  const Card = onRedial ? 'button' : 'div';
  const action = onRedial
    ? {
        type: 'button' as const,
        'aria-label': label,
        'aria-description': `${title}, ${time}`,
        title: label,
        onClick: () => onRedial(mode),
      }
    : undefined;

  return (
    <Card
      {...action}
      className={`${styles.bubble} ${styles.missedCallCard}`}
      data-group-start
      data-group-end
    >
      <CallIcon className={styles.missedCallIcon} size={22} aria-hidden="true" />
      <span className={styles.missedCallDetails}>
        <strong>{title}</strong>
        <time dateTime={new Date(createdAt).toISOString()}>{time}</time>
      </span>
    </Card>
  );
}
