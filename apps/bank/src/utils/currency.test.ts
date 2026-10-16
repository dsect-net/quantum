import { describe, it, expect } from 'vitest';
import {
  unitsToCredits,
  creditsToUnits,
  formatCredits,
  formatBankAccountId,
  formatBps,
} from './currency.js';

describe('Currency Utilities (1 credit = 100 units)', () => {
  it('converts units to credits standard decimal string', () => {
    expect(unitsToCredits(0)).toBe('0.00');
    expect(unitsToCredits(1)).toBe('0.01');
    expect(unitsToCredits(100)).toBe('1.00');
    expect(unitsToCredits(1050)).toBe('10.50');
    expect(unitsToCredits(100000)).toBe('1,000.00');
    expect(unitsToCredits(-50)).toBe('-0.50');
  });

  it('formats credits with units and sign options', () => {
    expect(formatCredits(25000)).toBe('250.00 QC');
    expect(formatCredits(25000, { unitLabel: 'credits' })).toBe('250.00 credits');
    expect(formatCredits(25000, { showSign: true })).toBe('+250.00 QC');
    expect(formatCredits(-500, { showSign: true })).toBe('-5.00 QC');
    expect(formatCredits(100, { showUnit: false })).toBe('1.00');
  });

  it('safely parses human input to exact integer units without float errors', () => {
    expect(creditsToUnits('0')).toBe(0);
    expect(creditsToUnits('10')).toBe(1000);
    expect(creditsToUnits('10.5')).toBe(1050);
    expect(creditsToUnits('10.50')).toBe(1050);
    expect(creditsToUnits('0.01')).toBe(1);
    expect(creditsToUnits('1,250.75')).toBe(125075);
    expect(creditsToUnits('-50.25')).toBe(-5025);
    expect(creditsToUnits(25.5)).toBe(2550);
    expect(creditsToUnits('invalid')).toBe(0);
  });

  it('formats bank-style account IDs cleanly', () => {
    expect(formatBankAccountId('scotty')).toBe('QB-CHK-SCOTTY');
    expect(formatBankAccountId('scotty:savings')).toBe('QB-SAV-SCOTTY');
    expect(formatBankAccountId('cooper', 'checking')).toBe('QB-CHK-COOPER');
    expect(formatBankAccountId('cooper', 'savings')).toBe('QB-SAV-COOPER');
  });

  it('formats basis points to percentage', () => {
    expect(formatBps(250)).toBe('2.50%');
    expect(formatBps(50)).toBe('0.50%');
    expect(formatBps(0)).toBe('0.00%');
    expect(formatBps(1000)).toBe('10.00%');
  });
});
