import {
  useDatePicker,
  parseDate,
  type DateValue,
  type UseDatePickerReturn,
} from '@ark-ui/react/date-picker';
import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { IconButton } from '../../components/IconButton';
import overlays from '../overlays.module.css';
import dialogs from '../sidebar/ConversationDialogs.module.css';
import {
  FIRST_CALENDAR_DATE,
  createCalendarMonths,
  findVisibleCalendarMonth,
  type CalendarMonth,
} from './calendarMonths';
import styles from './SearchDateDialog.module.css';

const MONTH_OVERSCAN = 1;
// prettier-ignore
const WEEKDAY_LABELS = [
  'M',
  'T',
  'W',
  'T',
  'F',
  'S',
  'S',
];

interface SearchDateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (timestamp: number) => void;
}

interface CalendarContentProps {
  value: DateValue[];
  onValueChange: (value: DateValue[]) => void;
  onClose: () => void;
  onConfirm: () => void;
}

interface CalendarMonthProps {
  month: CalendarMonth;
  viewportRef: RefObject<HTMLDivElement | null>;
  calendar: UseDatePickerReturn;
  tableProps: ReturnType<UseDatePickerReturn['getTableProps']>;
  maximumDate: DateValue;
}

interface CalendarScrollerProps {
  calendar: UseDatePickerReturn;
  tableProps: ReturnType<UseDatePickerReturn['getTableProps']>;
  maximumDate: DateValue;
  months: CalendarMonth[];
  onClose: () => void;
  onConfirm: () => void;
}

function getToday() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return parseDate(`${year}-${month}-${day}`);
}

function MonthHeading({
  label,
  viewportRef,
}: {
  label: string;
  viewportRef: RefObject<HTMLDivElement | null>;
}) {
  const headingRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const heading = headingRef.current;
    const viewport = viewportRef.current;
    if (!heading || !viewport) {
      return;
    }
    // Observe only the full-row boundary; scrolling must not rerender the date grid.
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.intersectionRatio === 1);
      },
      { root: viewport, threshold: 1 },
    );
    observer.observe(heading);
    return () => observer.disconnect();
  }, [viewportRef]);

  return (
    <div ref={headingRef} className={styles.month} data-visible={isVisible}>
      {label}
    </div>
  );
}

