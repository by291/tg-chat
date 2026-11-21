import { useEffect, useSyncExternalStore } from 'react';
import type { ChatOwner } from '../data/ChatOwner';
import { renderMessage, type CanonicalMessage } from '../data/messageModels';
import { pollManagement } from '../messages/content/poll/pollManagement';
import { usePollClock } from '../messages/content/poll/usePollClock';
import { ActionConfirmation } from './ActionConfirmation';

function findPoll(messages: CanonicalMessage[], messageId: string) {
  const message = messages.find((entry) => entry.id === messageId);
  if (!message || message.is_deleted || message.body?.kind !== 'poll') {
    return;
  }
  const media = renderMessage(message).media;
  return media?.kind === 'poll' ? media : undefined;
}

/** Keep close confirmation and command admission bound to the live poll and its deadline. */
export function PollCloseConfirmation({
  owner,
  messageId,
  isBusy,
  onCancel,
  onChoose,
}: {
  owner: Pick<ChatOwner, 'subscribe' | 'getSnapshot' | 'command'>;
  messageId: string;
  isBusy: boolean;
  onCancel: () => void;
  onChoose: (action: () => Promise<void>) => void;
}) {
  const snapshot = useSyncExternalStore(owner.subscribe, owner.getSnapshot);
  const poll = findPoll(snapshot.messages, messageId);
  const now = usePollClock(poll?.closesAt);
  const canClose = Boolean(poll && pollManagement(poll, now).canClose);
  useEffect(() => {
    if (!canClose) {
      onCancel();
    }
  }, [canClose, onCancel]);

  async function close() {
    // A new projection or the deadline can win the race with React's dialog dismissal.
    const current = findPoll(owner.getSnapshot().messages, messageId);
    if (current && pollManagement(current).canClose) {
      await owner.command({ kind: 'close_poll', message_id: messageId });
    }
  }

  return (
    <ActionConfirmation
      confirmation={
        canClose
          ? {
              title: 'Close poll?',
              description: 'Voting will end immediately.',
              choices: [{ label: 'Close poll', action: close }],
            }
          : undefined
      }
      isBusy={isBusy}
      onCancel={onCancel}
      onChoose={onChoose}
    />
  );
}
