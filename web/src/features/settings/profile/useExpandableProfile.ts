import { useEffect, useRef, useState } from 'react';
import { createProfileWheelGesture } from './profileWheelGesture';

const TOUCH_THRESHOLD = 8;

/** Give the profile its boundary gestures while leaving ordinary list scrolling native. */
export function useExpandableProfile({ isEnabled }: { isEnabled: boolean }) {
  const pageRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [hasScrolled, setHasScrolled] = useState(false);
  const expandedRef = useRef(false);

  function expandPhoto() {
    if (!isEnabled || !scrollRef.current) {
      return;
    }
    if (scrollRef.current.scrollTop > 0) {
      const shouldReduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      scrollRef.current.scrollTo({
        top: 0,
        behavior: shouldReduceMotion ? 'instant' : 'smooth',
      });
      return;
    }

    expandedRef.current = true;
    setIsExpanded(true);
  }

  useEffect(() => {
    const page = pageRef.current;
    const scroll = scrollRef.current;
    if (!page || !scroll) {
      return;
    }

    const viewport = scroll;
    expandedRef.current = false;
    setIsExpanded(false);
    const isMomentum = createProfileWheelGesture();
    let touchStart: { left: number; top: number } | undefined;

    function changeExpansion({ shouldExpand }: { shouldExpand: boolean }) {
      if (expandedRef.current === shouldExpand) {
        return false;
      }

      // Multiple wheel events can arrive before React commits the visible expansion state.
      expandedRef.current = shouldExpand;
      setIsExpanded(shouldExpand);

      return true;
    }

    function moveProfile(delta: number, event: Event) {
      if (!isEnabled || delta === 0) {
        return;
      }
      if (viewport.scrollTop > 0) {
        changeExpansion({ shouldExpand: false });
        return;
      }
      if (changeExpansion({ shouldExpand: delta < 0 })) {
        event.preventDefault();
      }
    }

    function onWheel(event: WheelEvent) {
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        return;
      }
      if (isMomentum({ delta: event.deltaY, time: performance.now() })) {
        return;
      }

      moveProfile(event.deltaY, event);
    }

    function onTouchStart(event: TouchEvent) {
      if (event.touches.length !== 1) {
        touchStart = undefined;
        return;
      }

      const touch = event.touches[0];
      touchStart = { left: touch.clientX, top: touch.clientY };
    }

    function onTouchMove(event: TouchEvent) {
      if (!touchStart || event.touches.length !== 1) {
        return;
      }

      const touch = event.touches[0];
      const horizontal = touch.clientX - touchStart.left;
      const vertical = touchStart.top - touch.clientY;
      if (Math.max(Math.abs(horizontal), Math.abs(vertical)) < TOUCH_THRESHOLD) {
        return;
      }

      touchStart = undefined;
      if (Math.abs(vertical) > Math.abs(horizontal)) {
        moveProfile(vertical, event);
      }
    }

    function onTouchEnd() {
      touchStart = undefined;
    }

    function onScroll() {
      const isAwayFromTop = viewport.scrollTop > 0;
      setHasScrolled(isAwayFromTop);
      if (isAwayFromTop) {
        changeExpansion({ shouldExpand: false });
      }
    }

    page.addEventListener('wheel', onWheel, { passive: false });
    page.addEventListener('touchstart', onTouchStart, { passive: true });
    page.addEventListener('touchmove', onTouchMove, { passive: false });
    page.addEventListener('touchend', onTouchEnd);
    page.addEventListener('touchcancel', onTouchEnd);
    scroll.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      page.removeEventListener('wheel', onWheel);
      page.removeEventListener('touchstart', onTouchStart);
      page.removeEventListener('touchmove', onTouchMove);
      page.removeEventListener('touchend', onTouchEnd);
      page.removeEventListener('touchcancel', onTouchEnd);
      scroll.removeEventListener('scroll', onScroll);
    };
  }, [isEnabled]);

  return {
    pageRef,
    scrollRef,
    isExpanded: isEnabled && isExpanded,
    hasScrolled,
    expandPhoto,
  };
}
