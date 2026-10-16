import React, { useState } from 'react';
import { useAccount } from '../context/AccountContext.js';
import { BankView } from '../types.js';
import {
  formatCredits,
  formatBankAccountId,
  formatBps,
} from '../utils/currency.js';
import {
  Wallet,
  PiggyBank,
  ArrowUpRight,
  PlusCircle,
  Copy,
  Check,
  Sparkles,
  Info,
  Clock,
  ArrowLeftRight,
  ReceiptText,
  Banknote,
  PieChart,
} from 'lucide-react';
import { CurrencyNotice } from '../components/CurrencyNotice.js';

interface AccountsViewProps {
  onNavigate: (view: BankView) => void;
}

export const AccountsView: React.FC<AccountsViewProps> = ({ onNavigate }) => {
  const {
    actingAccount,
    savingsAccount,
    checkingBalance,
    savingsBalance,
    netWorthUnits,
    policy,
    createSavingsAccount,
  } = useAccount();

  const [copiedAccount, setCopiedAccount] = useState<string | null>(null);
  const [isCreatingSavings, setIsCreatingSavings] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedAccount(id);
    setTimeout(() => setCopiedAccount(null), 2000);
  };

  const handleOpenSavings = async () => {
    try {
      setIsCreatingSavings(true);
      setCreateError(null);
      await createSavingsAccount();
    } catch (err: any) {
      setCreateError(err.message || 'Failed to create savings account');
    } finally {
      setIsCreatingSavings(false);
    }
  };

  const savingsRateBps = policy?.savings_rate_bps ?? 250; // default 2.50%

  return (
    <div data-testid="accounts-view" className="space-y-6">
      {/* Net Worth Hero Card */}
      <div
        data-testid="net-worth-card"
        className="bg-white border border-neutral-200/90 rounded-2xl p-6 shadow-2xs relative overflow-hidden"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                Total Net Worth
              </span>
              <span className="px-2 py-0.5 rounded-full bg-neutral-100 text-[10px] font-medium text-neutral-600">
                Combined Liquid
              </span>
            </div>
            <div
              data-testid="net-worth-amount"
              className="text-3xl sm:text-4xl font-bold tracking-tight text-neutral-900 mt-1 font-mono"
            >
              {formatCredits(netWorthUnits)}
            </div>
            <p className="text-xs text-neutral-500 mt-1">
              Primary account: <span className="font-medium text-neutral-700">{actingAccount?.display_name}</span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              data-testid="hero-move-money-button"
              type="button"
              onClick={() => onNavigate('move-money')}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-neutral-900 text-white rounded-xl text-xs font-medium hover:bg-neutral-800 transition-colors shadow-2xs cursor-pointer"
            >
              <ArrowLeftRight className="w-4 h-4" />
              <span>Move Money</span>
            </button>
            <button
              data-testid="hero-statements-button"
              type="button"
              onClick={() => onNavigate('activity')}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-neutral-200 text-neutral-700 rounded-xl text-xs font-medium hover:bg-neutral-50 transition-colors cursor-pointer"
            >
              <ReceiptText className="w-4 h-4 text-neutral-400" />
              <span>Statements</span>
            </button>
          </div>
        </div>

        {/* Quick account breakdown pills */}
        <div className="grid grid-cols-2 gap-3 mt-5 pt-4 border-t border-neutral-100">
          <div>
            <div className="text-[11px] text-neutral-400 font-medium">Checking Balance</div>
            <div
              data-testid="quick-checking-balance"
              className="text-sm font-semibold text-neutral-900 font-mono mt-0.5"
            >
              {formatCredits(checkingBalance?.balance_units || 0)}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-neutral-400 font-medium">Savings Balance</div>
            <div
              data-testid="quick-savings-balance"
              className="text-sm font-semibold text-neutral-900 font-mono mt-0.5"
            >
              {savingsAccount ? formatCredits(savingsBalance?.balance_units || 0) : 'None'}
            </div>
          </div>
        </div>
      </div>

      {/* Account Cards Section */}
      <div className="space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 px-1">
          Deposit Accounts
        </h3>

        {/* Checking Account Card */}
        <div
          data-testid="checking-account-card"
          className="bg-white border border-neutral-200 rounded-2xl p-5 hover:border-neutral-300 transition-all shadow-2xs"
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-neutral-100 flex items-center justify-center text-neutral-700">
                <Wallet className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="font-semibold text-sm text-neutral-900">Quantum Checking</h4>
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-neutral-100 text-neutral-700">
                    Primary
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span
                    data-testid="checking-account-number"
                    className="font-mono text-xs text-neutral-500"
                  >
                    {actingAccount ? formatBankAccountId(actingAccount.id, 'checking') : ''}
                  </span>
                  {actingAccount && (
                    <button
                      type="button"
                      onClick={() =>
                        handleCopy(
                          'checking',
                          formatBankAccountId(actingAccount.id, 'checking')
                        )
                      }
                      className="text-neutral-400 hover:text-neutral-600 transition-colors cursor-pointer"
                      title="Copy account number"
                    >
                      {copiedAccount === 'checking' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onNavigate('move-money')}
              className="p-2 text-neutral-400 hover:text-neutral-700 rounded-lg hover:bg-neutral-50 transition-colors cursor-pointer"
              title="Transfer from Checking"
            >
              <ArrowUpRight className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-5 pt-4 border-t border-neutral-100">
            <div>
              <span className="text-[11px] text-neutral-400 font-medium">Total Balance</span>
              <div
                data-testid="checking-balance-amount"
                className="text-lg font-bold text-neutral-900 font-mono mt-0.5"
              >
                {formatCredits(checkingBalance?.balance_units || 0)}
              </div>
            </div>

            <div>
              <span className="text-[11px] text-neutral-400 font-medium">Available to Spend</span>
              <div
                data-testid="checking-available-amount"
                className="text-lg font-bold text-emerald-600 font-mono mt-0.5"
              >
                {formatCredits(checkingBalance?.available_units || 0)}
              </div>
            </div>

            {/* Founder unvested balance indicator (A1) */}
            {(checkingBalance?.unvested_units || 0) > 0 && (
              <div className="col-span-2 sm:col-span-1">
                <span className="text-[11px] text-amber-600 font-medium flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Locked Vesting
                </span>
                <div
                  data-testid="checking-unvested-amount"
                  className="text-lg font-bold text-amber-700 font-mono mt-0.5"
                >
                  {formatCredits(checkingBalance?.unvested_units || 0)}
                </div>
              </div>
            )}
          </div>

          {(checkingBalance?.unvested_units || 0) > 0 && (
            <div className="mt-3 p-2.5 bg-amber-50/70 border border-amber-200/60 rounded-xl text-xs text-amber-800 flex items-start gap-2">
              <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="leading-relaxed">
                <strong>Founder Vesting Schedule (A1):</strong> Unvested allocation is
                locked by the ledger until block height maturation. Locked credits cannot be transferred or spent.
              </p>
            </div>
          )}
        </div>

        {/* Savings Account Card or Open Savings Flow */}
        {savingsAccount ? (
          <div
            data-testid="savings-account-card"
            className="bg-white border border-neutral-200 rounded-2xl p-5 hover:border-neutral-300 transition-all shadow-2xs"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-violet-50 text-violet-700 flex items-center justify-center">
                  <PiggyBank className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold text-sm text-neutral-900">Quantum Savings</h4>
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-violet-100 text-violet-800">
                      {formatBps(savingsRateBps)} APY
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span
                      data-testid="savings-account-number"
                      className="font-mono text-xs text-neutral-500"
                    >
                      {formatBankAccountId(savingsAccount.id, 'savings')}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        handleCopy(
                          'savings',
                          formatBankAccountId(savingsAccount.id, 'savings')
                        )
                      }
                      className="text-neutral-400 hover:text-neutral-600 transition-colors cursor-pointer"
                      title="Copy account number"
                    >
                      {copiedAccount === 'savings' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => onNavigate('move-money')}
                className="p-2 text-neutral-400 hover:text-neutral-700 rounded-lg hover:bg-neutral-50 transition-colors cursor-pointer"
                title="Transfer"
              >
                <ArrowUpRight className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-5 pt-4 border-t border-neutral-100">
              <div>
                <span className="text-[11px] text-neutral-400 font-medium">Savings Balance</span>
                <div
                  data-testid="savings-balance-amount"
                  className="text-lg font-bold text-neutral-900 font-mono mt-0.5"
                >
                  {formatCredits(savingsBalance?.balance_units || 0)}
                </div>
              </div>

              <div>
                <span className="text-[11px] text-neutral-400 font-medium">Interest Rate</span>
                <div
                  data-testid="savings-rate-display"
                  className="text-lg font-bold text-violet-700 font-mono mt-0.5 flex items-center gap-1.5"
                >
                  <Sparkles className="w-4 h-4 text-violet-500" />
                  <span>{formatBps(savingsRateBps)}</span>
                </div>
              </div>
            </div>

            <div className="mt-4 p-3 bg-neutral-50 border border-neutral-200/80 rounded-xl text-xs text-neutral-600 space-y-1">
              <div className="flex items-center gap-1.5 font-medium text-neutral-800">
                <Info className="w-3.5 h-3.5 text-neutral-500" />
                <span>Treasury-Funded Interest Policy (A4 §3)</span>
              </div>
              <p className="text-neutral-500 text-[11px] leading-relaxed">
                Savings interest is set by Fed policy within algorithmic bounds and funded exclusively
                from the Treasury allocation. Interest is never minted out of thin air and will pay zero
                if the Treasury allocation is depleted.
              </p>
            </div>
          </div>
        ) : (
          <div
            data-testid="create-savings-prompt-card"
            className="bg-linear-to-b from-violet-50/50 to-white border border-violet-200/80 rounded-2xl p-5 shadow-2xs"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-violet-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                  <PiggyBank className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold text-sm text-neutral-900">
                      Open a Quantum Savings Sub-Account
                    </h4>
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-violet-100 text-violet-800">
                      Earn {formatBps(savingsRateBps)} APY
                    </span>
                  </div>
                  <p className="text-xs text-neutral-600 max-w-lg leading-relaxed">
                    Earn rule-bound, Treasury-backed interest on your idle credits. Move funds seamlessly
                    between your checking and savings accounts at any time with zero fees.
                  </p>
                </div>
              </div>

              <button
                data-testid="create-savings-button"
                type="button"
                onClick={handleOpenSavings}
                disabled={isCreatingSavings}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 bg-neutral-900 text-white rounded-xl text-xs font-semibold hover:bg-neutral-800 transition-colors shadow-2xs cursor-pointer disabled:opacity-50 shrink-0"
              >
                <PlusCircle className="w-4 h-4 text-violet-400" />
                <span>{isCreatingSavings ? 'Opening...' : 'Open Savings Account'}</span>
              </button>
            </div>

            {createError && (
              <div className="mt-3 text-xs text-rose-600 font-medium">
                {createError}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Quick Navigation Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
        <button
          type="button"
          onClick={() => onNavigate('move-money')}
          className="p-4 bg-white border border-neutral-200 rounded-xl hover:border-neutral-300 hover:bg-neutral-50/50 transition-colors text-left cursor-pointer"
        >
          <ArrowLeftRight className="w-5 h-5 text-neutral-700 mb-2" />
          <div className="text-xs font-semibold text-neutral-900">Move Money</div>
          <p className="text-[11px] text-neutral-400 mt-0.5">Transfer between accounts</p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('activity')}
          className="p-4 bg-white border border-neutral-200 rounded-xl hover:border-neutral-300 hover:bg-neutral-50/50 transition-colors text-left cursor-pointer"
        >
          <ReceiptText className="w-5 h-5 text-neutral-700 mb-2" />
          <div className="text-xs font-semibold text-neutral-900">Activity</div>
          <p className="text-[11px] text-neutral-400 mt-0.5">History & statements</p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('income')}
          className="p-4 bg-white border border-neutral-200 rounded-xl hover:border-neutral-300 hover:bg-neutral-50/50 transition-colors text-left cursor-pointer"
        >
          <Banknote className="w-5 h-5 text-neutral-700 mb-2" />
          <div className="text-xs font-semibold text-neutral-900">Paychecks</div>
          <p className="text-[11px] text-neutral-400 mt-0.5">Salary & quest earnings</p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('economy')}
          className="p-4 bg-white border border-neutral-200 rounded-xl hover:border-neutral-300 hover:bg-neutral-50/50 transition-colors text-left cursor-pointer"
        >
          <PieChart className="w-5 h-5 text-neutral-700 mb-2" />
          <div className="text-xs font-semibold text-neutral-900">Economy</div>
          <p className="text-[11px] text-neutral-400 mt-0.5">Supply, cap & Fed policy</p>
        </button>
      </div>

      <CurrencyNotice />
    </div>
  );
};
