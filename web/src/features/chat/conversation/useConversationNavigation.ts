import { useCallback, useState } from 'react';
import type { MessageNavigation } from '../history/MessageTimeline';

/** Keep search, pinned history, and message jumps within the mounted conversation. */
export function useConversationNavigation(onBack: () => void) {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isPinnedView, setIsPinnedView] = useState(false);
  const [navigation, setNavigation] = useState<MessageNavigation>();

  const closePinnedView = useCallback(() => {
    setIsPinnedView(false);
  }, []);

  const finishSending = useCallback(() => {
    setNavigation(undefined);
    setIsSearchOpen(false);
  }, []);

  const jumpToMessage = useCallback((messageId: string) => {
    setIsPinnedView(false);
    setIsSearchOpen(false);
    setNavigation({ messageId, requestId: Date.now() });
  }, []);

  function searchJump(messageId: string) {
    // Search navigation preserves the input and result cursor until an explicit message jump.
    setNavigation({ messageId, requestId: Date.now() });
  }

  function openPinnedMessages() {
    setIsSearchOpen(false);
    setIsPinnedView(true);
  }

  function goBack() {
    if (isPinnedView) {
      setIsPinnedView(false);
      setIsSearchOpen(false);
      return;
    }
    onBack();
  }

  function toggleSearch() {
    setIsSearchOpen(!isSearchOpen);
  }

  return {
    isSearchOpen,
    isPinnedView,
    navigation,
    closePinnedView,
    finishSending,
    jumpToMessage,
    searchJump,
    openPinnedMessages,
    goBack,
    toggleSearch,
  };
}
