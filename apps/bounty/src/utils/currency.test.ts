import { describe, it, expect } from 'vitest';
import { unitsToCredits, formatCredits, creditsToUnits } from './currency.js';

describe('currency utils', () => {
  describe('unitsToCredits', () => {
    it('converts integer units correctly to two decimals', () => {
      expect(unitsToCredits(0)).toBe('0.00');
      expect(unitsToCredits(1)).toBe('0.01');
      expect(unitsToCredits(99)).toBe('0.99');
      expect(unitsToCredits(100)).toBe('1.00');
      expect(unitsToCredits(1050)).toBe('10.50');
      expect(unitsToCredits(100000)).toBe('1,000.00');
      expect(unitsToCredits(2100000000)).toBe('21,000,000.00');
    });

    it('handles negative units', () => {
      expect(unitsToCredits(-50)).toBe('-0.50');
      expect(unitsToCredits(-1250)).toBe('-12.50');
    });

    it('handles edge cases gracefully', () => {
      expect(unitsToCredits(NaN)).toBe('0.00');
      expect(unitsToCredits(Infinity)).toBe('0.00');
    });
  });

  describe('formatCredits', () => {
    it('formats with unit label by default', () => {
      expect(formatCredits(2500)).toBe('25.00 credits');
    });

    it('supports custom unit labels and omitting unit', () => {
      expect(formatCredits(2500, { unitLabel: 'QC' })).toBe('25.00 QC');
      expect(formatCredits(2500, { showUnit: false })).toBe('25.00');
    });

    it('supports positive sign prefix', () => {
      expect(formatCredits(500, { showSign: true })).toBe('+5.00 credits');
      expect(formatCredits(-500, { showSign: true })).toBe('-5.00 credits');
      expect(formatCredits(0, { showSign: true })).toBe('0.00 credits');
    });
  });

  describe('creditsToUnits', () => {
    it('converts decimal and integer strings to integer units without float errors', () => {
      expect(creditsToUnits('0')).toBe(0);
      expect(creditsToUnits('1')).toBe(100);
      expect(creditsToUnits('10.5')).toBe(1050);
      expect(creditsToUnits('10.50')).toBe(1050);
      expect(creditsToUnits('0.05')).toBe(5);
      expect(creditsToUnits('1,250.75')).toBe(125075);
    });

    it('handles negative input strings', () => {
      expect(creditsToUnits('-10.50')).toBe(-1050);
    });

    it('truncates beyond 2 decimal places rather than multiplying floats', () => {
      expect(creditsToUnits('10.509')).toBe(1050);
    });

    it('handles number inputs safely', () => {
      expect(creditsToUnits(25)).toBe(2500);
      expect(creditsToUnits(25.5)).toBe(2550);
    });

    it('handles malformed inputs safely', () => {
      expect(creditsToUnits('')).toBe(0);
      expect(creditsToUnits('abc')).toBe(0);
      expect(creditsToUnits('10.5.2')).toBe(0);
    });
  });
});