// Month geometry and callbacks stay stable while the virtual window moves past them.
const MonthGrid = memo(function MonthGrid({
  month,
  viewportRef,
  calendar,
  maximumDate,
  tableProps,
}: CalendarMonthProps) {
  const selectedDate = calendar.value[0]?.toString();
  const focusedDate = calendar.focusedValue.toString();

  return (
    <div
      className={styles.monthSection}
      style={{ height: month.height, transform: `translateY(${month.offset}px)` }}
    >
      <MonthHeading label={month.label} viewportRef={viewportRef} />
      <table
        {...tableProps}
        id={`${tableProps.id}-${month.date.toString()}`}
        aria-label={month.label}
        className={styles.table}
      >
        <thead>
          <tr>
            {WEEKDAY_LABELS.map((label, index) => (
              <th key={index} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {month.weeks.map((week, weekIndex) => (
            <tr key={weekIndex}>
              {week.map((day, weekday) => {
                if (!day) {
                  return <td key={weekday} aria-hidden="true" />;
                }

                const dateKey = day.date.toString();
                const isSelected = selectedDate === dateKey;
                const isFocused = focusedDate === dateKey;
                const isDisabled = day.date.compare(maximumDate) > 0;

                // This single-date grid needs no per-cell range or timezone calculations.
                // Ark still owns selection and the table's keyboard navigation.
                return (
                  <td key={dateKey} role="gridcell" aria-selected={isSelected}>
                    <button
                      type="button"
                      className={styles.day}
                      aria-label={day.label}
                      disabled={isDisabled}
                      tabIndex={isFocused ? 0 : -1}
                      data-part="table-cell-trigger"
                      data-view="day"
                      data-focus={isFocused ? '' : undefined}
                      data-selected={isSelected ? '' : undefined}
                      data-disabled={isDisabled ? '' : undefined}
                      onFocus={() => calendar.setFocusedValue(day.date)}
                      onClick={() => calendar.setValue([day.date])}
                    >
                      <span>{day.date.day}</span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

function CalendarContent({ value, onValueChange, onClose, onConfirm }: CalendarContentProps) {
  const [maximumDate] = useState(getToday);
  const months = useMemo(() => createCalendarMonths(maximumDate), [maximumDate]);

  // Share one state machine across months; virtual mounts should only create their DOM.
  const calendar = useDatePicker({
    inline: true,
    value,
    min: FIRST_CALENDAR_DATE,
    max: maximumDate,
    startOfWeek: 1,
    onValueChange: (details) => onValueChange(details.value),
  });

  return (
    <div {...calendar.getRootProps()} className={styles.picker}>
      <CalendarScroller
        calendar={calendar}
        tableProps={calendar.getTableProps()}
        months={months}
        maximumDate={maximumDate}
        onClose={onClose}
        onConfirm={onConfirm}
      />
    </div>
  );
}

function CalendarScroller({
  calendar,
  months,
  maximumDate,
  onClose,
  onConfirm,
  tableProps,
}: CalendarScrollerProps) {
  const [initialMonthIndex] = useState(() => {
    const selected = calendar.value[0] ?? calendar.focusedValue;
    return months.findIndex((month) => {
      return month.date.year === selected.year && month.date.month === selected.month;
    });
  });
  const [visibleMonthIndex, setVisibleMonthIndex] = useState(initialMonthIndex);
  const viewportRef = useRef<HTMLDivElement>(null);
  const shouldReduceMotion = useReducedMotion();
  const virtualizer = useVirtualizer({
    count: months.length,
    getScrollElement: () => viewportRef.current,
    getItemKey: (index) => months[index].date.toString(),
    estimateSize: (index) => months[index].height,
    initialOffset: months[initialMonthIndex].offset,
    overscan: MONTH_OVERSCAN,
    // One buffered month gives React room to batch updates instead of blocking scroll events.
    useFlushSync: false,
  });

  useLayoutEffect(() => {
    // Restore before paint; smooth scrolling here would visibly traverse years on open.
    virtualizer.scrollToOffset(months[initialMonthIndex].offset);
  }, [virtualizer, months, initialMonthIndex]);

  function updateVisibleMonth() {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    setVisibleMonthIndex(
      findVisibleCalendarMonth({
        months,
        scrollTop: viewport.scrollTop,
        viewportHeight: viewport.clientHeight,
      }),
    );
  }

  function scrollToMonth(index: number) {
    const month = months[index];
    if (!month) {
      return;
    }
    virtualizer.scrollToOffset(month.offset, {
      behavior: shouldReduceMotion ? 'auto' : 'smooth',
    });
  }

  return (
    <>
      <header className={styles.header}>
        <IconButton label="Close date picker" onClick={onClose}>
          <X />
        </IconButton>
        <Dialog.Title>{months[visibleMonthIndex].label}</Dialog.Title>
        <IconButton
          label="Previous month"
          disabled={visibleMonthIndex === 0}
          onClick={() => scrollToMonth(visibleMonthIndex - 1)}
        >
          <ChevronUp />
        </IconButton>
        <IconButton
          label="Next month"
          disabled={visibleMonthIndex === months.length - 1}
          onClick={() => scrollToMonth(visibleMonthIndex + 1)}
        >
          <ChevronDown />
        </IconButton>
      </header>
      <Dialog.Description className={styles.description}>
        Scroll through months, select a day, then jump to its messages.
      </Dialog.Description>
      <div
        {...calendar.getContentProps()}
        ref={viewportRef}
        className={styles.calendar}
        onScroll={updateVisibleMonth}
        aria-label="Calendar months"
        tabIndex={0}
      >
        <div className={styles.months} style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => (
            <MonthGrid
              key={item.key}
              month={months[item.index]}
              viewportRef={viewportRef}
              calendar={calendar}
              tableProps={tableProps}
              maximumDate={maximumDate}
            />
          ))}
        </div>
      </div>
      <footer className={styles.footer}>
        <button onClick={onConfirm}>Jump to Date</button>
      </footer>
    </>
  );
}

/** Keep the header and confirmation fixed while a bounded viewport scrolls through months. */
export function SearchDateDialog({ isOpen, onClose, onSelect }: SearchDateDialogProps) {
  const [value, setValue] = useState<DateValue[]>(() => [getToday()]);

  function jumpToDate() {
    const selected = value[0];
    if (!selected) {
      return;
    }
    onSelect(new Date(selected.year, selected.month - 1, selected.day).getTime());
    onClose();
  }

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(details) => {
        if (!details.open) {
          onClose();
        }
      }}
      lazyMount
      unmountOnExit
    >
      <Portal>
        <Dialog.Backdrop className={dialogs.backdrop} />
        <Dialog.Positioner className={overlays.dialogPositioner}>
          <Dialog.Content className={`${styles.dialog} ${dialogs.confirmation}`}>
            <CalendarContent
              value={value}
              onValueChange={setValue}
              onClose={onClose}
              onConfirm={jumpToDate}
            />
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
