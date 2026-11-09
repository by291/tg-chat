import { ArrowLeft, MessageCircle, Search, Settings, Users } from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { components } from '@/api/schema';
import { conversationDestination } from '@/features/communities/communityModels';
import { CurrentUserProvider } from '@/features/chat/CurrentUser';
import { isCancelled } from '@/features/auth/SessionOwner';
import type { Message } from '@/domain/messages/message';
import type { MessageCommand } from '../messages/commands';
import { canonicalMessageContent } from '../data/messageContent';
import { ActionConfirmation, type Confirmation } from './ActionConfirmation';
import { ConversationControls } from './ConversationControls';
import { PinnedMessages } from './PinnedMessages';
import { ChatOwner } from '../data/ChatOwner';
import {
  compareCounter,
  destinationKey,
  type CanonicalMessage,
  renderMessage,
  renderPending,
  type Conversation,
} from '../data/messageModels';
import { MessageComposer, type ComposedMessage } from '../composer/MessageComposer';
import { MessageTimeline } from '../history/MessageTimeline';
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

/** Reuse the editor and bounded virtual timeline with authenticated, server-owned message state. */
export function ConnectedChat({
  owner,
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
  }, [selectedKey]);
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

  async function submit(message: ComposedMessage) {
    if (isPersisting) {
      return;
    }
    setIsPersisting(true);
    setError('');
    try {
      if (editing) {
        await owner.command({
          kind: 'edit',
          message_id: editing.id,
          expected_version: editVersion,
          content: canonicalMessageContent(message),
        });
        setEditing(undefined);
      } else {
        await owner.queueSend(message);
      }
    } catch (failure) {
      report(failure);
    } finally {
      setIsPersisting(false);
    }
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
                <MessageCircle aria-hidden="true" />
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
                    {entry.request.content.text}
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
              <MessageTimeline
                key={selectedKey}
                messages={messages}
                precedingMessage={
                  snapshot.precedingMessage ? renderMessage(snapshot.precedingMessage) : undefined
                }
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
                onInteract={() => undefined}
                onOpenMedia={() => undefined}
                onJumpToMessage={(id) => void owner.jumpToMessage(id).catch(report)}
              />
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
                {editing && snapshot.editConflict?.id === editing.id && (
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
                <MessageComposer
                  key={selectedKey}
                  isTextOnly
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
              </footer>
            </>
          ) : (
            <div className={styles.empty}>Choose a conversation or find someone to message.</div>
          )}
        </section>
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
