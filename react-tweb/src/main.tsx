import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatApp } from './chat/ChatApp';
import './global.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('The application root element is missing.');
}

createRoot(rootElement).render(
  <StrictMode>
    <ChatApp />
  </StrictMode>,
);
