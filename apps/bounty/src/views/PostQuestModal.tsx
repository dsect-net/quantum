import React, { useState } from 'react';
import { Modal } from '../components/Modal.js';
import { useAccount } from '../context/AccountContext.js';
import { api } from '../api/client.js';
import { Quest, QuestType, QuestTier } from '../types.js';
import { creditsToUnits, formatCredits } from '../utils/currency.js';
import { calculateQuestEscrowPreview } from '../utils/escrow.js';
import { AlertCircle, Lock, CheckCircle2 } from 'lucide-react';

interface PostQuestModalProps {
  isOpen: boolean;
  onClose: () => void;
  onQuestPosted: (quest: Quest) => void;
}

export const PostQuestModal: React.FC<PostQuestModalProps> = ({
  isOpen,
  onClose,
  onQuestPosted,
}) => {
  const { currentAccount, balance, refreshBalance } = useAccount();

  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [questType, setQuestType] = useState<QuestType>('explain');
  const [tier, setTier] = useState<QuestTier>('standard');
  const [payoutInput, setPayoutInput] = useState('50.00');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const payoutUnits = creditsToUnits(payoutInput);
  const availableUnits = balance?.available_units ?? 0;
  const preview = calculateQuestEscrowPreview(payoutUnits, availableUnits, 10);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentAccount) {
      setErrorMessage('No active account selected');
      return;
    }
    if (!title.trim()) {
      setErrorMessage('Quest title is required');
      return;
    }
    if (!prompt.trim()) {
      setErrorMessage('Quest prompt is required');
      return;
    }
    if (payoutUnits <= 0) {
      setErrorMessage('Payout must be greater than 0 credits');
      return;
    }
    if (!preview.isSufficient) {
      setErrorMessage(
        `Insufficient balance: required ${formatCredits(preview.totalEscrowUnits)} (${formatCredits(payoutUnits)} payout + 10% bonus pool), available ${formatCredits(availableUnits)}`
      );
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMessage(null);

      const posted = await api.postQuest({
        funder_account: currentAccount.id,
        title: title.trim(),
        prompt_md: prompt.trim(),
        quest_type: questType,
        tier,
        payout_units: payoutUnits,
      });

      await refreshBalance();
      onQuestPosted(posted);
      onClose();

      setTitle('');
      setPrompt('');
      setPayoutInput('50.00');
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to post quest');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Commission a Knowledge Quest"
      subtitle="Escrow locks payout + 10% quality bonus pool (Amendment A3)"
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4" data-testid="post-quest-form">
        {errorMessage && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start space-x-2 text-rose-700 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">
            Quest Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Document Quantum Virtual Machine dispatch pipeline"
            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#7C5CFF]/30 focus:border-[#7C5CFF]"
            data-testid="quest-title-input"
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Quest Type
            </label>
            <select
              value={questType}
              onChange={(e) => setQuestType(e.target.value as QuestType)}
              className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#7C5CFF]/30"
              data-testid="quest-type-select"
            >
              <option value="explain">Explain (Teach a concept)</option>
              <option value="write">Write (Original piece)</option>
              <option value="dataset">Dataset (Structured info)</option>
              <option value="label">Label (Review/correct AI output)</option>
              <option value="qa">QA (Direct domain Q&A)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Tier
            </label>
            <select
              value={tier}
              onChange={(e) => setTier(e.target.value as QuestTier)}
              className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#7C5CFF]/30"
              data-testid="quest-tier-select"
            >
              <option value="quick">Quick (Short answer)</option>
              <option value="standard">Standard (Comprehensive)</option>
              <option value="deep">Deep (Detailed dataset)</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">
            Knowledge Prompt & Requirements
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe what knowledge the fleet lacks and what a human or expert should provide..."
            rows={4}
            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#7C5CFF]/30 focus:border-[#7C5CFF]"
            data-testid="quest-prompt-input"
            required
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">
            Posted Payout (Credits)
          </label>
          <div className="relative">
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={payoutInput}
              onChange={(e) => setPayoutInput(e.target.value)}
              placeholder="50.00"
              className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs text-gray-900 font-mono focus:outline-none focus:ring-2 focus:ring-[#7C5CFF]/30 focus:border-[#7C5CFF]"
              data-testid="quest-payout-input"
              required
            />
            <span className="absolute right-3 top-2 text-xs font-mono text-gray-400">QC</span>
          </div>
        </div>

        {/* Escrow lock summary card */}
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2 text-xs font-mono">
          <div className="flex items-center justify-between pb-1.5 border-b border-gray-200/80 font-sans font-semibold text-gray-800">
            <span className="flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-[#7C5CFF]" />
              Quest Escrow Preview
            </span>
            <span className="text-[10px] text-gray-400 font-mono">10% bonus pool</span>
          </div>

          <div className="space-y-1 text-[11px] text-gray-600">
            <div className="flex justify-between">
              <span>Base Payout:</span>
              <span>{formatCredits(preview.payoutUnits)}</span>
            </div>
            <div className="flex justify-between">
              <span>Quality Bonus Pool (10%):</span>
              <span>{formatCredits(preview.bonusPoolUnits)}</span>
            </div>
            <div className="pt-1 border-t border-gray-200 flex justify-between font-semibold text-gray-900 text-xs">
              <span>Total Escrow Required:</span>
              <span className="text-[#7C5CFF]">{formatCredits(preview.totalEscrowUnits)}</span>
            </div>
          </div>

          <div className="pt-1 flex items-center justify-between text-[11px] font-sans">
            <span className="text-gray-500">
              Available: <strong className="font-mono text-gray-700">{formatCredits(availableUnits)}</strong>
            </span>
            {preview.isSufficient ? (
              <span className="text-emerald-700 font-medium flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Sufficient
              </span>
            ) : (
              <span className="text-rose-600 font-medium flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" /> Short by {formatCredits(preview.shortfallUnits)}
              </span>
            )}
          </div>
        </div>

        <div className="pt-2 flex items-center justify-end space-x-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100 rounded-lg cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting || !preview.isSufficient || payoutUnits <= 0}
            className="px-4 py-2 text-xs font-semibold text-white bg-gray-900 hover:bg-black disabled:bg-gray-300 rounded-lg cursor-pointer shadow-2xs"
            data-testid="confirm-post-quest-button"
          >
            {isSubmitting ? 'Posting...' : 'Lock Escrow & Commission'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
