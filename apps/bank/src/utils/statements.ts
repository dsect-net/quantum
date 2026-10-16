import { Transaction, RunningBalanceTransaction } from '../types.js';
import { unitsToCredits } from './currency.js';

export type StatementFilterType =
  | 'all'
  | 'transfers'
  | 'paychecks'
  | 'interest'
  | 'mining'
  | 'quests'
  | 'bounties'
  | 'purchases';

export type StatementFilterPeriod = 'all' | '30d' | '7d' | 'today';

/**
 * Calculates running balances across chronological transactions for a target account.
 * Chronological order: lowest block_height / created_at first.
 * The returned array is sorted descending (most recent first) for display,
 * with each item containing the accurate running balance at that point in time.
 */
export function calculateRunningBalances(
  transactions: Transaction[],
  targetAccountId: string
): RunningBalanceTransaction[] {
  // Sort ascending chronologically to compute running balance
  const sortedAsc = [...transactions].sort((a, b) => {
    if (a.block_height !== null && b.block_height !== null) {
      if (a.block_height !== b.block_height) {
        return a.block_height - b.block_height;
      }
      return a.tx_index - b.tx_index;
    }
    if (a.block_height !== null && b.block_height === null) return -1;
    if (a.block_height === null && b.block_height !== null) return 1;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  let currentBalanceUnits = 0;
  const resultAsc: RunningBalanceTransaction[] = [];

  for (const tx of sortedAsc) {
    const isFrom = tx.from_account === targetAccountId;
    const isTo = tx.to_account === targetAccountId;

    if (!isFrom && !isTo) {
      continue;
    }

    let direction: 'in' | 'out' | 'internal' | 'neutral' = 'neutral';
    let netChangeUnits = 0;

    if (isTo && !isFrom) {
      direction = 'in';
      netChangeUnits = tx.amount_units;
      currentBalanceUnits += tx.amount_units;
    } else if (isFrom && !isTo) {
      direction = 'out';
      const fee = tx.fee_units || 0;
      netChangeUnits = -(tx.amount_units + fee);
      currentBalanceUnits -= (tx.amount_units + fee);
    } else {
      // Both from and to are target account (e.g. self)
      direction = 'internal';
      netChangeUnits = -(tx.fee_units || 0);
      currentBalanceUnits -= (tx.fee_units || 0);
    }

    resultAsc.push({
      tx,
      running_balance_units: currentBalanceUnits,
      direction,
      net_change_units: netChangeUnits,
    });
  }

  // Return descending (newest first) for UI display
  return resultAsc.reverse();
}

/**
 * Filter running-balance transactions by type and period
 */
export function filterTransactions(
  items: RunningBalanceTransaction[],
  filters: {
    type?: StatementFilterType;
    period?: StatementFilterPeriod;
    searchQuery?: string;
  }
): RunningBalanceTransaction[] {
  const { type = 'all', period = 'all', searchQuery = '' } = filters;
  const now = Date.now();
  const searchLower = searchQuery.trim().toLowerCase();

  return items.filter((item) => {
    const tx = item.tx;

    // Filter by type
    if (type !== 'all') {
      if (type === 'transfers' && tx.type !== 'transfer') return false;
      if (type === 'paychecks' && tx.type !== 'paycheck') return false;
      if (type === 'interest' && tx.type !== 'interest') return false;
      if (type === 'mining' && tx.type !== 'mint_reward' && tx.type !== 'work_credit') return false;
      if (type === 'purchases' && tx.type !== 'purchase') return false;
      if (type === 'bounties') {
        const isBounty =
          tx.type === 'escrow_lock' ||
          tx.type === 'escrow_release' ||
          tx.type === 'escrow_refund' ||
          (tx.memo && tx.memo.toLowerCase().includes('bounty'));
        if (!isBounty) return false;
      }
      if (type === 'quests') {
        const isQuest =
          tx.memo?.toLowerCase().includes('quest') ||
          (tx.payload as any)?.quest_id !== undefined;
        if (!isQuest) return false;
      }
    }

    // Filter by period
    if (period !== 'all') {
      const txTime = new Date(tx.created_at).getTime();
      const diffMs = now - txTime;
      const oneDayMs = 24 * 60 * 60 * 1000;

      if (period === 'today' && diffMs > oneDayMs) return false;
      if (period === '7d' && diffMs > 7 * oneDayMs) return false;
      if (period === '30d' && diffMs > 30 * oneDayMs) return false;
    }

    // Search query
    if (searchLower) {
      const memoMatch = tx.memo?.toLowerCase().includes(searchLower);
      const fromMatch = tx.from_account?.toLowerCase().includes(searchLower);
      const toMatch = tx.to_account?.toLowerCase().includes(searchLower);
      const idMatch = tx.id.toLowerCase().includes(searchLower);
      const typeMatch = tx.type.toLowerCase().includes(searchLower);
      if (!memoMatch && !fromMatch && !toMatch && !idMatch && !typeMatch) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Generate CSV statement representation from real transactions data
 */
export function generateStatementCsv(
  items: RunningBalanceTransaction[],
  accountId: string
): string {
  const headers = [
    'Account',
    'Date (UTC)',
    'Transaction ID',
    'Type',
    'Direction',
    'From Account',
    'To Account',
    'Amount (QC)',
    'Fee (QC)',
    'Net Change (QC)',
    'Running Balance (QC)',
    'Memo',
  ];

  const escapeCsv = (val: string | null | undefined): string => {
    if (val === null || val === undefined) return '""';
    const s = String(val).replace(/"/g, '""');
    return `"${s}"`;
  };

  const rows = items.map((item) => {
    const tx = item.tx;
    return [
      escapeCsv(accountId),
      escapeCsv(tx.created_at),
      escapeCsv(tx.id),
      escapeCsv(tx.type),
      escapeCsv(item.direction),
      escapeCsv(tx.from_account || 'SYSTEM'),
      escapeCsv(tx.to_account || 'SYSTEM'),
      escapeCsv(unitsToCredits(tx.amount_units)),
      escapeCsv(unitsToCredits(tx.fee_units)),
      escapeCsv(unitsToCredits(item.net_change_units)),
      escapeCsv(unitsToCredits(item.running_balance_units)),
      escapeCsv(tx.memo || ''),
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

/**
 * Triggers browser client-side download of the CSV statement
 */
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
