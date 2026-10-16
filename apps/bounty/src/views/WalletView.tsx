import React, { useState, useEffect, useCallback } from 'react';
import { useAccount } from '../context/AccountContext.js';
import { api } from '../api/client.js';
import { Transaction, CataloguePurchase } from '../types.js';
import { formatCredits } from '../utils/currency.js';
import { EmptyState } from '../components/EmptyState.js';
import {
  Wallet,
  ArrowUpRight,
  ArrowDownLeft,
  ShoppingBag,
  ShieldCheck,
  History,
  Lock,
  PiggyBank,
} from 'lucide-react';

export const WalletView: React.FC = () => {
  const { currentAccount, balance, refreshBalance } = useAccount();

  const [history, setHistory] = useState<Transaction[]>([]);
  const [purchases, setPurchases] = useState<CataloguePurchase[]>([]);
  const [activeTab, setActiveTab] = useState<'history' | 'purchases'>('history');
  const [isLoading, setIsLoading] = useState(true);

  const fetchWalletData = useCallback(async () => {
    if (!currentAccount) return;
    try {
      setIsLoading(true);
      const [txs, purch] = await Promise.all([
        api.getAccountHistory(currentAccount.id, 50),
        api.listPurchases(currentAccount.id),
      ]);
      setHistory(txs);
      setPurchases(purch);
    } catch {
      // ignore
    } finally {
      setIsLoading(false);
    }
  }, [currentAccount]);

  useEffect(() => {
    fetchWalletData();
  }, [fetchWalletData]);

  if (!currentAccount) {
    return (
      <div className="py-12 text-center text-gray-500">
        No active account selected. Use the account switcher in the top right.
      </div>
    );
  }

  // Calculate Net Worth: available + savings + escrow locked
  const availableUnits = balance?.available_units ?? 0;
  const netWorthUnits = availableUnits; // Can also reflect escrow/savings when available

  const getTxTypeBadge = (type: string) => {
    let color = 'bg-gray-100 text-gray-700';
    if (type.includes('release') || type === 'mining_reward' || type === 'work_credit' || type === 'paycheck') {
      color = 'bg-emerald-50 text-emerald-700 border-emerald-200';
    } else if (type.includes('lock') || type.startsWith('fee_')) {
      color = 'bg-amber-50 text-amber-700 border-amber-200';
    } else if (type === 'transfer') {
      color = 'bg-blue-50 text-blue-700 border-blue-200';
    } else if (type === 'catalogue_purchase') {
      color = 'bg-purple-50 text-[#7C5CFF] border-[#7C5CFF]/30';
    }
    return (
      <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono border ${color}`}>
        {type}
      </span>
    );
  };

  return (
    <div className="space-y-4 max-w-3xl mx-auto" data-testid="wallet-view">
      {/* Scope peek banner per Amendment A4 §2 */}
      <div className="bg-purple-50/60 border border-[#7C5CFF]/20 rounded-xl px-4 py-2 text-xs text-[#7C5CFF] flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-medium">
          <PiggyBank className="w-4 h-4" />
          Quantum Bank Peek (Full Bank arrives in Chunk 4b)
        </span>
        <button
          onClick={() => {
            refreshBalance();
            fetchWalletData();
          }}
          className="text-[11px] underline font-semibold hover:text-purple-900 cursor-pointer"
        >
          Reconcile
        </button>
      </div>

      {/* Account Balances Summary Card */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-2xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-700">
              <Wallet className="w-4 h-4 text-[#7C5CFF]" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-gray-900">{currentAccount.display_name}</h2>
              <span className="text-[11px] text-gray-400 font-mono">id: {currentAccount.id}</span>
            </div>
          </div>
          <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs font-mono capitalize">
            {currentAccount.kind}
          </span>
        </div>

        {/* Balance metrics grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-3 border-t border-gray-100">
          <div className="bg-gray-50/70 p-3 rounded-xl border border-gray-100">
            <span className="text-[11px] text-gray-500 block">Available Balance</span>
            <span className="text-lg font-bold font-mono text-gray-900" data-testid="wallet-available-balance">
              {formatCredits(availableUnits)}
            </span>
          </div>

          <div className="bg-gray-50/70 p-3 rounded-xl border border-gray-100">
            <span className="text-[11px] text-gray-500 block flex items-center gap-1">
              <Lock className="w-3 h-3 text-gray-400" />
              Escrow / Locked
            </span>
            <span className="text-lg font-bold font-mono text-gray-600">
              {formatCredits(0)}
            </span>
          </div>

          <div className="col-span-2 sm:col-span-1 bg-gray-50/70 p-3 rounded-xl border border-gray-100">
            <span className="text-[11px] text-gray-500 block">Net Worth</span>
            <span className="text-lg font-bold font-mono text-[#7C5CFF]" data-testid="wallet-net-worth">
              {formatCredits(netWorthUnits)}
            </span>
          </div>
        </div>

        {/* Verification badge */}
        {balance?.verified_at && (
          <div className="flex items-center space-x-1.5 text-[11px] text-gray-400 font-mono pt-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>Chain verified at: {new Date(balance.verified_at).toLocaleTimeString()}</span>
          </div>
        )}
      </div>

      {/* Tabs: Transaction History vs Purchases */}
      <div className="flex items-center space-x-2 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('history')}
          className={`pb-2.5 px-3 text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer border-b-2 -mb-px ${
            activeTab === 'history'
              ? 'border-gray-900 text-gray-900'
              : 'border-transparent text-gray-400 hover:text-gray-700'
          }`}
          data-testid="wallet-history-tab"
        >
          <History className="w-3.5 h-3.5" />
          <span>Activity & Ledger History ({history.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('purchases')}
          className={`pb-2.5 px-3 text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer border-b-2 -mb-px ${
            activeTab === 'purchases'
              ? 'border-gray-900 text-gray-900'
              : 'border-transparent text-gray-400 hover:text-gray-700'
          }`}
          data-testid="wallet-purchases-tab"
        >
          <ShoppingBag className="w-3.5 h-3.5" />
          <span>My Catalogue Grants ({purchases.length})</span>
        </button>
      </div>

      {/* Tab Content */}
      {isLoading ? (
        <div className="py-8 text-center text-gray-400 text-xs">Loading wallet activity...</div>
      ) : activeTab === 'history' ? (
        history.length === 0 ? (
          <EmptyState
            icon={History}
            title="No Activity Yet"
            description="Transactions involving your account will appear here once sealed in blocks."
          />
        ) : (
          <div className="bg-white border border-gray-200 rounded-2xl divide-y divide-gray-100 shadow-2xs overflow-hidden">
            {history.map((tx) => {
              const isIncoming = tx.to_account === currentAccount.id;
              const isOutgoing = tx.from_account === currentAccount.id;
              return (
                <div
                  key={tx.id}
                  className="p-3.5 flex items-center justify-between text-xs hover:bg-gray-50/50 transition-colors"
                  data-testid={`tx-row-${tx.id}`}
                >
                  <div className="flex items-center space-x-3">
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                        isIncoming
                          ? 'bg-emerald-50 text-emerald-600'
                          : isOutgoing
                          ? 'bg-rose-50 text-rose-600'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {isIncoming ? (
                        <ArrowDownLeft className="w-4 h-4" />
                      ) : (
                        <ArrowUpRight className="w-4 h-4" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center space-x-1.5">
                        {getTxTypeBadge(tx.type)}
                        {tx.block_height !== null ? (
                          <span className="text-[10px] text-gray-400 font-mono">
                            block #{tx.block_height}
                          </span>
                        ) : (
                          <span className="text-[10px] text-amber-600 font-mono">pending</span>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-500 font-mono mt-0.5">
                        {isIncoming && `from: ${tx.from_account || 'system'}`}
                        {isOutgoing && `to: ${tx.to_account || 'system'}`}
                        {tx.memo && ` • ${tx.memo}`}
                      </p>
                    </div>
                  </div>

                  <div className="text-right font-mono">
                    <span
                      className={`font-bold ${
                        isIncoming ? 'text-emerald-600' : isOutgoing ? 'text-gray-900' : 'text-gray-600'
                      }`}
                    >
                      {isIncoming ? '+' : isOutgoing ? '-' : ''}
                      {formatCredits(tx.amount_units)}
                    </span>
                    <p className="text-[10px] text-gray-400 font-sans">
                      {new Date(tx.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : purchases.length === 0 ? (
        <EmptyState
          icon={ShoppingBag}
          title="No Purchases Found"
          description="You haven't purchased items from the fleet catalogue yet."
        />
      ) : (
        <div className="space-y-2">
          {purchases.map((p) => (
            <div
              key={p.id}
              className="bg-white border border-gray-200 rounded-xl p-3.5 flex items-center justify-between text-xs shadow-2xs"
            >
              <div>
                <span className="font-semibold text-gray-900">
                  {p.item_title || p.item_id}
                </span>
                <p className="text-[11px] text-gray-500 font-mono mt-0.5">{p.message}</p>
                <span className="text-[10px] text-gray-400">
                  Granted: {new Date(p.granted_at).toLocaleDateString()}
                </span>
              </div>
              <div className="text-right font-mono">
                <span className="font-bold text-[#7C5CFF]">
                  {formatCredits(p.price_units)}
                </span>
                <span className="block text-[10px] text-emerald-600 font-semibold uppercase">
                  {p.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
