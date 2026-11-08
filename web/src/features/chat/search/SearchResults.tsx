import { useVirtualizer } from '@tanstack/react-virtual';
import { useLayoutEffect, useRef } from 'react';
import { Avatar } from '@/components/Avatar';
import { Ripple } from '@/components/Ripple';
import { describeMessage } from '../messageFormatting';
import type { Message } from '@/domain/messages/message';
import styles from './ChatSearch.module.css';

const RESULT_HEIGHT = 56;
const MAX_RESULTS_HEIGHT = 271;
const RESULT_OVERSCAN = 3;

interface SearchResultsProps {
  messages: Message[];
  activeId: string;
  query: string;
  onSelect: (message: Message) => void;
}

function MatchedText({ text, query }: { text: string; query: string }) {
  const normalizedQuery = query.trim().toLowerCase();
  const start = text.toLowerCase().indexOf(normalizedQuery);
  if (!normalizedQuery || start < 0) {
    return text;
  }

  const end = start + normalizedQuery.length;

  return (
    <>
      {text.slice(0, start)}
      <mark>{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
}

/** Bound the search dropdown DOM even when a short query matches the entire cached history. */
export function SearchResults({ messages, activeId, query, onSelect }: SearchResultsProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => RESULT_HEIGHT,
    getItemKey: (index) => messages[index].id,
    overscan: RESULT_OVERSCAN,
  });
  const height = Math.min(MAX_RESULTS_HEIGHT, messages.length * RESULT_HEIGHT);

  useLayoutEffect(
    () => {
      const activeIndex = messages.findIndex((message) => message.id === activeId);
      if (activeIndex >= 0) {
        virtualizer.scrollToIndex(activeIndex, { align: 'auto' });
      }
    },
    // prettier-ignore
    [
      activeId,
      messages,
      virtualizer,
    ],
  );

  return (
    <div
      ref={viewportRef}
      role="region"
      aria-label="Search results"
      className={styles.resultViewport}
      style={{ height }}
    >
      <div className={styles.resultCanvas} style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const message = messages[item.index];

          return (
            <button
              key={message.id}
              className={`${styles.result} ${styles.virtualResult}`}
              style={{ transform: `translateY(${item.start}px)` }}
              data-active={activeId === message.id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelect(message)}
            >
              <Avatar initials={message.authorName.slice(0, 1)} color="purple" size="small" />
              <span className={styles.resultText}>
                <strong>{message.authorName}</strong>
                <span>
                  <MatchedText text={describeMessage(message)} query={query} />
                </span>
              </span>
              <time>
                {new Date(message.createdAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })}
              </time>
              <Ripple />
            </button>
          );
        })}
      </div>
    </div>
  );
}
