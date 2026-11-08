import { PinnedConversationSorting } from './PinnedConversationSorting';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type { ConversationListEntry } from './conversationList';
import { useConversationGlide } from './useConversationGlide';
import { getConversationScrollAdjustment } from './conversationScrollAnchor';
import styles from './ChatSidebar.module.css';

const ROW_HEIGHT = 72;
const OVERSCAN_ROWS = 4;
const COMPOSE_CLEARANCE = 86;
const ARCHIVE_ROW_KEY = 'archive';

type ConversationListRow =
  | { key: string; kind: 'archive' }
  | {
      key: string;
      kind: 'conversation';
      conversation: ConversationListEntry;
    };

interface VirtualConversationListProps {
  conversations: ConversationListEntry[];
  label: string;
  initialOffset: number;
  archiveEntry?: ReactNode;
  onScrollOffsetChange: (offset: number) => void;
  onReorderPinned: (chatIds: string[]) => void;
  renderRow: (conversation: ConversationListEntry) => ReactNode;
}

interface VirtualConversationRowProps {
  conversationId?: string;
  index: number;
  top: number;
  canGlide: boolean;
  children: ReactNode;
}

function VirtualConversationRow({
  conversationId,
  index,
  top,
  canGlide,
  children,
}: VirtualConversationRowProps) {
  const rowRef = useConversationGlide({ top, canGlide });

  return (
    <div
      ref={rowRef}
      className={styles.virtualConversation}
      data-conversation-index={index}
      data-conversation-id={conversationId}
      style={{ top }}
    >
      {children}
    </div>
  );
}

/** Window fixed-height conversation rows while retaining stable positions during reordering. */
export function VirtualConversationList({
  conversations,
  label,
  initialOffset,
  archiveEntry,
  onScrollOffsetChange,
  onReorderPinned,
  renderRow,
}: VirtualConversationListProps) {
  const viewportRef = useRef<HTMLElement>(null);
  const focusFrameRef = useRef<number | undefined>(undefined);
  const previousKeysRef = useRef<string[]>([]);
  const rows: ConversationListRow[] = conversations.map((conversation) => ({
    key: `conversation:${conversation.id}`,
    kind: 'conversation',
    conversation,
  }));
  if (archiveEntry) {
    rows.unshift({ key: ARCHIVE_ROW_KEY, kind: 'archive' });
  }

  const rowKeys = rows.map((row) => row.key);
  const getItemKey = useCallback((index: number) => rowKeys[index], [rowKeys]);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewportRef.current,
    getItemKey,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN_ROWS,
    initialOffset,
    paddingEnd: COMPOSE_CLEARANCE,
  });
  const pinnedIds = conversations
    .filter((conversation) => conversation.isPinned)
    .map((conversation) => conversation.id);
  const virtualRows = virtualizer.getVirtualItems();
  const scrollTop = virtualizer.scrollOffset ?? initialOffset;
  const viewportHeight = virtualizer.scrollRect?.height ?? 0;
  const scrollAdjustment = getConversationScrollAdjustment({
    previousKeys: previousKeysRef.current,
    currentKeys: rowKeys,
    scrollTop,
    viewportHeight,
    rowHeight: ROW_HEIGHT,
  });

  useLayoutEffect(
    () => {
      previousKeysRef.current = rowKeys;
      if (scrollAdjustment === undefined || scrollAdjustment === 0) {
        return;
      }

      // Offscreen changes adjust the viewport rather than animate all visible rows.
      const maximumOffset = Math.max(0, virtualizer.getTotalSize() - viewportHeight);
      const nextOffset = Math.max(0, Math.min(scrollTop + scrollAdjustment, maximumOffset));
      virtualizer.scrollToOffset(nextOffset);
    },
    // prettier-ignore
    [
      rowKeys,
      scrollAdjustment,
      scrollTop,
      viewportHeight,
      virtualizer,
    ],
  );

  useEffect(() => {
    return () => {
      if (focusFrameRef.current !== undefined) {
        cancelAnimationFrame(focusFrameRef.current);
      }
    };
  }, []);

  function navigateRows(event: KeyboardEvent<HTMLElement>) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (target.closest('[data-sort-handle]')) {
      return;
    }

    const row = target.closest<HTMLElement>('[data-conversation-index]');
    if (!row) {
      return;
    }

    const currentIndex = Number(row.dataset.conversationIndex);
    let nextIndex = currentIndex;
    switch (event.key) {
      case 'ArrowDown':
        nextIndex += 1;
        break;
      case 'ArrowUp':
        nextIndex -= 1;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = rows.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    nextIndex = Math.max(0, Math.min(nextIndex, rows.length - 1));
    virtualizer.scrollToIndex(nextIndex, { align: 'auto' });
    if (focusFrameRef.current !== undefined) {
      cancelAnimationFrame(focusFrameRef.current);
    }

    // The target can be outside the mounted window until the virtualizer commits its scroll.
    focusFrameRef.current = requestAnimationFrame(() => {
      const selector = `[data-conversation-index="${nextIndex}"] button`;
      viewportRef.current
        ?.querySelector<HTMLButtonElement>(selector)
        ?.focus({ preventScroll: true });
    });
  }

  const list = (
    <nav
      ref={viewportRef}
      className={styles.chatList}
      aria-label={label}
      onKeyDown={navigateRows}
      onScroll={(event) => onScrollOffsetChange(event.currentTarget.scrollTop)}
      data-total-rows={rows.length}
      data-rendered-rows={virtualRows.length}
    >
      <div className={styles.virtualList} style={{ height: virtualizer.getTotalSize() }}>
        {virtualRows.map((item) => {
          const row = rows[item.index];
          if (row.kind === 'archive') {
            return (
              <VirtualConversationRow
                key={row.key}
                index={item.index}
                top={item.start}
                canGlide={scrollAdjustment === undefined}
              >
                {archiveEntry}
              </VirtualConversationRow>
            );
          }

          const conversation = row.conversation;

          return (
            <VirtualConversationRow
              key={row.key}
              conversationId={conversation.id}
              index={item.index}
              top={item.start}
              canGlide={scrollAdjustment === undefined}
            >
              {renderRow(conversation)}
            </VirtualConversationRow>
          );
        })}
        {rows.length === 0 && <p className={styles.empty}>No conversations</p>}
      </div>
    </nav>
  );

  return (
    <PinnedConversationSorting pinnedIds={pinnedIds} onReorder={onReorderPinned}>
      {list}
    </PinnedConversationSorting>
  );
}
