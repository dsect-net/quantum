/**
 * Escrow and Protocol Fee Preview Math
 *
 * Implements the fee calculation and escrow verification matching the
 * service's calculateBountyFeeAndSplit logic.
 */

export interface BountyEscrowPreview {
  priceUnits: number;
  feeBps: number;
  feeUnits: number;
  totalEscrowUnits: number;
  burnUnits: number;
  treasuryUnits: number;
  founderUnits: number;
  isSufficient: boolean;
  shortfallUnits: number;
}

export interface FeeSplitPercent {
  burn: number;
  treasury: number;
  founder: number;
}

export const DEFAULT_FEE_SPLIT: FeeSplitPercent = {
  burn: 40,
  treasury: 40,
  founder: 20,
};

/**
 * Calculates live fee preview and escrow cost for posting a bounty.
 *
 * @param priceUnits - bounty reward in integer units (1 credit = 100 units)
 * @param availableUnits - available checking balance of poster account
 * @param feeBps - protocol fee in basis points (e.g. 200 = 2.0%)
 * @param posterAccount - poster account id (special rules for treasury and scotty)
 * @param feeSplit - split configuration (default 40/40/20)
 */
export function calculateBountyEscrowPreview(
  priceUnits: number,
  availableUnits: number,
  feeBps: number = 200,
  posterAccount: string = '',
  feeSplit: FeeSplitPercent = DEFAULT_FEE_SPLIT
): BountyEscrowPreview {
  if (!Number.isFinite(priceUnits) || priceUnits <= 0) {
    return {
      priceUnits: 0,
      feeBps,
      feeUnits: 0,
      totalEscrowUnits: 0,
      burnUnits: 0,
      treasuryUnits: 0,
      founderUnits: 0,
      isSufficient: availableUnits >= 0,
      shortfallUnits: 0,
    };
  }

  // Integer fee calculation: (price_units * fee_bps) / 10000
  const feeUnits = Math.floor((priceUnits * feeBps) / 10000);
  const totalEscrowUnits = priceUnits + feeUnits;

  let treasuryUnits = Math.floor((feeUnits * feeSplit.treasury) / 100);
  let founderUnits = Math.floor((feeUnits * feeSplit.founder) / 100);

  // Self-transfer prevention: if treasury is poster, no treasury fee; if scotty, no founder fee
  if (posterAccount === 'treasury') {
    treasuryUnits = 0;
  }
  if (posterAccount === 'scotty') {
    founderUnits = 0;
  }

  const burnUnits = feeUnits - treasuryUnits - founderUnits;

  const isSufficient = availableUnits >= totalEscrowUnits;
  const shortfallUnits = isSufficient ? 0 : totalEscrowUnits - availableUnits;

  return {
    priceUnits,
    feeBps,
    feeUnits,
    totalEscrowUnits,
    burnUnits,
    treasuryUnits,
    founderUnits,
    isSufficient,
    shortfallUnits,
  };
}

export interface QuestEscrowPreview {
  payoutUnits: number;
  bonusPoolPct: number;
  bonusPoolUnits: number;
  totalEscrowUnits: number;
  isSufficient: boolean;
  shortfallUnits: number;
}

/**
 * Calculates escrow cost for posting a quest (payout + 10% bonus pool per Amendment A3)
 */
export function calculateQuestEscrowPreview(
  payoutUnits: number,
  availableUnits: number,
  bonusPoolPct: number = 10
): QuestEscrowPreview {
  if (!Number.isFinite(payoutUnits) || payoutUnits <= 0) {
    return {
      payoutUnits: 0,
      bonusPoolPct,
      bonusPoolUnits: 0,
      totalEscrowUnits: 0,
      isSufficient: availableUnits >= 0,
      shortfallUnits: 0,
    };
  }

  const bonusPoolUnits = Math.floor((payoutUnits * bonusPoolPct) / 100);
  const totalEscrowUnits = payoutUnits + bonusPoolUnits;
  const isSufficient = availableUnits >= totalEscrowUnits;
  const shortfallUnits = isSufficient ? 0 : totalEscrowUnits - availableUnits;

  return {
    payoutUnits,
    bonusPoolPct,
    bonusPoolUnits,
    totalEscrowUnits,
    isSufficient,
    shortfallUnits,
  };
}
