import { readMeasuredHistoryAnchor, remeasureHistory, type ReadingAnchor } from './historyAnchor';
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import { useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { estimateHistoryRow } from './historyEstimate';
import { animateHistoryNavigation, getHistoryNavigationWindow } from './animateHistoryNavigation';
import { unreadHistoryRowKey, type HistoryRow } from './historyRows';
import type { RemoteHistory } from './useHistoryWindow';
import { useCurrentUserId } from '@/features/chat/CurrentUser';
import type { MessageNavigation } from './MessageTimeline';
import type { ChatOverlayInsets } from '../useChatOverlayInsets';
import { animateHistoryInset } from './animateHistoryInset';
import { createHistoryScroll } from './createHistoryScroll';
import {
  canMarkLatestRead,
  canReadVisibleHistory,
  shouldLoadHistoryBoundary,
  shouldLoadOlderHistory,
} from './historyViewportPolicy';

const OVERSCAN_ROWS = 8;
const WIDTH_SETTLE_DELAY_MS = 100;
const FOLLOW_BOTTOM_DISTANCE = 80;
const DISABLE_END_FOLLOW_DISTANCE = -1;
const SHOW_JUMP_DISTANCE = 160;
const HISTORY_TOP_PADDING = 8;
const HISTORY_BOTTOM_PADDING = 12;
const NO_OVERLAYS: ChatOverlayInsets = { top: 0, bottom: 0 };

interface VirtualHistoryOptions {
  rows: HistoryRow[];
  overlayInsets?: ChatOverlayInsets;
  hasOlder: boolean;
  loadOlder: () => void;
  remoteHistory?: RemoteHistory;
  navigation?: MessageNavigation;
  latestRequest?: number;
  onReachLatest?: (messageId: string) => void;
  onReachMessage?: (messageId: string) => void;
}

interface NavigationWindow {
  requestId: string;
  start: number;
  end: number;
  rows: HistoryRow[];
  retainedIndexes: number[];
}

interface LatestNavigationRequest {
  requestId: number;
  messageRequestId?: number;
}

/** Give the virtualizer sole ownership of history measurements and scroll correction. */
export function useVirtualHistory({
  rows,
  overlayInsets = NO_OVERLAYS,
  hasOlder,
  loadOlder,
  remoteHistory,
  navigation,
  latestRequest,
  onReachLatest,
  onReachMessage,
}: VirtualHistoryOptions) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const animatedRowsRef = useRef<HTMLDivElement>(null);
  const cancelNavigationRef = useRef<(() => void) | undefined>(undefined);
  const [historyScroll] = useState(() =>
    createHistoryScroll({
      getAnimatedRows: () => animatedRowsRef.current,
      isNavigationActive: () => Boolean(cancelNavigationRef.current),
      onRevealComplete: scheduleScrollWork,
    }),
  );
  const previousBottomAlignmentRef = useRef(0);
  const insetAnimationRef = useRef<Animation | undefined>(undefined);
  const previousInsetsRef = useRef(overlayInsets);
  const isInitializedRef = useRef(false);
  const hasUserInteractedRef = useRef(false);
  const previousContentWidthRef = useRef(0);
  const readingAnchorRef = useRef<ReadingAnchor | undefined>(undefined);
  const lastNavigationRef = useRef<string | undefined>(undefined);
  const latestRequestIdRef = useRef(0);
  const pendingLatestRequestRef = useRef<LatestNavigationRequest | undefined>(undefined);
  const externalLatestRequestRef = useRef(latestRequest);
  const cancelResizeRestoreRef = useRef<(() => void) | undefined>(undefined);
  const isResizingRef = useRef(false);
  const scrollFrameRef = useRef(0);
  const scrollWorkRef = useRef<() => void>(() => {});
  const activeNavigationRowsRef = useRef(rows);
  const previousLastKeyRef = useRef(rows.at(-1)?.key);
  const hasNewer = Boolean(remoteHistory?.hasNewer);
  const previousHasNewerRef = useRef(hasNewer);
  const requestedHistoryStartRef = useRef<string | undefined>(undefined);
  const requestedHistoryEndRef = useRef<string | undefined>(undefined);
  const [navigationWindow, setNavigationWindow] = useState<NavigationWindow>();
  const [latestNavigation, setLatestNavigation] = useState<LatestNavigationRequest>();
  const isLatestNavigation = Boolean(
    latestNavigation && !hasNewer && latestNavigation.messageRequestId === navigation?.requestId,
  );
  let navigationKey: string | undefined;
  if (isLatestNavigation) {
    navigationKey = `latest:${latestNavigation?.requestId}`;
  } else if (navigation) {
    navigationKey = `message:${navigation.requestId}`;
  }

  useLayoutEffect(() => {
    // A newer message navigation permanently supersedes the manual Latest request. Clearing
    // that message request later must not resurrect an already consumed bottom navigation.
    if (latestNavigation && latestNavigation.messageRequestId !== navigation?.requestId) {
      setLatestNavigation(undefined);
    }
    const pendingLatestRequest = pendingLatestRequestRef.current;
    if (pendingLatestRequest && pendingLatestRequest.messageRequestId !== navigation?.requestId) {
      pendingLatestRequestRef.current = undefined;
    }
  }, [latestNavigation, navigation?.requestId]);

  const shouldReduceMotion = useReducedMotion();
  const getItemKey = useCallback((index: number) => rows[index].key, [rows]);
  const estimateSize = useCallback(
    (index: number) => {
      return estimateHistoryRow(rows[index], contentRef.current?.clientWidth || undefined);
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

  const currentUserId = useCurrentUserId();
  const lastRow = rows.at(-1);
  const previousLastKey = previousLastKeyRef.current;
  const hasAppended = Boolean(
    lastRow &&
    previousLastKey !== lastRow.key &&
    (previousLastKey === undefined || rows.some((row) => row.key === previousLastKey)),
  );
  const isOwnMessage = lastRow?.kind === 'message' && lastRow.message.authorId === currentUserId;
  const viewport = viewportRef.current;
  const scrollOffsetBeforeCommit = viewport?.scrollTop ?? 0;
  const isFollowingLatest = Boolean(
    viewport &&
    viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= FOLLOW_BOTTOM_DISTANCE,
  );
  // An arriving newer page extends the reading window, even if it happens to reach the end.
  const canFollowLatest = !hasNewer && !previousHasNewerRef.current;
  const shouldReveal = canFollowLatest && hasAppended && (isOwnMessage || isFollowingLatest);
  if (shouldReveal && isInitializedRef.current && !shouldReduceMotion) {
    // Ref measurements run before layout effects. Reserve scroll ownership before they can
    // apply estimate corrections, otherwise the first painted frame starts from a jump.
    const isPhotoReveal =
      lastRow?.kind === 'message' &&
      Boolean(lastRow.message.attachment || lastRow.message.media?.kind === 'album');
    historyScroll.prepare({ kind: isPhotoReveal ? 'photo-reveal' : 'text-reveal' });
  }

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
    // This inset belongs to the history once, rather than being repeated above every date.
    paddingStart: overlayInsets.top + HISTORY_TOP_PADDING,
    // The floating composer inset already reserves its space; the last group supplies the gap.
    paddingEnd: overlayInsets.bottom > 0 ? overlayInsets.bottom : HISTORY_BOTTOM_PADDING,
    scrollPaddingStart: overlayInsets.top,
    scrollPaddingEnd: overlayInsets.bottom,
    scrollToFn: historyScroll.scrollTo,
    anchorTo: 'end',
    followOnAppend: canFollowLatest && (shouldReduceMotion ? 'auto' : 'smooth'),
    // Keep the key anchor when a bounded page is resized without pinning its temporary bottom.
    scrollEndThreshold: canFollowLatest ? FOLLOW_BOTTOM_DISTANCE : DISABLE_END_FOLLOW_DISTANCE,
  });
  const viewportHeight = virtualizer.scrollRect?.height ?? 0;
  const bottomAlignment = Math.max(0, viewportHeight - virtualizer.getTotalSize());

  useLayoutEffect(
    () => {
      const previous = previousInsetsRef.current;
      previousInsetsRef.current = overlayInsets;
      const viewport = viewportRef.current;
      if (!viewport || !isInitializedRef.current) {
        return;
      }

      const topChange = overlayInsets.top - previous.top;
      const bottomChange = overlayInsets.bottom - previous.bottom;
      if (topChange === 0 && bottomChange === 0) {
        return;
      }

      // The viewport no longer shrinks when reply/edit controls grow. Preserve the same reading
      // position explicitly, or keep the latest message above the resized composer at the end.
      const previousDistance =
        virtualizer.getTotalSize() -
        viewport.scrollTop -
        viewport.clientHeight -
        topChange -
        bottomChange;
      // An appended message already owns the movement. Collapsing its reply/input helper must
      // retarget that reveal, rather than snapping to the end and covering it with another motion.
      if (historyScroll.isAnimating()) {
        virtualizer.scrollToEnd({ behavior: 'smooth' });
        return;
      }
      if (!hasNewer && previousDistance <= FOLLOW_BOTTOM_DISTANCE) {
        virtualizer.scrollToEnd({ behavior: 'auto' });
        const animatedRows = animatedRowsRef.current;
        if (animatedRows && bottomChange !== 0) {
          // Commit padding and scroll once, then animate only pixels; per-frame React updates
          // would repeatedly update the virtual range and render the message components.
          insetAnimationRef.current = animateHistoryInset({
            element: animatedRows,
            offset: bottomChange,
            duration: shouldReduceMotion ? 0 : (overlayInsets.transitionDuration ?? 0),
            previousAnimation: insetAnimationRef.current,
          });
        }
        return;
      }

      virtualizer.scrollToOffset(viewport.scrollTop + topChange, { behavior: 'auto' });
    },
    // prettier-ignore
    [
      overlayInsets,
      virtualizer,
      shouldReduceMotion,
      hasNewer,
    ],
  );

  useEffect(() => {
    return () => insetAnimationRef.current?.cancel();
  }, []);

  function rememberReadingPosition() {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (viewport && content?.clientWidth === previousContentWidthRef.current) {
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

  function cancelOtherMotion() {
    insetAnimationRef.current?.cancel();
    insetAnimationRef.current = undefined;
    cancelResizeRestoreRef.current?.();
    cancelResizeRestoreRef.current = undefined;
    cancelNavigationRef.current?.();
    cancelNavigationRef.current = undefined;
  }

  function cancelNavigation() {
    historyScroll.cancel();
    cancelOtherMotion();
  }

  useEffect(() => {
    return () => {
      cancelNavigation();
      cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = 0;
      lastNavigationRef.current = undefined;
      pendingLatestRequestRef.current = undefined;
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
      scheduleScrollWork();
    });
    return () => {
      cancelAnimationFrame(frame);
      isInitializedRef.current = false;
    };
  }, [virtualizer, navigation]);

  useLayoutEffect(() => {
    const previousBottomAlignment = previousBottomAlignmentRef.current;
    previousBottomAlignmentRef.current = bottomAlignment;
    previousLastKeyRef.current = lastRow?.key;
    previousHasNewerRef.current = hasNewer;
    if (!isInitializedRef.current) {
      return;
    }

    // Both the estimated append and its measured height change bottom alignment. Compensate
    // each committed layout before paint, not just the render that first added the message.
    if (historyScroll.isAnimating()) {
      // A shrinking canvas clamps native scrollTop even when no scroll command is issued.
      const scrollOffsetAfterCommit = viewportRef.current?.scrollTop ?? 0;
      const clampedDistance = scrollOffsetAfterCommit - scrollOffsetBeforeCommit;
      historyScroll.reveal(previousBottomAlignment - bottomAlignment + clampedDistance);
    }
    if (!shouldReveal) {
      return;
    }

    // Reserving the reveal must not keep a previous resize restore or reply navigation alive.
    cancelOtherMotion();
    setNavigationWindow(undefined);
    virtualizer.scrollToEnd({ behavior: shouldReduceMotion ? 'auto' : 'smooth' });
  });

  useLayoutEffect(() => {
    if (!navigationKey) {
      if (lastNavigationRef.current !== undefined) {
        cancelNavigation();
        lastNavigationRef.current = undefined;
        setNavigationWindow(undefined);
      }
      return;
    }

    // A reaction/edit may replace the rows while moving. Re-resolve the index only on that change.
    const isSameRequest = lastNavigationRef.current === navigationKey;
    const hasSameRows = activeNavigationRowsRef.current === rows;
    if (isSameRequest && (!cancelNavigationRef.current || hasSameRows)) {
      return;
    }

    const shouldPrepareWindow =
      navigationWindow?.requestId !== navigationKey || navigationWindow.rows !== rows;
    if (shouldPrepareWindow) {
      cancelNavigation();
      lastNavigationRef.current = undefined;
    }

    let targetIndex = rows.length - 1;
    let alignment: 'start' | 'center' | 'end' = 'end';
    if (!isLatestNavigation) {
      const target = navigation?.messageId;
      targetIndex = rows.findIndex((row) => row.key === target);
      alignment = 'center';
      if (navigation?.kind === 'unread' && target) {
        const dividerKey = unreadHistoryRowKey(target);
        const dividerIndex = rows.findIndex((row) => row.key === dividerKey);
        targetIndex = dividerIndex >= 0 ? dividerIndex : targetIndex;
        alignment = 'start';
      }
    }
    const viewport = viewportRef.current;
    if (targetIndex < 0 || !viewport) {
      return;
    }

    const messageId = rows[targetIndex].key;
    if (shouldPrepareWindow) {
      const nextWindow = getHistoryNavigationWindow({
        viewport,
        virtualizer,
        messageId,
        targetIndex,
        alignment,
      });
      if (nextWindow) {
        setNavigationWindow({
          ...nextWindow,
          requestId: navigationKey,
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
      messageId,
      targetIndex,
      alignment,
      shouldReduceMotion: Boolean(shouldReduceMotion),
      onComplete: () => {
        cancelNavigationRef.current = undefined;
        setNavigationWindow(undefined);
        scheduleScrollWork();
      },
    });
    lastNavigationRef.current = navigationKey;
  }, [
    navigationKey,
    navigation,
    isLatestNavigation,
    rows,
    virtualizer,
    shouldReduceMotion,
    navigationWindow,
  ]);

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) {
      return;
    }

    previousContentWidthRef.current = content.clientWidth;
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

      previousContentWidthRef.current = content.clientWidth;
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
      const width = content.clientWidth;
      const height = viewport.clientHeight;
      if (!width || !height) {
        return;
      }

      const hasWidthChanged =
        width !== previousContentWidthRef.current || resizeTimer !== undefined;
      // The content observer also reports history-height changes from pagination and media.
      // Those are already owned by row measurement and must not start a viewport resize pass.
      if (!hasWidthChanged && height === previousHeight) {
        return;
      }

      const distanceFromEnd = viewport.scrollHeight - viewport.scrollTop - previousHeight;
      const wasAtEnd = !previousHasNewerRef.current && distanceFromEnd <= FOLLOW_BOTTOM_DISTANCE;
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
          previousContentWidthRef.current = content.clientWidth;
          // A newer gesture owns position. Row observers can finish measuring without replaying
          // the old anchor or resetting the full cache during that gesture.
        };
        return;
      }

      if (wasAtEnd && !cancelNavigationRef.current) {
        virtualizer.scrollToEnd({ behavior: 'auto' });
      }
    });
    // Side panels can change the scroll surface without changing the capped message column.
    // Only a content-width change invalidates wrapping and cached row heights.
    observer.observe(viewport);
    observer.observe(content);

    return () => {
      observer.disconnect();
      clearTimeout(resizeTimer);
      cancelResizeRestoreRef.current?.();
      isResizingRef.current = false;
    };
  }, [virtualizer]);

  useEffect(() => {
    // Returning to the foreground can make an already visible message readable without scrolling.
    window.addEventListener('focus', scheduleScrollWork);
    document.addEventListener('visibilitychange', scheduleScrollWork);
    return () => {
      window.removeEventListener('focus', scheduleScrollWork);
      document.removeEventListener('visibilitychange', scheduleScrollWork);
    };
  }, []);

  function updateScrollPosition() {
    rememberReadingPosition();
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const activity = {
      isInitialized: isInitializedRef.current,
      isResizing: isResizingRef.current,
      isNavigating: Boolean(
        cancelNavigationRef.current ||
        navigationWindow ||
        pendingLatestRequestRef.current ||
        historyScroll.isAnimating(),
      ),
    };
    const readPosition = {
      activity,
      viewport,
      isPageVisible: document.visibilityState === 'visible',
      hasPageFocus: document.hasFocus(),
    };
    if (onReachLatest && !hasNewer && lastRow?.kind === 'message') {
      if (canMarkLatestRead(readPosition)) {
        onReachLatest(lastRow.key);
      }
    }
    if (onReachMessage && canReadVisibleHistory(readPosition)) {
      const reachedId = getReachedMessageId(viewport);
      if (reachedId) {
        onReachMessage(reachedId);
      }
    }

    const firstRowKey = rows[0]?.key;
    const shouldPrefetch = shouldLoadOlderHistory({
      activity,
      viewport,
      hasUserInteracted: hasUserInteractedRef.current,
      hasOlder,
      scrollDirection: virtualizer.scrollDirection,
      firstRowKey,
      requestedStartKey: requestedHistoryStartRef.current,
    });
    if (shouldPrefetch) {
      // Record ownership before requesting: scroll and measurement callbacks can share a frame.
      requestedHistoryStartRef.current = firstRowKey;
      loadOlder();
      return;
    }

    const loadNewer = remoteHistory?.loadNewer;
    const lastRowKey = lastRow?.key;
    const shouldPrefetchNewer = shouldLoadHistoryBoundary({
      activity,
      viewport,
      hasUserInteracted: hasUserInteractedRef.current,
      hasMore: hasNewer && !remoteHistory?.isLoading,
      scrollDirection: virtualizer.scrollDirection,
      boundaryKey: lastRowKey,
      requestedKey: requestedHistoryEndRef.current,
      edge: 'end',
    });
    if (loadNewer && shouldPrefetchNewer) {
      requestedHistoryEndRef.current = lastRowKey;
      loadNewer();
    }
  }

  function getReachedMessageId(viewport: HTMLDivElement) {
    const visibleTop = viewport.scrollTop + overlayInsets.top;
    const visibleBottom = viewport.scrollTop + viewport.clientHeight - overlayInsets.bottom;
    const renderedItems = virtualizer.getVirtualItems();
    for (let index = renderedItems.length - 1; index >= 0; index -= 1) {
      const item = renderedItems[index];
      const row = rows[item.index];
      const isIncoming =
        row?.kind === 'message' && !row.message.isService && row.message.authorId !== currentUserId;
      const isVisible =
        item.end + bottomAlignment > visibleTop && item.start + bottomAlignment < visibleBottom;
      if (isIncoming && isVisible) {
        return row.key;
      }
    }

    return undefined;
  }

  async function jumpToLatest() {
    if (pendingLatestRequestRef.current) {
      return;
    }

    const loadLatest = remoteHistory?.jumpToLatest;
    if (hasNewer && !loadLatest) {
      return;
    }

    cancelNavigation();
    virtualizer.cancelScroll();
    setNavigationWindow(undefined);
    latestRequestIdRef.current += 1;
    const request = {
      requestId: latestRequestIdRef.current,
      messageRequestId: navigation?.requestId,
    };
    if (hasNewer && loadLatest) {
      pendingLatestRequestRef.current = request;
      try {
        await loadLatest();
      } catch {
        if (pendingLatestRequestRef.current === request) {
          pendingLatestRequestRef.current = undefined;
          scheduleScrollWork();
        }
        return;
      }

      // A newer navigation or user gesture may take ownership before the window arrives.
      if (pendingLatestRequestRef.current !== request) {
        return;
      }
      pendingLatestRequestRef.current = undefined;
    }

    setLatestNavigation(request);
  }

  useEffect(() => {
    const hasNewRequest = latestRequest !== externalLatestRequestRef.current;
    externalLatestRequestRef.current = latestRequest;
    if (hasNewRequest && latestRequest !== undefined) {
      void jumpToLatest();
    }
  }, [latestRequest]);

  function cancelAutomaticScroll() {
    hasUserInteractedRef.current = true;
    pendingLatestRequestRef.current = undefined;
    cancelNavigation();
    lastNavigationRef.current = navigationKey;
    setNavigationWindow(undefined);
    virtualizer.cancelScroll();
  }

  return {
    viewportRef,
    contentRef,
    animatedRowsRef,
    virtualizer,
    canJumpToLatest: virtualizer.getDistanceFromEnd() > SHOW_JUMP_DISTANCE,
    updateScrollPosition: scheduleScrollWork,
    isNavigating: Boolean(navigationWindow),
    jumpToLatest,
    cancelAutomaticScroll,
  };
}
