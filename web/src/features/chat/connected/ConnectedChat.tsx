import { ArrowLeft, MessageCircle, Search, Settings } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import type { components } from '@/api/schema';
import { CurrentUserProvider } from '@/features/chat/CurrentUser';
import { isCancelled } from '@/features/auth/SessionOwner';
import { ChatOwner } from '../data/ChatOwner';
import {
  destinationKey,
  renderMessage,
  renderPending,
  type Conversation,
} from '../data/messageModels';
import { MessageComposer, type ComposedMessage } from '../composer/MessageComposer';
import { MessageTimeline } from '../history/MessageTimeline';
import styles from './ConnectedChat.module.css';

interface ConnectedChatProps {
  owner: ChatOwner;
  user: components['schemas']['PrivateProfile'];
  onSettings: () => void;
  onFindPeople: () => void;
}

function title(conversation: Conversation): string {
  return conversation.kind === 'saved' ? 'Saved Messages' : conversation.peer_name;
}

/** Reuse the editor and bounded virtual timeline with authenticated, server-owned message state. */
export function ConnectedChat({ owner, user, onSettings, onFindPeople }: ConnectedChatProps) {
  const snapshot = useSyncExternalStore(owner.subscribe, owner.getSnapshot);
  const [isDirectoryVisible, setIsDirectoryVisible] = useState(!snapshot.selection);
  const [isPersisting, setIsPersisting] = useState(false);
  const [error, setError] = useState('');
  const conversation = owner.selectedConversation();
  const selection = snapshot.selection;
  const messages = snapshot.messages.map(renderMessage);
  const acceptedIds = new Set(messages.map((message) => message.id));
  const selectedKey = selection ? destinationKey(selection.destination) : '';
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
        renderPending({ pending: entry, user, conversationId: conversation?.id ?? selectedKey }),
      );
    }
  }

  function report(failure: unknown) {
    if (!isCancelled(failure)) {
      setError(failure instanceof Error ? failure.message : 'The request could not be completed.');
    }
  }

  function openConversation(entry: Conversation) {
    const destination =
      entry.kind === 'saved'
        ? { kind: 'saved' as const }
        : { kind: 'recipient' as const, user_id: entry.peer_id };
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
      await owner.queueSend(message);
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
          </header>
          {!snapshot.isReady && <p role="status">Loading conversations…</p>}
          {snapshot.conversations.map((entry) => (
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
                <span>{entry.summary_text || 'Start a conversation'}</span>
              </span>
            </button>
          ))}
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
              <h2>{selection?.title ?? 'Your messages'}</h2>
              <p>Private conversation</p>
            </div>
            {selection && (
              <button type="button" onClick={() => void owner.loadHistory('latest')}>
                Latest messages
              </button>
            )}
          </header>
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
                canUseMessageActions={false}
                remoteHistory={{
                  hasOlder: snapshot.hasOlder,
                  isLoading: snapshot.isLoading,
                  loadOlder: () => void owner.loadHistory('older'),
                }}
                searchQuery=""
                onCommand={() => undefined}
                onReact={() => undefined}
                onInteract={() => undefined}
                onOpenMedia={() => undefined}
                onJumpToMessage={() => undefined}
              />
              <footer className={styles.composer}>
                <MessageComposer
                  key={selectedKey}
                  isTextOnly
                  isDisabled={isPersisting || !snapshot.isReady}
                  draft={snapshot.draft.value.text}
                  draftCustomEmoji={snapshot.draft.value.customEmoji}
                  draftRichText={snapshot.draft.value.richText}
                  onDraftChange={(value) => void owner.setDraft(value).catch(report)}
                  onSubmit={(message) => void submit(message)}
                  onCancelContext={() => undefined}
                  onJumpToMessage={() => undefined}
                  onNotify={setError}
                />
              </footer>
            </>
          ) : (
            <div className={styles.empty}>Choose a conversation or find someone to message.</div>
          )}
        </section>
      </main>
    </CurrentUserProvider>
  );
}
