interface HistoryInsetAnimationOptions {
  element: HTMLElement;
  offset: number;
  duration: number;
  previousAnimation?: Animation;
}

/** Move already-positioned rows visually while the virtualizer keeps its final measurements. */
export function animateHistoryInset({
  element,
  offset,
  duration,
  previousAnimation,
}: HistoryInsetAnimationOptions): Animation | undefined {
  let currentOffset = 0;
  if (previousAnimation && previousAnimation.playState === 'running') {
    // Continue from the visible position when another newline interrupts the current transition.
    currentOffset = new DOMMatrixReadOnly(getComputedStyle(element).transform).m42;
  }
  previousAnimation?.cancel();
  if (!duration || typeof element.animate !== 'function') {
    return undefined;
  }

  return element.animate(
    [{ transform: `translateY(${currentOffset + offset}px)` }, { transform: 'translateY(0px)' }],
    { duration, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
  );
}
