import { useCallback, useEffect, useState } from 'react';
import { ChatDetails } from '../chat/details/ChatDetails';
import { ChatSidebar } from '../chat/sidebar/ChatSidebar';
import { ConversationPane } from '../chat/ConversationPane';
import { conversations } from '../chat/demo/fixtures';
import { MediaViewer } from '../chat/media/MediaViewer';
import type { Message } from '../chat/model';
import { useConversationList } from '../chat/sidebar/conversationList';
import { useChatState } from '../chat/state/useChatState';
import { useInputModality } from './useInputModality';
import styles from './ChatApp.module.css';

const NOTICE_DURATION = 4000;

/** Compose the application shell around persistent conversation state and transient panels. */
export function ChatApp() {
  useInputModality();
  const { state, dispatch, isReady, storageError } = useChatState();
  const conversationEntries = useConversationList(state);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [hasOpenedDetails, setHasOpenedDetails] = useState(false);
  const [isMobileChatOpen, setIsMobileChatOpen] = useState(true);
  const [mediaMessage, setMediaMessage] = useState<Message>();
  const [forwardDrafts, setForwardDrafts] = useState<Record<string, Message[]>>({});
  const [notice, setNotice] = useState('');
  const [requestedChatId] = useState(() => new URL(window.location.href).searchParams.get('chat'));
  const isConversationDeleted =
    state.conversationPreferences?.[state.activeChatId]?.isDeleted ?? false;
  const hasDetails = isDetailsOpen && !isConversationDeleted;
  const conversation =
    conversations.find((entry) => entry.id === state.activeChatId) || conversations[0];
  const activeEntry = conversationEntries.find((entry) => entry.id === conversation.id);
  const messages = state.messages.filter((message) => message.chatId === conversation.id);

  useEffect(() => {
    const isKnownConversation = conversations.some((entry) => entry.id === requestedChatId);
    if (isReady && requestedChatId && isKnownConversation) {
      dispatch({ type: 'select-chat', chatId: requestedChatId });
    }
  }, [isReady, requestedChatId, dispatch]);

  useEffect(() => {
    document.documentElement.dataset.theme = state.isDark ? 'dark' : 'light';
  }, [state.isDark]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeout = window.setTimeout(() => setNotice(''), NOTICE_DURATION);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  function selectConversation(chatId: string) {
    dispatch({ type: 'select-chat', chatId });
    setIsMobileChatOpen(true);
    setIsDetailsOpen(false);
    setMediaMessage(undefined);
  }

  function prepareForward(options: { chatId: string; messages: Message[] }) {
    setForwardDrafts((current) => ({ ...current, [options.chatId]: options.messages }));
    selectConversation(options.chatId);
  }

  const clearForwardDraft = useCallback(() => {
    setForwardDrafts((current) => {
      const next = { ...current };
      delete next[conversation.id];
      return next;
    });
  }, [conversation.id]);

  if (!isReady) {
    return (
      <div className={styles.loading} role="status">
        Opening your conversations…
      </div>
    );
  }

  return (
    <div
      className={styles.app}
      data-details-open={hasDetails}
      data-mobile-chat-open={isMobileChatOpen}
    >
      <div className={styles.sidebarSlot}>
        <ChatSidebar
          state={state}
          dispatch={dispatch}
          onSelectChat={selectConversation}
          onToggleTheme={() => dispatch({ type: 'toggle-theme' })}
        />
      </div>
      <div className={styles.conversationSlot}>
        {!isConversationDeleted && (
          <ConversationPane
            key={conversation.id}
            conversation={conversation}
            state={state}
            forwardMessages={forwardDrafts[conversation.id]}
            onPrepareForward={prepareForward}
            onClearForward={clearForwardDraft}
            dispatch={dispatch}
            onOpenDetails={() => {
              setHasOpenedDetails(true);
              setIsDetailsOpen((isOpen) => !isOpen);
            }}
            onOpenMedia={setMediaMessage}
            onBack={() => setIsMobileChatOpen(false)}
            onNotify={setNotice}
          />
        )}
        {isConversationDeleted && (
          <div className={styles.emptyConversation}>
            <p>Select a conversation to start messaging</p>
            <button onClick={() => setIsMobileChatOpen(false)}>Back to chats</button>
          </div>
        )}
      </div>
      <div className={styles.detailsSlot} inert={!hasDetails} aria-hidden={!hasDetails}>
        {hasOpenedDetails && (
          <ChatDetails
            key={conversation.id}
            conversation={conversation}
            messages={messages}
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
        )}
      </div>
      <MediaViewer
        message={mediaMessage}
        messages={messages}
        onClose={() => setMediaMessage(undefined)}
        onNavigate={setMediaMessage}
      />
      {storageError && (
        <div className={styles.storageError} role="alert">
          {storageError}
        </div>
      )}
      {notice && (
        <div className={styles.toast} role="status">
          {notice}
        </div>
      )}
    </div>
  );
}
