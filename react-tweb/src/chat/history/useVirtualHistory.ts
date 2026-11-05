import { readHistoryAnchor, remeasureHistory, type ReadingAnchor } from './historyAnchor';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { estimateHistoryRow } from './historyEstimate';
import type { HistoryRow } from './historyRows';
import { CURRENT_USER_ID } from '../model';
import type { MessageNavigation } from './MessageTimeline';

const OVERSCAN_ROWS = 8;
const FOLLOW_BOTTOM_DISTANCE = 80;
const LOAD_OLDER_DISTANCE = 360;
const SHOW_JUMP_DISTANCE = 160;
const HISTORY_TOP_PADDING = 40;
const HISTORY_BOTTOM_PADDING = 12;

interface VirtualHistoryOptions {
  rows: HistoryRow[];
  hasOlder: boolean;
  loadOlder: () => void;
  navigation?: MessageNavigation;
}

/** Give the virtualizer sole ownership of history measurements and scroll correction. */
export function useVirtualHistory({
  rows,
  hasOlder,
  loadOlder,
  navigation,
}: VirtualHistoryOptions) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const isInitializedRef = useRef(false);
  const hasUserInteractedRef = useRef(false);
  const previousWidthRef = useRef(0);
  const readingAnchorRef = useRef<ReadingAnchor | undefined>(undefined);
  const lastNavigationRef = useRef<number | undefined>(undefined);
  const previousLastKeyRef = useRef(rows.at(-1)?.key);
  const shouldReduceMotion = useReducedMotion();
  const getItemKey = useCallback((index: number) => rows[index].key, [rows]);
  const estimateSize = useCallback(
    (index: number) => {
      return estimateHistoryRow(rows[index], viewportRef.current?.clientWidth || undefined);
    },
    [rows],
  );

  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => viewportRef.current,
    getItemKey,
    estimateSize,
    // Preserve fractional heights so rounding cannot widen the gap between adjacent bubbles.
    measureElement: (element, entry) => {
      return entry?.borderBoxSize[0]?.blockSize ?? element.getBoundingClientRect().height;
    },
    overscan: OVERSCAN_ROWS,
    paddingStart: HISTORY_TOP_PADDING,
    paddingEnd: HISTORY_BOTTOM_PADDING,
    anchorTo: 'end',
    followOnAppend: shouldReduceMotion ? 'auto' : 'smooth',
    scrollEndThreshold: FOLLOW_BOTTOM_DISTANCE,
  });

  function rememberReadingPosition() {
    const viewport = viewportRef.current;
    if (viewport && viewport.clientWidth === previousWidthRef.current) {
      readingAnchorRef.current = readHistoryAnchor(viewport);
    }
  }

  useLayoutEffect(rememberReadingPosition);

  useLayoutEffect(() => {
    // Strict Mode remounts effects; schedule after the viewport and first rows have committed.
    const frame = requestAnimationFrame(() => {
      // A reply jump owns initial positioning when search remounts the history.
      if (!navigation) {
        virtualizer.scrollToEnd({ behavior: 'auto' });
      }
      isInitializedRef.current = true;
    });
    return () => {
      cancelAnimationFrame(frame);
      isInitializedRef.current = false;
    };
  }, [virtualizer, navigation]);

  useLayoutEffect(() => {
    const lastRow = rows.at(-1);
    const previousLastKey = previousLastKeyRef.current;
    const hasAppended =
      lastRow && previousLastKey !== lastRow.key && rows.some((row) => row.key === previousLastKey);
    const isOwnMessage =
      lastRow?.kind === 'message' && lastRow.message.authorId === CURRENT_USER_ID;

    // Sending explicitly returns to the latest message, even while reading older history.
    if (hasAppended && isOwnMessage) {
      virtualizer.scrollToEnd({ behavior: shouldReduceMotion ? 'auto' : 'smooth' });
    }
    previousLastKeyRef.current = lastRow?.key;
  }, [rows, virtualizer, shouldReduceMotion]);

  useLayoutEffect(() => {
    if (!navigation || lastNavigationRef.current === navigation.requestId) {
      return;
    }
    const targetIndex = rows.findIndex((row) => row.key === navigation.messageId);
    if (targetIndex < 0) {
      return;
    }

    // Distant targets are not mounted yet; DOM scrollIntoView cannot resolve them.
    virtualizer.scrollToIndex(targetIndex, { align: 'center', behavior: 'auto' });
    lastNavigationRef.current = navigation.requestId;
  }, [navigation, rows, virtualizer]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    previousWidthRef.current = viewport.clientWidth;
    rememberReadingPosition();
    let previousHeight = viewport.clientHeight;
    const observer = new ResizeObserver(() => {
      const hasWidthChanged = viewport.clientWidth !== previousWidthRef.current;
      const wasAtEnd =
        viewport.scrollHeight - viewport.scrollTop - previousHeight <= FOLLOW_BOTTOM_DISTANCE;
      previousWidthRef.current = viewport.clientWidth;
      previousHeight = viewport.clientHeight;

      // Cached wrapping depends on width, while composer growth only changes viewport height.
      if (hasWidthChanged) {
        remeasureHistory({
          viewport,
          virtualizer,
          anchor: readingAnchorRef.current,
        });
      }
      if (wasAtEnd) {
        virtualizer.scrollToEnd({ behavior: 'auto' });
      }
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [virtualizer]);

  function updateScrollPosition() {
    rememberReadingPosition();
    if (
      !isInitializedRef.current ||
      !hasUserInteractedRef.current ||
      !hasOlder ||
      !viewportRef.current
    ) {
      return;
    }
    if (viewportRef.current.scrollTop < LOAD_OLDER_DISTANCE) {
      loadOlder();
    }
  }

  function jumpToLatest() {
    virtualizer.scrollToEnd({ behavior: shouldReduceMotion ? 'auto' : 'smooth' });
  }

  function cancelAutomaticScroll() {
    hasUserInteractedRef.current = true;
    virtualizer.cancelScroll();
  }

  return {
    viewportRef,
    virtualizer,
    canJumpToLatest: virtualizer.getDistanceFromEnd() > SHOW_JUMP_DISTANCE,
    updateScrollPosition,
    jumpToLatest,
    cancelAutomaticScroll,
  };
}
