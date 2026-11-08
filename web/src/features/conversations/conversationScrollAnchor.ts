interface ConversationViewport {
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
}

interface ConversationScrollAnchorOptions extends ConversationViewport {
  previousKeys: string[];
  currentKeys: string[];
}

interface VisibleConversationRowsOptions extends ConversationViewport {
  keys: string[];
}

function collectVisibleKeys({
  keys,
  scrollTop,
  viewportHeight,
  rowHeight,
}: VisibleConversationRowsOptions) {
  const visibleKeys: string[] = [];
  for (const [index, key] of keys.entries()) {
    const top = index * rowHeight;
    const bottom = top + rowHeight;
    if (bottom >= scrollTop && top <= scrollTop + viewportHeight) {
      visibleKeys.push(key);
    }
  }

  return visibleKeys;
}

/** Preserve the viewport only when every previously or currently visible row moves equally. */
export function getConversationScrollAdjustment({
  previousKeys,
  currentKeys,
  scrollTop,
  viewportHeight,
  rowHeight,
}: ConversationScrollAnchorOptions): number | undefined {
  const hasSameOrder =
    previousKeys.length === currentKeys.length &&
    currentKeys.every((key, index) => key === previousKeys[index]);
  if (hasSameOrder || previousKeys.length === 0 || viewportHeight === 0) {
    return;
  }

  const viewport = {
    scrollTop,
    viewportHeight,
    rowHeight,
  };
  const previousVisible = collectVisibleKeys({ ...viewport, keys: previousKeys });
  const currentVisible = collectVisibleKeys({ ...viewport, keys: currentKeys });
  const visibleKeys = new Set([...previousVisible, ...currentVisible]);
  const previousPositions = new Map(previousKeys.map((key, index) => [key, index * rowHeight]));
  const currentPositions = new Map(currentKeys.map((key, index) => [key, index * rowHeight]));
  let adjustment: number | undefined;

  for (const key of visibleKeys) {
    const previousTop = previousPositions.get(key);
    const currentTop = currentPositions.get(key);
    if (previousTop === undefined || currentTop === undefined) {
      return;
    }

    const rowAdjustment = currentTop - previousTop;
    // A shared shift preserves reading position; differing shifts need individual row animation.
    if (adjustment !== undefined && adjustment !== rowAdjustment) {
      return;
    }

    adjustment = rowAdjustment;
  }

  return adjustment;
}
