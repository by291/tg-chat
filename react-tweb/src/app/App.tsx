import { BrowserRouter } from 'react-router';
import { useInputModality } from '@/hooks/useInputModality';
import { ChatPage } from '@/pages/chat/ChatPage';

/** Assemble application-wide navigation and input policy around the chat workspace. */
export function App() {
  useInputModality();

  return (
    <BrowserRouter>
      <ChatPage />
    </BrowserRouter>
  );
}
