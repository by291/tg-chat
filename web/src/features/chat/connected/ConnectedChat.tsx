import { ArrowLeft, MessageCircle, Search, Settings, Users } from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { components } from '@/api/schema';
import { conversationDestination } from '@/features/communities/communityModels';
import { CurrentUserProvider } from '@/features/chat/CurrentUser';
import { isCancelled, requirePayload, type SessionOwner } from '@/features/auth/SessionOwner';
import { ConnectedMediaContext } from '@/features/media/ConnectedMediaContext';
import { RemoteAvatar } from '@/features/media/RemoteAvatar';
import type { MessageInteraction } from '@/domain/messages/interaction';
import type { PollMedia } from '@/domain/messages/media';
import type { Message } from '@/domain/messages/message';
import type { MessageCommand } from '../messages/commands';
import { canonicalMessageContent } from '../data/messageContent';
import { ActionConfirmation, type Confirmation } from './ActionConfirmation';
import { ConversationControls } from './ConversationControls';
import { PinnedMessages } from './PinnedMessages';
import { PollVotersDialog } from './PollVotersDialog';
import { ComposerListDialog } from '../composer/forms/ComposerListDialog';
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
} from '../data/messageModels';
import { MessageComposer, type ComposedMessage } from '../composer/MessageComposer';
import { MessageTimeline } from '../history/MessageTimeline';
import { ShareContactDialog } from '../composer/ShareContactDialog';
import { ContactLinkContext } from '../messages/content/contact/ContactActions';
import styles from './ConnectedChat.module.css';

// prettier-ignore
const CONNECTED_ACTIONS: MessageCommand['action'][] = [
  'reply',
  'edit',
  'delete',
  'pin',
  'copy',
];
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
  const [editing, setEditing] = useState<CanonicalMessage>();
  const [editVersion, setEditVersion] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [isPinsOpen, setIsPinsOpen] = useState(false);
  const [contactDestination, setContactDestination] = useState<string>();
  const [voterMessageId, setVoterMessageId] = useState<string>();
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
  // Keep the editor's captured object stable while canonical updates arrive underneath it.
  const editingMessage = useMemo(() => (editing ? renderMessage(editing) : undefined), [editing]);
  const conversation = owner.selectedConversation();
  const selection = snapshot.selection;
  const isCommunity = conversation?.kind === 'group' || conversation?.kind === 'channel';
  const canPost = conversation?.can_post ?? selection?.destination.kind !== 'conversation';
  const allowedActions = CONNECTED_ACTIONS.filter((action) => {
    if (action === 'pin') {
      return conversation?.can_manage ?? false;
    }
    if (action === 'reply' || action === 'edit') {
      return canPost;
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
  const directory = snapshot.conversations.filter((entry) => {
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
    setConfirmation(undefined);
    setContactDestination(undefined);
    setVoterMessageId(undefined);
    setPollEditor(undefined);
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
    const destination = conversationDestination(entry);
    void owner.select({ destination, title: title(entry) }).catch(report);
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
          content: canonicalMessageContent(message, {
            isCaption: Boolean(editing.attachments?.length),
          }),
        });
        setEditing(undefined);
      } else if (message.sticker) {
        await owner.queueBody({ kind: 'sticker', sticker_id: message.sticker });
      } else if (message.files?.length) {
        await owner.enqueueMedia({ value: message, files: message.files });
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

  async function savePoll(message: ComposedMessage): Promise<boolean> {
    if (!pollEditor || message.media?.kind !== 'poll') {
      return false;
    }

    await owner.command({
      kind: 'edit_poll',
      message_id: pollEditor.messageId,
      expected_poll_version: pollEditor.version,
      poll: pollInput(message.media),
    });
    return true;
  }

  async function interact(messageId: string, interaction: MessageInteraction): Promise<boolean> {
    const message = snapshot.messages.find((entry) => entry.id === messageId);
    const body = message?.body;
    if (!message || message.is_deleted || body?.kind !== 'poll') {
      return false;
    }

    try {
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
    if (!session) {
      return;
    }

    const response = await session.client.GET('/api/v1/users/{user_id}', {
      params: { path: { user_id: accountId } },
    });
    const profile = requirePayload(response);
    if (profile.id === user.id) {
      await owner.select({ destination: { kind: 'saved' }, title: 'Saved Messages' });
    } else {
      await owner.select({
        destination: { kind: 'recipient', user_id: profile.id },
        title: profile.display_name,
      });
    }
    setIsDirectoryVisible(false);
  }

  function messageCommand(command: MessageCommand) {
    const canonical = snapshot.messages.find((message) => message.id === command.message.id);
    if (!canonical || canonical.is_deleted || canonical.service_kind) {
      return;
    }
    switch (command.action) {
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
          description: 'Choose whose history should change. Deletion cannot be undone.',
          choices,
        });
        break;
      }
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
        </aside>
        <section className={styles.chat} aria-label="Chat">
          <header className={styles.chatHeader}>
            <button
              type="button"
              aria-label="Back to conversations"
              onClick={() => setIsDirectoryVisible(true)}
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
