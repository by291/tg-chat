import { useCallback, useEffect, useMemo, useState, type Dispatch } from 'react';
import { Forward, Trash2 } from 'lucide-react';
import { IconButton } from '../components/IconButton';
import { HeaderActionDialog } from './HeaderActionDialog';
import { useHeaderActions } from './useHeaderActions';
import { useChatOverlayInsets } from './useChatOverlayInsets';
import { ConversationMuteDialog } from './sidebar/ConversationMuteDialog';
import { ConversationRemovalDialog } from './sidebar/ConversationDialogs';
import { ChatHeader } from './ChatHeader';
import { ForwardMessageDialog, type ForwardRecipients } from './messages/ForwardMessageDialog';
import { forwardMessages as sendForwardedMessages } from './messages/forwardMessages';
import { downloadMessageMedia } from './messages/messageDownloads';
import { Ripple } from '../components/Ripple';
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
  forwardMessages?: Message[];
  onPrepareForward: (options: { chatId: string; messages: Message[] }) => void;
  onClearForward: () => void;
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
  forwardMessages,
  onPrepareForward,
  onClearForward,
  onOpenDetails,
  onOpenMedia,
  onBack,
  onNotify,
}: ConversationPaneProps) {
  const overlays = useChatOverlayInsets();
  const [replyMessage, setReplyMessage] = useState<Message>();
  const [editingMessage, setEditingMessage] = useState<Message>();
  const [pendingDelete, setPendingDelete] = useState<Message>();
  const [pendingForward, setPendingForward] = useState<Message[]>();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isPinnedView, setIsPinnedView] = useState(false);
  const [navigation, setNavigation] = useState<MessageNavigation>();
  const messages = useMemo(() => {
    return state.messages.filter((message) => message.chatId === conversation.id);
  }, [state.messages, conversation.id]);
  const pinnedMessages = useMemo(() => {
    return messages.filter((message) => message.isPinned);
  }, [messages]);
  const displayedMessages = isPinnedView ? pinnedMessages : messages;
  const headerActions = useHeaderActions({ conversation, state, dispatch, onNotify });
  const unreadCount = headerActions.entry?.unreadCount ?? 0;
  const markLatestRead = useCallback(() => {
    if (unreadCount === 0) {
      return;
    }
    dispatch({
      type: 'update-conversations',
      chatIds: [conversation.id],
      changes: { unreadCount: 0, isMarkedUnread: false },
    });
  }, [conversation.id, dispatch, unreadCount]);

  useEffect(() => {
    // Clearing history or expiring a message must not leave an editable copy in the composer.
    if (replyMessage && !messages.some((message) => message.id === replyMessage.id)) {
      setReplyMessage(undefined);
    }
    if (editingMessage && !messages.some((message) => message.id === editingMessage.id)) {
      setEditingMessage(undefined);
    }
  }, [messages, replyMessage, editingMessage]);

  function searchJump(messageId: string) {
    // Search navigation keeps the input and result cursor alive; pin jumps close search.
    setNavigation({ messageId, requestId: Date.now() });
  }

  const copySelectedMessages = useCallback(async () => {
    const selected = messages.filter((message) => headerActions.selectedIds.includes(message.id));
    try {
      await navigator.clipboard.writeText(selected.map(describeMessage).join('\n'));
      onNotify('Copied to clipboard');
    } catch {
      onNotify('Could not access the clipboard');
    }
  }, [messages, headerActions.selectedIds, onNotify]);

  function clearComposerContext() {
    setReplyMessage(undefined);
    setEditingMessage(undefined);
    onClearForward();
  }

  function submitMessage(composed: ComposedMessage) {
    if (editingMessage) {
      const hasRetainedMedia = Boolean(editingMessage.attachment || editingMessage.media);
      if (!composed.text.trim() && !composed.richText && !hasRetainedMedia) {
        // Cancelling deletion keeps the empty editor open so the user can continue the edit.
        setPendingDelete(editingMessage);
        return;
      }
      dispatch({
        type: 'edit',
        chatId: conversation.id,
        messageId: editingMessage.id,
        text: composed.text,
        customEmoji: composed.customEmoji,
        richText: composed.richText,
      });
      clearComposerContext();
      return;
    }

    const hasContent = Boolean(
      composed.text.trim() ||
      composed.richText ||
      composed.attachment ||
      composed.sticker ||
      composed.media,
    );
    if (hasContent) {
      dispatch({
        type: 'send',
        message: {
          id: crypto.randomUUID(),
          chatId: conversation.id,
          authorId: 'you',
          authorName: 'You',
          text: composed.text,
          customEmoji: composed.customEmoji,
          richText: composed.richText,
          createdAt: Date.now(),
          attachment: composed.attachment,
          sticker: composed.sticker,
          media: composed.media,
          replyToId: replyMessage?.id,
          reactions: [],
        },
      });
    }
    if (forwardMessages?.length) {
      sendForwardedMessages({ messages: forwardMessages, chatId: conversation.id, dispatch });
    }
    clearComposerContext();
    setNavigation(undefined);
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
          onClearForward();
          setIsPinnedView(false);
          setReplyMessage(message);
          setEditingMessage(undefined);
          return;
        case 'edit':
          onClearForward();
          setIsPinnedView(false);
          setEditingMessage(message);
          setReplyMessage(undefined);
          return;
        case 'clear-selection':
          headerActions.clearSelection();
          return;
        case 'copy-selected':
          void copySelectedMessages();
          return;
        case 'forward-selected':
          setPendingForward(
            messages.filter((entry) => headerActions.selectedIds.includes(entry.id)),
          );
          return;
        case 'download-selected':
          downloadMessageMedia(
            messages.filter((entry) => headerActions.selectedIds.includes(entry.id)),
          );
          return;
        case 'delete-selected':
          headerActions.setDialog('delete-messages');
          return;
        case 'delete':
          setPendingDelete(message);
          return;
        case 'copy':
          void copyMessage(message);
          return;
        case 'select':
          headerActions.selectMessage(message.id);
          return;
        case 'forward':
          setPendingForward([message]);
          return;
        case 'pin':
          dispatch({
            type: 'pin',
            chatId: conversation.id,
            messageId: message.id,
          });
      }
    },
    [
      copyMessage,
      copySelectedMessages,
      onClearForward,
      dispatch,
      conversation.id,
      headerActions.selectMessage,
      headerActions.clearSelection,
      headerActions.selectedIds,
      headerActions.setDialog,
      messages,
      onNotify,
    ],
  );

  function chooseForwardRecipient(recipient: Conversation) {
    if (!pendingForward) {
      return;
    }
    if (recipient.kind === 'saved') {
      sendToRecipients({ recipients: [recipient], caption: '' });
      return;
    }
    // Choosing an ordinary chat creates a draft; only its composer sends the messages.
    setReplyMessage(undefined);
    setEditingMessage(undefined);
    onPrepareForward({ chatId: recipient.id, messages: pendingForward });
    setPendingForward(undefined);
    headerActions.clearSelection();
  }

  function sendToRecipients({ recipients, caption, customEmoji, richText }: ForwardRecipients) {
    if (!pendingForward) {
      return;
    }
    for (const recipient of recipients) {
      sendForwardedMessages({
        messages: pendingForward,
        chatId: recipient.id,
        caption,
        customEmoji,
        richText,
        dispatch,
      });
    }
    setPendingForward(undefined);
    headerActions.clearSelection();
    onNotify('Messages forwarded');
  }

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
    setIsSearchOpen(false);
    setNavigation({ messageId, requestId: Date.now() });
  }, []);

  function openPinnedMessages() {
    setIsSearchOpen(false);
    setIsPinnedView(true);
  }

  function goBack() {
    if (isPinnedView) {
      setIsPinnedView(false);
      setIsSearchOpen(false);
      return;
    }
    onBack();
  }

  function toggleSearch() {
    setIsSearchOpen(!isSearchOpen);
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
        overlayInsets={overlays.insets}
        searchQuery=""
        unreadCount={options.isPinnedView ? 0 : unreadCount}
        isMuted={headerActions.entry?.isMuted ?? false}
        onReachLatest={isPinnedView || options.isPinnedView ? undefined : markLatestRead}
        selectedIds={headerActions.isSelecting ? headerActions.selectedIds : undefined}
        onToggleSelection={headerActions.toggleMessage}
        onSetSelection={headerActions.setMessagesSelected}
        messageIdPrefix={options.isPinnedView ? 'pinned-message' : undefined}
        navigation={navigation}
        onCommand={applyMessageCommand}
        onReact={reactToMessage}
        onVote={voteOnMessage}
        onOpenMedia={onOpenMedia}
        onJumpToMessage={jumpToMessage}
      />
    );
  }

  return (
    <main
      ref={overlays.containerRef}
      className={styles.conversation}
      aria-label={`${conversation.title} conversation`}
    >
      <div ref={overlays.headerRef} className={styles.headerOverlay}>
        <ChatHeader
          conversation={headerActions.entry ?? conversation}
          messages={displayedMessages}
          isSelecting={headerActions.isSelecting}
          onAction={headerActions.runAction}
          onAutoDelete={headerActions.setAutoDelete}
          onSearchJump={searchJump}
          isSearchOpen={isSearchOpen}
          pinnedCount={isPinnedView ? pinnedMessages.length : undefined}
          onToggleSearch={toggleSearch}
          onOpenDetails={onOpenDetails}
          onBack={goBack}
        />
        <div hidden={isPinnedView} className={styles.pinnedSlot} data-search-open={isSearchOpen}>
          <PinnedMessageBar
            messages={pinnedMessages}
            onJump={jumpToMessage}
            onOpenList={openPinnedMessages}
            onUnpin={(message) => applyMessageCommand({ action: 'pin', message })}
          />
        </div>
      </div>
      <div className={styles.historyPage} hidden={isPinnedView}>
        {renderTimeline({ messages, isPinnedView: false })}
      </div>
      {isPinnedView && (
        <div className={styles.historyPage}>
          {renderTimeline({ messages: pinnedMessages, isPinnedView: true })}
        </div>
      )}
      <div
        ref={overlays.footerRef}
        className={styles.footerOverlay}
        data-selecting={headerActions.isSelecting}
        hidden={isPinnedView}
      >
        <div className={styles.composerSlot} inert={headerActions.isSelecting}>
          <MessageComposer
            draft={state.drafts[conversation.id] || ''}
            draftCustomEmoji={state.draftCustomEmoji?.[conversation.id]}
            draftRichText={state.draftRichText?.[conversation.id]}
            replyMessage={replyMessage}
            editingMessage={editingMessage}
            forwardMessages={forwardMessages}
            onDraftChange={(value) =>
              dispatch({
                type: 'set-draft',
                chatId: conversation.id,
                ...value,
              })
            }
            onSubmit={submitMessage}
            onCancelContext={clearComposerContext}
            onJumpToMessage={jumpToMessage}
            onNotify={onNotify}
          />
        </div>
        <div
          className={styles.selectionToolbar}
          inert={!headerActions.isSelecting}
          aria-hidden={!headerActions.isSelecting}
        >
          <IconButton
            label="Delete selected messages"
            className={styles.deleteSelected}
            disabled={!headerActions.selectedIds.length}
            onClick={() => headerActions.setDialog('delete-messages')}
          >
            <Trash2 />
          </IconButton>
          <button className={styles.selectionCount} onClick={headerActions.clearSelection}>
            {headerActions.selectedIds.length}
            {headerActions.selectedIds.length === 1 ? ' message' : ' messages'}
            <Ripple />
          </button>
          <IconButton
            label="Forward selected messages"
            disabled={!headerActions.selectedIds.length}
            onClick={() => {
              setPendingForward(
                messages.filter((message) => {
                  return headerActions.selectedIds.includes(message.id);
                }),
              );
            }}
          >
            <Forward />
          </IconButton>
        </div>
      </div>
      <ConversationMuteDialog
        conversation={headerActions.actions.muteConversation}
        onCancel={headerActions.actions.cancelMute}
        onConfirm={headerActions.actions.confirmMute}
      />
      <ConversationRemovalDialog
        request={headerActions.actions.confirmation}
        onCancel={headerActions.actions.cancelRemoval}
        onConfirm={headerActions.actions.confirmRemoval}
      />
      <HeaderActionDialog
        mode={headerActions.dialog}
        selectedCount={headerActions.selectedIds.length}
        onClose={() => headerActions.setDialog(undefined)}
        onAutoDelete={headerActions.setAutoDelete}
        onDelete={headerActions.deleteSelectedMessages}
      />
      {pendingForward && (
        <ForwardMessageDialog
          state={state}
          onClose={() => setPendingForward(undefined)}
          onChooseRecipient={chooseForwardRecipient}
          onSend={sendToRecipients}
        />
      )}
      <DeleteMessageDialog
        isOpen={Boolean(pendingDelete)}
        finalFocusEl={() => {
          return (
            overlays.footerRef.current?.querySelector<HTMLElement>('[contenteditable=true]') ?? null
          );
        }}
        onCancel={() => setPendingDelete(undefined)}
        onConfirm={confirmDelete}
      />
    </main>
  );
}
