import { ArrowDown } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { IconButton } from '../../components/IconButton';
import { createHistoryRows } from './historyRows';
import { MessageBubble } from '../messages/MessageBubble';
import { DeferredMessageMedia } from '../messages/deferredMedia';
import { MessageMenu } from '../messages/MessageMenu';
import { useMessageMenu } from '../messages/useMessageMenu';
import { describeMessage } from '../messageFormatting';
import type { Message, MessageCommand } from '../model';
import { useHistoryWindow } from './useHistoryWindow';
import { useVirtualHistory } from './useVirtualHistory';
import styles from './MessageTimeline.module.css';

const HIGHLIGHT_DURATION = 1800;

export interface MessageNavigation {
  messageId: string;
  requestId: number;
}

interface MessageTimelineProps {
  messages: Message[];
  isPreview?: boolean;
  messageIdPrefix?: string;
  searchQuery: string;
  navigation?: MessageNavigation;
  selectedIds?: string[];
  onToggleSelection?: (messageId: string) => void;
  onCommand: (command: MessageCommand) => void;
  onReact: (messageId: string, emoji: string) => void;
  onVote: (messageId: string, optionId: string) => void;
  onOpenMedia: (message: Message) => void;
  onJumpToMessage: (messageId: string) => void;
}

interface VirtualMessageHistoryProps extends MessageTimelineProps {
  messageById: Map<string, Message>;
}

