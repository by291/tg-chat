import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationListEntry } from '../conversationList';

type SearchScope = 'all' | 'archive';

interface SidebarSearchOptions {
  conversations: ConversationListEntry[];
  isArchiveOpen: boolean;
  onCloseArchive: () => void;
}

/** Own the sidebar query, archive scope, and focus handoff between search and menus. */
export function useSidebarSearch({
  conversations,
  isArchiveOpen,
  onCloseArchive,
}: SidebarSearchOptions) {
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [scope, setScope] = useState<SearchScope>('all');
  const inputRef = useRef<HTMLInputElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const shouldRestoreFocus = useRef(false);
  const shouldFocusArchiveSearch = useRef(false);
  const normalizedQuery = query.trim().toLowerCase();
  const matchingConversations = useMemo(
    () => {
      if (!isSearching) {
        return [];
      }
      return conversations.filter((conversation) => {
        if (scope === 'archive' && !conversation.isArchived) {
          return false;
        }
        return conversation.title.toLowerCase().includes(normalizedQuery);
      });
    },
    // prettier-ignore
    [
      conversations,
      isSearching,
      normalizedQuery,
      scope,
    ],
  );

  useEffect(() => {
    if (!isSearching && shouldRestoreFocus.current) {
      shouldRestoreFocus.current = false;
      menuButtonRef.current?.focus();
    }
  }, [isSearching]);

  useEffect(() => {
    if (isArchiveOpen || !isSearching || !shouldFocusArchiveSearch.current) {
      return;
    }
    // Wait for page restoration and menu dismissal before search claims focus.
    const frame = requestAnimationFrame(() => {
      shouldFocusArchiveSearch.current = false;
      inputRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [isSearching, isArchiveOpen]);

  function resetSearch() {
    setIsSearching(false);
    setQuery('');
    setScope('all');
  }

  function closeSearch() {
    shouldRestoreFocus.current = true;
    resetSearch();
  }

  function openArchiveSearch() {
    shouldFocusArchiveSearch.current = true;
    onCloseArchive();
    setScope('archive');
    setQuery('');
    setIsSearching(true);
  }

  function clearQuery() {
    setQuery('');
    inputRef.current?.focus();
  }

  return {
    query,
    isSearching,
    scope,
    inputRef,
    menuButtonRef,
    matchingConversations,
    setQuery,
    clearQuery,
    resetSearch,
    closeSearch,
    openArchiveSearch,
    startSearch: () => setIsSearching(true),
    searchAllChats: () => setScope('all'),
  };
}
