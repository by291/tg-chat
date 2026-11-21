import { useEffect, useRef, useState } from 'react';

/** Bind fullscreen requests and browser-initiated exits to the current call panel. */
export function useCallFullscreen() {
  const panelRef = useRef<HTMLElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const panel = panelRef.current;

    function synchronize() {
      setIsFullscreen(Boolean(panel && document.fullscreenElement === panel));
    }

    document.addEventListener('fullscreenchange', synchronize);
    return () => {
      // The browser releases fullscreen itself when the call's element is removed.
      document.removeEventListener('fullscreenchange', synchronize);
    };
  }, []);

  async function exit() {
    if (document.fullscreenElement !== panelRef.current) {
      return true;
    }

    setIsPending(true);
    setError('');
    try {
      await document.exitFullscreen();
      return true;
    } catch {
      setError('Could not exit fullscreen.');
      return false;
    } finally {
      setIsPending(false);
    }
  }

  async function toggle() {
    const panel = panelRef.current;
    if (!panel || isPending) {
      return;
    }
    if (document.fullscreenElement === panel) {
      await exit();
      return;
    }

    setIsPending(true);
    setError('');
    try {
      await panel.requestFullscreen();
    } catch {
      setError('Fullscreen is unavailable.');
    } finally {
      setIsPending(false);
    }
  }

  return {
    panelRef,
    isFullscreen,
    isPending,
    isSupported: Boolean(document.fullscreenEnabled),
    error,
    exit,
    toggle,
  };
}
