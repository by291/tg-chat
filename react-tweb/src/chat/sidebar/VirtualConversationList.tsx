import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useCallback,
  useEffect,
  useRef,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type { ConversationListEntry } from './conversationList';
import { useConversationGlide } from './useConversationGlide';
import styles from './ChatSidebar.module.css';

const ROW_HEIGHT = 72;
const OVERSCAN_ROWS = 4;
const COMPOSE_CLEARANCE = 86;

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
  conversationId: string;
  index: number;
  top: number;
  children: ReactNode;
}

function VirtualConversationRow({
  conversationId,
  index,
  top,
  children,
}: VirtualConversationRowProps) {
  const rowRef = useConversationGlide(top);

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
  const draggedIdRef = useRef<string | undefined>(undefined);
  const getItemKey = useCallback((index: number) => conversations[index].id, [conversations]);
  const virtualizer = useVirtualizer({
    count: conversations.length,
    getScrollElement: () => viewportRef.current,
    getItemKey,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN_ROWS,
    initialOffset,
    paddingStart: archiveEntry ? ROW_HEIGHT : 0,
    paddingEnd: COMPOSE_CLEARANCE,
  });
  const virtualRows = virtualizer.getVirtualItems();

  useEffect(() => {
    return () => {
      if (focusFrameRef.current !== undefined) {
        cancelAnimationFrame(focusFrameRef.current);
      }
    };
  }, []);

  function findPinnedDragTarget(event: DragEvent<HTMLElement>) {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    const row = event.target.closest<HTMLElement>('[data-conversation-id]');
    return conversations.find((conversation) => {
      return conversation.id === row?.dataset.conversationId && conversation.isPinned;
    });
  }

  function finishPinnedReorder(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const target = findPinnedDragTarget(event);
    const draggedId = draggedIdRef.current;
    draggedIdRef.current = undefined;
    if (!target || !draggedId || target.id === draggedId) {
      return;
    }

    const pinnedIds = conversations
      .filter((conversation) => conversation.isPinned)
      .map((conversation) => conversation.id);
    const startIndex = pinnedIds.indexOf(draggedId);
    const targetIndex = pinnedIds.indexOf(target.id);
    if (startIndex < 0 || targetIndex < 0) {
      return;
    }
    pinnedIds.splice(startIndex, 1);
    pinnedIds.splice(targetIndex, 0, draggedId);
    onReorderPinned(pinnedIds);
  }

  function navigateRows(event: KeyboardEvent<HTMLElement>) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
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
        nextIndex = conversations.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    nextIndex = Math.max(0, Math.min(nextIndex, conversations.length - 1));
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

  return (
    <nav
      ref={viewportRef}
      className={styles.chatList}
      aria-label={label}
      onKeyDown={navigateRows}
      onDragStart={(event) => {
        const target = findPinnedDragTarget(event);
        if (!target) {
          return;
        }
        draggedIdRef.current = target.id;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', target.id);
      }}
      onDragOver={(event) => {
        if (draggedIdRef.current && findPinnedDragTarget(event)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
        }
      }}
      onDrop={finishPinnedReorder}
      onDragEnd={() => {
        draggedIdRef.current = undefined;
      }}
      onScroll={(event) => onScrollOffsetChange(event.currentTarget.scrollTop)}
      data-total-rows={conversations.length}
      data-rendered-rows={virtualRows.length}
    >
      <div className={styles.virtualList} style={{ height: virtualizer.getTotalSize() }}>
        {archiveEntry}
        {virtualRows.map((item) => {
          const conversation = conversations[item.index];
          return (
            <VirtualConversationRow
              key={conversation.id}
              conversationId={conversation.id}
              index={item.index}
              top={item.start}
            >
              {renderRow(conversation)}
            </VirtualConversationRow>
          );
        })}
        {conversations.length === 0 && <p className={styles.empty}>No conversations</p>}
      </div>
    </nav>
  );
}
