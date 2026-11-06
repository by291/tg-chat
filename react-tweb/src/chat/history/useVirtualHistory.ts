import { readMeasuredHistoryAnchor, remeasureHistory, type ReadingAnchor } from './historyAnchor';
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import { useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { estimateHistoryRow } from './historyEstimate';
import { animateHistoryNavigation, getHistoryNavigationWindow } from './animateHistoryNavigation';
import type { HistoryRow } from './historyRows';
import { CURRENT_USER_ID } from '../model';
import type { MessageNavigation } from './MessageTimeline';

const OVERSCAN_ROWS = 8;
const WIDTH_SETTLE_DELAY_MS = 100;
const FOLLOW_BOTTOM_DISTANCE = 80;
const MIN_HISTORY_PREFETCH_DISTANCE = 360;
const SHOW_JUMP_DISTANCE = 160;
const HISTORY_TOP_PADDING = 40;
const HISTORY_BOTTOM_PADDING = 12;

interface VirtualHistoryOptions {
  rows: HistoryRow[];
  hasOlder: boolean;
  loadOlder: () => void;
  navigation?: MessageNavigation;
}

interface NavigationWindow {
  requestId: number;
  start: number;
  end: number;
  rows: HistoryRow[];
  retainedIndexes: number[];
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
  const cancelNavigationRef = useRef<(() => void) | undefined>(undefined);
  const cancelResizeRestoreRef = useRef<(() => void) | undefined>(undefined);
  const isResizingRef = useRef(false);
  const scrollFrameRef = useRef(0);
  const scrollWorkRef = useRef<() => void>(() => {});
  const activeNavigationRowsRef = useRef(rows);
  const previousLastKeyRef = useRef(rows.at(-1)?.key);
  const requestedHistoryStartRef = useRef<string | undefined>(undefined);
  const [navigationWindow, setNavigationWindow] = useState<NavigationWindow>();
  const shouldReduceMotion = useReducedMotion();
  const getItemKey = useCallback((index: number) => rows[index].key, [rows]);
  const estimateSize = useCallback(
    (index: number) => {
      return estimateHistoryRow(rows[index], viewportRef.current?.clientWidth || undefined);
    },
    [rows],
  );
  const rangeExtractor = useCallback(
    (range: Range) => {
      const visibleIndexes = defaultRangeExtractor(range);
      if (!navigationWindow || navigationWindow.rows !== rows) {
        return visibleIndexes;
      }

      // Keep the old viewport and animation corridor, without mounting the gap between distant
      // targets.
      const indexes = new Set([...visibleIndexes, ...navigationWindow.retainedIndexes]);
      for (let index = navigationWindow.start; index <= navigationWindow.end; index += 1) {
        indexes.add(index);
      }
      return Array.from(indexes).sort((left, right) => left - right);
    },
    [navigationWindow, rows],
  );

  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => viewportRef.current,
    getItemKey,
    estimateSize,
    rangeExtractor,
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
      readingAnchorRef.current = readMeasuredHistoryAnchor({ viewport, virtualizer });
    }
  }

  // Scroll events and virtualizer commits can arrive in the same frame. Share one read pass.
  function scheduleScrollWork() {
    if (scrollFrameRef.current) {
      return;
    }
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = 0;
      scrollWorkRef.current();
    });
  }

  useLayoutEffect(() => {
    scrollWorkRef.current = updateScrollPosition;
    scheduleScrollWork();
  });

  function cancelNavigation() {
    cancelResizeRestoreRef.current?.();
    cancelResizeRestoreRef.current = undefined;
    cancelNavigationRef.current?.();
    cancelNavigationRef.current = undefined;
  }

  useEffect(() => {
    return () => {
      cancelNavigation();
      cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = 0;
      lastNavigationRef.current = undefined;
    };
  }, []);

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
      cancelNavigation();
      setNavigationWindow(undefined);
      virtualizer.scrollToEnd({ behavior: shouldReduceMotion ? 'auto' : 'smooth' });
    }
    previousLastKeyRef.current = lastRow?.key;
  }, [rows, virtualizer, shouldReduceMotion]);

  useLayoutEffect(() => {
    if (!navigation) {
      cancelNavigation();
      setNavigationWindow(undefined);
      return;
    }
    // A reaction/edit may replace the rows while moving. Re-resolve the index only on that change.
    const isSameRequest = lastNavigationRef.current === navigation.requestId;
    const hasSameRows = activeNavigationRowsRef.current === rows;
    if (isSameRequest && (!cancelNavigationRef.current || hasSameRows)) {
      return;
    }
    const shouldPrepareWindow =
      navigationWindow?.requestId !== navigation.requestId || navigationWindow.rows !== rows;
    if (shouldPrepareWindow) {
      cancelNavigation();
      lastNavigationRef.current = undefined;
    }
    const targetIndex = rows.findIndex((row) => row.key === navigation.messageId);
    const viewport = viewportRef.current;
    if (targetIndex < 0 || !viewport) {
      return;
    }

    if (shouldPrepareWindow) {
      const nextWindow = getHistoryNavigationWindow({
        viewport,
        virtualizer,
        messageId: navigation.messageId,
        targetIndex,
      });
      if (nextWindow) {
        setNavigationWindow({
          ...nextWindow,
          requestId: navigation.requestId,
          rows,
          retainedIndexes: virtualizer.getVirtualItems().map((item) => item.index),
        });
      }
      return;
    }

    // The previous commit mounted and measured the animation corridor before movement begins.
    virtualizer.cancelScroll();
    activeNavigationRowsRef.current = rows;
    cancelNavigationRef.current = animateHistoryNavigation({
      viewport,
      virtualizer,
      messageId: navigation.messageId,
      targetIndex,
      shouldReduceMotion: Boolean(shouldReduceMotion),
      onComplete: () => {
        cancelNavigationRef.current = undefined;
        setNavigationWindow(undefined);
        scheduleScrollWork();
      },
    });
    lastNavigationRef.current = navigation.requestId;
  }, [navigation, rows, virtualizer, shouldReduceMotion, navigationWindow]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    previousWidthRef.current = viewport.clientWidth;
    rememberReadingPosition();
    let previousHeight = viewport.clientHeight;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    let resizeAnchor: ReadingAnchor | undefined;
    let shouldFollowAfterResize = false;

    const restoreAfterResize = () => {
      resizeTimer = undefined;
      isResizingRef.current = false;
      if (!viewport.clientWidth || !viewport.clientHeight) {
        return;
      }
      previousWidthRef.current = viewport.clientWidth;
      cancelResizeRestoreRef.current = remeasureHistory({
        viewport,
        virtualizer,
        anchor: resizeAnchor,
      });
      if (shouldFollowAfterResize) {
        cancelResizeRestoreRef.current?.();
        virtualizer.scrollToEnd({ behavior: 'auto' });
      }
      scheduleScrollWork();
    };

    const observer = new ResizeObserver(() => {
      const width = viewport.clientWidth;
      const height = viewport.clientHeight;
      if (!width || !height) {
        return;
      }
      const hasWidthChanged = width !== previousWidthRef.current || resizeTimer !== undefined;
      const wasAtEnd =
        viewport.scrollHeight - viewport.scrollTop - previousHeight <= FOLLOW_BOTTOM_DISTANCE;
      previousHeight = height;

      // Responsive width transitions deliver several intermediate sizes. Keep the original anchor
      // and rebuild once the width settles, rather than anchoring each already-shifted intermediate
      // frame.
      if (hasWidthChanged) {
        if (resizeTimer === undefined) {
          resizeAnchor = readingAnchorRef.current;
          shouldFollowAfterResize = wasAtEnd;
          cancelNavigation();
          setNavigationWindow(undefined);
        }
        clearTimeout(resizeTimer);
        isResizingRef.current = true;
        resizeTimer = setTimeout(restoreAfterResize, WIDTH_SETTLE_DELAY_MS);
        cancelResizeRestoreRef.current = () => {
          clearTimeout(resizeTimer);
          resizeTimer = undefined;
          isResizingRef.current = false;
          previousWidthRef.current = viewport.clientWidth;
          // A newer gesture owns position. Row observers can finish measuring without replaying
          // the old anchor or resetting the full cache during that gesture.
        };
        return;
      }
      if (wasAtEnd && !cancelNavigationRef.current) {
        virtualizer.scrollToEnd({ behavior: 'auto' });
      }
    });
    observer.observe(viewport);
    return () => {
      observer.disconnect();
      clearTimeout(resizeTimer);
      cancelResizeRestoreRef.current?.();
      isResizingRef.current = false;
    };
  }, [virtualizer]);

  function updateScrollPosition() {
    rememberReadingPosition();
    // User scrolling needs history ahead of the viewport, including during momentum. Only layout
    // rebuilding and explicit message navigation defer pagination; waiting for scroll idle hits
    // the loaded boundary and stops the gesture before the next page can be inserted.
    if (
      !isInitializedRef.current ||
      isResizingRef.current ||
      navigationWindow ||
      cancelNavigationRef.current ||
      !hasUserInteractedRef.current ||
      !hasOlder ||
      !viewportRef.current
    ) {
      return;
    }
    const viewport = viewportRef.current;
    const prefetchDistance = Math.max(MIN_HISTORY_PREFETCH_DISTANCE, viewport.clientHeight);
    const isApproachingStart = virtualizer.scrollDirection !== 'forward';
    if (!isApproachingStart || viewport.scrollTop > prefetchDistance) {
      return;
    }

    const firstRowKey = rows[0]?.key;
    if (!firstRowKey || requestedHistoryStartRef.current === firstRowKey) {
      return;
    }
    // Scroll and measurement callbacks may share the same loaded boundary until React commits.
    // Request it once; anchorTo: 'end' preserves the reading position when the prefix is inserted.
    requestedHistoryStartRef.current = firstRowKey;
    loadOlder();
  }

  function jumpToLatest() {
    cancelNavigation();
    lastNavigationRef.current = navigation?.requestId;
    setNavigationWindow(undefined);
    virtualizer.scrollToEnd({ behavior: shouldReduceMotion ? 'auto' : 'smooth' });
  }

  function cancelAutomaticScroll() {
    hasUserInteractedRef.current = true;
    cancelNavigation();
    lastNavigationRef.current = navigation?.requestId;
    setNavigationWindow(undefined);
    virtualizer.cancelScroll();
  }

  return {
    viewportRef,
    virtualizer,
    canJumpToLatest: virtualizer.getDistanceFromEnd() > SHOW_JUMP_DISTANCE,
    updateScrollPosition: scheduleScrollWork,
    isNavigating: Boolean(navigationWindow),
    jumpToLatest,
    cancelAutomaticScroll,
  };
}
