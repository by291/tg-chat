import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useReducedMotion } from 'motion/react';
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import { Avatar } from '@/components/Avatar';
import { Ripple } from '@/components/Ripple';
import { ConversationMenu } from '../ConversationMenu';
import type { ConversationListEntry, ConversationMenuAction } from '../conversationList';
import { readPreviewAnchor, type PreviewAnchor } from '../previewPosition';
import styles from '../ChatSidebar.module.css';

const SEARCH_EXIT_DURATION = 150;
const SEARCH_ROW_HEIGHT = 56;
const VIRTUAL_SEARCH_THRESHOLD = 40;
const SEARCH_OVERSCAN_ROWS = 4;

interface SidebarSearchResultsProps {
  conversations: ConversationListEntry[];
  isSearching: boolean;
  isArchiveScope: boolean;
  onSelectChat: (chatId: string) => void;
  onMenuAction: (
    conversation: ConversationListEntry,
    action: ConversationMenuAction,
    anchor?: PreviewAnchor,
  ) => void;
}

interface SearchResultRowsProps {
  conversations: ConversationListEntry[];
  viewportRef: RefObject<HTMLElement | null>;
  onSelectChat: SidebarSearchResultsProps['onSelectChat'];
  onMenuAction: SidebarSearchResultsProps['onMenuAction'];
}

function SearchResultRows({
  conversations,
  viewportRef,
  onSelectChat,
  onMenuAction,
}: SearchResultRowsProps) {
  const rowsRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const [retainedChatId, setRetainedChatId] = useState<string>();
  const retainedIndex = conversations.findIndex(
    (conversation) => conversation.id === retainedChatId,
  );
  const extractRange = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range);
      if (retainedIndex < 0 || indexes.includes(retainedIndex)) {
        return indexes;
      }
      // Native focus and a portal menu's anchor must survive scrolling beyond the visible window.
      indexes.push(retainedIndex);
      return indexes.sort((first, second) => first - second);
    },
    [retainedIndex],
  );
  const shouldVirtualize = conversations.length > VIRTUAL_SEARCH_THRESHOLD;
  const virtualizer = useVirtualizer({
    count: conversations.length,
    getScrollElement: () => viewportRef.current,
    getItemKey: (index) => conversations[index].id,
    estimateSize: () => SEARCH_ROW_HEIGHT,
    overscan: SEARCH_OVERSCAN_ROWS,
    scrollMargin,
    rangeExtractor: extractRange,
    enabled: shouldVirtualize,
  });

  useLayoutEffect(() => {
    setScrollMargin(rowsRef.current?.offsetTop ?? 0);
  }, []);

  function renderResult(conversation: ConversationListEntry) {
    return (
      <ConversationMenu
        key={conversation.id}
        conversation={conversation}
        isSelecting={false}
        onAction={(action, anchor) => onMenuAction(conversation, action, anchor)}
      >
        <button
          type="button"
          className={styles.searchResult}
          onFocus={() => setRetainedChatId(conversation.id)}
          onContextMenuCapture={() => setRetainedChatId(conversation.id)}
          onClick={(event) => {
            if (event.shiftKey) {
              onMenuAction(conversation, 'preview', readPreviewAnchor(event.currentTarget));
              return;
            }
            onSelectChat(conversation.id);
          }}
        >
          <Avatar initials={conversation.initials} color={conversation.color} size="small" />
          <span className={styles.rowContent}>
            <span className={styles.resultTitle}>{conversation.title}</span>
            <span className={styles.resultSubtitle}>{conversation.subtitle}</span>
          </span>
          <Ripple />
        </button>
      </ConversationMenu>
    );
  }

  if (!shouldVirtualize) {
    return <div ref={rowsRef}>{conversations.map(renderResult)}</div>;
  }

  return (
    <div
      ref={rowsRef}
      className={styles.virtualList}
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((item) => (
        <div
          key={item.key}
          className={styles.virtualSearchResult}
          style={{ top: item.start - scrollMargin }}
        >
          {renderResult(conversations[item.index])}
        </div>
      ))}
    </div>
  );
}

/** Keep the transition shell mounted and release result menus after search finishes closing. */
export function SidebarSearchResults({
  conversations,
  isSearching,
  isArchiveScope,
  onSelectChat,
  onMenuAction,
}: SidebarSearchResultsProps) {
  const viewportRef = useRef<HTMLElement>(null);
  const lastResults = useRef({ conversations, isArchiveScope });
  const [hasClosingResults, setHasClosingResults] = useState(false);
  const shouldReduceMotion = useReducedMotion();
  const visibleResults = isSearching ? { conversations, isArchiveScope } : lastResults.current;
  const shouldRenderResults = isSearching || hasClosingResults;

  useLayoutEffect(
    () => {
      if (isSearching) {
        lastResults.current = { conversations, isArchiveScope };
      }
    },
    // prettier-ignore
    [
      conversations,
      isArchiveScope,
      isSearching,
    ],
  );

  useEffect(() => {
    if (isSearching) {
      setHasClosingResults(true);
      return;
    }
    if (shouldReduceMotion) {
      setHasClosingResults(false);
      return;
    }
    // The CSS exit lasts 150 ms; retaining this snapshot also prevents query reset flicker.
    const timer = window.setTimeout(() => setHasClosingResults(false), SEARCH_EXIT_DURATION);
    return () => window.clearTimeout(timer);
  }, [isSearching, shouldReduceMotion]);

  return (
    <nav
      ref={viewportRef}
      className={styles.searchPanel}
      aria-label="Search results"
      aria-hidden={!isSearching}
      inert={!isSearching}
    >
      {shouldRenderResults && (
        <div className={styles.searchCard}>
          <h2>{visibleResults.isArchiveScope ? 'Archived Chats' : 'Chats'}</h2>
          <SearchResultRows
            conversations={visibleResults.conversations}
            viewportRef={viewportRef}
            onSelectChat={onSelectChat}
            onMenuAction={onMenuAction}
          />
          {visibleResults.conversations.length === 0 && (
            <p className={styles.empty}>No conversations found</p>
          )}
        </div>
      )}
    </nav>
  );
}
