import { ArrowLeft, MessageCircle, Search, Settings, Users } from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { components } from '@/api/schema';
import { conversationDestination } from '@/features/communities/communityModels';
import { CurrentUserProvider } from '@/features/chat/CurrentUser';
import { ApiError, isCancelled, type SessionOwner } from '@/features/auth/SessionOwner';
import { ConnectedMediaContext } from '@/features/media/ConnectedMediaContext';
import { RemoteAvatar } from '@/features/media/RemoteAvatar';
import type { MessageInteraction } from '@/domain/messages/interaction';
import type { PollMedia } from '@/domain/messages/media';
import type { Message } from '@/domain/messages/message';
import type { Conversation as PickerConversation } from '@/domain/conversations/conversation';
import type { MessageCommand, MessageMenuAction } from '../messages/commands';
import type { ChecklistMedia } from '@/domain/messages/media';
import { checklistInput } from '../data/checklistInput';
import { canonicalMessageContent } from '../data/messageContent';
import { ActionConfirmation, type Confirmation } from './ActionConfirmation';
import { ConversationControls } from './ConversationControls';
import { PinnedMessages } from './PinnedMessages';
import { PollVotersDialog } from './PollVotersDialog';
import { ComposerListDialog, type ListSubmitOptions } from '../composer/forms/ComposerListDialog';
import { pollInput } from '../data/pollInput';
import { ChatOwner } from '../data/ChatOwner';
import {
  compareCounter,
  destinationKey,
  type CanonicalMessage,
  type MessageBodyInput,
  renderMessage,
  renderPending,
  type Conversation,
  type Destination,
} from '../data/messageModels';
import { MessageComposer, type ComposedMessage } from '../composer/MessageComposer';
import { MessageTimeline } from '../history/MessageTimeline';
import { ChatSearch } from '../search/ChatSearch';
import { GlobalMessageSearch } from '../search/GlobalMessageSearch';
import { ShareContactDialog } from '../composer/ShareContactDialog';
import { ContactLinkContext } from '../messages/content/contact/ContactActions';
import { ForwardMessageDialog } from '../messages/forwarding/ForwardMessageDialog';
import type { MessageSelectionChange } from '../messages/selection/useMessageSelectionGesture';
import styles from './ConnectedChat.module.css';

// prettier-ignore
const CONNECTED_ACTIONS: MessageMenuAction[] = [
  'reply',
  'edit',
  'delete',
  'pin',
  'copy',
  'add-task',
  'edit-checklist',
  'forward',
  'select',
  'forward-selected',
  'delete-selected',
  'clear-selection',
];
const MAX_BATCH_MESSAGES = 20;
const REMOVE_MESSAGE_DESCRIPTION =
  'Choose whose history should change. Deletion cannot be undone. Existing forwarded copies remain available.';
// prettier-ignore
const REACTIONS = [
  '👍',
  '👎',
  '❤️',
  '🔥',
  '🥰',
  '👏',
  '😁',
  '🤔',
  '😢',
  '🎉',
];

interface ConnectedChatProps {
  owner: ChatOwner;
  session?: SessionOwner;
  isMediaAvailable?: boolean;
  user: components['schemas']['PrivateProfile'];
  onSettings: () => void;
  onFindPeople: () => void;
  onCommunities: () => void;
  onCommunityDetails: (id: string) => void;
}

function title(conversation: Conversation): string {
  if (conversation.kind === 'saved') {
    return 'Saved Messages';
  }
  return conversation.title || conversation.peer_name;
}

function forwardDestinationTitle(destination: Destination, conversations: Conversation[]): string {
  if (destination.kind === 'saved') {
    return 'Saved Messages';
  }

  const conversation = conversations.find((entry) => {
    return destination.kind === 'conversation'
      ? entry.id === destination.conversation_id
      : entry.kind === 'direct' && entry.peer_id === destination.user_id;
  });
  return conversation ? title(conversation) : 'Unavailable conversation';
}

function pickerConversation(conversation: Conversation): PickerConversation {
  const name = title(conversation);
  const kind = conversation.kind === 'direct' ? 'private' : conversation.kind;
  return {
    id: conversation.id,
    title: name,
    subtitle: conversation.peer_username,
    initials: name.slice(0, 2).toUpperCase(),
    color: '#5288c1',
    preview: conversation.summary_text,
    time: '',
    kind:
      kind === 'private' || kind === 'group' || kind === 'channel' || kind === 'saved'
        ? kind
        : undefined,
  };
}

function canEditPoll(message: CanonicalMessage | undefined): boolean {
  return message?.body?.kind === 'poll' && !message.is_deleted && message.body.can_edit;
}

