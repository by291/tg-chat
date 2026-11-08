import type { components } from '@/api/schema';
import type { Conversation } from '../data/messageModels';
import type { Confirmation } from './ActionConfirmation';
import styles from './ConnectedChat.module.css';

const MUTE_DAY_MS = 24 * 60 * 60 * 1000;

/** Present account-owned preferences separately from shared message expiry and destructive actions. */
export function ConversationControls(props: {
  conversation: Conversation;
  onCommand: (action: components['schemas']['CommandAction']) => Promise<void>;
  onConfirm: (confirmation: Confirmation) => void;
  onError: (error: unknown) => void;
  onPins: () => void;
}) {
  const conversation = props.conversation;
  const isMuted = Boolean(
    conversation.muted_until && Date.parse(conversation.muted_until) > Date.now(),
  );
  const preferences = {
    kind: 'preferences' as const,
    is_archived: conversation.is_archived,
    is_hidden: conversation.is_hidden,
    is_manually_unread: conversation.is_manually_unread,
    pin_rank: conversation.pin_rank,
    muted_until: conversation.muted_until,
    keep_archived: conversation.keep_archived,
  };

  function change(action: components['schemas']['CommandAction']) {
    void props.onCommand(action).catch(props.onError);
  }

  function confirm(kind: 'clear' | 'close') {
    const isClosing = kind === 'close';
    props.onConfirm({
      title: isClosing ? 'Close conversation?' : 'Clear history for me?',
      description:
        'This removes your access to existing history. The other participant keeps their copy.',
      choices: [
        {
          label: isClosing ? 'Close conversation' : 'Clear for me',
          action: () => props.onCommand({ kind }),
        },
      ],
    });
  }

  return (
    <details className={styles.preferences}>
      <summary>Conversation options</summary>
      <div className={styles.actions}>
        <button type="button" onClick={props.onPins}>
          Pinned messages
        </button>
        <button
          type="button"
          onClick={() => change({ ...preferences, is_archived: !conversation.is_archived })}
        >
          {conversation.is_archived ? 'Unarchive' : 'Archive'}
        </button>
        <button
          type="button"
          onClick={() => change({ ...preferences, is_hidden: !conversation.is_hidden })}
        >
          {conversation.is_hidden ? 'Show conversation' : 'Hide conversation'}
        </button>
        <button
          type="button"
          onClick={() =>
            change({ ...preferences, is_manually_unread: !conversation.is_manually_unread })
          }
        >
          {conversation.is_manually_unread ? 'Remove unread mark' : 'Mark unread'}
        </button>
        <button
          type="button"
          onClick={() =>
            change({ ...preferences, pin_rank: conversation.pin_rank === null ? 0 : null })
          }
        >
          {conversation.pin_rank === null ? 'Pin conversation' : 'Unpin conversation'}
        </button>
        <button
          type="button"
          onClick={() =>
            change({
              ...preferences,
              muted_until: isMuted ? null : new Date(Date.now() + MUTE_DAY_MS).toISOString(),
            })
          }
        >
          {isMuted ? 'Unmute' : 'Mute for one day'}
        </button>
        <label>
          <input
            type="checkbox"
            checked={conversation.keep_archived}
            onChange={(event) => change({ ...preferences, keep_archived: event.target.checked })}
          />
          Keep archived when messages arrive
        </label>
        <label>
          Auto-delete new messages
          <select
            value={conversation.expiry_days}
            onChange={(event) => change({ kind: 'expiry', days: Number(event.target.value) })}
          >
            <option value={0}>Off</option>
            <option value={1}>After 1 day</option>
            <option value={7}>After 7 days</option>
            <option value={30}>After 30 days</option>
          </select>
        </label>
        <button type="button" onClick={() => confirm('clear')}>
          Clear history
        </button>
        {conversation.kind !== 'saved' && (
          <button type="button" onClick={() => confirm('close')}>
            Close conversation
          </button>
        )}
      </div>
    </details>
  );
}
