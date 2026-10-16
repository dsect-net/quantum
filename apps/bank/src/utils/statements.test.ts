import { describe, it, expect } from 'vitest';
import {
  calculateRunningBalances,
  filterTransactions,
  generateStatementCsv,
} from './statements.js';
import { Transaction } from '../types.js';

describe('Statements & Running Balance Calculations', () => {
  const dummyTxs: Transaction[] = [
    {
      id: 'tx-1',
      block_height: 0,
      tx_index: 0,
      type: 'genesis',
      from_account: null,
      to_account: 'scotty',
      amount_units: 500000,
      fee_units: 0,
      memo: 'Genesis allocation',
      actor_signature: 'sig',
      created_at: '2026-10-15T00:00:00Z',
      payload: null,
    },
    {
      id: 'tx-2',
      block_height: 1,
      tx_index: 0,
      type: 'transfer',
      from_account: 'scotty',
      to_account: 'cooper',
      amount_units: 10000,
      fee_units: 50,
      memo: 'Server setup bounty payout',
      actor_signature: 'sig',
      created_at: '2026-10-15T01:00:00Z',
      payload: null,
    },
    {
      id: 'tx-3',
      block_height: 2,
      tx_index: 0,
      type: 'paycheck',
      from_account: 'treasury',
      to_account: 'scotty',
      amount_units: 25000,
      fee_units: 0,
      memo: 'Founder paycheck epoch 1',
      actor_signature: 'sig',
      created_at: '2026-10-15T02:00:00Z',
      payload: null,
    },
    {
      id: 'tx-4',
      block_height: null, // pending mempool tx
      tx_index: 0,
      type: 'transfer',
      from_account: 'scotty',
      to_account: 'scotty:savings',
      amount_units: 5000,
      fee_units: 0,
      memo: 'Deposit to savings',
      actor_signature: 'sig',
      created_at: '2026-10-15T03:00:00Z',
      payload: null,
    },
  ];

  it('calculates running balances in chronological order and returns descending', () => {
    const results = calculateRunningBalances(dummyTxs, 'scotty');
    expect(results).toHaveLength(4);

    // Results are returned descending (newest first)
    // tx-4: pending transfer -5000 -> 500,000 - 10,050 + 25,000 - 5,000 = 509,950
    expect(results[0].tx.id).toBe('tx-4');
    expect(results[0].direction).toBe('out');
    expect(results[0].net_change_units).toBe(-5000);
    expect(results[0].running_balance_units).toBe(509950);

    // tx-3: paycheck +25000 -> 489,950 + 25,000 = 514,950
    expect(results[1].tx.id).toBe('tx-3');
    expect(results[1].direction).toBe('in');
    expect(results[1].net_change_units).toBe(25000);
    expect(results[1].running_balance_units).toBe(514950);

    // tx-2: transfer out 10,000 + 50 fee -> 500,000 - 10,050 = 489,950
    expect(results[2].tx.id).toBe('tx-2');
    expect(results[2].direction).toBe('out');
    expect(results[2].net_change_units).toBe(-10050);
    expect(results[2].running_balance_units).toBe(489950);

    // tx-1: genesis +500,000 -> 500,000
    expect(results[3].tx.id).toBe('tx-1');
    expect(results[3].direction).toBe('in');
    expect(results[3].net_change_units).toBe(500000);
    expect(results[3].running_balance_units).toBe(500000);
  });

  it('filters transactions by type', () => {
    const calculated = calculateRunningBalances(dummyTxs, 'scotty');

    const transfersOnly = filterTransactions(calculated, { type: 'transfers' });
    expect(transfersOnly).toHaveLength(2);
    expect(transfersOnly.map((i) => i.tx.id)).toEqual(['tx-4', 'tx-2']);

    const paychecksOnly = filterTransactions(calculated, { type: 'paychecks' });
    expect(paychecksOnly).toHaveLength(1);
    expect(paychecksOnly[0].tx.id).toBe('tx-3');

    const miningOnly = filterTransactions(calculated, { type: 'mining' });
    expect(miningOnly).toHaveLength(0);
  });

  it('filters transactions by search query', () => {
    const calculated = calculateRunningBalances(dummyTxs, 'scotty');

    const searchBounty = filterTransactions(calculated, { searchQuery: 'bounty' });
    expect(searchBounty).toHaveLength(1);
    expect(searchBounty[0].tx.id).toBe('tx-2');

    const searchSavings = filterTransactions(calculated, { searchQuery: 'savings' });
    expect(searchSavings).toHaveLength(1);
    expect(searchSavings[0].tx.id).toBe('tx-4');
  });

  it('generates a valid CSV statement', () => {
    const calculated = calculateRunningBalances(dummyTxs, 'scotty');
    const csv = generateStatementCsv(calculated, 'scotty');

    expect(csv).toContain('Account,Date (UTC),Transaction ID,Type');
    expect(csv).toContain('"scotty"');
    expect(csv).toContain('"tx-4"');
    expect(csv).toContain('"tx-3"');
    expect(csv).toContain('"tx-2"');
    expect(csv).toContain('"tx-1"');
    expect(csv).toContain('"Founder paycheck epoch 1"');
    expect(csv).toContain('"5,099.50"'); // running balance formatted
  });
});
