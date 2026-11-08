import { ChevronDown, Quote } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import styles from './MessageQuote.module.css';

const COLLAPSED_QUOTE_HEIGHT = 56;

interface MessageQuoteProps {
  children: ReactNode;
  isCollapsible?: boolean;
}

/** Render a quoted passage with Telegram's optional three-line disclosure. */
export function MessageQuote({ children, isCollapsible = false }: MessageQuoteProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const contentId = useId();
  const [isExpanded, setIsExpanded] = useState(false);
  const [contentHeight, setContentHeight] = useState(COLLAPSED_QUOTE_HEIGHT);
  const isTruncated = contentHeight > COLLAPSED_QUOTE_HEIGHT;

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content || !isCollapsible) {
      return;
    }

    function measureContent() {
      if (content) {
        setContentHeight(content.scrollHeight);
      }
    }

    measureContent();
    // Observe the natural content height, not the animated clipping box, to avoid feedback loops.
    const observer = new ResizeObserver(measureContent);
    observer.observe(content);

    return () => observer.disconnect();
  }, [children, isCollapsible]);

  return (
    <blockquote
      className={styles.quote}
      dir="auto"
      data-collapsible={isCollapsible}
      data-expanded={isExpanded}
      style={
        isCollapsible
          ? { maxHeight: isExpanded ? contentHeight : COLLAPSED_QUOTE_HEIGHT }
          : undefined
      }
      onClick={(event) => {
        const target = event.target as HTMLElement;
        const isInteractive = target.closest('a, button, [role="button"]');
        if (isCollapsible && isTruncated && !isInteractive && !window.getSelection()?.toString()) {
          setIsExpanded((current) => !current);
        }
      }}
    >
      <Quote className={styles.quoteIcon} size={11} fill="currentColor" aria-hidden="true" />
      <div ref={contentRef} id={contentId} className={styles.content} dir="auto">
        {children}
      </div>
      {isCollapsible && isTruncated && (
        <button
          type="button"
          className={styles.collapse}
          aria-label={isExpanded ? 'Collapse quote' : 'Expand quote'}
          aria-controls={contentId}
          aria-expanded={isExpanded}
          onClick={(event) => {
            event.stopPropagation();
            setIsExpanded((current) => !current);
          }}
        >
          <ChevronDown size={16} aria-hidden="true" />
        </button>
      )}
    </blockquote>
  );
}
