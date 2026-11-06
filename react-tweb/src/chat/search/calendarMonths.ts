import { parseDate, type DateValue } from '@ark-ui/react/date-picker';

const DAYS_PER_WEEK = 7;
const CELL_HEIGHT = 40;
const MONTH_HEADING_HEIGHT = 40;
const WEEKDAY_HEADING_HEIGHT = 40;
const WEEK_GAP = 4;
const DAY_LABEL_FORMATTER = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

export const FIRST_CALENDAR_DATE = parseDate('2013-08-01');

export interface CalendarDay {
  date: DateValue;
  label: string;
}

export interface CalendarMonth {
  date: DateValue;
  label: string;
  height: number;
  offset: number;
  weeks: (CalendarDay | null)[][];
}

function createMonthWeeks(options: { date: DateValue; leadingDays: number; daysInMonth: number }) {
  const { date, leadingDays, daysInMonth } = options;
  const weeks: (CalendarDay | null)[][] = [];
  const weekCount = Math.ceil((leadingDays + daysInMonth) / DAYS_PER_WEEK);

  for (let weekIndex = 0; weekIndex < weekCount; weekIndex += 1) {
    const week: (CalendarDay | null)[] = [];
    for (let weekday = 0; weekday < DAYS_PER_WEEK; weekday += 1) {
      const day = weekIndex * DAYS_PER_WEEK + weekday - leadingDays + 1;
      const isInMonth = day > 0 && day <= daysInMonth;
      if (!isInMonth) {
        week.push(null);
        continue;
      }
      week.push({
        date: date.set({ day }),
        label: DAY_LABEL_FORMATTER.format(new Date(date.year, date.month - 1, day)),
      });
    }
    weeks.push(week);
  }

  return weeks;
}

/** Build fixed month measurements so scrolling does not depend on offscreen DOM. */
export function createCalendarMonths(lastDate: DateValue): CalendarMonth[] {
  const months: CalendarMonth[] = [];
  let date = FIRST_CALENDAR_DATE;
  let offset = 0;

  while (date.compare(lastDate) <= 0) {
    const firstDay = new Date(date.year, date.month - 1, 1);
    const daysInMonth = new Date(date.year, date.month, 0).getDate();
    const leadingDays = (firstDay.getDay() + DAYS_PER_WEEK - 1) % DAYS_PER_WEEK;
    const weeks = Math.ceil((leadingDays + daysInMonth) / DAYS_PER_WEEK);
    // Match the CSS grid: gaps occur between weeks, never above the first week.
    const height =
      MONTH_HEADING_HEIGHT + WEEKDAY_HEADING_HEIGHT + weeks * CELL_HEIGHT + (weeks - 1) * WEEK_GAP;
    months.push({
      date,
      label: firstDay.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      height,
      offset,
      weeks: createMonthWeeks({ date, leadingDays, daysInMonth }),
    });
    offset += height;
    date = date.add({ months: 1 });
  }

  return months;
}

/** Resolve a visible month using the viewport center, including a clamped final month. */
export function findVisibleCalendarMonth(options: {
  months: CalendarMonth[];
  scrollTop: number;
  viewportHeight: number;
}) {
  const { months, scrollTop, viewportHeight } = options;
  const center = scrollTop + viewportHeight / 2;
  const index = months.findIndex((month) => month.offset + month.height > center);
  return index < 0 ? months.length - 1 : index;
}
