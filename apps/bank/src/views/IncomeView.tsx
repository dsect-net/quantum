import React, { useState, useEffect } from 'react';
import { useAccount } from '../context/AccountContext.js';
import { Transaction, AccountQuestEarnings } from '../types.js';
import { api } from '../api/client.js';
import { formatCredits } from '../utils/currency.js';
import {
  Banknote,
  GraduationCap,
  Hammer,
  PiggyBank,
  Sparkles,
  Info,
  Calendar,
  CheckCircle,
} from 'lucide-react';
import { EmptyState } from '../components/EmptyState.js';

export const IncomeView: React.FC = () => {
  const { actingAccount, savingsAccount } = useAccount();

  const [history, setHistory] = useState<Transaction[]>([]);
  const [questEarnings, setQuestEarnings] = useState<AccountQuestEarnings | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!actingAccount) return;

    const loadIncome = async () => {
      try {
        setIsLoading(true);
        const [accountHistory, qEarnings] = await Promise.all([
          api.getAccountHistory(actingAccount.id, 100, 0),
          api.getAccountQuestEarnings(actingAccount.id).catch(() => null),
        ]);

        // If savings account exists, also fetch savings history for interest
        let fullHistory = accountHistory;
        if (savingsAccount) {
          try {
            const savingsHistory = await api.getAccountHistory(savingsAccount.id, 50, 0);
            fullHistory = [...accountHistory, ...savingsHistory];
          } catch {
            // ignore
          }
        }

        setHistory(fullHistory);
        setQuestEarnings(qEarnings);
      } catch {
        // ignore
      } finally {
        setIsLoading(false);
      }
    };

    loadIncome();
  }, [actingAccount, savingsAccount]);

  // Income categorizations
  const paycheckTxs = history.filter(
    (tx) => tx.type === 'paycheck' && tx.to_account === actingAccount?.id
  );

  const interestTxs = history.filter(
    (tx) =>
      tx.type === 'interest' &&
      (tx.to_account === actingAccount?.id || tx.to_account === savingsAccount?.id)
  );

  const miningTxs = history.filter(
    (tx) =>
      (tx.type === 'mint_reward' || tx.type === 'work_credit') &&
      tx.to_account === actingAccount?.id
  );

  const bountyTxs = history.filter(
    (tx) =>
      tx.type === 'escrow_release' &&
      tx.to_account === actingAccount?.id &&
      (!tx.memo || !tx.memo.toLowerCase().includes('quest'))
  );

  // Totals in units
  const totalPaychecksUnits = paycheckTxs.reduce((sum, tx) => sum + tx.amount_units, 0);
  const totalQuestsUnits = questEarnings?.total_earned_units || 0;
  const totalInterestUnits = interestTxs.reduce((sum, tx) => sum + tx.amount_units, 0);
  const totalMiningUnits = miningTxs.reduce((sum, tx) => sum + tx.amount_units, 0);
  const totalBountiesUnits = bountyTxs.reduce((sum, tx) => sum + tx.amount_units, 0);

  const totalAllIncomeUnits =
    totalPaychecksUnits +
    totalQuestsUnits +
    totalInterestUnits +
    totalMiningUnits +
    totalBountiesUnits;

  return (
    <div data-testid="income-view" className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-neutral-900 tracking-tight">Paychecks & Income</h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            Auditable breakdown of protocol salary, quest contributions, bounties, and yields
          </p>
        </div>
        {isLoading && (
          <span className="text-xs text-neutral-400 font-mono">Syncing...</span>
        )}
      </div>

      {/* Hero Income Metrics */}
      <div
        data-testid="income-summary-card"
        className="bg-white border border-neutral-200/90 rounded-2xl p-6 shadow-2xs"
      >
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
              Total Inbound Earnings
            </span>
            <div
              data-testid="total-income-amount"
              className="text-3xl font-bold tracking-tight text-neutral-900 font-mono mt-1"
            >
              {formatCredits(totalAllIncomeUnits)}
            </div>
            <p className="text-xs text-neutral-500 mt-0.5">
              Cumulative lifetime earnings landed in checking & savings
            </p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-neutral-100 flex items-center justify-center text-neutral-800">
            <Banknote className="w-6 h-6" />
          </div>
        </div>

        {/* Breakdown Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-5 border-t border-neutral-100">
          <div>
            <div className="text-[11px] text-neutral-400 font-medium flex items-center gap-1">
              <Banknote className="w-3 h-3 text-neutral-500" /> Founder Salary (A1)
            </div>
            <div
              data-testid="kpi-founder-salary"
              className="text-sm font-bold text-neutral-900 font-mono mt-0.5"
            >
              {formatCredits(totalPaychecksUnits)}
            </div>
          </div>

          <div>
            <div className="text-[11px] text-neutral-400 font-medium flex items-center gap-1">
              <GraduationCap className="w-3 h-3 text-violet-600" /> Quest Earnings (A3)
            </div>
            <div
              data-testid="kpi-quest-earnings"
              className="text-sm font-bold text-neutral-900 font-mono mt-0.5"
            >
              {formatCredits(totalQuestsUnits)}
            </div>
          </div>

          <div>
            <div className="text-[11px] text-neutral-400 font-medium flex items-center gap-1">
              <Hammer className="w-3 h-3 text-neutral-500" /> Mining & PoUW (A2)
            </div>
            <div
              data-testid="kpi-mining-earnings"
              className="text-sm font-bold text-neutral-900 font-mono mt-0.5"
            >
              {formatCredits(totalMiningUnits + totalBountiesUnits)}
            </div>
          </div>

          <div>
            <div className="text-[11px] text-neutral-400 font-medium flex items-center gap-1">
              <PiggyBank className="w-3 h-3 text-violet-600" /> Savings Yield (A4)
            </div>
            <div
              data-testid="kpi-interest-earnings"
              className="text-sm font-bold text-neutral-900 font-mono mt-0.5"
            >
              {formatCredits(totalInterestUnits)}
            </div>
          </div>
        </div>
      </div>

      {/* Founder Paycheck Section (Amendment A1) */}
      <div
        data-testid="paychecks-section"
        className="bg-white border border-neutral-200/90 rounded-2xl p-5 shadow-2xs space-y-4"
      >
        <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-neutral-100 text-neutral-800 rounded-lg">
              <Banknote className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-neutral-900">
                Founder Paychecks (Amendment A1)
              </h3>
              <p className="text-[11px] text-neutral-400">
                Rule-bound protocol salary paid from Treasury per epoch
              </p>
            </div>
          </div>
          <span className="text-xs font-mono font-semibold text-neutral-900">
            {paycheckTxs.length} paid
          </span>
        </div>

        {actingAccount?.id !== 'scotty' ? (
          <EmptyState
            icon={Info}
            title="Non-Founder Account"
            description="Founder salary is rule-bound protocol income paid exclusively to the project founder (Scotty) from Treasury per Amendment A1. This account does not receive founder paychecks."
          />
        ) : paycheckTxs.length === 0 ? (
          <EmptyState
            icon={Calendar}
            title="No Paychecks Issued Yet"
            description="Paychecks are distributed automatically by the Fed from Treasury at regular epoch intervals. If Treasury is short, paychecks are paused."
          />
        ) : (
          <div className="space-y-2">
            {paycheckTxs.map((tx) => (
              <div
                key={tx.id}
                data-testid={`paycheck-row-${tx.id}`}
                className="p-3 bg-neutral-50 rounded-xl border border-neutral-200/60 flex items-center justify-between text-xs"
              >
                <div>
                  <div className="font-semibold text-neutral-900">{tx.memo || 'Founder Paycheck'}</div>
                  <div className="text-[11px] text-neutral-400 font-mono">
                    Block {tx.block_height ?? 'Mempool'} • {new Date(tx.created_at).toLocaleDateString()}
                  </div>
                </div>
                <div className="font-mono font-bold text-emerald-600">
                  +{formatCredits(tx.amount_units)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quest Earnings Section (Amendment A3) */}
      <div
        data-testid="quests-earnings-section"
        className="bg-white border border-neutral-200/90 rounded-2xl p-5 shadow-2xs space-y-4"
      >
        <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-violet-50 text-violet-700 rounded-lg">
              <GraduationCap className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-neutral-900">
                Verified Quest Earnings (Amendment A3)
              </h3>
              <p className="text-[11px] text-neutral-400">
                Treasury rewards earned for verified knowledge contributions
              </p>
            </div>
          </div>
          <span className="text-xs font-mono font-semibold text-neutral-900">
            {questEarnings?.completed_quests_count || 0} completed
          </span>
        </div>

        {!questEarnings || questEarnings.records.length === 0 ? (
          <EmptyState
            icon={GraduationCap}
            title="No Completed Quests"
            description="Complete AI-verified human knowledge quests in the Quantum Bounty Board & Quests app to earn Treasury-funded credits."
          />
        ) : (
          <div className="space-y-2">
            {questEarnings.records.map((rec) => (
              <div
                key={rec.id}
                data-testid={`quest-record-${rec.id}`}
                className="p-3 bg-neutral-50 rounded-xl border border-neutral-200/60 flex items-center justify-between text-xs"
              >
                <div className="space-y-0.5">
                  <div className="font-semibold text-neutral-900 flex items-center gap-1.5">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Knowledge Contribution #{rec.quest_id.slice(0, 8)}</span>
                  </div>
                  <div className="text-[11px] text-neutral-400 line-clamp-1 italic">
                    "{rec.body.slice(0, 60)}..."
                  </div>
                </div>
                <div className="font-mono font-bold text-emerald-600">
                  +{formatCredits(rec.paid_units)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Savings Interest Section (Amendment A4) */}
      <div
        data-testid="interest-earnings-section"
        className="bg-white border border-neutral-200/90 rounded-2xl p-5 shadow-2xs space-y-4"
      >
        <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-violet-50 text-violet-700 rounded-lg">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-neutral-900">
                Treasury Savings Interest (Amendment A4 §3)
              </h3>
              <p className="text-[11px] text-neutral-400">
                Epoch interest paid from Treasury allocation to savings accounts
              </p>
            </div>
          </div>
          <span className="text-xs font-mono font-semibold text-neutral-900">
            {interestTxs.length} distributions
          </span>
        </div>

        {interestTxs.length === 0 ? (
          <EmptyState
            icon={PiggyBank}
            title="No Interest Distributions Yet"
            description="Interest on savings accounts is calculated and distributed each epoch. Interest requires that the Treasury interest reserve maintains sufficient funds."
          />
        ) : (
          <div className="space-y-2">
            {interestTxs.map((tx) => (
              <div
                key={tx.id}
                data-testid={`interest-row-${tx.id}`}
                className="p-3 bg-neutral-50 rounded-xl border border-neutral-200/60 flex items-center justify-between text-xs"
              >
                <div>
                  <div className="font-semibold text-neutral-900">{tx.memo || 'Savings Interest'}</div>
                  <div className="text-[11px] text-neutral-400 font-mono">
                    {new Date(tx.created_at).toLocaleDateString()}
                  </div>
                </div>
                <div className="font-mono font-bold text-emerald-600">
                  +{formatCredits(tx.amount_units)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
