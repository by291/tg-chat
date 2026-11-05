import { useEffect, useState } from 'react';
import { ChatDetails } from './ChatDetails';
import { ChatSidebar } from './ChatSidebar';
import { ConversationPane } from './ConversationPane';
import { conversations } from './fixtures';
import { MediaViewer } from './MediaViewer';
import type { Message } from './model';
import { useChatState } from './useChatState';
import styles from './ChatApp.module.css';

const NOTICE_DURATION = 4000;

/** Compose the application shell around persistent conversation state and transient panels. */
export function ChatApp() {
  const { state, dispatch, isReady, storageError } = useChatState();
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isMobileChatOpen, setIsMobileChatOpen] = useState(true);
  const [mediaMessage, setMediaMessage] = useState<Message>();
  const [notice, setNotice] = useState('');
  const conversation =
    conversations.find((entry) => entry.id === state.activeChatId) || conversations[0];
  const messages = state.messages.filter((message) => message.chatId === conversation.id);

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
      data-details-open={isDetailsOpen}
      data-mobile-chat-open={isMobileChatOpen}
    >
      <div className={styles.sidebarSlot}>
        <ChatSidebar
          state={state}
          onSelectChat={selectConversation}
          onToggleTheme={() => dispatch({ type: 'toggle-theme' })}
        />
      </div>
      <div className={styles.conversationSlot}>
        <ConversationPane
          key={conversation.id}
          conversation={conversation}
          state={state}
          dispatch={dispatch}
          onOpenDetails={() => setIsDetailsOpen(!isDetailsOpen)}
          onOpenMedia={setMediaMessage}
          onBack={() => setIsMobileChatOpen(false)}
          onNotify={setNotice}
        />
      </div>
      {isDetailsOpen && (
        <div className={styles.detailsSlot}>
          <ChatDetails
            key={conversation.id}
            conversation={conversation}
            messages={messages}
            onClose={() => setIsDetailsOpen(false)}
            onOpenMedia={setMediaMessage}
          />
        </div>
      )}
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
