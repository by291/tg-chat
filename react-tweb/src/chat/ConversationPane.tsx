import { useCallback, useMemo, useState, type Dispatch } from 'react';
import { ChatHeader } from './ChatHeader';
import { DeleteMessageDialog } from './DeleteMessageDialog';
import { PinnedMessageBar } from './PinnedMessageBar';
import { MessageComposer, type ComposedMessage } from './composer/MessageComposer';
import { MessageTimeline, type MessageNavigation } from './history/MessageTimeline';
import { describeMessage } from './messageFormatting';
import type { ChatAction, ChatState, Conversation, Message, MessageCommand } from './model';
import styles from './ConversationPane.module.css';

interface ConversationPaneProps {
  conversation: Conversation;
  state: ChatState;
  dispatch: Dispatch<ChatAction>;
  onOpenDetails: () => void;
  onOpenMedia: (message: Message) => void;
  onBack: () => void;
  onNotify: (message: string) => void;
}

/** Coordinate message commands and transient editing state for one selected conversation. */
export function ConversationPane({
  conversation,
  state,
  dispatch,
  onOpenDetails,
  onOpenMedia,
  onBack,
  onNotify,
}: ConversationPaneProps) {
  const [replyMessage, setReplyMessage] = useState<Message>();
  const [editingMessage, setEditingMessage] = useState<Message>();
  const [pendingDelete, setPendingDelete] = useState<Message>();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isPinnedView, setIsPinnedView] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [navigation, setNavigation] = useState<MessageNavigation>();
  const messages = useMemo(() => {
    return state.messages.filter((message) => message.chatId === conversation.id);
  }, [state.messages, conversation.id]);
  const pinnedMessages = useMemo(() => {
    return messages.filter((message) => message.isPinned);
  }, [messages]);
  const displayedMessages = isPinnedView ? pinnedMessages : messages;
  const searchResultCount = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return displayedMessages.length;
    }
    return displayedMessages.filter((message) => {
      return describeMessage(message).toLowerCase().includes(normalizedQuery);
    }).length;
  }, [displayedMessages, searchQuery]);

  function clearComposerContext() {
    setReplyMessage(undefined);
    setEditingMessage(undefined);
  }

  function submitMessage(composed: ComposedMessage) {
    if (editingMessage) {
      dispatch({
        type: 'edit',
        chatId: conversation.id,
        messageId: editingMessage.id,
        text: composed.text,
      });
      clearComposerContext();
      return;
    }

    dispatch({
      type: 'send',
      message: {
        id: crypto.randomUUID(),
        chatId: conversation.id,
        authorId: 'you',
        authorName: 'You',
        text: composed.text,
        createdAt: Date.now(),
        attachment: composed.attachment,
        sticker: composed.sticker,
        replyToId: replyMessage?.id,
        reactions: [],
      },
    });
    clearComposerContext();
    setNavigation(undefined);
    setSearchQuery('');
    setIsSearchOpen(false);
  }

  const copyMessage = useCallback(
    async (message: Message) => {
      try {
        await navigator.clipboard.writeText(describeMessage(message));
        onNotify('Copied to clipboard');
      } catch {
        onNotify('Could not access the clipboard. Select the message text to copy it.');
      }
    },
    [onNotify],
  );

  // Stable timeline props let memoized history ignore draft and composer-only updates.
  // Keep the real dependencies so changing conversations or callbacks never uses stale state.
  const applyMessageCommand = useCallback(
    ({ action, message }: MessageCommand) => {
      switch (action) {
        case 'reply':
          setIsPinnedView(false);
          setReplyMessage(message);
          setEditingMessage(undefined);
          return;
        case 'edit':
          setIsPinnedView(false);
          setEditingMessage(message);
          setReplyMessage(undefined);
          return;
        case 'delete':
          setPendingDelete(message);
          return;
        case 'copy':
          void copyMessage(message);
          return;
        case 'pin':
          dispatch({
            type: 'pin',
            chatId: conversation.id,
            messageId: message.id,
          });
      }
    },
    [copyMessage, dispatch, conversation.id],
  );

  const reactToMessage = useCallback(
    (messageId: string, emoji: string) => {
      dispatch({
        type: 'react',
        chatId: conversation.id,
        messageId,
        emoji,
      });
    },
    [dispatch, conversation.id],
  );

  const voteOnMessage = useCallback(
    (messageId: string, optionId: string) => {
      dispatch({
        type: 'vote',
        chatId: conversation.id,
        messageId,
        optionId,
      });
    },
    [dispatch, conversation.id],
  );

  const jumpToMessage = useCallback((messageId: string) => {
    setIsPinnedView(false);
    setSearchQuery('');
    setIsSearchOpen(false);
    setNavigation({ messageId, requestId: Date.now() });
  }, []);

  function openPinnedMessages() {
    setIsSearchOpen(false);
    setSearchQuery('');
    setIsPinnedView(true);
  }

  function goBack() {
    if (isPinnedView) {
      setIsPinnedView(false);
      setIsSearchOpen(false);
      setSearchQuery('');
      return;
    }
    onBack();
  }

  function toggleSearch() {
    setIsSearchOpen(!isSearchOpen);
    setSearchQuery('');
  }

  function confirmDelete() {
    if (!pendingDelete) {
      return;
    }

    dispatch({ type: 'delete', chatId: conversation.id, messageId: pendingDelete.id });
    if (editingMessage?.id === pendingDelete.id || replyMessage?.id === pendingDelete.id) {
      clearComposerContext();
    }

    setPendingDelete(undefined);
  }

  function renderTimeline(options: { messages: Message[]; isPinnedView: boolean }) {
    return (
      <MessageTimeline
        messages={options.messages}
        searchQuery={options.isPinnedView === isPinnedView ? searchQuery : ''}
        messageIdPrefix={options.isPinnedView ? 'pinned-message' : undefined}
        navigation={options.isPinnedView ? undefined : navigation}
        onCommand={applyMessageCommand}
        onReact={reactToMessage}
        onVote={voteOnMessage}
        onOpenMedia={onOpenMedia}
        onJumpToMessage={jumpToMessage}
      />
    );
  }

  return (
    <main className={styles.conversation} aria-label={`${conversation.title} conversation`}>
      <ChatHeader
        conversation={conversation}
        isSearchOpen={isSearchOpen}
        searchQuery={searchQuery}
        searchResultCount={searchResultCount}
        pinnedCount={isPinnedView ? pinnedMessages.length : undefined}
        onSearchQueryChange={setSearchQuery}
        onToggleSearch={toggleSearch}
        onOpenDetails={onOpenDetails}
        onBack={goBack}
        onToggleTheme={() => dispatch({ type: 'toggle-theme' })}
      />
      <div className={styles.historyPage} hidden={isPinnedView}>
        {!isSearchOpen && (
          <PinnedMessageBar
            messages={pinnedMessages}
            onJump={jumpToMessage}
            onOpenList={openPinnedMessages}
            onUnpin={(message) => applyMessageCommand({ action: 'pin', message })}
          />
        )}
        {renderTimeline({ messages, isPinnedView: false })}
      </div>
      {isPinnedView && (
        <div className={styles.historyPage}>
          {renderTimeline({ messages: pinnedMessages, isPinnedView: true })}
        </div>
      )}
      <div hidden={isPinnedView}>
        <MessageComposer
          key={editingMessage?.id || 'compose'}
          draft={state.drafts[conversation.id] || ''}
          replyMessage={replyMessage}
          editingMessage={editingMessage}
          onDraftChange={(text) => dispatch({ type: 'set-draft', chatId: conversation.id, text })}
          onSubmit={submitMessage}
          onCancelContext={clearComposerContext}
          onNotify={onNotify}
        />
      </div>
      <DeleteMessageDialog
        isOpen={Boolean(pendingDelete)}
        onCancel={() => setPendingDelete(undefined)}
        onConfirm={confirmDelete}
      />
    </main>
  );
}
