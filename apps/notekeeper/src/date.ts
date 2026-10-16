/**
 * Date utilities for Quantum Notekeeper.
 * Ensures date-only due_at (YYYY-MM-DD) is treated as a local calendar date
 * without timezone drift into previous days, displaying date-only with no time.
 */

export function isDateOnly(dateStr: string): boolean {
  const trimmed = dateStr.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) || /^\d{4}-\d{2}-\d{2}T00:00:00(?:\.000)?Z?$/.test(trimmed);
}

export interface FormattedDue {
  formatted: string;
  isPast: boolean;
  isToday: boolean;
}

/**
 * Format due date for display on list items, cards, and detail views.
 * Date-only strings display as e.g. "Due: Oct 15" with no time.
 * DateTime strings display as e.g. "Due: Oct 15, 2:30 PM".
 */
export function formatDue(dueAt?: string | null): FormattedDue | null {
  if (!dueAt || typeof dueAt !== 'string' || !dueAt.trim()) {
    return null;
  }

  const trimmed = dueAt.trim();
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endOfToday = startOfToday + 24 * 60 * 60 * 1000;

  if (isDateOnly(trimmed)) {
    const [year, month, day] = trimmed.slice(0, 10).split('-').map(Number);
    const localDate = new Date(year, month - 1, day);
    const itemTime = localDate.getTime();

    const formatted = localDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });

    return {
      formatted,
      isPast: itemTime < startOfToday,
      isToday: itemTime >= startOfToday && itemTime < endOfToday,
    };
  }

  // Date with time (ISO or datetime string)
  const dateObj = new Date(trimmed);
  if (isNaN(dateObj.getTime())) {
    return null;
  }

  const itemTime = dateObj.getTime();
  const formatted = dateObj.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  return {
    formatted,
    isPast: itemTime < Date.now(),
    isToday: itemTime >= startOfToday && itemTime < endOfToday,
  };
}

export type DueBucket = 'overdue' | 'today' | 'this_week' | 'later';

/**
 * Classify an item's due date into one of the 4 Due View sections:
 * - 'overdue': calendar day before today
 * - 'today': today's calendar day
 * - 'this_week': within the next 7 calendar days
 * - 'later': beyond 7 calendar days
 */
export function classifyDueBucket(dueAt?: string | null): DueBucket | null {
  if (!dueAt || typeof dueAt !== 'string' || !dueAt.trim()) {
    return null;
  }

  const trimmed = dueAt.trim();
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endOfToday = startOfToday + 24 * 60 * 60 * 1000;
  const endOfWeek = startOfToday + 7 * 24 * 60 * 60 * 1000;

  let itemTime: number;

  if (isDateOnly(trimmed)) {
    const [year, month, day] = trimmed.slice(0, 10).split('-').map(Number);
    itemTime = new Date(year, month - 1, day).getTime();
  } else {
    const dateObj = new Date(trimmed);
    if (isNaN(dateObj.getTime())) return null;
    itemTime = dateObj.getTime();
  }

  if (itemTime < startOfToday) {
    return 'overdue';
  }
  if (itemTime < endOfToday) {
    return 'today';
  }
  if (itemTime < endOfWeek) {
    return 'this_week';
  }
  return 'later';
}

/**
 * Return YYYY-MM-DD for a given local date (defaults to now).
 */
export function getLocalDateString(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Return today's local date string YYYY-MM-DD.
 */
export function getTodayString(): string {
  return getLocalDateString(new Date());
}

/**
 * Return tomorrow's local date string YYYY-MM-DD.
 */
export function getTomorrowString(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return getLocalDateString(d);
}

/**
 * Return next week's local date string YYYY-MM-DD (7 days from now).
 */
export function getNextWeekString(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return getLocalDateString(d);
}

/**
 * Format an incoming due_at string into a YYYY-MM-DD string suitable for <input type="date">.
 */
export function toDateInputValue(dueAt?: string | null): string {
  if (!dueAt || typeof dueAt !== 'string') return '';
  const trimmed = dueAt.trim();
  if (isDateOnly(trimmed)) {
    return trimmed.slice(0, 10);
  }
  const dateObj = new Date(trimmed);
  if (isNaN(dateObj.getTime())) return '';
  return getLocalDateString(dateObj);
}
