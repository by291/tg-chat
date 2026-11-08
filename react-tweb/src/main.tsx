import { StrictMode } from 'react';
import { BrowserRouter } from 'react-router';
import { createRoot } from 'react-dom/client';
import { ChatApp } from './app/ChatApp';
import './global.css';

// Match tweb's device policy independently of the most recent pointer or keyboard event.
const isTouchSupported = 'ontouchstart' in window;
document.documentElement.dataset.touchSupported = String(isTouchSupported);

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('The application root element is missing.');
}

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <ChatApp />
    </BrowserRouter>
  </StrictMode>,
);
