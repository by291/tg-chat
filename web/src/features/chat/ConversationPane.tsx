import { useCallback, useEffect, useMemo, useState, type Dispatch } from 'react';
import { Forward, Trash2 } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import { HeaderActionDialog } from './HeaderActionDialog';
import { useHeaderActions } from './useHeaderActions';
import { useChatOverlayInsets } from './useChatOverlayInsets';
import { ConversationMuteDialog } from '@/features/conversations/ConversationMuteDialog';
import { ConversationRemovalDialog } from '@/features/conversations/ConversationDialogs';
import { ChatHeader } from './ChatHeader';
import { ForwardMessageDialog } from './messages/forwarding/ForwardMessageDialog';
import { Ripple } from '@/components/Ripple';
import { DeleteMessageDialog } from './DeleteMessageDialog';
import { PinnedMessageBar } from './PinnedMessageBar';
import { MessagePinDialog } from './MessagePinDialog';
import { useMessagePinning } from './useMessagePinning';
import { MessageComposer } from './composer/MessageComposer';
import { MessageTimeline } from './history/MessageTimeline';
import type { MediaViewerCommand } from '@/features/media/mediaViewerCommands';
import { useMediaViewerCommand } from '@/features/media/useMediaViewerCommand';
import type { ChatAction } from '@/features/chat/state/chatActions';
import type { ChatState } from '@/features/chat/state/chatState';
import type { Conversation } from '@/domain/conversations/conversation';
import type { Message } from '@/domain/messages/message';
import { createOutgoingMessageTransitions } from './messages/transitions/outgoingMessageTransition';
import { useConversationComposer } from './conversation/useConversationComposer';
import { useConversationDialogs } from './conversation/useConversationDialogs';
import { useConversationMessageCommands } from './conversation/useConversationMessageCommands';
import { useConversationNavigation } from './conversation/useConversationNavigation';
import styles from './ConversationPane.module.css';

interface ConversationPaneProps {
  conversation: Conversation;
  state: ChatState;
  dispatch: Dispatch<ChatAction>;
  forwardMessages?: Message[];
  requestedMediaCommand?: MediaViewerCommand;
  onFinishMediaCommand?: (options: { shouldRestoreViewer: boolean }) => void;
  onPrepareForward: (options: { chatId: string; messages: Message[] }) => void;
  onClearForward: () => void;
  onOpenDetails: () => void;
  onOpenMedia: (message: Message) => void;
  onBack: () => void;
  onNotify: (message: string) => void;
}

