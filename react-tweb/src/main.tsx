import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import '@/styles/global.css';

// Match tweb's device policy independently of the most recent pointer or keyboard event.
const isTouchSupported = 'ontouchstart' in window;
document.documentElement.dataset.touchSupported = String(isTouchSupported);

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('The application root element is missing.');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
