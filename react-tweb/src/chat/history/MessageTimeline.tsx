import { ArrowDown } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { IconButton } from '../../components/IconButton';
import { createHistoryRows } from './historyRows';
import { MessageBubble } from '../messages/MessageBubble';
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
  isPreview,
  messageIdPrefix,
  onCommand,
  onReact,
  onVote,
  onOpenMedia,
  onJumpToMessage,
}: VirtualMessageHistoryProps) {
  const allRows = useMemo(() => createHistoryRows(messages), [messages]);
  const appearedIdsRef = useRef(new Set(messages.map((message) => message.id)));
  const [highlightedId, setHighlightedId] = useState('');
  const history = useHistoryWindow(allRows);
  const { rows, hasOlder, loadOlder } = history;
  const scroll = useVirtualHistory({ rows, hasOlder, loadOlder, navigation });
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

  function markMessageAppeared(messageId: string) {
    appearedIdsRef.current.add(messageId);
  }

  return (
    <>
      <div
        ref={scroll.viewportRef}
        className={styles.viewport}
        onScroll={scroll.updateScrollPosition}
        onWheel={scroll.cancelAutomaticScroll}
        onTouchStart={scroll.cancelAutomaticScroll}
        onPointerDown={scroll.cancelAutomaticScroll}
        onKeyDown={scroll.cancelAutomaticScroll}
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
                    isPreview={isPreview}
                    idPrefix={messageIdPrefix}
                    replyMessage={messageById.get(row.message.replyToId || '')}
                    isGroupStart={row.isGroupStart}
                    isGroupEnd={row.isGroupEnd}
                    isHighlighted={row.key === highlightedId}
                    shouldAnimate={!appearedIdsRef.current.has(row.key)}
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
      {scroll.canJumpToLatest && !searchQuery && (
        <IconButton
          label="Jump to latest message"
          className={styles.jumpButton}
          onClick={scroll.jumpToLatest}
        >
          <ArrowDown />
        </IconButton>
      )}
    </>
  );
}

/** Keep a bounded message DOM while preserving grouping and message-ID navigation. */
export function MessageTimeline(props: MessageTimelineProps) {
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
}