/** Reuse the editor and bounded virtual timeline with authenticated, server-owned message state. */
export function ConnectedChat({
  owner,
  session,
  isMediaAvailable = false,
  user,
  onSettings,
  onFindPeople,
  onCommunities,
  onCommunityDetails,
}: ConnectedChatProps) {
  const snapshot = useSyncExternalStore(owner.subscribe, owner.getSnapshot);
  const [isDirectoryVisible, setIsDirectoryVisible] = useState(!snapshot.selection);
  const [isPersisting, setIsPersisting] = useState(false);
  const [error, setError] = useState('');
  const [folder, setFolder] = useState('inbox');
  const [directoryQuery, setDirectoryQuery] = useState('');
  const [searchConversationId, setSearchConversationId] = useState<string>();
  const [editing, setEditing] = useState<CanonicalMessage>();
  const [editVersion, setEditVersion] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [isPinsOpen, setIsPinsOpen] = useState(false);
  const [contactDestination, setContactDestination] = useState<string>();
  const [selectedIds, setSelectedIds] = useState<string[]>();
  const [forwardIds, setForwardIds] = useState<string[]>();
  const [voterMessageId, setVoterMessageId] = useState<string>();
  const [checklistEditor, setChecklistEditor] = useState<{
    messageId: string;
    version: string;
    initialChecklist: ChecklistMedia;
  }>();
  const [pollEditor, setPollEditor] = useState<{
    messageId: string;
    version: string;
    initialPoll: PollMedia;
  }>();
  const voterMessage = snapshot.messages.find((entry) => entry.id === voterMessageId);
  const voterPoll = voterMessage?.is_deleted ? undefined : voterMessage?.body;
  const canViewVoters =
    voterPoll?.kind === 'poll' && !voterPoll.is_anonymous && voterPoll.voter_count != null;
  const currentEditorMessage = snapshot.messages.find(
    (entry) => entry.id === pollEditor?.messageId,
  );
  const canShowPollEditor = canEditPoll(currentEditorMessage);
  const currentChecklist = snapshot.messages.find(
    (entry) => entry.id === checklistEditor?.messageId,
  );
  const canShowChecklistEditor =
    currentChecklist?.body?.kind === 'checklist' &&
    !currentChecklist.is_deleted &&
    currentChecklist.body.can_edit;
  // Keep the editor's captured object stable while canonical updates arrive underneath it.
  const editingMessage = useMemo(() => (editing ? renderMessage(editing) : undefined), [editing]);
  const conversation = owner.selectedConversation();
  const selection = snapshot.selection;
  const isCommunity = conversation?.kind === 'group' || conversation?.kind === 'channel';
  const canPost = conversation?.can_post ?? selection?.destination.kind !== 'conversation';
  const canForward = Boolean(conversation && conversation.is_forwarding_enabled !== false);
  const allowedActions = CONNECTED_ACTIONS.filter((action) => {
    if (action === 'pin') {
      return conversation?.can_manage ?? false;
    }
    if (action === 'reply' || action === 'edit') {
      return canPost;
    }
    if (action === 'forward' || action === 'forward-selected') {
      return canForward;
    }
    return true;
  });
  const messages = snapshot.messages.map((canonical) => {
    const message = renderMessage(canonical);
    message.isRead =
      conversation?.kind === 'direct' &&
      canonical.author_id === user.id &&
      compareCounter(canonical.sequence, conversation.peer_read_through) <= 0;
    return message;
  });
  const normalizedDirectoryQuery = directoryQuery.trim().toLowerCase();
  const directory = snapshot.conversations.filter((entry) => {
    if (normalizedDirectoryQuery) {
      const matchesTitle = title(entry).toLowerCase().includes(normalizedDirectoryQuery);
      return matchesTitle || entry.peer_username.toLowerCase().includes(normalizedDirectoryQuery);
    }
    if (folder === 'hidden') {
      return entry.is_hidden;
    }
    return !entry.is_hidden && entry.is_archived === (folder === 'archived');
  });
  directory.sort((first, second) => {
    const pinDifference = (first.pin_rank ?? Infinity) - (second.pin_rank ?? Infinity);
    return pinDifference || Date.parse(second.updated_at) - Date.parse(first.updated_at);
  });
  const reply = snapshot.draft.reply;
  let replyMessage: Message | undefined = messages.find(
    (message) => message.id === reply?.message_id,
  );
  if (reply && !replyMessage) {
    replyMessage = {
      id: reply.message_id,
      chatId: conversation?.id ?? '',
      authorId: '',
      authorName: 'Reply to message',
      text: snapshot.draft.isReplyUnavailable
        ? 'Message unavailable'
        : (reply.quote ?? 'Open the original message'),
      createdAt: 0,
      reactions: [],
    };
  }
  const acceptedIds = new Set(messages.map((message) => message.id));
  const selectedKey = selection ? destinationKey(selection.destination) : '';
  useEffect(() => {
    setEditing(undefined);
    setIsPinsOpen(false);
    setSearchConversationId(undefined);
    setConfirmation(undefined);
    setContactDestination(undefined);
    setVoterMessageId(undefined);
    setPollEditor(undefined);
    setChecklistEditor(undefined);
    setSelectedIds(undefined);
    setForwardIds(undefined);
  }, [selectedKey, conversation?.generation]);
  useEffect(() => {
    if (!canPost) {
      setEditing(undefined);
      setConfirmation(undefined);
    }
  }, [canPost]);
  const pending = snapshot.pending.filter((entry) => {
    const destination = entry.request.destination;
    const isCanonical =
      destination.kind === 'conversation' && destination.conversation_id === conversation?.id;
    const isRecipient =
      destination.kind === 'recipient' && destination.user_id === conversation?.peer_id;
    return destinationKey(destination) === selectedKey || isCanonical || isRecipient;
  });
  for (const entry of pending) {
    if (!acceptedIds.has(entry.request.message_id)) {
      messages.push(
        renderPending({
          pending: entry,
          user,
          conversationId: conversation?.id ?? selectedKey,
        }),
      );
    }
  }

  function report(failure: unknown) {
    if (!isCancelled(failure)) {
      setError(failure instanceof Error ? failure.message : 'The request could not be completed.');
    }
  }

  function openConversation(entry: Conversation) {
    setEditing(undefined);
    setIsPinsOpen(false);
    setError('');
    setDirectoryQuery('');
    const destination = conversationDestination(entry);
    void owner.select({ destination, title: title(entry) }).catch(report);
    setIsDirectoryVisible(false);
  }

  async function openGlobalResult(result: { conversationId: string; messageId: string }) {
    const conversations = owner.getSnapshot().conversations;
    const entry = conversations.find((candidate) => candidate.id === result.conversationId);
    if (!entry) {
      throw new ApiError({ code: 'not_found', message: 'Message unavailable' });
    }
    const destination = conversationDestination(entry);
    await owner.select({ destination, title: title(entry) }, { messageId: result.messageId });
    setDirectoryQuery('');
    setIsDirectoryVisible(false);
  }

  async function submit(message: ComposedMessage): Promise<boolean> {
    if (isPersisting) {
      return false;
    }
    setIsPersisting(true);
    setError('');
    try {
      if (editing) {
        await owner.command({
          kind: 'edit',
          message_id: editing.id,
          expected_version: editVersion,
          disable_link_preview: message.disableLinkPreview,
          content: canonicalMessageContent(message, {
            isCaption: Boolean(editing.attachments?.length),
          }),
        });
        setEditing(undefined);
      } else if (message.sticker) {
        await owner.queueBody({ kind: 'sticker', sticker_id: message.sticker });
      } else if (message.files?.length) {
        await owner.enqueueMedia({
          value: message,
          files: message.files,
          disableLinkPreview: message.disableLinkPreview,
        });
      } else {
        await owner.queueSend(message);
      }
      return true;
    } catch (failure) {
      report(failure);
      return false;
    } finally {
      setIsPersisting(false);
    }
  }

  async function queueContact(body: MessageBodyInput): Promise<boolean> {
    try {
      await owner.queueBody(body);
      return true;
    } catch (failure) {
      report(failure);
      return false;
    }
  }

  async function queuePoll(message: ComposedMessage): Promise<boolean> {
    if (message.media?.kind !== 'poll') {
      return false;
    }

    await owner.queueBody({ ...pollInput(message.media), kind: 'poll' });
    return true;
  }

  async function savePoll(message: ComposedMessage, options?: ListSubmitOptions): Promise<boolean> {
    if (!pollEditor || message.media?.kind !== 'poll') {
      return false;
    }

    await owner.command({
      kind: 'edit_poll',
      message_id: pollEditor.messageId,
      expected_poll_version: pollEditor.version,
      poll: pollInput(message.media),
      preserve_quiz: options?.shouldPreserveQuiz,
    });
    return true;
  }

  async function queueChecklist(message: ComposedMessage): Promise<boolean> {
    if (message.media?.kind !== 'checklist') {
      return false;
    }

    await owner.queueBody({ ...checklistInput(message.media), kind: 'checklist' });
    return true;
  }

  async function saveChecklist(message: ComposedMessage): Promise<boolean> {
    if (!checklistEditor || message.media?.kind !== 'checklist') {
      return false;
    }

    await owner.command({
      kind: 'edit_checklist',
      message_id: checklistEditor.messageId,
      expected_list_version: checklistEditor.version,
      checklist: checklistInput(message.media),
    });
    return true;
  }

  async function interactWithChecklist(
    message: CanonicalMessage,
    body: components['schemas']['ChecklistView'],
    interaction: MessageInteraction,
  ): Promise<boolean> {
    switch (interaction.type) {
      case 'set-task':
        await owner.command({
          kind: 'set_checklist_task',
          message_id: message.id,
          task_id: interaction.taskId,
          expected_task_version: interaction.expectedTaskVersion,
          is_complete: interaction.isComplete,
        });
        return true;
      case 'add-task':
        if (interaction.expectedListVersion === undefined) {
          return false;
        }
        await owner.command({
          kind: 'append_checklist_tasks',
          message_id: message.id,
          expected_list_version: interaction.expectedListVersion,
          tasks: [{ id: interaction.id, text: interaction.text }],
        });
        return true;
      case 'edit-checklist': {
        const checklist = renderMessage(message).media;
        if (checklist?.kind !== 'checklist' || !body.can_edit) {
          return false;
        }
        setChecklistEditor({
          messageId: message.id,
          version: body.list_version,
          initialChecklist: checklist,
        });
        return true;
      }
      default:
        return false;
    }
  }

  async function interact(messageId: string, interaction: MessageInteraction): Promise<boolean> {
    const message = snapshot.messages.find((entry) => entry.id === messageId);
    const body = message?.body;
    if (!message || message.is_deleted || !body) {
      return false;
    }

    try {
      if (body.kind === 'checklist') {
        setError('');
        return await interactWithChecklist(message, body, interaction);
      }
      if (body.kind !== 'poll') {
        return false;
      }

      switch (interaction.type) {
        case 'vote':
          await owner.command({
            kind: 'vote_poll',
            message_id: messageId,
            option_ids: interaction.optionIds,
          });
          break;
        case 'add-option':
          await owner.command({
            kind: 'add_poll_option',
            message_id: messageId,
            expected_poll_version: body.version,
            option: { id: interaction.id, text: interaction.text },
          });
          break;
        case 'edit-poll': {
          const poll = renderMessage(message).media;
          if (poll?.kind === 'poll' && body.can_edit) {
            setPollEditor({ messageId, version: body.version, initialPoll: poll });
          }
          break;
        }
        case 'close-poll':
          setConfirmation({
            title: 'Close poll?',
            description: 'Voting will end immediately.',
            choices: [
              {
                label: 'Close poll',
                action: () => owner.command({ kind: 'close_poll', message_id: messageId }),
              },
            ],
          });
          break;
        case 'view-voters':
          setVoterMessageId(messageId);
          break;
      }
      return true;
    } catch (failure) {
      report(failure);
      return false;
    }
  }

  async function openContactLink(accountId: string) {
    if (await owner.openContact(accountId)) {
      setIsDirectoryVisible(false);
    }
  }

  function messageCommand(command: MessageCommand) {
    const canonical = snapshot.messages.find((message) => message.id === command.message.id);
    if (!canonical || canonical.is_deleted || canonical.service_kind) {
      return;
    }
    switch (command.action) {
      case 'select':
        toggleSelection(canonical.id);
        break;
      case 'clear-selection':
        setSelectedIds(undefined);
        break;
      case 'forward':
        setForwardIds([canonical.id]);
        break;
      case 'forward-selected':
        setForwardIds(selectedIds);
        break;
      case 'delete-selected':
        confirmSelectedRemoval();
        break;
      case 'reply':
        setEditing(undefined);
        void owner.setReply({ message_id: canonical.id }).catch(report);
        break;
      case 'edit':
        setEditing(canonical);
        setEditVersion(canonical.version);
        break;
      case 'copy':
        void navigator.clipboard.writeText(command.message.text).catch(report);
        break;
      case 'pin':
        void owner
          .command({
            kind: 'pin',
            message_id: canonical.id,
            is_pinned: !canonical.is_pinned,
          })
          .catch(report);
        break;
      case 'delete': {
        const choices: Confirmation['choices'] = [
          {
            label: 'Hide for me',
            action: () => owner.command({ kind: 'hide_message', message_id: canonical.id }),
          },
        ];
        if (canonical.author_id === user.id || (isCommunity && conversation.can_manage)) {
          choices.push({
            label: 'Delete for everyone',
            action: () => owner.command({ kind: 'delete', message_id: canonical.id }),
          });
        }
        setConfirmation({
          title: 'Remove message?',
          description: REMOVE_MESSAGE_DESCRIPTION,
          choices,
        });
        break;
      }
    }
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

    const eligibleMessages = snapshot.messages.filter(
      (message) => !message.is_deleted && !message.service_kind && messageIds.includes(message.id),
    );
    if (eligibleMessages.length === 0) {
      return;
    }

    const eligibleIds = eligibleMessages.map((message) => message.id);
    const selected = new Set([...(selectedIds ?? []), ...eligibleIds]);
    if (selected.size > MAX_BATCH_MESSAGES) {
      setError(`You can select up to ${MAX_BATCH_MESSAGES} messages.`);
    }
    setSelectedIds((current) => {
      const ids = new Set([...(current ?? []), ...eligibleIds]);
      return Array.from(ids).slice(0, MAX_BATCH_MESSAGES);
    });
  }

  function confirmSelectedRemoval() {
    if (!selectedIds?.length) {
      return;
    }
    const ids = selectedIds;
    const selected = snapshot.messages.filter((message) => ids.includes(message.id));
    const mayDelete =
      selected.length === ids.length &&
      selected.every((message) => {
        return message.author_id === user.id || (isCommunity && conversation.can_manage);
      });
    const choices: Confirmation['choices'] = [
      { label: 'Hide for me', action: async () => removeSelected({ ids, kind: 'batch_hide' }) },
    ];
    if (mayDelete) {
      choices.push({
        label: 'Delete for everyone',
        action: async () => removeSelected({ ids, kind: 'batch_delete' }),
      });
    }
    setConfirmation({
      title: 'Remove selected messages?',
      description: REMOVE_MESSAGE_DESCRIPTION,
      choices,
    });
  }

  async function removeSelected(input: { ids: string[]; kind: 'batch_hide' | 'batch_delete' }) {
    await owner.command({ kind: input.kind, message_ids: input.ids });
    setSelectedIds(undefined);
  }

  async function forwardTo(recipients: PickerConversation[]) {
    if (!forwardIds?.length) {
      return;
    }
    // The picker closes before its callback. A changed conversation must not submit stale picks.
    const current = owner.getSnapshot().selection;
    if (!current || destinationKey(current.destination) !== selectedKey) {
      return;
    }
    const ids = new Set(forwardIds);
    const ordered = snapshot.messages.filter((message) => ids.has(message.id));
    if (ordered.length !== ids.size) {
      setForwardIds(undefined);
      setError('Some selected messages are no longer available.');
      return;
    }
    const destinations = recipients.map((recipient) => ({
      kind: 'conversation' as const,
      conversation_id: recipient.id,
    }));
    try {
      await owner.queueForwards({ destinations, messageIds: ordered.map((message) => message.id) });
      setSelectedIds(undefined);
    } catch (failure) {
      report(failure);
    } finally {
      setForwardIds(undefined);
    }
  }

  function react(messageId: string, emoji: string) {
    const message = snapshot.messages.find((entry) => entry.id === messageId);
    if (!message) {
      return;
    }
    const isSelected = message.reactions.some(
      (reaction) => reaction.emoji === emoji && reaction.is_selected,
    );
    void owner
      .command({
        kind: 'reaction',
        message_id: messageId,
        emoji,
        is_selected: !isSelected,
      })
      .catch(report);
  }

  async function confirm(action: () => Promise<void>) {
    setIsPersisting(true);
    try {
      await action();
      setConfirmation(undefined);
    } catch (failure) {
      report(failure);
    } finally {
      setIsPersisting(false);
    }
  }

  const mediaActions = session
    ? {
        session,
        retry: (id: string) => void owner.retry(id).catch(report),
        cancel: (id: string) => void owner.discard(id).catch(report),
        jump: (id: string) => void owner.jumpToMessage(id).catch(report),
        reselect: (input: { messageId: string; occurrenceId: string; file: File }) =>
          void owner.restoreMediaSource(input).catch(report),
        notify: setError,
      }
    : undefined;

  return (
    <CurrentUserProvider value={user.id}>
      <main className={styles.workspace} data-directory-visible={isDirectoryVisible}>
        <aside className={styles.directory} aria-label="Conversations">
          <header className={styles.directoryHeader}>
            <h1>Messages</h1>
            <button type="button" aria-label="Account settings" onClick={onSettings}>
              <Settings />
            </button>
            <button type="button" aria-label="Find people" onClick={onFindPeople}>
              <Search />
            </button>
            <button type="button" aria-label="Communities" onClick={onCommunities}>
              <Users />
            </button>
          </header>
          {!snapshot.isReady && <p role="status">Loading conversations…</p>}
          <div className={styles.directorySearch}>
            <Search size={18} aria-hidden="true" />
            <input
              type="text"
              aria-label="Search chats and messages"
              placeholder="Search"
              value={directoryQuery}
              onChange={(event) => setDirectoryQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
                  setDirectoryQuery('');
                }
              }}
            />
          </div>
          {!normalizedDirectoryQuery && (
            <label className={styles.folder}>
              Conversations
              <select
                aria-label="Conversation folder"
                value={folder}
                onChange={(event) => setFolder(event.target.value)}
              >
                <option value="inbox">Inbox</option>
                <option value="archived">Archived</option>
                <option value="hidden">Hidden</option>
              </select>
            </label>
          )}
          {directory.map((entry) => (
            <button
              type="button"
              className={styles.conversation}
              aria-pressed={conversation?.id === entry.id}
              key={entry.id}
              onClick={() => openConversation(entry)}
            >
              <span className={styles.avatar}>
                {session && (entry.avatar_file_id || entry.peer_avatar_file_id) ? (
                  <RemoteAvatar
                    session={session}
                    owner={entry.avatar_file_id ? 'conversation' : 'user'}
                    id={entry.avatar_file_id ? entry.id : entry.peer_id}
                    fileId={entry.avatar_file_id ?? entry.peer_avatar_file_id}
                    initials={title(entry).slice(0, 2).toUpperCase()}
                  />
                ) : (
                  <MessageCircle aria-hidden="true" />
                )}
              </span>
              <span className={styles.summary}>
                <strong>{title(entry)}</strong>
                <span>
                  {entry.draft.content?.text
                    ? `Draft: ${entry.draft.content.text}`
                    : entry.summary_text || 'Start a conversation'}
                </span>
                {(entry.unread_count !== '0' || entry.is_manually_unread) && (
                  <span aria-label="Unread messages">
                    {entry.unread_count === '0' ? 'Unread' : entry.unread_count}
                  </span>
                )}
                {entry.pin_rank !== null && <span>Pinned</span>}
              </span>
            </button>
          ))}
          {snapshot.isReady && (
            <GlobalMessageSearch
              query={directoryQuery}
              visibilityKey={owner.searchVisibilityKey()}
              loadPage={owner.searchMessages}
              onSelect={openGlobalResult}
            />
          )}
          {snapshot.pendingCommands.length > 0 && (
            <section className={styles.pending} aria-label="Unconfirmed actions">
              <h2>Unconfirmed actions</h2>
              <p>Review current state before retrying or dismissing an action.</p>
              {snapshot.pendingCommands.map((entry) => (
                <div key={entry.request.operation_id}>
                  <span>{entry.request.action.kind}</span>
                  <button
                    type="button"
                    onClick={() =>
                      void owner.retryCommand(entry.request.operation_id).catch(report)
                    }
                  >
                    Retry action
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void owner.discardCommand(entry.request.operation_id).catch(report)
                    }
                  >
                    Dismiss action
                  </button>
                </div>
              ))}
            </section>
          )}
          {snapshot.pending.length > 0 && (
            <section className={styles.pending} aria-label="Pending messages">
              <h2>Pending messages</h2>
              {snapshot.pending.map((entry) => (
                <div className={styles.pendingItem} key={entry.request.message_id}>
                  <button
                    type="button"
                    onClick={() => {
                      void owner
                        .select({
                          destination: entry.request.destination,
                          title: entry.title ?? 'Pending conversation',
                        })
                        .catch(report);
                      setIsDirectoryVisible(false);
                    }}
                  >
                    {entry.request.content.text ||
                      entry.media?.map((item) => item.filename).join(', ') ||
                      'Pending message'}
                  </button>
                  <p>{entry.error || 'Waiting for server confirmation'}</p>
                  <div className={styles.actions}>
                    <button
                      type="button"
                      onClick={() => void owner.retry(entry.request.message_id).catch(report)}
                    >
                      Retry
                    </button>
                    <button
                      type="button"
                      onClick={() => void owner.discard(entry.request.message_id).catch(report)}
                    >
                      Remove from outbox
                    </button>
                  </div>
                </div>
              ))}
              <p>
                Removing an unconfirmed item does not delete a message already saved by the server.
              </p>
            </section>
          )}
          {snapshot.pendingForwards.length > 0 && (
            <section className={styles.pending} aria-label="Pending forwards">
              <h2>Pending forwards</h2>
              {snapshot.pendingForwards.map((entry) => (
                <div className={styles.pendingItem} key={entry.request.operation_id}>
                  <strong>
                    {forwardDestinationTitle(entry.request.destination, snapshot.conversations)}
                  </strong>
                  <p>{entry.error ?? 'Waiting for server confirmation'}</p>
                  {entry.error && (
                    <button
                      type="button"
                      onClick={() =>
                        void owner.dismissForward(entry.request.operation_id).catch(report)
                      }
                    >
                      Dismiss forward
                    </button>
                  )}
                </div>
              ))}
            </section>
          )}
        </aside>
        <section className={styles.chat} aria-label="Chat">
          <header className={styles.chatHeader}>
            <button
              type="button"
              aria-label="Back to conversations"
              onClick={() => {
                owner.cancelContactOpen();
                setIsDirectoryVisible(true);
              }}
            >
              <ArrowLeft />
            </button>
            <div>
              <h2>{conversation ? title(conversation) : (selection?.title ?? 'Your messages')}</h2>
              <p>
                {isCommunity
                  ? `${conversation.kind} · ${conversation.role}`
                  : 'Private conversation'}
              </p>
            </div>
            {isCommunity && (
              <button type="button" onClick={() => onCommunityDetails(conversation.id)}>
                Community details
              </button>
            )}
            {conversation && (
              <button
                type="button"
                aria-label="Search this conversation"
                aria-pressed={searchConversationId === conversation.id}
                onClick={() => {
                  setIsPinsOpen(false);
                  setSearchConversationId((current) => {
                    return current === conversation.id ? undefined : conversation.id;
                  });
                }}
              >
                <Search />
              </button>
            )}
            {selection && (
              <button type="button" onClick={() => void owner.loadHistory('latest')}>
                Latest messages
              </button>
            )}
          </header>
          {conversation && (
            <ConversationControls
              conversation={conversation}
              onCommand={(action) => owner.command(action)}
              onConfirm={setConfirmation}
              onError={report}
              onPins={() => setIsPinsOpen(true)}
            />
          )}
          {conversation && searchConversationId === conversation.id && (
            <div className={styles.conversationSearch}>
              <ChatSearch
                key={conversation.id}
                messages={messages}
                canFilterSender={conversation.kind !== 'saved'}
                onClose={() => setSearchConversationId(undefined)}
                onJump={(messageId) => owner.jumpToMessage(messageId, { shouldRevalidate: true })}
                source={{
                  conversationId: conversation.id,
                  visibilityKey: owner.searchVisibilityKey(conversation.id),
                  loadPage: owner.searchMessages,
                  onJumpToDate: (timestamp) => owner.jumpToDate(timestamp),
                  senderRoster:
                    conversation.kind === 'group'
                      ? { revision: conversation.generation, loadPage: owner.loadSearchSenders }
                      : undefined,
                  senders:
                    conversation.kind === 'direct'
                      ? [
                          { id: user.id, name: user.display_name },
                          { id: conversation.peer_id, name: conversation.peer_name },
                        ]
                      : undefined,
                }}
              />
            </div>
          )}
          {isPinsOpen && conversation && (
            <PinnedMessages
              key={conversation.id}
              owner={owner}
              version={conversation.version}
              onClose={() => setIsPinsOpen(false)}
              onError={report}
            />
          )}
          {(error || snapshot.error) && (
            <p className={styles.error} role="alert">
              {error || snapshot.error}
            </p>
          )}
          {selection ? (
            <>
              {selectedIds && (
                <div className={styles.historyControls} aria-label="Message selection">
                  <button type="button" onClick={() => setSelectedIds(undefined)}>
                    Cancel selection
                  </button>
                  <span>{selectedIds.length} selected</span>
                  {canForward && (
                    <button
                      type="button"
                      disabled={!selectedIds.length}
                      onClick={() => setForwardIds(selectedIds)}
                    >
                      Forward selected messages
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={!selectedIds.length}
                    onClick={confirmSelectedRemoval}
                  >
                    Delete selected messages
                  </button>
                </div>
              )}
              <div className={styles.historyControls}>
                {snapshot.hasOlder && (
                  <button
                    type="button"
                    disabled={snapshot.isLoading}
                    onClick={() => void owner.loadHistory('older')}
                  >
                    Load older messages
                  </button>
                )}
                {snapshot.isLoading && <span role="status">Loading messages…</span>}
                {snapshot.hasNewer && <span>Viewing older history</span>}
              </div>
              <ConnectedMediaContext.Provider value={mediaActions}>
                <ContactLinkContext.Provider
                  value={session ? (id) => void openContactLink(id).catch(report) : undefined}
                >
                  <MessageTimeline
                    key={selectedKey}
                    messages={messages}
                    precedingMessage={
                      snapshot.precedingMessage
                        ? renderMessage(snapshot.precedingMessage)
                        : undefined
                    }
                    shouldShowSender={conversation?.kind === 'group'}
                    allowedActions={allowedActions}
                    selectedIds={selectedIds}
                    onToggleSelection={toggleSelection}
                    onSetSelection={setMessageSelection}
                    reactionChoices={REACTIONS}
                    navigation={snapshot.navigation}
                    onReachLatest={() => {
                      const reached = snapshot.messages.at(-1);
                      if (reached && !isDirectoryVisible && !editing) {
                        void owner.markReached(reached.id).catch(report);
                      }
                    }}
                    remoteHistory={{
                      hasOlder: snapshot.hasOlder,
                      isLoading: snapshot.isLoading,
                      loadOlder: () => void owner.loadHistory('older'),
                    }}
                    searchQuery=""
                    onCommand={messageCommand}
                    onReact={react}
                    onInteract={interact}
                    onOpenMedia={() => undefined}
                    onJumpToMessage={(id) => void owner.jumpToMessage(id).catch(report)}
                  />
                </ContactLinkContext.Provider>
              </ConnectedMediaContext.Provider>
              <footer className={styles.composer}>
                {snapshot.draftConflict && (
                  <div className={styles.conflict} role="status">
                    <p>
                      Another device changed this draft:{' '}
                      {snapshot.draftConflict.value.text || '(empty draft)'}
                    </p>
                    <button type="button" onClick={() => void owner.keepLocalDraft().catch(report)}>
                      Keep my draft
                    </button>
                    <button
                      type="button"
                      onClick={() => void owner.restoreDraft(snapshot.draftConflict!).catch(report)}
                    >
                      Use other draft
                    </button>
                  </div>
                )}
                {snapshot.draftAlternatives?.map((draft) => (
                  <div className={styles.conflict} key={draft.id}>
                    <p>Recovered draft: {draft.value.text}</p>
                    <button
                      type="button"
                      onClick={() => void owner.restoreDraft(draft).catch(report)}
                    >
                      Restore recovered draft
                    </button>
                  </div>
                ))}
                {canPost && editing && snapshot.editConflict?.id === editing.id && (
                  <div className={styles.conflict} role="status">
                    <p>Current message: {snapshot.editConflict.content.text}</p>
                    <p>
                      Your edit is still in the editor. Choose whether to save it over this version.
                    </p>
                    <button
                      type="button"
                      onClick={() => setEditVersion(snapshot.editConflict!.version)}
                    >
                      Keep my edit for next save
                    </button>
                    <button type="button" onClick={() => setEditing(undefined)}>
                      Discard my edit
                    </button>
                  </div>
                )}
                {!canPost && <p role="status">You cannot post in this conversation.</p>}
                {canPost && (
                  <MessageComposer
                    key={selectedKey}
                    isTextOnly
                    canSendSticker
                    onShareContact={session ? () => setContactDestination(selectedKey) : undefined}
                    isPollAnonymousOnly={conversation?.kind === 'channel'}
                    onPollSubmit={queuePoll}
                    onChecklistSubmit={queueChecklist}
                    isMediaAvailable={isMediaAvailable}
                    onMediaSubmit={submit}
                    editingMessage={editingMessage}
                    replyMessage={replyMessage}
                    isDisabled={isPersisting || !snapshot.isReady || !canPost}
                    draft={snapshot.draft.value.text}
                    draftCustomEmoji={snapshot.draft.value.customEmoji}
                    draftRichText={snapshot.draft.value.richText}
                    onDraftChange={(value) => void owner.setDraft(value).catch(report)}
                    onSubmit={(message) => void submit(message)}
                    onCancelContext={() => {
                      setEditing(undefined);
                      void owner.setReply(undefined).catch(report);
                    }}
                    onJumpToMessage={(id) => void owner.jumpToMessage(id).catch(report)}
                    onNotify={setError}
                  />
                )}
              </footer>
            </>
          ) : (
            <div className={styles.empty}>Choose a conversation or find someone to message.</div>
          )}
        </section>
        {session && contactDestination === selectedKey && (
          <ShareContactDialog
            key={contactDestination}
            session={session}
            onClose={() => setContactDestination(undefined)}
            onSubmit={queueContact}
          />
        )}
        {forwardIds && (
          <ForwardMessageDialog
            conversations={snapshot.conversations
              .filter((entry) => entry.can_post)
              .map(pickerConversation)}
            onClose={() => setForwardIds(undefined)}
            onChooseRecipient={(recipient) => void forwardTo([recipient])}
            onSend={({ recipients }) => void forwardTo(recipients)}
          />
        )}
        {pollEditor && canShowPollEditor && canPost && (
          <ComposerListDialog
            key={pollEditor.messageId}
            kind="poll"
            isConnected
            isPollAnonymousOnly={conversation?.kind === 'channel'}
            initialPoll={pollEditor.initialPoll}
            onClose={() => setPollEditor(undefined)}
            onSubmit={savePoll}
          />
        )}
        {checklistEditor && canShowChecklistEditor && (
          <ComposerListDialog
            key={checklistEditor.messageId}
            kind="checklist"
            isConnected
            initialChecklist={checklistEditor.initialChecklist}
            onClose={() => setChecklistEditor(undefined)}
            onSubmit={saveChecklist}
          />
        )}
        {voterMessageId && canViewVoters && (
          <PollVotersDialog
            key={`${conversation?.generation}:${voterMessageId}:${voterPoll.version}`}
            owner={owner}
            messageId={voterMessageId}
            options={voterPoll.options}
            onClose={() => setVoterMessageId(undefined)}
          />
        )}
        <ActionConfirmation
          confirmation={confirmation}
          isBusy={isPersisting}
          onCancel={() => setConfirmation(undefined)}
          onChoose={(action) => void confirm(action)}
        />
      </main>
    </CurrentUserProvider>
  );
}
