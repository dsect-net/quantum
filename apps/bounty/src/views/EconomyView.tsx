import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client.js';
import { EconomySummary, AssessmentRecord, PolicyRecord } from '../types.js';
import { formatCredits } from '../utils/currency.js';
import {
  TrendingUp,
  Flame,
  Lock,
  Landmark,
  Cpu,
  Scale,
  CalendarClock,
  Sparkles,
} from 'lucide-react';

export const EconomyView: React.FC = () => {
  const [summary, setSummary] = useState<EconomySummary | null>(null);
  const [assessment, setAssessment] = useState<AssessmentRecord | null>(null);
  const [pendingPolicies, setPendingPolicies] = useState<PolicyRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchEconomyData = useCallback(async () => {
    try {
      setIsLoading(true);
      const [sum, assess, pending] = await Promise.all([
        api.getEconomySummary(),
        api.getLatestAssessment().catch(() => null),
        api.getPendingPolicies().catch(() => []),
      ]);
      setSummary(sum);
      setAssessment(assess);
      setPendingPolicies(pending);
    } catch {
      // ignore
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEconomyData();
  }, [fetchEconomyData]);

  if (isLoading) {
    return (
      <div className="py-12 text-center text-gray-400">
        <div className="w-8 h-8 border-2 border-gray-300 border-t-[#7C5CFF] rounded-full animate-spin mx-auto mb-2" />
        <span className="text-xs">Loading macro economy data...</span>
      </div>
    );
  }

  const issuedUnits = summary?.issued_units ?? 0;
  const capUnits = summary?.supply_cap_units ?? 2100000000;
  const progressPct = ((issuedUnits / capUnits) * 100).toFixed(2);

  return (
    <div className="space-y-4 max-w-3xl mx-auto" data-testid="economy-view">
      {/* Supply vs Cap Card */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-2xs space-y-4" data-testid="supply-cap-card">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center text-[#7C5CFF]">
              <TrendingUp className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-gray-900">Total Supply vs Hard Cap</h2>
              <p className="text-[10px] text-gray-400 font-mono">
                Formula: Genesis + Mining Issuance (No Admin Mint)
              </p>
            </div>
          </div>
          <span className="text-sm font-bold font-mono text-[#7C5CFF]">{progressPct}%</span>
        </div>

        {/* Progress Bar */}
        <div className="space-y-1.5">
          <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden border border-gray-200/80">
            <div
              className="bg-linear-to-r from-gray-900 via-[#7C5CFF] to-[#7C5CFF] h-3 rounded-full transition-all duration-500"
              style={{ width: `${Math.max(1, Math.min(100, Number(progressPct)))}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] font-mono text-gray-500">
            <span>Issued: {formatCredits(issuedUnits)}</span>
            <span>Cap: {formatCredits(capUnits)}</span>
          </div>
        </div>
      </div>

      {/* 4-Card Economy Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Mining Reward */}
        <div className="bg-white border border-gray-200 rounded-xl p-3.5 shadow-2xs space-y-1">
          <div className="flex items-center space-x-1.5 text-gray-500 text-[11px]">
            <Cpu className="w-3.5 h-3.5 text-gray-700" />
            <span>Block Reward</span>
          </div>
          <div className="text-base font-bold font-mono text-gray-900">
            {formatCredits(summary?.current_reward_units ?? 0)}
          </div>
          <div className="text-[10px] text-gray-400 font-mono">
            Halving at #{summary?.next_halving_height ?? 10000}
          </div>
        </div>

        {/* Burn Total */}
        <div className="bg-white border border-gray-200 rounded-xl p-3.5 shadow-2xs space-y-1">
          <div className="flex items-center space-x-1.5 text-rose-600 text-[11px]">
            <Flame className="w-3.5 h-3.5" />
            <span>Burned Total</span>
          </div>
          <div className="text-base font-bold font-mono text-gray-900">
            {formatCredits(summary?.burned_units ?? 0)}
          </div>
          <div className="text-[10px] text-gray-400 font-mono">Non-refundable burn</div>
        </div>

        {/* Escrow Locked */}
        <div className="bg-white border border-gray-200 rounded-xl p-3.5 shadow-2xs space-y-1">
          <div className="flex items-center space-x-1.5 text-[#7C5CFF] text-[11px]">
            <Lock className="w-3.5 h-3.5" />
            <span>Escrow Locked</span>
          </div>
          <div className="text-base font-bold font-mono text-gray-900">
            {formatCredits(summary?.escrow_locked_units ?? 0)}
          </div>
          <div className="text-[10px] text-gray-400 font-mono">Open bounties/quests</div>
        </div>

        {/* Treasury */}
        <div className="bg-white border border-gray-200 rounded-xl p-3.5 shadow-2xs space-y-1">
          <div className="flex items-center space-x-1.5 text-blue-600 text-[11px]">
            <Landmark className="w-3.5 h-3.5" />
            <span>Treasury Pool</span>
          </div>
          <div className="text-base font-bold font-mono text-gray-900">
            {formatCredits(summary?.treasury_balance_units ?? 0)}
          </div>
          <div className="text-[10px] text-gray-400 font-mono">System reserve</div>
        </div>
      </div>

      {/* Fed Assessment Card (Brief §5.4, §9) */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-2xs space-y-3" data-testid="fed-assessment-card">
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div className="flex items-center space-x-2">
            <Scale className="w-4 h-4 text-[#7C5CFF]" />
            <h3 className="text-sm font-bold text-gray-900">Federal Reserve Assessment</h3>
          </div>
          {assessment && (
            <span className="text-[10px] text-gray-400 font-mono">
              Evaluated at Block #{assessment.block_height}
            </span>
          )}
        </div>

        {assessment ? (
          <div className="space-y-3 text-xs">
            {/* Plain language policy assessment */}
            <div className="bg-gray-50 p-3 rounded-xl border border-gray-100 text-gray-700 leading-relaxed font-sans">
              <p className="font-semibold text-gray-900 mb-1 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[#7C5CFF]" />
                Automated Policy Health Summary
              </p>
              <p className="text-xs text-gray-600">
                {assessment.metrics.proposal?.rationale ||
                  `Ledger stability healthy at block height ${assessment.block_height}. Issued percentage is ${assessment.metrics.issued_pct}%.`}
              </p>
            </div>

            {/* Macro KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 font-mono text-[11px]">
              <div className="p-2 bg-gray-50/70 rounded-lg">
                <span className="text-gray-400 block text-[10px]">Tx Velocity</span>
                <span className="font-bold text-gray-900">{assessment.metrics.tx_velocity}</span>
              </div>
              <div className="p-2 bg-gray-50/70 rounded-lg">
                <span className="text-gray-400 block text-[10px]">Inflation Rate</span>
                <span className="font-bold text-gray-900">{assessment.metrics.inflation_per_period}%</span>
              </div>
              <div className="p-2 bg-gray-50/70 rounded-lg">
                <span className="text-gray-400 block text-[10px]">Top-3 Concentration</span>
                <span className="font-bold text-gray-900">
                  {assessment.metrics.balance_concentration?.top3_share_pct ?? 0}%
                </span>
              </div>
              <div className="p-2 bg-gray-50/70 rounded-lg">
                <span className="text-gray-400 block text-[10px]">Bounty Completion</span>
                <span className="font-bold text-gray-900">{assessment.metrics.bounty_completion_rate}%</span>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-gray-500 italic py-2">
            No Fed assessment triggered yet. Periodic evaluation runs every 100 blocks.
          </p>
        )}
      </div>

      {/* Pending Timelocked Policy Changes Card */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-2xs space-y-3" data-testid="pending-policy-card">
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div className="flex items-center space-x-2">
            <CalendarClock className="w-4 h-4 text-amber-600" />
            <h3 className="text-sm font-bold text-gray-900">Pending Timelocked Policy Changes</h3>
          </div>
          <span className="text-[10px] px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full font-mono border border-amber-200">
            {pendingPolicies.length} pending
          </span>
        </div>

        {pendingPolicies.length === 0 ? (
          <p className="text-xs text-gray-500 italic py-2">
            No pending policy changes. All Fed monetary parameters are currently at effective rates.
          </p>
        ) : (
          <div className="space-y-2">
            {pendingPolicies.map((p) => (
              <div
                key={p.id}
                className="p-3 bg-amber-50/40 border border-amber-200/80 rounded-xl space-y-1 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-gray-900">Policy Update: {p.id}</span>
                  <span className="text-[10px] text-amber-800 font-mono font-semibold">
                    Effective: {new Date(p.effective_at).toLocaleString()}
                  </span>
                </div>
                <pre className="text-[11px] font-mono text-gray-700 bg-white/70 p-2 rounded border border-amber-100 overflow-x-auto">
                  {JSON.stringify(p.params, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
