import React, { useState } from 'react';
import { useAccount } from '../context/AccountContext.js';
import { api } from '../api/client.js';
import {
  formatCredits,
  creditsToUnits,
  unitsToCredits,
  formatBankAccountId,
} from '../utils/currency.js';
import { validateTransfer } from '../utils/validation.js';
import { BankView } from '../types.js';
import {
  ArrowLeftRight,
  ArrowRight,
  Send,
  CheckCircle2,
  AlertCircle,
  Wallet,
  PiggyBank,
  Info,
  CalendarClock,
} from 'lucide-react';
import { Modal } from '../components/Modal.js';

type TransferMode = 'own' | 'third_party';

interface MoveMoneyViewProps {
  onNavigate?: (view: BankView) => void;
}

export const MoveMoneyView: React.FC<MoveMoneyViewProps> = ({ onNavigate }) => {
  const {
    allAccounts,
    actingAccount,
    savingsAccount,
    checkingBalance,
    savingsBalance,
    refreshAll,
  } = useAccount();

  const [mode, setMode] = useState<TransferMode>('own');
  const [ownDirection, setOwnDirection] = useState<'to_savings' | 'to_checking'>('to_savings');
  const [recipientId, setRecipientId] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [memoInput, setMemoInput] = useState('');
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successTxId, setSuccessTxId] = useState<string | null>(null);

  if (!actingAccount) {
    return <div className="p-8 text-center text-xs text-neutral-400">Loading account...</div>;
  }

  // Determine source and destination accounts
  let fromAccount = actingAccount.id;
  let toAccount = '';
  let availableUnits = checkingBalance?.available_units || 0;

  if (mode === 'own') {
    if (ownDirection === 'to_savings') {
      fromAccount = actingAccount.id;
      toAccount = savingsAccount ? savingsAccount.id : `${actingAccount.id}:savings`;
      availableUnits = checkingBalance?.available_units || 0;
    } else {
      fromAccount = savingsAccount ? savingsAccount.id : `${actingAccount.id}:savings`;
      toAccount = actingAccount.id;
      availableUnits = savingsBalance?.available_units || 0;
    }
  } else {
    fromAccount = actingAccount.id;
    toAccount = recipientId.trim();
    availableUnits = checkingBalance?.available_units || 0;
  }

  const amountUnits = creditsToUnits(amountInput);

  // Eligible third party accounts (excluding self)
  const thirdPartyRecipients = allAccounts.filter(
    (a) => a.id !== actingAccount.id && !a.id.endsWith(':savings') && a.kind !== 'system'
  );

  const handleReview = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessTxId(null);

    const validation = validateTransfer({
      from_account: fromAccount,
      to_account: toAccount,
      amount_units: amountUnits,
      available_units: availableUnits,
    });

    if (!validation.isValid) {
      setErrorMsg(validation.error || 'Invalid transfer parameters');
      return;
    }

    setIsConfirmOpen(true);
  };

  const handleConfirmTransfer = async () => {
    try {
      setIsSubmitting(true);
      setErrorMsg(null);

      const tx = await api.postTransfer({
        from_account: fromAccount,
        to_account: toAccount,
        amount_units: amountUnits,
        memo: memoInput.trim() || undefined,
      });

      setSuccessTxId(tx.id);
      setIsConfirmOpen(false);
      setAmountInput('');
      setMemoInput('');
      await refreshAll();
    } catch (err: any) {
      setErrorMsg(err.message || 'Transfer failed');
      setIsConfirmOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div data-testid="move-money-view" className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h2 className="text-lg font-bold text-neutral-900 tracking-tight">Move Money</h2>
        <p className="text-xs text-neutral-500 mt-0.5">
          Transfer credits between your own accounts or send to other participants
        </p>
      </div>

      {/* Mode Selector Tabs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 p-1 bg-neutral-100 rounded-xl">
        <button
          type="button"
          data-testid="mode-own-button"
          onClick={() => {
            setMode('own');
            setErrorMsg(null);
            setSuccessTxId(null);
          }}
          className={`flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
            mode === 'own'
              ? 'bg-white text-neutral-900 shadow-2xs font-semibold'
              : 'text-neutral-500 hover:text-neutral-700'
          }`}
        >
          <ArrowLeftRight className="w-3.5 h-3.5" />
          <span>Between My Accounts</span>
        </button>

        <button
          type="button"
          data-testid="mode-third-party-button"
          onClick={() => {
            setMode('third_party');
            setErrorMsg(null);
            setSuccessTxId(null);
          }}
          className={`flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
            mode === 'third_party'
              ? 'bg-white text-neutral-900 shadow-2xs font-semibold'
              : 'text-neutral-500 hover:text-neutral-700'
          }`}
        >
          <Send className="w-3.5 h-3.5" />
          <span>To Another Account</span>
        </button>

        {onNavigate && (
          <button
            type="button"
            data-testid="mode-scheduled-button"
            onClick={() => onNavigate('scheduled')}
            className="flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium text-neutral-500 hover:text-neutral-700 transition-colors cursor-pointer col-span-2 sm:col-span-1"
          >
            <CalendarClock className="w-3.5 h-3.5 text-violet-600" />
            <span>Scheduled Orders</span>
          </button>
        )}
      </div>

      {/* Success Notification */}
      {successTxId && (
        <div
          data-testid="transfer-success-banner"
          className="p-4 bg-emerald-50 border border-emerald-200/80 rounded-2xl flex items-start gap-3 animate-in fade-in"
        >
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="text-xs font-semibold text-emerald-900">Transfer Completed Successfully</h4>
            <p className="text-xs text-emerald-700 leading-relaxed">
              Atomic transaction appended to the ledger mempool. Transaction ID:
            </p>
            <div className="font-mono text-[11px] bg-emerald-100/70 px-2 py-1 rounded text-emerald-900 select-all break-all">
              {successTxId}
            </div>
          </div>
        </div>
      )}

      {/* Error Notification */}
      {errorMsg && (
        <div
          data-testid="transfer-error-banner"
          className="p-4 bg-rose-50 border border-rose-200/80 rounded-2xl flex items-start gap-3 animate-in fade-in"
        >
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <h4 className="text-xs font-semibold text-rose-900">Transfer Not Allowed</h4>
            <p className="text-xs text-rose-700 leading-relaxed">{errorMsg}</p>
          </div>
        </div>
      )}

      {/* Main Transfer Form Card */}
      <form
        onSubmit={handleReview}
        data-testid="move-money-form"
        className="bg-white border border-neutral-200/90 rounded-2xl p-6 shadow-2xs space-y-5"
      >
        {mode === 'own' ? (
          /* Transfer Between Own Accounts */
          <div className="space-y-4">
            {!savingsAccount && (
              <div className="p-3.5 bg-amber-50/70 border border-amber-200/60 rounded-xl text-xs text-amber-800 flex items-start gap-2">
                <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p>
                  You do not have a Savings sub-account yet. Please open a Savings account from the
                  Accounts tab first before moving money internally.
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                data-testid="direction-checking-to-savings"
                onClick={() => setOwnDirection('to_savings')}
                className={`p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                  ownDirection === 'to_savings'
                    ? 'border-neutral-900 bg-neutral-50 ring-1 ring-neutral-900'
                    : 'border-neutral-200 hover:border-neutral-300'
                }`}
              >
                <div className="text-[11px] text-neutral-400 font-medium">Checking → Savings</div>
                <div className="text-xs font-semibold text-neutral-900 mt-0.5">Deposit to Savings</div>
              </button>

              <button
                type="button"
                data-testid="direction-savings-to-checking"
                onClick={() => setOwnDirection('to_checking')}
                disabled={!savingsAccount}
                className={`p-3 rounded-xl border text-left transition-colors cursor-pointer disabled:opacity-40 ${
                  ownDirection === 'to_checking'
                    ? 'border-neutral-900 bg-neutral-50 ring-1 ring-neutral-900'
                    : 'border-neutral-200 hover:border-neutral-300'
                }`}
              >
                <div className="text-[11px] text-neutral-400 font-medium">Savings → Checking</div>
                <div className="text-xs font-semibold text-neutral-900 mt-0.5">Withdraw to Checking</div>
              </button>
            </div>

            {/* Source & Destination Flow Visualizer */}
            <div className="p-3.5 bg-neutral-50 rounded-xl border border-neutral-200/60 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                {ownDirection === 'to_savings' ? (
                  <Wallet className="w-4 h-4 text-neutral-500" />
                ) : (
                  <PiggyBank className="w-4 h-4 text-violet-600" />
                )}
                <div>
                  <span className="text-[10px] text-neutral-400 block">From</span>
                  <span className="font-medium text-neutral-800">
                    {ownDirection === 'to_savings' ? 'Quantum Checking' : 'Quantum Savings'}
                  </span>
                </div>
              </div>

              <ArrowRight className="w-4 h-4 text-neutral-400" />

              <div className="flex items-center gap-2 text-right">
                <div>
                  <span className="text-[10px] text-neutral-400 block">To</span>
                  <span className="font-medium text-neutral-800">
                    {ownDirection === 'to_savings' ? 'Quantum Savings' : 'Quantum Checking'}
                  </span>
                </div>
                {ownDirection === 'to_savings' ? (
                  <PiggyBank className="w-4 h-4 text-violet-600" />
                ) : (
                  <Wallet className="w-4 h-4 text-neutral-500" />
                )}
              </div>
            </div>
          </div>
        ) : (
          /* Transfer to Another Account */
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1.5">
                Recipient Account
              </label>
              <select
                data-testid="recipient-select"
                value={recipientId}
                onChange={(e) => setRecipientId(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl text-xs text-neutral-900 focus:outline-none focus:ring-1 focus:ring-violet-500 focus:bg-white cursor-pointer"
              >
                <option value="">Select recipient...</option>
                {thirdPartyRecipients.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.display_name} ({formatBankAccountId(a.id)})
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Amount Input */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-neutral-700">Amount to Transfer</label>
            <div className="text-xs text-neutral-400">
              Available:{' '}
              <span data-testid="transfer-available-balance" className="font-mono text-neutral-700 font-medium">
                {formatCredits(availableUnits)}
              </span>
            </div>
          </div>

          <div className="relative">
            <input
              data-testid="transfer-amount-input"
              type="text"
              inputMode="decimal"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              placeholder="0.00"
              className="w-full pl-3.5 pr-16 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl text-sm font-mono text-neutral-900 focus:outline-none focus:ring-1 focus:ring-violet-500 focus:bg-white"
            />
            <button
              type="button"
              data-testid="transfer-max-button"
              onClick={() => setAmountInput(unitsToCredits(availableUnits))}
              className="absolute right-2.5 top-2 text-[10px] font-semibold uppercase px-2 py-1 rounded bg-neutral-200 text-neutral-700 hover:bg-neutral-300 transition-colors cursor-pointer"
            >
              MAX
            </button>
          </div>

          {amountUnits > 0 && (
            <p data-testid="amount-integer-preview" className="text-[11px] text-neutral-400 font-mono mt-1">
              Exact ledger amount: {amountUnits.toLocaleString()} integer units (1 QC = 100 units)
            </p>
          )}
        </div>

        {/* Memo Input */}
        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1.5">
            Memo / Reference (Optional)
          </label>
          <input
            data-testid="transfer-memo-input"
            type="text"
            value={memoInput}
            onChange={(e) => setMemoInput(e.target.value)}
            placeholder="e.g. Server maintenance bounty / savings allocation"
            className="w-full px-3.5 py-2 bg-neutral-50 border border-neutral-200 rounded-xl text-xs text-neutral-900 focus:outline-none focus:ring-1 focus:ring-violet-500 focus:bg-white"
          />
        </div>

        {/* Submit Review Button */}
        <button
          data-testid="review-transfer-button"
          type="submit"
          disabled={amountUnits <= 0 || (mode === 'own' && !savingsAccount) || (mode === 'third_party' && !recipientId)}
          className="w-full py-3 bg-neutral-900 text-white rounded-xl text-xs font-semibold hover:bg-neutral-800 transition-colors shadow-2xs cursor-pointer disabled:opacity-40"
        >
          Review & Confirm Transfer
        </button>
      </form>

      {/* Confirmation Modal */}
      <Modal
        isOpen={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        title="Confirm Transfer"
        subtitle="Please verify the transfer details before signing to ledger."
      >
        <div data-testid="transfer-confirmation-modal" className="space-y-4">
          <div className="p-4 bg-neutral-50 rounded-xl border border-neutral-200/80 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-neutral-500">From Account</span>
              <span className="font-mono font-medium text-neutral-900">
                {formatBankAccountId(fromAccount)}
              </span>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-neutral-500">To Account</span>
              <span className="font-mono font-medium text-neutral-900">
                {formatBankAccountId(toAccount)}
              </span>
            </div>

            <div className="border-t border-neutral-200/60 pt-2 flex items-center justify-between text-xs">
              <span className="text-neutral-500">Amount (Credits)</span>
              <span data-testid="confirm-amount-credits" className="font-mono font-bold text-neutral-900">
                {formatCredits(amountUnits)}
              </span>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-neutral-500">Amount (Integer Units)</span>
              <span data-testid="confirm-amount-units" className="font-mono text-neutral-700">
                {amountUnits.toLocaleString()} units
              </span>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-neutral-500">Protocol Fee</span>
              <span className="font-mono text-emerald-600 font-medium">0.00 QC</span>
            </div>

            {memoInput.trim() && (
              <div className="border-t border-neutral-200/60 pt-2 text-xs">
                <span className="text-neutral-500 block">Memo</span>
                <span className="text-neutral-800 italic mt-0.5 block">{memoInput.trim()}</span>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setIsConfirmOpen(false)}
              className="flex-1 py-2.5 bg-white border border-neutral-200 rounded-xl text-xs font-medium text-neutral-700 hover:bg-neutral-50 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              data-testid="confirm-transfer-button"
              type="button"
              onClick={handleConfirmTransfer}
              disabled={isSubmitting}
              className="flex-1 py-2.5 bg-neutral-900 text-white rounded-xl text-xs font-semibold hover:bg-neutral-800 transition-colors shadow-2xs cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? 'Signing Transfer...' : 'Confirm Transfer'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Scheduled & Recurring Payments Live Feature Card */}
      <div
        data-testid="scheduled-payments-feature-card"
        className="p-4 bg-white border border-neutral-200/90 rounded-2xl text-xs text-neutral-600 shadow-2xs space-y-2"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold text-neutral-900">
            <CalendarClock className="w-4 h-4 text-violet-600" />
            <span>Scheduled & Recurring Standing Orders</span>
          </div>
          {onNavigate && (
            <button
              type="button"
              data-testid="open-scheduled-payments-button"
              onClick={() => onNavigate('scheduled')}
              className="flex items-center gap-1 text-xs font-semibold text-violet-700 hover:text-violet-900 cursor-pointer"
            >
              <span>Manage Schedules</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <p className="text-neutral-500 text-[11px] leading-relaxed">
          Set up one-off future transfers or recurring standing orders. Schedules execute as signed ledger transfers during block seals with automatic skip protection if balance is insufficient.
        </p>
      </div>
    </div>
  );
};
