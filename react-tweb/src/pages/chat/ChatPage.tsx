import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { SenderProfileProvider } from '@/features/chat/details/SenderProfileProvider';
import { ChatDetails } from '@/features/chat/details/ChatDetails';
import { ChatSidebar } from '@/features/conversations/ChatSidebar';
import { ConversationPane } from '@/features/chat/ConversationPane';
import { ContactActionsProvider } from '@/features/chat/messages/content/contact/ContactActions';
import { MediaViewer } from '@/features/media/MediaViewer';
import { getGalleryMessages } from '@/features/media/photoGallery';
import {
  resolveMediaViewerCommand,
  type MediaViewerCommand,
} from '@/features/media/mediaViewerCommands';
import type { Message } from '@/domain/messages/message';
import { useConversationList } from '@/features/conversations/conversationList';
import { useChatState } from '@/features/chat/state/useChatState';
import { useChatRoute } from '@/routes/useChatRoute';
import { useAppNavigation } from '@/routes/useAppNavigation';
import { useAppPreferences } from '@/features/settings/appPreferences';
import { useAppearanceTheme } from '@/features/settings/appearance/useAppearanceTheme';
import { ChatWallpaper } from '@/features/settings/appearance/ChatWallpaper';
import { StartupSidebar } from '@/layouts/chat/StartupSidebar';
import { useStartupTransition } from '@/layouts/chat/useStartupTransition';
import { ToastViewport } from '@/components/Toast';
import { showToast } from '@/components/toastStore';
import { useMessageNotifications } from '@/features/settings/notifications/useMessageNotifications';
import { ChatLayout } from '@/layouts/chat/ChatLayout';
import styles from './ChatPage.module.css';

const MOBILE_CHAT_BREAKPOINT = 760;