function VirtualMessageHistory({
  messages,
  messageById,
  searchQuery,
  navigation,
  selectedIds,
  onToggleSelection,
  isPreview,
  messageIdPrefix,
  onCommand,
  onReact,
  onVote,
  onOpenMedia,
  onJumpToMessage,
}: VirtualMessageHistoryProps) {
  const allRows = useMemo(() => createHistoryRows(messages), [messages]);
  // A lazy initializer avoids rebuilding the full ID set on every virtual-range update.
  const [appearedIds] = useState(() => new Set(messages.map((message) => message.id)));
  const [highlightedId, setHighlightedId] = useState('');
  const history = useHistoryWindow(allRows);
  const { rows, hasOlder, loadOlder } = history;
  const scroll = useVirtualHistory({
    rows,
    hasOlder,
    loadOlder,
    navigation,
  });
  const menu = useMessageMenu({
    viewportRef: scroll.viewportRef,
    isDisabled: isPreview || selectedIds !== undefined,
  });
  const virtualItems = scroll.virtualizer.getVirtualItems();
  const totalHeight = scroll.virtualizer.getTotalSize();
  const viewportHeight = scroll.virtualizer.scrollRect?.height || 0;
  const bottomAlignment = Math.max(0, viewportHeight - totalHeight);

  useEffect(() => {
    if (!navigation) {
      return;
    }
    history.revealMessage(navigation.messageId);
    setHighlightedId(navigation.messageId);
    const timeout = window.setTimeout(() => setHighlightedId(''), HIGHLIGHT_DURATION);
    return () => window.clearTimeout(timeout);
  }, [navigation]);

  const markMessageAppeared = useCallback(
    (messageId: string) => {
      appearedIds.add(messageId);
    },
    [appearedIds],
  );

  return (
    <DeferredMessageMedia isDeferred={scroll.isNavigating}>
      <div
        ref={scroll.viewportRef}
        className={styles.viewport}
        onScroll={scroll.updateScrollPosition}
        onWheel={scroll.cancelAutomaticScroll}
        onTouchStart={scroll.cancelAutomaticScroll}
        onPointerDown={scroll.cancelAutomaticScroll}
        onKeyDown={(event) => {
          scroll.cancelAutomaticScroll();
          menu.onKeyDown(event);
        }}
        onContextMenu={menu.onContextMenu}
        onClickCapture={(event) => {
          if (selectedIds === undefined) {
            menu.onClick(event);
            return;
          }
          const target = event.target as HTMLElement;
          const messageId = target.closest<HTMLElement>('[data-message-id]')?.dataset.messageId;
          if (messageId) {
            event.preventDefault();
            event.stopPropagation();
            onToggleSelection?.(messageId);
          }
        }}
        onPointerDownCapture={menu.onPointerDown}
        onPointerMove={menu.onPointerMove}
        onPointerUp={menu.cancelLongPress}
        onPointerCancel={menu.cancelLongPress}
        aria-label="Message history"
        data-total-rows={allRows.length}
        data-loaded-rows={rows.length}
        data-rendered-rows={virtualItems.length}
        tabIndex={0}
      >
        <div className={styles.messages} style={{ height: totalHeight + bottomAlignment }}>
          <div className={styles.historyStart}>
            {hasOlder ? (
              <button onClick={loadOlder}>Load earlier messages</button>
            ) : (
              <span>{searchQuery ? 'Search results' : 'Beginning of conversation'}</span>
            )}
          </div>
          {virtualItems.map((item) => {
            const row = rows[item.index];
            return (
              <div
                key={row.key}
                ref={scroll.virtualizer.measureElement}
                data-index={item.index}
                data-row-key={row.key}
                className={styles.virtualRow}
                inert={isPreview}
                style={{ transform: `translateY(${item.start + bottomAlignment}px)` }}
              >
                {row.kind === 'date' ? (
                  <div className={styles.dateRow}>
                    <span className={styles.dateSeparator}>{row.label}</span>
                  </div>
                ) : (
                  <MessageBubble
                    message={row.message}
                    isSelecting={selectedIds !== undefined}
                    isSelected={selectedIds?.includes(row.message.id)}
                    isPreview={isPreview}
                    isMenuOpen={menu.isOpen && menu.target?.messageId === row.message.id}
                    menuContentId={menu.contentId}
                    idPrefix={messageIdPrefix}
                    replyMessage={messageById.get(row.message.replyToId || '')}
                    isGroupStart={row.isGroupStart}
                    isGroupEnd={row.isGroupEnd}
                    isHighlighted={row.key === highlightedId}
                    shouldAnimate={!appearedIds.has(row.key)}
                    onAppear={markMessageAppeared}
                    onCommand={onCommand}
                    onReact={onReact}
                    onVote={onVote}
                    onOpenMedia={onOpenMedia}
                    onJumpToMessage={onJumpToMessage}
                  />
                )}
              </div>
            );
          })}
          {messages.length === 0 && (
            <div className={styles.emptyState}>
              <strong>{searchQuery ? 'No messages found' : 'A fresh conversation'}</strong>
              <p>
                {searchQuery ? 'Try another word or phrase.' : 'Send a message to get started.'}
              </p>
            </div>
          )}
        </div>
      </div>
      {!isPreview && (
        <MessageMenu
          contentId={menu.contentId}
          target={menu.target}
          message={menu.target ? messageById.get(menu.target.messageId) : undefined}
          isOpen={menu.isOpen}
          onClose={menu.closeMenu}
          onExitComplete={menu.releaseTarget}
          onCommand={onCommand}
          onReact={onReact}
        />
      )}
      {scroll.canJumpToLatest && !searchQuery && (
        <IconButton
          label="Jump to latest message"
          className={styles.jumpButton}
          onClick={scroll.jumpToLatest}
        >
          <ArrowDown />
        </IconButton>
      )}
    </DeferredMessageMedia>
  );
}

/** Keep a bounded message DOM while preserving grouping and message-ID navigation. */
export const MessageTimeline = memo(function MessageTimeline(props: MessageTimelineProps) {
  const normalizedQuery = props.searchQuery.trim().toLowerCase();
  const messageById = useMemo(() => {
    return new Map(props.messages.map((message) => [message.id, message]));
  }, [props.messages]);
  const visibleMessages = useMemo(() => {
    if (!normalizedQuery) {
      return props.messages;
    }
    return props.messages.filter((message) => {
      return describeMessage(message).toLowerCase().includes(normalizedQuery);
    });
  }, [props.messages, normalizedQuery]);

  return (
    <div className={styles.timelineArea} data-preview={props.isPreview}>
      <VirtualMessageHistory
        key={normalizedQuery}
        {...props}
        messages={visibleMessages}
        messageById={messageById}
        searchQuery={normalizedQuery}
      />
    </div>
  );
});
