import { useState } from 'react';
import type { ChatOwner } from '../data/ChatOwner';
import { destinationKey, type CanonicalMessage } from '../data/messageModels';
import type { ForwardRecipients } from '../messages/forwarding/ForwardMessageDialog';
import type { MessageSelectionChange } from '../messages/selection/useMessageSelectionGesture';

const MAX_BATCH_MESSAGES = 20;

interface MessageSelectionOptions {
  owner: ChatOwner;
  messages: CanonicalMessage[];
  authorId: string;
  canReport: boolean;
  selectedKey: string;
  generation?: string;
  onError: (message: string) => void;
}

/** Keep message selections and their dialogs within the authorized conversation view. */
export function useMessageSelection({
  owner,
  messages,
  authorId,
  canReport,
  selectedKey,
  generation,
  onError,
}: MessageSelectionOptions) {
  const [selectedIds, setSelectedIds] = useState<string[]>();
  const [isChoosingReportMessages, setIsChoosingReportMessages] = useState(false);
  const [forwardIds, setForwardIds] = useState<string[]>();
  const [reportedMessageIds, setReportedMessageIds] = useState<string[]>();
  const [scope, setScope] = useState({ selectedKey, generation });

  // Reset before rendering a new membership so dialogs cannot display the old selection.
  if (scope.selectedKey !== selectedKey || scope.generation !== generation) {
    setScope({ selectedKey, generation });
    setSelectedIds(undefined);
    setIsChoosingReportMessages(false);
    setForwardIds(undefined);
    setReportedMessageIds(undefined);
  }

  const reportableMessageIds = new Set(
    messages.filter(canReportMessage).map((message) => message.id),
  );
  const canReportSelection = Boolean(
    canReport && selectedIds?.length && selectedIds.every((id) => reportableMessageIds.has(id)),
  );

  function ownsSelection() {
    const current = owner.getSnapshot().selection;
    return (
      current &&
      destinationKey(current.destination) === selectedKey &&
      owner.selectedConversation()?.generation === generation
    );
  }

  function clearSelectedMessages() {
    if (ownsSelection()) {
      setSelectedIds(undefined);
    }
  }

  function canReportMessage(message: CanonicalMessage) {
    return message.author_id !== authorId && !message.is_deleted && !message.service_kind;
  }

  function startReportSelection() {
    setIsChoosingReportMessages(true);
    setSelectedIds([]);
  }

  function cancelMessageSelection() {
    setIsChoosingReportMessages(false);
    setSelectedIds(undefined);
  }

  function reportSelectedMessages() {
    if (!canReportSelection || !selectedIds) {
      return;
    }

    setReportedMessageIds(selectedIds);
  }

  function toggleSelection(messageId: string) {
    const current = selectedIds ?? [];
    setMessageSelection({ messageIds: [messageId], shouldSelect: !current.includes(messageId) });
  }

  function setMessageSelection({ messageIds, shouldSelect }: MessageSelectionChange) {
    if (!shouldSelect) {
      setSelectedIds((current) => current?.filter((id) => !messageIds.includes(id)));
      return;
    }

    const eligibleMessages = messages.filter((message) => {
      if (message.is_deleted || message.service_kind || !messageIds.includes(message.id)) {
        return false;
      }

      return !isChoosingReportMessages || reportableMessageIds.has(message.id);
    });
    if (eligibleMessages.length === 0) {
      return;
    }

    const eligibleIds = eligibleMessages.map((message) => message.id);
    const selected = new Set([...(selectedIds ?? []), ...eligibleIds]);
    if (selected.size > MAX_BATCH_MESSAGES) {
      onError(`You can select up to ${MAX_BATCH_MESSAGES} messages.`);
    }
    setSelectedIds((current) => {
      const ids = new Set([...(current ?? []), ...eligibleIds]);
      return Array.from(ids).slice(0, MAX_BATCH_MESSAGES);
    });
  }

  async function forwardTo({ recipients, caption, customEmoji, richText }: ForwardRecipients) {
    if (!forwardIds?.length) {
      return false;
    }
    // A changed conversation must not submit picks from the previous history.
    if (!ownsSelection()) {
      return false;
    }

    const ids = new Set(forwardIds);
    const ordered = messages.filter((message) => ids.has(message.id));
    if (ordered.length !== ids.size) {
      throw new Error('Some selected messages are no longer available.');
    }
    const destinations = recipients.map((recipient) => ({
      kind: 'conversation' as const,
      conversation_id: recipient.id,
    }));
    await owner.queueForwards({
      destinations,
      messageIds: ordered.map((message) => message.id),
      comment: { text: caption, customEmoji, richText },
    });
    clearSelectedMessages();

    return true;
  }

  return {
    selectedIds,
    forwardIds,
    reportedMessageIds,
    isChoosingReportMessages,
    reportableMessageIds,
    canReportSelection,
    canReportMessage,
    startReportSelection,
    cancelMessageSelection,
    reportSelectedMessages,
    setMessageSelection,
    toggleSelection,
    setForwardIds,
    setReportedMessageIds,
    clearSelectedMessages,
    forwardTo,
  };
}
