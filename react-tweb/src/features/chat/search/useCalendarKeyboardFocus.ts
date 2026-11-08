import type { UseDatePickerReturn } from '@ark-ui/react/date-picker';
import type { Virtualizer } from '@tanstack/react-virtual';
import { useLayoutEffect, useRef, type KeyboardEvent, type RefObject } from 'react';
import type { CalendarMonth } from './calendarMonths';

const NAVIGATION_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
]);
const DAY_SELECTOR = '[data-part="table-cell-trigger"]';

interface CalendarKeyboardFocusOptions {
  calendar: UseDatePickerReturn;
  months: CalendarMonth[];
  viewportRef: RefObject<HTMLDivElement | null>;
  virtualizer: Virtualizer<HTMLDivElement, Element>;
}

/** Complete Ark keyboard focus after the destination month enters the virtual window. */
export function useCalendarKeyboardFocus({
  calendar,
  months,
  viewportRef,
  virtualizer,
}: CalendarKeyboardFocusOptions) {
  const navigationOriginRef = useRef<string | null>(null);

  // A virtual scroll can commit after the date change, so retry on each committed window.
  useLayoutEffect(() => {
    const origin = navigationOriginRef.current;
    const viewport = viewportRef.current;
    const focusedDate = calendar.focusedValue;
    const focusedKey = focusedDate.toString();
    if (!origin || !viewport || origin === focusedKey) {
      return;
    }

    const target = viewport.querySelector<HTMLButtonElement>(
      `${DAY_SELECTOR}[data-value="${focusedKey}"]`,
    );
    if (!target) {
      const monthIndex = months.findIndex((month) => {
        return month.date.year === focusedDate.year && month.date.month === focusedDate.month;
      });
      if (monthIndex >= 0) {
        virtualizer.scrollToIndex(monthIndex, { align: 'start' });
      }
      return;
    }

    const viewportBounds = viewport.getBoundingClientRect();
    const targetBounds = target.getBoundingClientRect();
    const viewportBottom = viewportBounds.top + viewport.clientHeight;
    if (targetBounds.top < viewportBounds.top) {
      virtualizer.scrollToOffset(viewport.scrollTop + targetBounds.top - viewportBounds.top);
    } else if (targetBounds.bottom > viewportBottom) {
      virtualizer.scrollToOffset(viewport.scrollTop + targetBounds.bottom - viewportBottom);
    }

    navigationOriginRef.current = null;
    target.focus({ preventScroll: true });
  });

  function requestKeyboardFocus(event: KeyboardEvent<HTMLDivElement>) {
    const isDateCell = event.target instanceof HTMLElement && event.target.matches(DAY_SELECTOR);
    const isNavigation = NAVIGATION_KEYS.has(event.key);
    if (isDateCell && isNavigation && !event.defaultPrevented && !event.nativeEvent.isComposing) {
      navigationOriginRef.current = calendar.focusedValue.toString();
    }
  }

  function cancelKeyboardFocus() {
    // Pointer browsing must not return to the last keyboard date after a virtual mount.
    navigationOriginRef.current = null;
  }

  return { requestKeyboardFocus, cancelKeyboardFocus };
}
