import { useEffect, useReducer, useState } from 'react';
import { createInitialState } from '../demo/fixtures';
import { chatReducer } from './reducer';
import { loadChatState, saveChatState } from './storage';

const EXPIRATION_CHECK_INTERVAL = 30_000;

/** Restore conversations before allowing interaction, then persist every committed change. */
export function useChatState() {
  const [state, dispatch] = useReducer(chatReducer, undefined, createInitialState);
  const [isReady, setIsReady] = useState(false);
  const [storageError, setStorageError] = useState('');

  useEffect(() => {
    let isActive = true;

    async function restoreConversations() {
      try {
        const savedState = await loadChatState();
        if (isActive && savedState) {
          dispatch({ type: 'restore', state: savedState });
        }
      } catch {
        if (isActive) {
          setStorageError('Local storage is unavailable. Changes may not survive a reload.');
        }
      } finally {
        if (isActive) {
          setIsReady(true);
        }
      }
    }

    void restoreConversations();
    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    // IndexedDB serializes these writes; older snapshots cannot overtake newer ones.
    void saveChatState(state).catch(() => {
      setStorageError('Could not save your changes. Your browser storage may be full.');
    });
  }, [state, isReady]);

  useEffect(() => {
    if (!isReady) {
      return;
    }
    function expireMessages() {
      dispatch({ type: 'expire-messages', now: Date.now() });
    }
    expireMessages();
    const timer = window.setInterval(expireMessages, EXPIRATION_CHECK_INTERVAL);
    window.addEventListener('focus', expireMessages);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', expireMessages);
    };
  }, [isReady]);

  return { state, dispatch, isReady, storageError };
}
