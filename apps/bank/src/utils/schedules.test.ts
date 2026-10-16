import { describe, it, expect } from 'vitest';
import {
  formatInterval,
  formatScheduleStatus,
  formatExecutionStatus,
  formatNextDue,
  validateScheduleInput,
  MIN_SCHEDULE_INTERVAL_SECONDS,
  MAX_ACTIVE_SCHEDULES_PER_ACCOUNT,
} from './schedules.js';

describe('schedules utils & validation', () => {
  describe('constants', () => {
    it('defines standard protocol bounds', () => {
      expect(MIN_SCHEDULE_INTERVAL_SECONDS).toBe(60);
      expect(MAX_ACTIVE_SCHEDULES_PER_ACCOUNT).toBe(50);
    });
  });

  describe('formatInterval', () => {
    it('formats one-off schedules when interval is missing or 0', () => {
      expect(formatInterval(null)).toBe('One-off');
      expect(formatInterval(undefined)).toBe('One-off');
      expect(formatInterval(0)).toBe('One-off');
      expect(formatInterval(-10)).toBe('One-off');
    });

    it('formats seconds into plain language intervals', () => {
      expect(formatInterval(60)).toBe('Every 60 seconds (1m)');
      expect(formatInterval(30)).toBe('Every 30s');
      expect(formatInterval(300)).toBe('Every 5 minutes');
      expect(formatInterval(900)).toBe('Every 15 minutes');
      expect(formatInterval(3600)).toBe('Every 1 hour');
      expect(formatInterval(7200)).toBe('Every 2 hours');
      expect(formatInterval(86400)).toBe('Daily (24h)');
      expect(formatInterval(604800)).toBe('Weekly (7d)');
      expect(formatInterval(172800)).toBe('Every 2 days');
    });

    it('formats block-based intervals when blocks provided', () => {
      expect(formatInterval(null, 100)).toBe('Every 100 blocks');
      expect(formatInterval(null, 1)).toBe('Every 1 block');
    });
  });

  describe('formatScheduleStatus', () => {
    it('returns appropriate labels and styles for each status', () => {
      expect(formatScheduleStatus('active').label).toBe('Active');
      expect(formatScheduleStatus('active').badgeClass).toContain('emerald');

      expect(formatScheduleStatus('completed').label).toBe('Completed');
      expect(formatScheduleStatus('completed').badgeClass).toContain('blue');

      expect(formatScheduleStatus('cancelled').label).toBe('Cancelled');
      expect(formatScheduleStatus('cancelled').badgeClass).toContain('neutral');

      expect(formatScheduleStatus('failed').label).toBe('Failed');
      expect(formatScheduleStatus('failed').badgeClass).toContain('rose');
    });
  });

  describe('formatExecutionStatus', () => {
    it('formats succeeded status with helpful explanation', () => {
      const res = formatExecutionStatus('succeeded');
      expect(res.label).toBe('Succeeded');
      expect(res.explanation).toContain('Payment executed successfully');
      expect(res.badgeClass).toContain('emerald');
    });

    it('formats skipped occurrences with honest non-blaming plain language explanation', () => {
      // Must read as: "skipped — not enough balance; will try again next interval", NOT as user error
      const res = formatExecutionStatus('skipped', 'insufficient_funds');
      expect(res.label).toBe('Skipped');
      expect(res.explanation).toBe('skipped — not enough balance; will try again next interval');
      expect(res.badgeClass).toContain('amber');

      const resDefault = formatExecutionStatus('skipped');
      expect(resDefault.explanation).toBe('skipped — not enough balance; will try again next interval');
    });

    it('formats failed occurrences with plain language explanation', () => {
      const res = formatExecutionStatus('failed', 'insufficient_funds');
      expect(res.label).toBe('Failed');
      expect(res.explanation).toBe('Failed — insufficient checking balance at execution time');
      expect(res.badgeClass).toContain('rose');
    });
  });

  describe('formatNextDue', () => {
    it('formats valid ISO date into readable timestamp', () => {
      const formatted = formatNextDue('2026-10-16T12:00:00Z');
      expect(formatted).not.toBe('N/A');
      expect(formatted).toContain('2026');
    });

    it('handles empty input gracefully', () => {
      expect(formatNextDue('')).toBe('N/A');
    });
  });

  describe('validateScheduleInput', () => {
    const validOneOff = {
      from_account: 'cooper',
      to_account: 'scotty',
      amount_units: 5000,
      schedule_type: 'one_off' as const,
    };

    const validRecurring = {
      from_account: 'cooper',
      to_account: 'scotty',
      amount_units: 5000,
      schedule_type: 'recurring' as const,
      interval_seconds: 60,
    };

    it('passes valid one-off schedule', () => {
      const res = validateScheduleInput(validOneOff);
      expect(res.isValid).toBe(true);
      expect(res.error).toBeUndefined();
    });

    it('passes valid recurring schedule meeting minimum interval (60s)', () => {
      const res = validateScheduleInput(validRecurring);
      expect(res.isValid).toBe(true);
    });

    it('rejects self-transfers', () => {
      const res = validateScheduleInput({
        ...validOneOff,
        to_account: 'cooper',
      });
      expect(res.isValid).toBe(false);
      expect(res.error).toContain('Self-transfer is forbidden');
    });

    it('rejects non-positive and non-integer amounts', () => {
      expect(
        validateScheduleInput({ ...validOneOff, amount_units: 0 }).isValid
      ).toBe(false);
      expect(
        validateScheduleInput({ ...validOneOff, amount_units: -100 }).isValid
      ).toBe(false);
      expect(
        validateScheduleInput({ ...validOneOff, amount_units: 12.5 }).isValid
      ).toBe(false);
    });

    it('enforces minimum interval of 60 seconds on recurring schedules', () => {
      const res = validateScheduleInput({
        ...validRecurring,
        interval_seconds: 59,
      });
      expect(res.isValid).toBe(false);
      expect(res.error).toContain('minimum allowed interval (60s)');
    });

    it('enforces maximum 50 active schedules per account bound', () => {
      const res = validateScheduleInput({
        ...validOneOff,
        active_schedules_count: 50,
      });
      expect(res.isValid).toBe(false);
      expect(res.error).toContain('Exceeded maximum active scheduled payments (50)');
    });

    it('enforces savings account restrictions', () => {
      // From savings to non-owner
      const res1 = validateScheduleInput({
        from_account: 'cooper:savings',
        to_account: 'scotty',
        amount_units: 1000,
        schedule_type: 'one_off',
      });
      expect(res1.isValid).toBe(false);
      expect(res1.error).toContain('Savings accounts cannot transfer directly to third parties');

      // To savings from non-owner
      const res2 = validateScheduleInput({
        from_account: 'scotty',
        to_account: 'cooper:savings',
        amount_units: 1000,
        schedule_type: 'one_off',
      });
      expect(res2.isValid).toBe(false);
      expect(res2.error).toContain('Direct transfers into third-party savings accounts are not permitted');

      // Valid: From savings to own checking
      const res3 = validateScheduleInput({
        from_account: 'cooper:savings',
        to_account: 'cooper',
        amount_units: 1000,
        schedule_type: 'one_off',
      });
      expect(res3.isValid).toBe(true);
    });
  });
});