/** Compose the selected conversation, its action owners, and its overlay layout. */
export function ConversationPane({
  conversation,
  state,
  dispatch,
  forwardMessages,
  requestedMediaCommand,
  onFinishMediaCommand,
  onPrepareForward,
  onClearForward,
  onOpenDetails,
  onOpenMedia,
  onBack,
  onNotify,
}: ConversationPaneProps) {
  const overlays = useChatOverlayInsets();
  const [outgoingMessages] = useState(() =>
    createOutgoingMessageTransitions({ getContainer: () => overlays.containerRef.current }),
  );
  useEffect(() => () => outgoingMessages.dispose(), [outgoingMessages]);
  // Empty edits and timeline commands share the same deletion confirmation.
  const [pendingDelete, setPendingDelete] = useState<Message>();
  const pinning = useMessagePinning(dispatch);
  const navigation = useConversationNavigation(onBack);
  const { isSearchOpen, isPinnedView } = navigation;
  const messages = useMemo(() => {
    return state.messages.filter((message) => message.chatId === conversation.id);
  }, [state.messages, conversation.id]);
  const pinnedMessages = useMemo(() => {
    return messages.filter((message) => message.isPinned);
  }, [messages]);
  const displayedMessages = isPinnedView ? pinnedMessages : messages;
  const headerActions = useHeaderActions({
    conversation,
    state,
    dispatch,
    onNotify,
  });
  const unreadCount = headerActions.entry?.unreadCount ?? 0;
  const markLatestRead = useCallback(
    () => {
      if (unreadCount === 0) {
        return;
      }

      dispatch({
        type: 'update-conversations',
        chatIds: [conversation.id],
        changes: { unreadCount: 0, isMarkedUnread: false },
      });
    },
    // prettier-ignore
    [
      conversation.id,
      dispatch,
      unreadCount,
    ],
  );

  const composer = useConversationComposer({
    chatId: conversation.id,
    messages,
    forwardMessages,
    dispatch,
    onClearForward,
    onStartContext: navigation.closePinnedView,
    onSent: navigation.finishSending,
    onRequestDelete: setPendingDelete,
    onPrepareOutgoing: outgoingMessages.prepare,
  });
  const dialogs = useConversationDialogs({
    chatId: conversation.id,
    dispatch,
    pendingDelete,
    setPendingDelete,
    requestedMediaCommand,
    onFinishMediaCommand,
    onPrepareForward,
    onClearReplyAndEdit: composer.clearReplyAndEdit,
    onClearDeletedContext: composer.clearDeletedContext,
    onClearSelection: headerActions.clearSelection,
    onNotify,
  });
  const commands = useConversationMessageCommands({
    chatId: conversation.id,
    messages,
    dispatch,
    headerActions,
    onReply: composer.startReply,
    onEdit: composer.startEdit,
    onDelete: setPendingDelete,
    onForward: dialogs.requestForward,
    onPin: pinning.requestChange,
    onNotify,
  });

  useMediaViewerCommand({
    chatId: conversation.id,
    command: requestedMediaCommand,
    onMessageCommand: commands.applyMessageCommand,
    onJumpToMessage: navigation.jumpToMessage,
  });

  function renderTimeline(options: { messages: Message[]; isPinnedView: boolean }) {
    return (
      <MessageTimeline
        messages={options.messages}
        shouldShowSender={conversation.kind === 'group'}
        onMessageMount={options.isPinnedView ? undefined : outgoingMessages.mount}
        overlayInsets={overlays.insets}
        searchQuery=""
        unreadCount={options.isPinnedView ? 0 : unreadCount}
        isMuted={headerActions.entry?.isMuted ?? false}
        onReachLatest={isPinnedView || options.isPinnedView ? undefined : markLatestRead}
        selectedIds={headerActions.isSelecting ? headerActions.selectedIds : undefined}
        onToggleSelection={headerActions.toggleMessage}
        onSetSelection={headerActions.setMessagesSelected}
        messageIdPrefix={options.isPinnedView ? 'pinned-message' : undefined}
        navigation={navigation.navigation}
        onCommand={commands.applyMessageCommand}
        onReact={commands.reactToMessage}
        onInteract={commands.interactWithMessage}
        onOpenMedia={onOpenMedia}
        onJumpToMessage={navigation.jumpToMessage}
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
          onSearchJump={navigation.searchJump}
          isSearchOpen={isSearchOpen}
          pinnedCount={isPinnedView ? pinnedMessages.length : undefined}
          onToggleSearch={navigation.toggleSearch}
          onOpenDetails={onOpenDetails}
          onBack={navigation.goBack}
        />
        <div hidden={isPinnedView} className={styles.pinnedSlot} data-search-open={isSearchOpen}>
          <PinnedMessageBar
            messages={pinnedMessages}
            onJump={navigation.jumpToMessage}
            onOpenList={navigation.openPinnedMessages}
            onUnpin={pinning.requestChange}
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
            replyMessage={composer.replyMessage}
            editingMessage={composer.editingMessage}
            forwardMessages={forwardMessages}
            onDraftChange={(value) =>
              dispatch({
                type: 'set-draft',
                chatId: conversation.id,
                ...value,
              })
            }
            onSubmit={composer.submitMessage}
            onCancelContext={composer.clearContext}
            onJumpToMessage={navigation.jumpToMessage}
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
            onClick={commands.forwardSelectedMessages}
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
      {dialogs.pendingForward && (
        <ForwardMessageDialog
          state={state}
          onClose={dialogs.cancelForward}
          onChooseRecipient={dialogs.chooseForwardRecipient}
          onSend={dialogs.sendToRecipients}
        />
      )}
      <MessagePinDialog
        request={pinning.request}
        conversation={conversation}
        onCancel={pinning.cancelChange}
        onConfirm={pinning.confirmChange}
      />
      <DeleteMessageDialog
        isOpen={Boolean(pendingDelete)}
        finalFocusEl={() => {
          return (
            overlays.footerRef.current?.querySelector<HTMLElement>('[contenteditable=true]') ?? null
          );
        }}
        onCancel={dialogs.cancelDelete}
        onConfirm={dialogs.confirmDelete}
      />
    </main>
  );
}
