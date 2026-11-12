const READ_BOTTOM_DISTANCE = 1;
const MIN_HISTORY_PREFETCH_DISTANCE = 360;

interface HistoryActivity {
  isInitialized: boolean;
  isResizing: boolean;
  isNavigating: boolean;
}

interface HistoryViewport {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  clientWidth: number;
}

interface ReadPolicyOptions {
  activity: HistoryActivity;
  viewport?: HistoryViewport | null;
  isPageVisible: boolean;
  hasPageFocus: boolean;
}

interface PrefetchPolicyOptions {
  activity: HistoryActivity;
  viewport?: HistoryViewport | null;
  hasUserInteracted: boolean;
  hasOlder: boolean;
  scrollDirection: 'forward' | 'backward' | null;
  firstRowKey?: string;
  requestedStartKey?: string;
}

interface HistoryBoundaryOptions {
  activity: HistoryActivity;
  viewport?: HistoryViewport | null;
  hasUserInteracted: boolean;
  hasMore: boolean;
  boundaryKey?: string;
  requestedKey?: string;
  scrollDirection: 'forward' | 'backward' | null;
  edge: 'start' | 'end';
}

function hasStablePosition(activity: HistoryActivity) {
  return activity.isInitialized && !activity.isResizing && !activity.isNavigating;
}

/** Admit read updates only when a foreground viewport has settled. */
export function canReadVisibleHistory({
  activity,
  viewport,
  isPageVisible,
  hasPageFocus,
}: ReadPolicyOptions) {
  const canRead = hasStablePosition(activity) && isPageVisible && hasPageFocus;
  return canRead && Boolean(viewport?.clientHeight && viewport.clientWidth);
}

/** Mark the latest message read only when its rendered bottom is visible in the focused page. */
export function canMarkLatestRead(options: ReadPolicyOptions) {
  const { viewport } = options;
  if (!viewport || !canReadVisibleHistory(options)) {
    return false;
  }

  // Reading requires the rendered bottom, not the looser threshold used for following new messages.
  const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;

  return distanceFromBottom <= READ_BOTTOM_DISTANCE;
}

/** Prefetch each boundary once while the user is approaching it. */
export function shouldLoadHistoryBoundary({
  activity,
  viewport,
  hasUserInteracted,
  hasMore,
  boundaryKey,
  requestedKey,
  scrollDirection,
  edge,
}: HistoryBoundaryOptions) {
  const canPrefetch = hasStablePosition(activity) && hasUserInteracted && hasMore;
  if (!canPrefetch || !viewport || !boundaryKey || requestedKey === boundaryKey) {
    return false;
  }

  // Momentum must keep loading ahead; only layout rebuilding and explicit navigation defer it.
  const prefetchDistance = Math.max(MIN_HISTORY_PREFETCH_DISTANCE, viewport.clientHeight);
  if (edge === 'start') {
    return scrollDirection !== 'forward' && viewport.scrollTop <= prefetchDistance;
  }

  const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
  return scrollDirection !== 'backward' && distanceFromBottom <= prefetchDistance;
}

/** Prefetch each older-history boundary once as user scrolling approaches it. */
export function shouldLoadOlderHistory({
  activity,
  viewport,
  hasUserInteracted,
  hasOlder,
  scrollDirection,
  firstRowKey,
  requestedStartKey,
}: PrefetchPolicyOptions) {
  return shouldLoadHistoryBoundary({
    activity,
    viewport,
    hasUserInteracted,
    hasMore: hasOlder,
    boundaryKey: firstRowKey,
    requestedKey: requestedStartKey,
    scrollDirection,
    edge: 'start',
  });
}
