import {
  Archive,
  ArrowLeft,
  ContactRound,
  LoaderCircle,
  Search,
  Settings,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { ApiError, type SessionOwner } from '@/features/auth/SessionOwner';
import { CommunityDiscovery } from '@/features/communities/CommunityDiscovery';
import type { CommunityKind } from '@/features/communities/communityModels';
import type { ChatOwner, ChatSnapshot } from '../data/ChatOwner';
import type { Conversation, Destination } from '../data/messageModels';
import { GlobalMessageSearch } from '../search/GlobalMessageSearch';
import { ConnectedChatMenu } from './ConnectedChatMenu';
import { ConnectedConversationRow } from './ConnectedConversationRow';
import { PendingConversationActions } from './PendingConversationActions';
import { conversationTitle as title } from './conversationTitle';
import sharedStyles from './ConnectedChat.module.css';
import styles from './ConnectedDirectory.module.css';

interface ConnectedDirectoryProps {
  owner: ChatOwner;
  session?: SessionOwner;
  snapshot: ChatSnapshot;
  conversationId?: string;
  connectionLabel?: string;
  outbox: ChatSnapshot['pending'];
  isVisible: boolean;
  isHidden: boolean;
  onOpen: (conversation: Conversation) => void;
  onOpenMessage: (input: { conversation: Conversation; messageId: string }) => Promise<void>;
  onOpenPending: () => void;
  onSettings: () => void;
  onContacts: () => void;
  onCommunities: () => void;
  onCreateCommunity: (kind: CommunityKind) => void;
  onOpenCommunity: (conversation: Conversation) => void;
  onError: (error: unknown) => void;
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

/** Browse folders, discover conversations, and recover work outside the current timeline. */
export function ConnectedDirectory({
  owner,
  session,
  snapshot,
  conversationId,
  connectionLabel,
  outbox,
  isVisible,
  isHidden,
  onOpen,
  onOpenMessage,
  onOpenPending,
  onSettings,
  onContacts,
  onCommunities,
  onCreateCommunity,
  onOpenCommunity,
  onError: report,
}: ConnectedDirectoryProps) {
  const [folder, setFolder] = useState<'inbox' | 'archived' | 'hidden'>('inbox');
  const [directoryQuery, setDirectoryQuery] = useState('');

  const normalizedDirectoryQuery = directoryQuery.trim().toLowerCase();
  const isDiscovering = Boolean(normalizedDirectoryQuery && session && snapshot.isReady);
  const directory = snapshot.conversations.filter((entry) => {
    if (normalizedDirectoryQuery) {
      const isCommunityMatch = entry.kind === 'group' || entry.kind === 'channel';
      if (isDiscovering && isCommunityMatch) {
        return false;
      }
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

  const directoryCommands = snapshot.pendingCommands.filter((entry) => {
    return isVisible || entry.request.conversation_id !== conversationId;
  });

  function openConversation(entry: Conversation) {
    setDirectoryQuery('');
    onOpen(entry);
  }

  function retryCommand(operationId: string) {
    void owner.retryCommand(operationId).catch(report);
  }

  function dismissCommand(operationId: string) {
    void owner.discardCommand(operationId).catch(report);
  }

  function conversationNameForId(id: string) {
    const entry = snapshot.conversations.find((candidate) => candidate.id === id);
    return entry ? title(entry) : 'Unavailable conversation';
  }

  function openFolder(nextFolder: typeof folder) {
    setDirectoryQuery('');
    setFolder(nextFolder);
  }

  function openSavedMessages() {
    const saved = snapshot.conversations.find((entry) => entry.kind === 'saved');
    if (saved) {
      openConversation(saved);
    }
  }

  function openDiscoveryResult(entry: Conversation) {
    setDirectoryQuery('');
    onOpenCommunity(entry);
  }

  async function openGlobalResult(result: { conversationId: string; messageId: string }) {
    const conversations = owner.getSnapshot().conversations;
    const entry = conversations.find((candidate) => candidate.id === result.conversationId);
    if (!entry) {
      throw new ApiError({ code: 'not_found', message: 'Message unavailable' });
    }
    await onOpenMessage({ conversation: entry, messageId: result.messageId });
    setDirectoryQuery('');
  }

  return (
    <aside
      className={styles.directory}
      aria-label="Conversations"
      hidden={isHidden}
      data-visible={isVisible}
      data-directory-panel
      data-chat-controls
    >
      <header className={styles.directoryHeader}>
        {folder === 'inbox' ? (
          <ConnectedChatMenu
            onOpenSaved={openSavedMessages}
            onOpenArchived={() => openFolder('archived')}
            onOpenHidden={() => openFolder('hidden')}
            onCreate={onCreateCommunity}
          />
        ) : (
          <button type="button" aria-label="Back to inbox" onClick={() => openFolder('inbox')}>
            <ArrowLeft />
          </button>
        )}
        <h1>
          {folder === 'archived' && 'Archived Chats'}
          {folder === 'hidden' && 'Hidden Chats'}
          {folder === 'inbox' && 'Messages'}
        </h1>
        <button type="button" aria-label="Account settings" onClick={onSettings}>
          <Settings />
        </button>
        <button type="button" aria-label="Contacts" onClick={onContacts}>
          <ContactRound />
        </button>
        <button type="button" aria-label="Communities" onClick={onCommunities}>
          <Users />
        </button>
      </header>
      {!snapshot.isReady && <p role="status">Loading conversations…</p>}
      <div className={styles.directorySearch}>
        {connectionLabel ? (
          <LoaderCircle size={18} className={sharedStyles.connectionSpinner} aria-hidden="true" />
        ) : (
          <Search size={18} aria-hidden="true" />
        )}
        <input
          type="text"
          aria-label="Search chats and messages"
          placeholder={connectionLabel ?? 'Search'}
          value={directoryQuery}
          onChange={(event) => setDirectoryQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
              setDirectoryQuery('');
            }
          }}
        />
      </div>
      {connectionLabel && (
        <p
          className={styles.directoryConnection}
          data-has-query={Boolean(directoryQuery)}
          role="status"
        >
          {connectionLabel}
        </p>
      )}
      {!normalizedDirectoryQuery &&
        folder === 'inbox' &&
        snapshot.conversations.some((entry) => entry.is_archived && !entry.is_hidden) && (
          <button
            type="button"
            className={styles.archiveEntry}
            onClick={() => openFolder('archived')}
          >
            <Archive aria-hidden="true" /> Archived Chats
          </button>
        )}
      {directory.map((entry) => (
        <ConnectedConversationRow
          key={entry.id}
          conversation={entry}
          name={title(entry)}
          session={session}
          isSelected={conversationId === entry.id}
          onOpen={() => openConversation(entry)}
          onCommand={(action) => {
            void owner.commandForConversation({ conversationId: entry.id, action }).catch(report);
          }}
        />
      ))}
      {isDiscovering && session && (
        <CommunityDiscovery
          session={session}
          chat={owner}
          query={directoryQuery}
          onAdmitted={openDiscoveryResult}
        />
      )}
      {snapshot.isReady && (
        <GlobalMessageSearch
          query={directoryQuery}
          visibilityKey={owner.searchVisibilityKey()}
          loadPage={owner.searchMessages}
          onSelect={openGlobalResult}
        />
      )}
      <PendingConversationActions
        commands={directoryCommands}
        conversationName={conversationNameForId}
        onRetry={retryCommand}
        onDismiss={dismissCommand}
      />
      {outbox.length > 0 && (
        <section className={styles.pending} aria-label="Pending messages">
          <h2>Pending messages</h2>
          {outbox.map((entry) => (
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
                  onOpenPending();
                }}
              >
                {entry.request.content.text ||
                  entry.media?.map((item) => item.filename).join(', ') ||
                  'Pending message'}
              </button>
              <p>{entry.error || 'Waiting for server confirmation'}</p>
              <div className={sharedStyles.actions}>
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
          <p>Removing an unconfirmed item does not delete a message already saved by the server.</p>
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
  );
}
