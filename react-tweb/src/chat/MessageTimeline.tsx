import { ArrowDown, Pin } from 'lucide-react';
import { AnimatePresence, useReducedMotion } from 'motion/react';
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IconButton } from '../shared/IconButton';
import { MessageBubble } from './MessageBubble';
import { belongsToSameGroup, describeMessage, formatMessageDate } from './messageFormatting';
import type { Message, MessageCommand } from './model';
import styles from './MessageTimeline.module.css';

const BOTTOM_DISTANCE_THRESHOLD = 160;
const HIGHLIGHT_DURATION = 1800;

export interface MessageNavigation {
  messageId: string;
  requestId: number;
}

interface MessageTimelineProps {
  messages: Message[];
  searchQuery: string;
  navigation?: MessageNavigation;
  onCommand: (command: MessageCommand) => void;
  onReact: (messageId: string, emoji: string) => void;
  onOpenMedia: (message: Message) => void;
  onJumpToMessage: (messageId: string) => void;
}

/** Keep the history scroll owner stable while rendering grouped, searchable messages. */
export function MessageTimeline({
  messages,
  searchQuery,
  navigation,
  onCommand,
  onReact,
  onOpenMedia,
  onJumpToMessage,
}: MessageTimelineProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const previousLastId = useRef<string | undefined>(undefined);
  const isNearBottomRef = useRef(true);
  const [canJumpToLatest, setCanJumpToLatest] = useState(false);
  const [highlightedId, setHighlightedId] = useState('');
  const shouldReduceMotion = useReducedMotion();
  const lastMessage = messages.at(-1);
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const visibleMessages = normalizedQuery
    ? messages.filter((message) => describeMessage(message).toLowerCase().includes(normalizedQuery))
    : messages;
  const pinnedMessages = messages.filter((message) => message.isPinned);
  const pinnedMessage = pinnedMessages.at(-1);

  function scrollToLatest() {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: shouldReduceMotion ? 'instant' : 'smooth',
    });
  }

  function updateScrollPosition() {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    isNearBottomRef.current = distance < BOTTOM_DISTANCE_THRESHOLD;
    setCanJumpToLatest(!isNearBottomRef.current);
  }

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const hasNewMessage = lastMessage?.id !== previousLastId.current;
    const shouldFollow = isNearBottomRef.current || lastMessage?.authorId === 'you';

    // Edits and reactions must not pull a reader away from their history position.
    if (viewport && hasNewMessage && shouldFollow && !normalizedQuery) {
      viewport.scrollTop = viewport.scrollHeight;
    }

    previousLastId.current = lastMessage?.id;
  }, [lastMessage?.id, lastMessage?.authorId, normalizedQuery]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const observer = new ResizeObserver(() => {
      // Composer growth changes the viewport; keep the latest message above it.
      if (isNearBottomRef.current && !normalizedQuery) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [normalizedQuery]);

  useEffect(() => {
    if (!navigation) {
      return;
    }

    const messageElement = document.getElementById(`message-${navigation.messageId}`);
    messageElement?.scrollIntoView({
      block: 'center',
      behavior: shouldReduceMotion ? 'instant' : 'smooth',
    });
    setHighlightedId(navigation.messageId);
    const timeout = window.setTimeout(() => setHighlightedId(''), HIGHLIGHT_DURATION);
    return () => window.clearTimeout(timeout);
  }, [navigation, shouldReduceMotion]);

  return (
    <div className={styles.timelineArea}>
      {pinnedMessage && !normalizedQuery && (
        <button className={styles.pinnedMessage} onClick={() => onJumpToMessage(pinnedMessage.id)}>
          <Pin size={19} />
          <span>
            <strong>Pinned message</strong>
            <span>{describeMessage(pinnedMessage)}</span>
          </span>
        </button>
      )}
      <div
        ref={viewportRef}
        className={styles.viewport}
        onScroll={updateScrollPosition}
        aria-label="Message history"
        tabIndex={0}
      >
        <div className={styles.messages}>
          <div className={styles.historyStart}>
            <span>November 5</span>
          </div>
          <div className={styles.serviceMessage}>You created this group</div>
          <AnimatePresence initial={false}>
            {visibleMessages.map((message, index) => {
              const previousMessage = visibleMessages[index - 1];
              const nextMessage = visibleMessages[index + 1];
              const hasNewDate =
                previousMessage &&
                formatMessageDate(previousMessage.createdAt) !==
                  formatMessageDate(message.createdAt);

              return (
                <Fragment key={message.id}>
                  {hasNewDate && (
                    <div className={styles.dateSeparator}>
                      {formatMessageDate(message.createdAt)}
                    </div>
                  )}
                  <MessageBubble
                    message={message}
                    replyMessage={messages.find((entry) => entry.id === message.replyToId)}
                    isGroupStart={!belongsToSameGroup(message, previousMessage)}
                    isGroupEnd={!nextMessage || !belongsToSameGroup(nextMessage, message)}
                    isHighlighted={message.id === highlightedId}
                    onCommand={onCommand}
                    onReact={onReact}
                    onOpenMedia={onOpenMedia}
                    onJumpToMessage={onJumpToMessage}
                  />
                </Fragment>
              );
            })}
          </AnimatePresence>
          {visibleMessages.length === 0 && (
            <div className={styles.emptyState}>
              <span>✦</span>
              <strong>{normalizedQuery ? 'No messages found' : 'A fresh conversation'}</strong>
              <p>
                {normalizedQuery ? 'Try another word or phrase.' : 'Send a message to get started.'}
              </p>
            </div>
          )}
        </div>
      </div>
      {canJumpToLatest && !normalizedQuery && (
        <IconButton
          label="Jump to latest message"
          className={styles.jumpButton}
          onClick={scrollToLatest}
        >
          <ArrowDown />
        </IconButton>
      )}
    </div>
  );
}
