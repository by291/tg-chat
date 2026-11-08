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

function hasStablePosition(activity: HistoryActivity) {
  return activity.isInitialized && !activity.isResizing && !activity.isNavigating;
}

/** Mark the latest message read only when its rendered bottom is visible in the focused page. */
export function canMarkLatestRead({
  activity,
  viewport,
  isPageVisible,
  hasPageFocus,
}: ReadPolicyOptions) {
  const canRead = hasStablePosition(activity) && isPageVisible && hasPageFocus;
  if (!canRead || !viewport?.clientHeight || !viewport.clientWidth) {
    return false;
  }

  // Reading requires the rendered bottom, not the looser threshold used for following new messages.
  const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
  return distanceFromBottom <= READ_BOTTOM_DISTANCE;
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
  const canPrefetch = hasStablePosition(activity) && hasUserInteracted && hasOlder;
  if (!canPrefetch || !viewport || !firstRowKey || requestedStartKey === firstRowKey) {
    return false;
  }

  // Momentum must keep loading ahead; only layout rebuilding and explicit navigation defer it.
  const prefetchDistance = Math.max(MIN_HISTORY_PREFETCH_DISTANCE, viewport.clientHeight);
  return scrollDirection !== 'forward' && viewport.scrollTop <= prefetchDistance;
}
