import type { components } from '@/api/schema';
import type { CanonicalMessage } from '../data/messageModels';
import type { PendingCommand } from '../data/pendingMessages';
import styles from './ConnectedChat.module.css';

type CommandAction = components['schemas']['CommandAction'];

const ACTION_LABELS: Record<Exclude<CommandAction['kind'], 'preferences'>, string> = {
  draft: 'Save draft',
  read: 'Mark messages as read',
  clear: 'Clear history',
  close: 'Close conversation',
  expiry: 'Change auto-delete',
  edit: 'Edit message',
  delete: 'Delete message for everyone',
  hide_message: 'Remove message for me',
  reaction: 'Change reaction',
  pin: 'Change pinned message',
  vote_poll: 'Vote in poll',
  edit_poll: 'Edit poll',
  add_poll_option: 'Add poll option',
  close_poll: 'Close poll',
  set_forwarding_policy: 'Change forwarding permission',
  batch_hide: 'Remove messages for me',
  batch_delete: 'Delete messages for everyone',
  set_checklist_task: 'Update checklist task',
  append_checklist_tasks: 'Add checklist tasks',
  edit_checklist: 'Edit checklist',
};

const PREFERENCE_LABELS: Record<components['schemas']['PreferenceChange']['field'], string> = {
  archive: 'Change archive status',
  hidden: 'Change chat visibility',
  unread: 'Change unread mark',
  pin: 'Change chat pin',
  mute: 'Change mute',
  archive_retention: 'Change archive preference',
};

interface PendingConversationActionsProps {
  commands: PendingCommand[];
  messages?: CanonicalMessage[];
  conversationName?: (id: string) => string;
  onRetry: (operationId: string) => void;
  onDismiss: (operationId: string) => void;
}

function actionLabel(action: CommandAction): string {
  return action.kind === 'preferences'
    ? PREFERENCE_LABELS[action.change.field]
    : ACTION_LABELS[action.kind];
}

/** Keep retry and dismissal available next to the chat whose action may have been applied. */
export function PendingConversationActions({
  commands,
  messages,
  conversationName,
  onRetry,
  onDismiss,
}: PendingConversationActionsProps) {
  if (commands.length === 0) {
    return null;
  }

  return (
    <details className={styles.recovery}>
      <summary className={styles.recoveryToggle}>Unconfirmed actions ({commands.length})</summary>
      <div className={styles.recoveryPanel}>
        <p>Check the current state before retrying or dismissing.</p>
        {commands.map(({ request }) => {
          const { action, conversation_id: conversationId, operation_id: operationId } = request;
          const target =
            'message_id' in action
              ? messages?.find((message) => message.id === action.message_id && !message.is_deleted)
              : undefined;

          return (
            <div key={operationId} className={styles.recoveredDraft}>
              <strong>{actionLabel(action)}</strong>
              {conversationName && <span>{conversationName(conversationId)}</span>}
              {target?.content.text && <p>{target.content.text}</p>}
              <div className={styles.recoveryActions}>
                <button type="button" onClick={() => onRetry(operationId)}>
                  Retry action
                </button>
                <button type="button" onClick={() => onDismiss(operationId)}>
                  Dismiss action
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
}
