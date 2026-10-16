import React, { useState, useEffect } from 'react';
import { useAccount } from '../context/AccountContext.js';
import { api } from '../api/client.js';
import { EconomySummary, EffectivePolicy } from '../types.js';
import { formatCredits, formatBps } from '../utils/currency.js';
import {
  PieChart,
  Flame,
  Lock,
  Landmark,
  Pickaxe,
  Sparkles,
  ShieldCheck,
  Blocks,
  RefreshCw,
} from 'lucide-react';
import { CurrencyNotice } from '../components/CurrencyNotice.js';

export const EconomySnapshotView: React.FC = () => {
  const { summary: ctxSummary, policy: ctxPolicy } = useAccount();
  const [summary, setSummary] = useState<EconomySummary | null>(ctxSummary);
  const [policy, setPolicy] = useState<EffectivePolicy | null>(ctxPolicy);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refreshData = async () => {
    try {
      setIsRefreshing(true);
      const [s, p] = await Promise.all([
        api.getEconomySummary(),
        api.getEffectivePolicy(),
      ]);
      setSummary(s);
      setPolicy(p);
    } catch {
      // ignore
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (!summary || !policy) {
      refreshData();
    }
  }, []);

  const issuedUnits = summary?.issued_units ?? 0;
  const supplyCapUnits = summary?.supply_cap_units ?? 1_000_000_000;
  const issuedPct = supplyCapUnits > 0 ? (issuedUnits / supplyCapUnits) * 100 : 0;
  const savingsRateBps = policy?.savings_rate_bps ?? 250;
  const currentRewardUnits = summary?.current_reward_units ?? 5000;

  return (
    <div data-testid="economy-snapshot-view" className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-neutral-900 tracking-tight">Economy Snapshot</h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            Real-time ledger monetary metrics, Treasury reserves, and Fed policy
          </p>
        </div>

        <button
          type="button"
          onClick={refreshData}
          disabled={isRefreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-neutral-200 rounded-xl text-xs text-neutral-700 hover:bg-neutral-50 transition-colors shadow-2xs cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Supply vs Cap Card */}
      <div
        data-testid="supply-cap-card"
        className="bg-white border border-neutral-200/90 rounded-2xl p-6 shadow-2xs space-y-4"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-neutral-100 text-neutral-800 rounded-lg">
              <PieChart className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                Circulating Supply vs Cap
              </span>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span
                  data-testid="issued-supply-amount"
                  className="text-2xl font-bold font-mono text-neutral-900"
                >
                  {formatCredits(issuedUnits)}
                </span>
                <span className="text-xs text-neutral-400 font-mono">
                  / {formatCredits(supplyCapUnits)}
                </span>
              </div>
            </div>
          </div>

          <div className="text-right">
            <span
              data-testid="issued-pct-display"
              className="text-lg font-bold font-mono text-neutral-900"
            >
              {issuedPct.toFixed(2)}%
            </span>
            <span className="block text-[11px] text-neutral-400">Total Issued</span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full bg-neutral-100 h-2.5 rounded-full overflow-hidden">
          <div
            className="bg-neutral-900 h-full rounded-full transition-all duration-500"
            style={{ width: `${Math.min(100, Math.max(1, issuedPct))}%` }}
          />
        </div>
      </div>

      {/* Fed Policy & Rates Card */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Savings Rate Card */}
        <div
          data-testid="policy-savings-card"
          className="bg-white border border-neutral-200/90 rounded-2xl p-5 shadow-2xs space-y-2"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-violet-50 text-violet-700 rounded-lg">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-semibold text-neutral-900">Savings Rate (Fed Set)</div>
                <div className="text-[11px] text-neutral-400">Annualized yield on deposits</div>
              </div>
            </div>
            <span
              data-testid="economy-savings-rate"
              className="text-lg font-bold font-mono text-violet-700"
            >
              {formatBps(savingsRateBps)}
            </span>
          </div>
          <p className="text-[11px] text-neutral-500 leading-relaxed pt-2 border-t border-neutral-100">
            Current target rate set by Fed algorithmic governance within statutory bounds (50–1000 bps).
            Funded exclusively from Treasury surplus.
          </p>
        </div>

        {/* Mining Reward Card */}
        <div
          data-testid="mining-reward-card"
          className="bg-white border border-neutral-200/90 rounded-2xl p-5 shadow-2xs space-y-2"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-neutral-100 text-neutral-800 rounded-lg">
                <Pickaxe className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-semibold text-neutral-900">Block Mining Reward</div>
                <div className="text-[11px] text-neutral-400">Proof-of-Work per sealed block</div>
              </div>
            </div>
            <span
              data-testid="economy-mining-reward"
              className="text-lg font-bold font-mono text-neutral-900"
            >
              {formatCredits(currentRewardUnits)}
            </span>
          </div>
          <p className="text-[11px] text-neutral-500 leading-relaxed pt-2 border-t border-neutral-100">
            Halves every 210,000 blocks. Next halving at height{' '}
            <span className="font-mono text-neutral-700">
              {summary?.next_halving_height?.toLocaleString() ?? '210,000'}
            </span>
            .
          </p>
        </div>
      </div>

      {/* Reserves and Total Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div
          data-testid="treasury-reserve-card"
          className="p-4 bg-white border border-neutral-200/90 rounded-2xl shadow-2xs"
        >
          <div className="flex items-center gap-2 text-neutral-500 text-xs font-medium">
            <Landmark className="w-3.5 h-3.5" /> Treasury Reserve
          </div>
          <div
            data-testid="economy-treasury-balance"
            className="text-lg font-bold font-mono text-neutral-900 mt-1"
          >
            {formatCredits(summary?.treasury_balance_units ?? 0)}
          </div>
          <div className="text-[10px] text-neutral-400 mt-0.5">Funds paychecks & interest</div>
        </div>

        <div
          data-testid="escrow-locked-card"
          className="p-4 bg-white border border-neutral-200/90 rounded-2xl shadow-2xs"
        >
          <div className="flex items-center gap-2 text-neutral-500 text-xs font-medium">
            <Lock className="w-3.5 h-3.5" /> Escrow Locked
          </div>
          <div
            data-testid="economy-escrow-locked"
            className="text-lg font-bold font-mono text-neutral-900 mt-1"
          >
            {formatCredits(summary?.escrow_locked_units ?? 0)}
          </div>
          <div className="text-[10px] text-neutral-400 mt-0.5">Active bounties & quests</div>
        </div>

        <div
          data-testid="burned-total-card"
          className="p-4 bg-white border border-neutral-200/90 rounded-2xl shadow-2xs"
        >
          <div className="flex items-center gap-2 text-neutral-500 text-xs font-medium">
            <Flame className="w-3.5 h-3.5 text-rose-500" /> Burned Total
          </div>
          <div
            data-testid="economy-burned-total"
            className="text-lg font-bold font-mono text-neutral-900 mt-1"
          >
            {formatCredits(summary?.burned_units ?? 0)}
          </div>
          <div className="text-[10px] text-neutral-400 mt-0.5">Protocol fee deflation</div>
        </div>
      </div>

      {/* Chain Status Strip */}
      <div
        data-testid="chain-status-strip"
        className="p-4 bg-neutral-900 text-white rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-2xs"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-neutral-800 flex items-center justify-center text-violet-400">
            <Blocks className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs font-semibold">Quantum Core Ledger Tip</div>
            <div className="text-[11px] text-neutral-400 font-mono">
              Height: <span data-testid="economy-block-height">{summary?.block_height ?? 0}</span> •
              Validators:{' '}
              <span data-testid="economy-validator-count">{summary?.validator_count ?? 2}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-emerald-400 bg-neutral-800/80 px-2.5 py-1 rounded-full">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Consensus Verified</span>
        </div>
      </div>

      <CurrencyNotice />
    </div>
  );
};
