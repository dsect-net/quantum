import React, { useState, useEffect } from 'react';
import { Modal } from '../components/Modal.js';
import { useAccount } from '../context/AccountContext.js';
import { api } from '../api/client.js';
import { Bounty } from '../types.js';
import { creditsToUnits, formatCredits } from '../utils/currency.js';
import { calculateBountyEscrowPreview } from '../utils/escrow.js';
import { AlertCircle, Lock, CheckCircle2 } from 'lucide-react';

interface PostBountyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onBountyPosted: (bounty: Bounty) => void;
}

export const PostBountyModal: React.FC<PostBountyModalProps> = ({
  isOpen,
  onClose,
  onBountyPosted,
}) => {
  const { currentAccount, balance, refreshBalance } = useAccount();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priceInput, setPriceInput] = useState('20.00');
  const [feeBps, setFeeBps] = useState(200); // 2.0% default genesis
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Fetch live fee policy when opening modal
  useEffect(() => {
    if (isOpen) {
      api
        .getEffectivePolicy()
        .then((policy) => {
          if (typeof policy.bounty_posting_fee_bps === 'number') {
            setFeeBps(policy.bounty_posting_fee_bps);
          }
        })
        .catch(() => {
          // fallback to 200 bps
        });
    }
  }, [isOpen]);

  const priceUnits = creditsToUnits(priceInput);
  const availableUnits = balance?.available_units ?? 0;
  const posterId = currentAccount?.id ?? '';

  const preview = calculateBountyEscrowPreview(
    priceUnits,
    availableUnits,
    feeBps,
    posterId
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentAccount) {
      setErrorMessage('No active account selected');
      return;
    }
    if (!title.trim()) {
      setErrorMessage('Bounty title is required');
      return;
    }
    if (!description.trim()) {
      setErrorMessage('Bounty description is required');
      return;
    }
    if (priceUnits <= 0) {
      setErrorMessage('Bounty price must be greater than 0 credits');
      return;
    }
    if (!preview.isSufficient) {
      setErrorMessage(`Insufficient balance: you need ${formatCredits(preview.totalEscrowUnits)} but only have ${formatCredits(availableUnits)}`);
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMessage(null);

      const posted = await api.postBounty({
        poster_account: currentAccount.id,
        title: title.trim(),
        description_md: description.trim(),
        price_units: priceUnits,
      });

      await refreshBalance();
      onBountyPosted(posted);
      onClose();

      // Reset form
      setTitle('');
      setDescription('');
      setPriceInput('20.00');
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to post bounty');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Post a New Bounty"
      subtitle="Escrow locks price + protocol fee on confirmation"
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4" data-testid="post-bounty-form">
        {errorMessage && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start space-x-2 text-rose-700 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Title */}
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">
            Bounty Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Implement agent telemetry exporter"
            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#7C5CFF]/30 focus:border-[#7C5CFF]"
            data-testid="bounty-title-input"
            required
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">
            Description & Acceptance Criteria
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the problem, requirements, and expected verification proof..."
            rows={4}
            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#7C5CFF]/30 focus:border-[#7C5CFF]"
            data-testid="bounty-description-input"
            required
          />
        </div>

        {/* Price in Credits */}
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">
            Bounty Reward (Credits)
          </label>
          <div className="relative">
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              placeholder="20.00"
              className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs text-gray-900 font-mono focus:outline-none focus:ring-2 focus:ring-[#7C5CFF]/30 focus:border-[#7C5CFF]"
              data-testid="bounty-price-input"
              required
            />
            <span className="absolute right-3 top-2 text-xs font-mono text-gray-400">
              QC
            </span>
          </div>
        </div>

        {/* Live Escrow & Fee Breakdown Card */}
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3.5 space-y-2.5 text-xs" data-testid="escrow-preview-card">
          <div className="flex items-center justify-between pb-2 border-b border-gray-200/80">
            <span className="font-semibold text-gray-800 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-[#7C5CFF]" />
              Escrow & Fee Preview
            </span>
            <span className="text-[10px] text-gray-500 font-mono">
              Live Policy: {(feeBps / 100).toFixed(1)}% fee
            </span>
          </div>

          <div className="space-y-1.5 font-mono text-[11px]">
            <div className="flex justify-between text-gray-600">
              <span>Bounty Payout:</span>
              <span>{formatCredits(preview.priceUnits)}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>Protocol Fee ({(feeBps / 100).toFixed(1)}%):</span>
              <span>{formatCredits(preview.feeUnits)}</span>
            </div>
            <div className="pl-2 border-l border-gray-200 text-[10px] text-gray-400 space-y-0.5">
              <div className="flex justify-between">
                <span>└ Burn (40%):</span>
                <span>{formatCredits(preview.burnUnits)}</span>
              </div>
              <div className="flex justify-between">
                <span>└ Treasury (40%):</span>
                <span>{formatCredits(preview.treasuryUnits)}</span>
              </div>
              <div className="flex justify-between">
                <span>└ Founder royalty (20%):</span>
                <span>{formatCredits(preview.founderUnits)}</span>
              </div>
            </div>
            <div className="pt-2 border-t border-gray-200 flex justify-between font-semibold text-gray-900 text-xs">
              <span>Total Escrow Required:</span>
              <span className="text-[#7C5CFF]">{formatCredits(preview.totalEscrowUnits)}</span>
            </div>
          </div>

          {/* Balance comparison indicator */}
          <div className="pt-1 flex items-center justify-between text-[11px]">
            <span className="text-gray-500">
              Available balance: <strong className="font-mono text-gray-700">{formatCredits(availableUnits)}</strong>
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

        {/* Buttons */}
        <div className="pt-2 flex items-center justify-end space-x-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting || !preview.isSufficient || priceUnits <= 0}
            className="px-4 py-2 text-xs font-semibold text-white bg-gray-900 hover:bg-black disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg shadow-2xs transition-colors cursor-pointer"
            data-testid="confirm-post-bounty-button"
          >
            {isSubmitting ? 'Posting...' : 'Lock Escrow & Post'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
