import React, { useState, useEffect, useMemo } from 'react';
import { useAccount } from '../context/AccountContext.js';
import { Transaction } from '../types.js';
import { api } from '../api/client.js';
import {
  calculateRunningBalances,
  filterTransactions,
  generateStatementCsv,
  downloadCsv,
  StatementFilterType,
  StatementFilterPeriod,
} from '../utils/statements.js';
import {
  formatCredits,
  formatBankAccountId,
} from '../utils/currency.js';
import {
  Download,
  Search,
  Filter,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowLeftRight,
  ReceiptText,
  RotateCcw,
} from 'lucide-react';
import { EmptyState } from '../components/EmptyState.js';

export const ActivityView: React.FC = () => {
  const { actingAccount, savingsAccount } = useAccount();

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [accountScope, setAccountScope] = useState<'checking' | 'savings'>('checking');
  const [selectedType, setSelectedType] = useState<StatementFilterType>('all');
  const [selectedPeriod, setSelectedPeriod] = useState<StatementFilterPeriod>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const targetAccountId = useMemo(() => {
    if (!actingAccount) return '';
    if (accountScope === 'savings' && savingsAccount) {
      return savingsAccount.id;
    }
    return actingAccount.id;
  }, [actingAccount, savingsAccount, accountScope]);

  const fetchHistory = async () => {
    if (!targetAccountId) return;
    try {
      setIsLoading(true);
      const history = await api.getAccountHistory(targetAccountId, 100, 0);
      setTransactions(history);
    } catch {
      setTransactions([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [targetAccountId]);

  // Compute running balance chronologically
  const runningBalanceItems = useMemo(() => {
    return calculateRunningBalances(transactions, targetAccountId);
  }, [transactions, targetAccountId]);

  // Filter transactions
  const filteredItems = useMemo(() => {
    return filterTransactions(runningBalanceItems, {
      type: selectedType,
      period: selectedPeriod,
      searchQuery,
    });
  }, [runningBalanceItems, selectedType, selectedPeriod, searchQuery]);

  const handleExportCsv = () => {
    if (!targetAccountId) return;
    const csv = generateStatementCsv(filteredItems, targetAccountId);
    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `quantum-bank-statement-${targetAccountId}-${dateStr}.csv`;
    downloadCsv(filename, csv);
  };

  return (
    <div data-testid="activity-view" className="space-y-6">
      {/* Header and Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-neutral-900 tracking-tight">
            Account Activity & Statements
          </h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            Full transaction history with chronological running balance
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Account Scope Toggle */}
          {savingsAccount && (
            <div className="flex bg-neutral-100 p-1 rounded-xl text-xs font-medium">
              <button
                type="button"
                data-testid="scope-checking-button"
                onClick={() => setAccountScope('checking')}
                className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                  accountScope === 'checking'
                    ? 'bg-white text-neutral-900 shadow-2xs font-semibold'
                    : 'text-neutral-500 hover:text-neutral-700'
                }`}
              >
                Checking
              </button>
              <button
                type="button"
                data-testid="scope-savings-button"
                onClick={() => setAccountScope('savings')}
                className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                  accountScope === 'savings'
                    ? 'bg-white text-neutral-900 shadow-2xs font-semibold'
                    : 'text-neutral-500 hover:text-neutral-700'
                }`}
              >
                Savings
              </button>
            </div>
          )}

          <button
            data-testid="export-csv-button"
            type="button"
            onClick={handleExportCsv}
            disabled={filteredItems.length === 0}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-neutral-900 text-white rounded-xl text-xs font-medium hover:bg-neutral-800 transition-colors shadow-2xs cursor-pointer disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white border border-neutral-200/90 rounded-2xl p-4 shadow-2xs space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-2.5" />
            <input
              data-testid="activity-search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search memo, counterparty, or transaction ID..."
              className="w-full pl-9 pr-3 py-2 bg-neutral-50 border border-neutral-200 rounded-xl text-xs text-neutral-900 focus:outline-none focus:ring-1 focus:ring-violet-500 focus:bg-white transition-all"
            />
          </div>

          {/* Type Filter */}
          <div className="flex items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
            <select
              data-testid="activity-type-filter"
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value as StatementFilterType)}
              className="px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-xl text-xs text-neutral-700 focus:outline-none focus:ring-1 focus:ring-violet-500 cursor-pointer"
            >
              <option value="all">All Types</option>
              <option value="transfers">Transfers</option>
              <option value="paychecks">Paychecks</option>
              <option value="interest">Interest</option>
              <option value="quests">Quests</option>
              <option value="bounties">Bounties / Escrow</option>
              <option value="mining">Mining / PoUW</option>
              <option value="purchases">Purchases</option>
            </select>

            {/* Period Filter */}
            <select
              data-testid="activity-period-filter"
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value as StatementFilterPeriod)}
              className="px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-xl text-xs text-neutral-700 focus:outline-none focus:ring-1 focus:ring-violet-500 cursor-pointer"
            >
              <option value="all">All Time</option>
              <option value="today">Today</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
            </select>

            <button
              type="button"
              onClick={fetchHistory}
              title="Refresh Activity"
              className="p-2 border border-neutral-200 rounded-xl hover:bg-neutral-50 text-neutral-500 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Transactions List with Running Balance */}
      <div
        data-testid="activity-transactions-list"
        className="bg-white border border-neutral-200/90 rounded-2xl overflow-hidden shadow-2xs"
      >
        <div className="px-5 py-3.5 border-b border-neutral-100 flex items-center justify-between bg-neutral-50/60">
          <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">
            Transactions ({filteredItems.length})
          </span>
          <span className="text-[11px] font-mono text-neutral-400">
            {formatBankAccountId(targetAccountId)}
          </span>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-xs text-neutral-400">
            Loading transaction history...
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-8">
            <EmptyState
              icon={ReceiptText}
              title="No Transactions Found"
              description="No transaction records match your selected account and filters."
            />
          </div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {filteredItems.map((item) => {
              const tx = item.tx;
              const isIncoming = item.direction === 'in';
              const isInternal = item.direction === 'internal';

              return (
                <div
                  key={tx.id}
                  data-testid={`tx-row-${tx.id}`}
                  className="p-4 hover:bg-neutral-50/70 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                        isIncoming
                          ? 'bg-emerald-50 text-emerald-600'
                          : isInternal
                          ? 'bg-violet-50 text-violet-600'
                          : 'bg-neutral-100 text-neutral-700'
                      }`}
                    >
                      {isIncoming ? (
                        <ArrowDownLeft className="w-4 h-4" />
                      ) : isInternal ? (
                        <ArrowLeftRight className="w-4 h-4" />
                      ) : (
                        <ArrowUpRight className="w-4 h-4" />
                      )}
                    </div>

                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-neutral-900">
                          {tx.memo || (tx.type.replace('_', ' ').toUpperCase())}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-neutral-100 text-neutral-600">
                          {tx.type}
                        </span>
                        {tx.block_height === null && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                            Pending Mempool
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-[11px] text-neutral-400 flex-wrap">
                        <span>{new Date(tx.created_at).toLocaleString()}</span>
                        <span>•</span>
                        <span className="font-mono text-[10px]">
                          {isIncoming
                            ? `From: ${tx.from_account || 'SYSTEM'}`
                            : `To: ${tx.to_account || 'SYSTEM'}`}
                        </span>
                        <span>•</span>
                        <span className="font-mono text-[10px]">ID: {tx.id.slice(0, 8)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="text-right flex sm:flex-col items-center sm:items-end justify-between sm:justify-center border-t sm:border-t-0 pt-2 sm:pt-0 border-neutral-100">
                    <div
                      data-testid={`tx-amount-${tx.id}`}
                      className={`text-sm font-bold font-mono ${
                        isIncoming
                          ? 'text-emerald-600'
                          : isInternal
                          ? 'text-violet-700'
                          : 'text-neutral-900'
                      }`}
                    >
                      {formatCredits(item.net_change_units, { showSign: true })}
                    </div>

                    <div
                      data-testid={`tx-running-balance-${tx.id}`}
                      className="text-[11px] text-neutral-400 font-mono mt-0.5"
                    >
                      Bal: {formatCredits(item.running_balance_units)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
