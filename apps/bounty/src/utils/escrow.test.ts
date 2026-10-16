import { describe, it, expect } from 'vitest';
import { calculateBountyEscrowPreview, calculateQuestEscrowPreview } from './escrow.js';

describe('escrow preview calculations', () => {
  describe('calculateBountyEscrowPreview', () => {
    it('calculates 2% fee and split for 2000 units bounty', () => {
      // 2000 units price, fee_bps = 200 (2%) -> fee = 40 units
      // split: 40% burn = 16, 40% treasury = 16, 20% founder = 8
      // total needed = 2040 units
      const preview = calculateBountyEscrowPreview(2000, 50000, 200, 'cooper');
      expect(preview.feeUnits).toBe(40);
      expect(preview.totalEscrowUnits).toBe(2040);
      expect(preview.burnUnits).toBe(16);
      expect(preview.treasuryUnits).toBe(16);
      expect(preview.founderUnits).toBe(8);
      expect(preview.isSufficient).toBe(true);
      expect(preview.shortfallUnits).toBe(0);
    });

    it('correctly flags insufficient balance and shortfall', () => {
      const preview = calculateBountyEscrowPreview(2000, 1500, 200, 'cooper');
      expect(preview.totalEscrowUnits).toBe(2040);
      expect(preview.isSufficient).toBe(false);
      expect(preview.shortfallUnits).toBe(540);
    });

    it('handles special self-transfer prevention for treasury', () => {
      const preview = calculateBountyEscrowPreview(1000, 1000000, 200, 'treasury');
      expect(preview.feeUnits).toBe(20);
      expect(preview.treasuryUnits).toBe(0);
      // Remainder goes to burn: 20 fee - 0 treasury - 4 founder = 16 burn
      expect(preview.founderUnits).toBe(4);
      expect(preview.burnUnits).toBe(16);
    });

    it('handles special self-transfer prevention for scotty (founder)', () => {
      const preview = calculateBountyEscrowPreview(1000, 1000000, 200, 'scotty');
      expect(preview.feeUnits).toBe(20);
      expect(preview.founderUnits).toBe(0);
      expect(preview.treasuryUnits).toBe(8);
      expect(preview.burnUnits).toBe(12);
    });

    it('handles custom fee bps from live policy (e.g. 250 bps = 2.5%)', () => {
      const preview = calculateBountyEscrowPreview(4000, 5000, 250, 'cooper');
      // 4000 * 250 / 10000 = 100 units fee
      expect(preview.feeUnits).toBe(100);
      expect(preview.totalEscrowUnits).toBe(4100);
      expect(preview.burnUnits).toBe(40);
      expect(preview.treasuryUnits).toBe(40);
      expect(preview.founderUnits).toBe(20);
      expect(preview.isSufficient).toBe(true);
    });
  });

  describe('calculateQuestEscrowPreview', () => {
    it('calculates 10% bonus pool and total lock for standard quest', () => {
      // 5000 units payout + 10% bonus pool (500 units) = 5500 units total
      const preview = calculateQuestEscrowPreview(5000, 10000, 10);
      expect(preview.bonusPoolUnits).toBe(500);
      expect(preview.totalEscrowUnits).toBe(5500);
      expect(preview.isSufficient).toBe(true);
      expect(preview.shortfallUnits).toBe(0);
    });

    it('flags insufficient funds for quest funding', () => {
      const preview = calculateQuestEscrowPreview(5000, 3000, 10);
      expect(preview.totalEscrowUnits).toBe(5500);
      expect(preview.isSufficient).toBe(false);
      expect(preview.shortfallUnits).toBe(2500);
    });
  });
});
