import { Flag, Forward, Trash2 } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import { Ripple } from '@/components/Ripple';
import styles from './ConversationPane.module.css';

interface MessageSelectionToolbarProps {
  count: number;
  isSelecting: boolean;
  canReport?: boolean;
  isChoosingReport?: boolean;
  onCancel: () => void;
  onDelete?: () => void;
  onForward?: () => void;
  onReport?: () => void;
}

/** Present selection actions admitted by the active conversation owner. */
export function MessageSelectionToolbar({
  count,
  isSelecting,
  canReport,
  isChoosingReport,
  onCancel,
  onDelete,
  onForward,
  onReport,
}: MessageSelectionToolbarProps) {
  const countLabel = `${count} ${count === 1 ? 'message' : 'messages'}`;
  return (
    <div
      className={styles.selectionToolbar}
      inert={!isSelecting}
      aria-hidden={!isSelecting}
      role="region"
      aria-label="Message selection"
    >
      {onDelete && (
        <IconButton
          label="Delete selected messages"
          className={styles.deleteSelected}
          disabled={!count}
          onClick={onDelete}
        >
          <Trash2 />
        </IconButton>
      )}
      <button
        className={styles.selectionCount}
        aria-label={`Cancel selection, ${countLabel}`}
        onClick={onCancel}
      >
        {isChoosingReport && !count ? 'Select messages to report' : countLabel}
        <Ripple />
      </button>
      {onReport && (
        <IconButton label="Report selected messages" disabled={!canReport} onClick={onReport}>
          <Flag />
        </IconButton>
      )}
      {onForward && (
        <IconButton label="Forward selected messages" disabled={!count} onClick={onForward}>
          <Forward />
        </IconButton>
      )}
    </div>
  );
}
