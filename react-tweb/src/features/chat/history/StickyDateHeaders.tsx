import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { getActiveHistoryDateKey, type HistoryDateGroup } from './historyDates';
import styles from './MessageTimeline.module.css';

const SCROLL_IDLE_DELAY = 1350;

interface StickyDateHeadersProps {
  groups: HistoryDateGroup[];
  viewportRef: RefObject<HTMLDivElement | null>;
  topInset: number;
  isPreview: boolean;
  onOpenDate: (timestamp: number) => void;
}

type DateVisibilityOptions = Pick<StickyDateHeadersProps, 'groups' | 'viewportRef' | 'topInset'>;

function useDateVisibility(options: DateVisibilityOptions) {
  const { viewportRef } = options;
  const geometryRef = useRef(options);
  const [activeDateKey, setActiveDateKey] = useState<string>();
  const [isScrolling, setIsScrolling] = useState(false);

  useLayoutEffect(() => {
    // Prepending history changes coordinates; replace them before the next scroll callback.
    geometryRef.current = options;
    const viewport = viewportRef.current;
    if (viewport) {
      setActiveDateKey(
        getActiveHistoryDateKey({
          groups: options.groups,
          scrollOffset: viewport.scrollTop,
          topInset: options.topInset,
        }),
      );
    }
  }, [options.groups, options.topInset, viewportRef]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    const scrollElement = viewport;
    let idleTimeout: number | undefined;
    let frame: number | undefined;

    function updateVisibility() {
      frame = undefined;
      const geometry = geometryRef.current;
      setActiveDateKey(
        getActiveHistoryDateKey({
          groups: geometry.groups,
          scrollOffset: scrollElement.scrollTop,
          topInset: geometry.topInset,
        }),
      );
      const distanceToEnd =
        scrollElement.scrollHeight - scrollElement.clientHeight - scrollElement.scrollTop;
      // Bottom-anchored layout corrections must not reveal an idle date again.
      if (distanceToEnd <= 0) {
        return;
      }
      setIsScrolling(true);
      window.clearTimeout(idleTimeout);
      idleTimeout = window.setTimeout(() => setIsScrolling(false), SCROLL_IDLE_DELAY);
    }

    function scheduleVisibilityUpdate() {
      if (frame === undefined) {
        frame = requestAnimationFrame(updateVisibility);
      }
    }

    viewport.addEventListener('scroll', scheduleVisibilityUpdate, { passive: true });
    return () => {
      viewport.removeEventListener('scroll', scheduleVisibilityUpdate);
      window.clearTimeout(idleTimeout);
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }
    };
  }, [viewportRef]);

  return { activeDateKey, isScrolling };
}

/** Keep both neighboring date headers mounted while native sticky positioning performs the handoff. */
export function StickyDateHeaders({
  groups,
  viewportRef,
  topInset,
  isPreview,
  onOpenDate,
}: StickyDateHeadersProps) {
  const { activeDateKey, isScrolling } = useDateVisibility({ groups, viewportRef, topInset });

  return groups.map((group) => {
    const isSticky = !isPreview && group.date.key === activeDateKey;
    const isHidden = isSticky && !isScrolling;
    return (
      <div
        key={group.date.key}
        className={styles.dateGroup}
        style={{ top: group.start, height: group.end - group.start }}
      >
        <div className={styles.dateHeader} data-hidden={isHidden} inert={isHidden || isPreview}>
          <button
            type="button"
            className={styles.dateSeparator}
            aria-label={`Jump to date: ${group.date.label}`}
            onClick={() => onOpenDate(group.date.timestamp)}
          >
            {group.date.label}
          </button>
        </div>
      </div>
    );
  });
}
