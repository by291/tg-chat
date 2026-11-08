import { lazy, Suspense } from 'react';
import { BrowserRouter } from 'react-router';
import { useInputModality } from '@/hooks/useInputModality';
import { AccountApplication } from '@/features/auth/AccountApplication';
import styles from '@/features/accounts/Accounts.module.css';
// Demo stores and editor modules load only after the user enters the demo route.
const ChatPage = lazy(async () => {
  const chat = await import('@/pages/chat/ChatPage');
  return { default: chat.ChatPage };
});

/** Assemble application-wide navigation and input policy around the chat workspace. */
export function App() {
  useInputModality();

  const isConnected = import.meta.env.VITE_APP_MODE === 'connected';
  if (isConnected && window.location.pathname !== '/demo') {
    return <AccountApplication />;
  }
  if (isConnected) {
    return (
      <div className={styles.demo}>
        <aside className={styles.demoNotice}>
          <span>Demo · Sample conversations stored in this browser</span>
          <a href="/">Back to your account</a>
        </aside>
        <div className={styles.demoWorkspace}>
          <Suspense fallback={<p role="status">Loading chat demo…</p>}>
            <BrowserRouter>
              <ChatPage />
            </BrowserRouter>
          </Suspense>
        </div>
      </div>
    );
  }

  return (
    <Suspense fallback={<p role="status">Loading chat demo…</p>}>
      <BrowserRouter>
        <ChatPage />
      </BrowserRouter>
    </Suspense>
  );
}
