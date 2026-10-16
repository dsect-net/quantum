import {
  ScheduleStatus,
  ScheduleExecutionStatus,
  ScheduleType,
} from '../types.js';

export const MIN_SCHEDULE_INTERVAL_SECONDS = 60;
export const MAX_ACTIVE_SCHEDULES_PER_ACCOUNT = 50;

/**
 * Formats recurrence interval into human-friendly plain language.
 */
export function formatInterval(seconds?: number | null, blocks?: number | null): string {
  if (blocks && blocks > 0) {
    return `Every ${blocks} ${blocks === 1 ? 'block' : 'blocks'}`;
  }

  if (!seconds || seconds <= 0) {
    return 'One-off';
  }

  if (seconds === 60) {
    return 'Every 60 seconds (1m)';
  }

  if (seconds < 60) {
    return `Every ${seconds}s`;
  }

  if (seconds < 3600) {
    if (seconds % 60 === 0) {
      const mins = seconds / 60;
      return `Every ${mins} ${mins === 1 ? 'minute' : 'minutes'}`;
    }
    return `Every ${seconds} seconds`;
  }

  if (seconds < 86400) {
    if (seconds % 3600 === 0) {
      const hours = seconds / 3600;
      return `Every ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
    }
    const mins = Math.round(seconds / 60);
    return `Every ${mins} minutes`;
  }

  if (seconds === 86400) {
    return 'Daily (24h)';
  }

  if (seconds === 604800) {
    return 'Weekly (7d)';
  }

  if (seconds % 86400 === 0) {
    const days = seconds / 86400;
    return `Every ${days} ${days === 1 ? 'day' : 'days'}`;
  }

  const hours = Math.round(seconds / 3600);
  return `Every ${hours} hours`;
}

/**
 * Formats schedule status into UI badge configuration.
 */
export function formatScheduleStatus(status: ScheduleStatus): {
  label: string;
  badgeClass: string;
} {
  switch (status) {
    case 'active':
      return {
        label: 'Active',
        badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      };
    case 'completed':
      return {
        label: 'Completed',
        badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
      };
    case 'cancelled':
      return {
        label: 'Cancelled',
        badgeClass: 'bg-neutral-100 text-neutral-600 border-neutral-200',
      };
    case 'failed':
      return {
        label: 'Failed',
        badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
      };
    default:
      return {
        label: status,
        badgeClass: 'bg-neutral-100 text-neutral-600 border-neutral-200',
      };
  }
}

/**
 * Maps schedule occurrence execution status and failure/skip reasons to human-friendly text.
 * Crucial invariant: A skipped recurring occurrence must read as:
 * "skipped — not enough balance; will try again next interval", NOT as an error the user caused.
 */
export function formatExecutionStatus(
  status: ScheduleExecutionStatus,
  reason?: string | null
): {
  label: string;
  explanation: string;
  badgeClass: string;
} {
  switch (status) {
    case 'succeeded':
      return {
        label: 'Succeeded',
        explanation: 'Payment executed successfully on the ledger',
        badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      };
    case 'skipped':
      if (!reason || reason === 'insufficient_funds') {
        return {
          label: 'Skipped',
          explanation: 'skipped — not enough balance; will try again next interval',
          badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
        };
      }
      return {
        label: 'Skipped',
        explanation: `Skipped: ${reason}`,
        badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
      };
    case 'failed':
      if (reason === 'insufficient_funds') {
        return {
          label: 'Failed',
          explanation: 'Failed — insufficient checking balance at execution time',
          badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
        };
      }
      return {
        label: 'Failed',
        explanation: reason ? `Failed: ${reason}` : 'Execution rejected',
        badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
      };
    default:
      return {
        label: status,
        explanation: reason || 'Unknown execution status',
        badgeClass: 'bg-neutral-100 text-neutral-600 border-neutral-200',
      };
  }
}

/**
 * Formats a next due ISO timestamp into a readable date/time string.
 */
export function formatNextDue(isoDate: string): string {
  if (!isoDate) return 'N/A';
  try {
    const date = new Date(isoDate);
    if (isNaN(date.getTime())) return isoDate;
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return isoDate;
  }
}

export interface ScheduleValidationInput {
  from_account: string;
  to_account: string;
  amount_units: number;
  schedule_type: ScheduleType;
  interval_seconds?: number | null;
  active_schedules_count?: number;
  first_due_at?: string | null;
}

export interface ScheduleValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Validates scheduled payment inputs client-side before sending to API.
 */
export function validateScheduleInput(input: ScheduleValidationInput): ScheduleValidationResult {
  const {
    from_account,
    to_account,
    amount_units,
    schedule_type,
    interval_seconds,
    active_schedules_count,
    first_due_at,
  } = input;

  if (!from_account || !from_account.trim()) {
    return { isValid: false, error: 'Source account is required.' };
  }

  if (!to_account || !to_account.trim()) {
    return { isValid: false, error: 'Recipient account is required.' };
  }

  if (from_account.trim() === to_account.trim()) {
    return {
      isValid: false,
      error: 'Self-transfer is forbidden. Source and recipient cannot be the same account.',
    };
  }

  if (amount_units <= 0) {
    return { isValid: false, error: 'Amount must be greater than zero.' };
  }

  if (!Number.isInteger(amount_units)) {
    return {
      isValid: false,
      error: 'Amount must be in exact integer units (no partial cents).',
    };
  }

  // Active schedules count bound (Amendment A4 / Chunk 5: max 50 active)
  if (active_schedules_count !== undefined && active_schedules_count >= MAX_ACTIVE_SCHEDULES_PER_ACCOUNT) {
    return {
      isValid: false,
      error: `Exceeded maximum active scheduled payments (${MAX_ACTIVE_SCHEDULES_PER_ACCOUNT}) for this account.`,
    };
  }

  // Recurring interval check
  if (schedule_type === 'recurring') {
    if (interval_seconds === undefined || interval_seconds === null || interval_seconds <= 0) {
      return {
        isValid: false,
        error: 'Recurring schedule requires a recurrence interval.',
      };
    }
    if (interval_seconds < MIN_SCHEDULE_INTERVAL_SECONDS) {
      return {
        isValid: false,
        error: `Recurrence interval (${interval_seconds}s) is below minimum allowed interval (${MIN_SCHEDULE_INTERVAL_SECONDS}s).`,
      };
    }
  }

  // First due date check if provided
  if (first_due_at) {
    const parsedDate = new Date(first_due_at);
    if (isNaN(parsedDate.getTime())) {
      return { isValid: false, error: 'Invalid start date/time format.' };
    }
  }

  // Savings account restrictions (Amendment A4)
  const isFromSavings = from_account.endsWith(':savings');
  const isToSavings = to_account.endsWith(':savings');

  if (isFromSavings) {
    const ownerId = from_account.replace(/:savings$/, '');
    if (to_account !== ownerId) {
      return {
        isValid: false,
        error: `Savings accounts cannot transfer directly to third parties. Funds must be moved to your checking account (${ownerId}) first.`,
      };
    }
  }

  if (isToSavings) {
    const ownerId = to_account.replace(/:savings$/, '');
    if (from_account !== ownerId) {
      return {
        isValid: false,
        error: `Direct transfers into third-party savings accounts are not permitted. Only the owner (${ownerId}) may fund their savings account.`,
      };
    }
  }

  return { isValid: true };
}