/** Coordinate the chat workspace, persistent conversation state, and transient feature panels. */
export function ChatPage() {
  const messageTextSize = useAppPreferences((preferences) => preferences.messageTextSize);
  const { state, dispatch, isReady, storageError } = useChatState();
  const shouldReduceMotion = useReducedMotion() ?? false;
  useStartupTransition({ isReady, shouldReduceMotion });
  const conversationEntries = useConversationList(state);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [hasOpenedDetails, setHasOpenedDetails] = useState(false);
  const navigation = useAppNavigation();
  const previousChatId = useRef(navigation.chatId);
  const isMobileChatOpen = Boolean(navigation.chatId);
  const [mediaMessage, setMediaMessage] = useState<Message>();
  const [requestedMediaCommand, setRequestedMediaCommand] = useState<MediaViewerCommand>();
  const [mediaReturnMessage, setMediaReturnMessage] = useState<Message>();
  const [forwardDrafts, setForwardDrafts] = useState<Record<string, Message[]>>({});

  const isConversationDeleted =
    state.conversationPreferences?.[state.activeChatId]?.isDeleted ?? false;
  const conversation = conversationEntries.find((entry) => entry.id === state.activeChatId);
  const hasConversation = isReady && Boolean(conversation) && !isConversationDeleted;
  const hasDetails = isDetailsOpen && hasConversation;
  const activeEntry = conversationEntries.find((entry) => entry.id === conversation?.id);
  const messages = state.messages.filter((message) => message.chatId === conversation?.id);
  const { variant, choice, isDark, toggleTheme } = useAppearanceTheme({
    isReady,
    isLegacyDark: state.isDark,
  });

  useChatRoute({
    chatId: navigation.chatId,
    state,
    dispatch,
    isReady,
  });

  useEffect(() => {
    // Browser history bypasses selectConversation, so it must also dismiss chat-specific overlays.
    const hasChangedChat = previousChatId.current !== navigation.chatId;
    previousChatId.current = navigation.chatId;
    if (hasChangedChat && navigation.navigationType === 'POP') {
      setIsDetailsOpen(false);
      setMediaMessage(undefined);
      setRequestedMediaCommand(undefined);
      setMediaReturnMessage(undefined);
    }
  }, [navigation.chatId, navigation.navigationType]);

  function selectConversation(chatId: string) {
    // Explicit selection also clears manual unread marks, even when the URL is unchanged.
    dispatch({ type: 'select-chat', chatId });
    navigation.openChat(chatId);
    setIsDetailsOpen(false);
    setMediaMessage(undefined);
    setRequestedMediaCommand(undefined);
    setMediaReturnMessage(undefined);
  }

  useMessageNotifications({
    state,
    isReady,
    isConversationVisible:
      hasConversation && (window.innerWidth > MOBILE_CHAT_BREAKPOINT || isMobileChatOpen),
    onOpen: selectConversation,
  });

  function runMediaViewerCommand(command: MediaViewerCommand) {
    const resolvedCommand = resolveMediaViewerCommand({ command, messages: state.messages });
    if (!resolvedCommand) {
      setMediaMessage(undefined);
      showToast('This message is no longer available.');
      return;
    }

    selectConversation(resolvedCommand.message.chatId);
    setRequestedMediaCommand(resolvedCommand);
    const canReturnToViewer = command.action === 'forward' || command.action === 'delete';
    if (canReturnToViewer) {
      setMediaReturnMessage(command.message);
    }
  }

  function finishMediaViewerCommand(options: { shouldRestoreViewer: boolean }) {
    setRequestedMediaCommand(undefined);
    setMediaReturnMessage(undefined);
    if (!options.shouldRestoreViewer || !mediaReturnMessage) {
      return;
    }

    // Cancellation returns to the selected album tile, not the parent's first photo.
    const currentMessage = getGalleryMessages(state.messages).find((message) => {
      return message.id === mediaReturnMessage.id && message.chatId === mediaReturnMessage.chatId;
    });
    setMediaMessage(currentMessage);
  }

  function prepareForward(options: { chatId: string; messages: Message[] }) {
    setForwardDrafts((current) => ({ ...current, [options.chatId]: options.messages }));
    selectConversation(options.chatId);
  }

  const clearForwardDraft = useCallback(() => {
    if (!conversation) {
      return;
    }
    setForwardDrafts((current) => {
      const next = { ...current };
      delete next[conversation.id];
      return next;
    });
  }, [conversation?.id]);

  return (
    <ContactActionsProvider
      state={state}
      dispatch={dispatch}
      onSelectConversation={selectConversation}
    >
      <SenderProfileProvider
        state={state}
        dispatch={dispatch}
        onSelectConversation={selectConversation}
        onOpenMedia={setMediaMessage}
      >
        <ChatLayout
          messageTextSize={messageTextSize}
          isDetailsOpen={hasDetails}
          isMobileChatOpen={isMobileChatOpen && hasConversation}
          background={<ChatWallpaper variant={variant} choice={choice} />}
          sidebar={
            isReady ? (
              <ChatSidebar
                state={state}
                dispatch={dispatch}
                onSelectChat={selectConversation}
                onToggleTheme={toggleTheme}
                isDark={isDark}
              />
            ) : (
              <StartupSidebar />
            )
          }
          conversation={
            <>
              {hasConversation && conversation && (
                <ConversationPane
                  key={conversation.id}
                  conversation={conversation}
                  state={state}
                  forwardMessages={forwardDrafts[conversation.id]}
                  requestedMediaCommand={requestedMediaCommand}
                  onFinishMediaCommand={finishMediaViewerCommand}
                  onPrepareForward={prepareForward}
                  onClearForward={clearForwardDraft}
                  dispatch={dispatch}
                  onOpenDetails={() => {
                    setHasOpenedDetails(true);
                    setIsDetailsOpen((isOpen) => !isOpen);
                  }}
                  onOpenMedia={setMediaMessage}
                  onBack={navigation.closeChat}
                  onNotify={showToast}
                />
              )}
              {isReady && !hasConversation && (
                <div className={styles.emptyConversation}>
                  <p>Select a chat to start messaging</p>
                </div>
              )}
            </>
          }
          details={
            hasOpenedDetails &&
            conversation && (
              <ChatDetails
                key={conversation.id}
                conversation={conversation}
                messages={messages}
                state={state}
                dispatch={dispatch}
                isOpen={hasDetails}
                isMuted={activeEntry?.isMuted ?? false}
                onToggleMute={() =>
                  dispatch({
                    type: 'update-conversations',
                    chatIds: [conversation.id],
                    changes: { isMuted: !activeEntry?.isMuted, mutedUntil: 0 },
                  })
                }
                onClose={() => setIsDetailsOpen(false)}
                onOpenMedia={setMediaMessage}
              />
            )
          }
        >
          <MediaViewer
            message={mediaMessage}
            messages={state.messages.filter((message) => message.chatId === mediaMessage?.chatId)}
            onClose={() => setMediaMessage(undefined)}
            onNavigate={setMediaMessage}
            onCommand={runMediaViewerCommand}
            onNotify={showToast}
          />
          {storageError && (
            <div className={styles.storageError} role="alert">
              {storageError}
            </div>
          )}
          <ToastViewport />
        </ChatLayout>
      </SenderProfileProvider>
    </ContactActionsProvider>
  );
}
