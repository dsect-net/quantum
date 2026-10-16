import { describe, it, expect } from 'vitest';
import { validateTransfer } from './validation.js';

describe('Transfer Validation', () => {
  it('validates a correct transfer between checking accounts', () => {
    const res = validateTransfer({
      from_account: 'scotty',
      to_account: 'cooper',
      amount_units: 5000,
      available_units: 10000,
    });
    expect(res.isValid).toBe(true);
    expect(res.error).toBeUndefined();
  });

  it('rejects self transfers', () => {
    const res = validateTransfer({
      from_account: 'cooper',
      to_account: 'cooper',
      amount_units: 1000,
      available_units: 5000,
    });
    expect(res.isValid).toBe(false);
    expect(res.error).toContain('Self-transfer is forbidden');
  });

  it('rejects zero and negative amounts', () => {
    expect(
      validateTransfer({
        from_account: 'scotty',
        to_account: 'cooper',
        amount_units: 0,
        available_units: 5000,
      }).isValid
    ).toBe(false);

    expect(
      validateTransfer({
        from_account: 'scotty',
        to_account: 'cooper',
        amount_units: -500,
        available_units: 5000,
      }).isValid
    ).toBe(false);
  });

  it('rejects fractional units', () => {
    const res = validateTransfer({
      from_account: 'scotty',
      to_account: 'cooper',
      amount_units: 500.5,
      available_units: 5000,
    });
    expect(res.isValid).toBe(false);
    expect(res.error).toContain('integer units');
  });

  it('rejects transfers exceeding available funds', () => {
    const res = validateTransfer({
      from_account: 'scotty',
      to_account: 'cooper',
      amount_units: 15000,
      available_units: 10000,
    });
    expect(res.isValid).toBe(false);
    expect(res.error).toContain('Insufficient available funds');
  });

  it('allows owner to transfer from checking to their own savings account', () => {
    const res = validateTransfer({
      from_account: 'scotty',
      to_account: 'scotty:savings',
      amount_units: 2500,
      available_units: 10000,
    });
    expect(res.isValid).toBe(true);
  });

  it('allows owner to transfer from their savings account to checking account', () => {
    const res = validateTransfer({
      from_account: 'scotty:savings',
      to_account: 'scotty',
      amount_units: 2500,
      available_units: 5000,
    });
    expect(res.isValid).toBe(true);
  });

  it('rejects savings transfer to a third party', () => {
    const res = validateTransfer({
      from_account: 'scotty:savings',
      to_account: 'cooper',
      amount_units: 1000,
      available_units: 5000,
    });
    expect(res.isValid).toBe(false);
    expect(res.error).toContain('Savings accounts cannot transfer directly to third parties');
  });

  it('rejects third party transfer into someone else savings account', () => {
    const res = validateTransfer({
      from_account: 'cooper',
      to_account: 'scotty:savings',
      amount_units: 1000,
      available_units: 5000,
    });
    expect(res.isValid).toBe(false);
    expect(res.error).toContain('Direct transfers into third-party savings accounts are not permitted');
  });
});
