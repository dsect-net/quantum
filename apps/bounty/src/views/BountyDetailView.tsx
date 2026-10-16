import React, { useState, useEffect, useCallback } from 'react';
import { Bounty, BountyComment } from '../types.js';
import { api } from '../api/client.js';
import { useAccount } from '../context/AccountContext.js';
import { StatusChip } from '../components/StatusChip.js';
import { formatCredits } from '../utils/currency.js';
import {
  ArrowLeft,
  ExternalLink,
  Lock,
  MessageSquare,
  Send,
  AlertCircle,
  CheckCircle2,
  Clock,
  User,
  GitBranch,
} from 'lucide-react';

interface BountyDetailViewProps {
  bountyId: string;
  onBack: () => void;
  onBountyUpdated?: () => void;
}

export const BountyDetailView: React.FC<BountyDetailViewProps> = ({
  bountyId,
  onBack,
  onBountyUpdated,
}) => {
  const { currentAccount, refreshBalance } = useAccount();

  const [bounty, setBounty] = useState<Bounty | null>(null);
  const [comments, setComments] = useState<BountyComment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Submit modal state
  const [isSubmittingWork, setIsSubmittingWork] = useState(false);
  const [artifactUrl, setArtifactUrl] = useState('');
  const [submissionNotes, setSubmissionNotes] = useState('');

  // Comment input state
  const [commentText, setCommentText] = useState('');
  const [isPostingComment, setIsPostingComment] = useState(false);

  const fetchBounty = useCallback(async () => {
    try {
      setIsLoading(true);
      setErrorMessage(null);
      const res = await api.getBounty(bountyId);
      setBounty(res);
      setComments(res.comments || []);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load bounty');
    } finally {
      setIsLoading(false);
    }
  }, [bountyId]);

  useEffect(() => {
    fetchBounty();
  }, [fetchBounty]);

  const viewer = currentAccount?.id || '';
  const isPoster = bounty?.poster_account === viewer;
  const isClaimant = bounty?.claimant_account === viewer;

  // Actions
  const handleClaim = async () => {
    if (!currentAccount || !bounty) return;
    try {
      setErrorMessage(null);
      const updated = await api.claimBounty(bounty.id, currentAccount.id);
      setBounty(updated);
      setActionSuccess(`Bounty claimed by ${currentAccount.id}`);
      if (onBountyUpdated) onBountyUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to claim bounty');
    }
  };

  const handleCancel = async () => {
    if (!currentAccount || !bounty) return;
    try {
      setErrorMessage(null);
      const updated = await api.cancelBounty(bounty.id, currentAccount.id);
      setBounty(updated);
      await refreshBalance();
      setActionSuccess('Bounty cancelled and escrow refunded (minus burned fee)');
      if (onBountyUpdated) onBountyUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to cancel bounty');
    }
  };

  const handleSubmitWork = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentAccount || !bounty) return;
    try {
      setErrorMessage(null);
      const updated = await api.submitBounty(bounty.id, currentAccount.id, {
        linked_artifact: artifactUrl.trim() || undefined,
        notes: submissionNotes.trim() || undefined,
      });
      setBounty(updated);
      setIsSubmittingWork(false);
      setActionSuccess('Work submitted for verification and acceptance');
      if (onBountyUpdated) onBountyUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to submit work');
    }
  };

  const handleAccept = async () => {
    if (!currentAccount || !bounty) return;
    try {
      setErrorMessage(null);
      const updated = await api.acceptBounty(bounty.id, currentAccount.id);
      setBounty(updated);
      await refreshBalance();
      setActionSuccess('Bounty accepted! Escrow payment released to claimant.');
      if (onBountyUpdated) onBountyUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to accept bounty');
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentAccount || !bounty || !commentText.trim()) return;
    try {
      setIsPostingComment(true);
      const newComment = await api.addBountyComment(
        bounty.id,
        currentAccount.id,
        commentText.trim()
      );
      setComments((prev) => [...prev, newComment]);
      setCommentText('');
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to post comment');
    } finally {
      setIsPostingComment(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 text-center text-gray-400">
        <div className="w-8 h-8 border-2 border-gray-300 border-t-[#7C5CFF] rounded-full animate-spin mx-auto mb-2" />
        <span className="text-xs">Loading bounty details...</span>
      </div>
    );
  }

  if (!bounty) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-rose-600 mb-4">{errorMessage || 'Bounty not found'}</p>
        <button
          onClick={onBack}
          className="px-4 py-1.5 text-xs font-medium text-white bg-gray-900 rounded-lg cursor-pointer"
        >
          Return to Board
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl mx-auto" data-testid="bounty-detail-view">
      {/* Top back button */}
      <button
        onClick={onBack}
        className="inline-flex items-center space-x-1.5 text-xs font-medium text-gray-500 hover:text-gray-900 transition-colors cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to Board</span>
      </button>

      {/* Notifications */}
      {errorMessage && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start space-x-2 text-rose-700 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}
      {actionSuccess && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start space-x-2 text-emerald-800 text-xs">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* Header Card */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-2xs space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <StatusChip status={bounty.status} size="md" />
              <span className="text-xs text-gray-400 font-mono">id: {bounty.id}</span>
            </div>
            <h2 className="text-lg font-bold text-gray-900 leading-snug">{bounty.title}</h2>
          </div>
          <div className="text-right shrink-0">
            <span className="text-xl font-bold font-mono text-gray-900">
              {formatCredits(bounty.price_units)}
            </span>
            <p className="text-[10px] text-gray-400 font-mono">
              fee: {formatCredits(bounty.fee_units)}
            </p>
          </div>
        </div>

        {/* Metadata row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3 border-t border-gray-100 text-xs">
          <div>
            <span className="text-gray-400 text-[10px] block">Poster</span>
            <span className="font-semibold text-gray-800 flex items-center gap-1 font-mono">
              <User className="w-3 h-3 text-gray-400" />
              {bounty.poster_account}
            </span>
          </div>
          <div>
            <span className="text-gray-400 text-[10px] block">Claimant</span>
            <span className="font-semibold text-gray-800 font-mono">
              {bounty.claimant_account || '—'}
            </span>
          </div>
          <div>
            <span className="text-gray-400 text-[10px] block">Posted At</span>
            <span className="text-gray-600 font-mono text-[11px]">
              {new Date(bounty.created_at).toLocaleDateString()}
            </span>
          </div>
          <div>
            <span className="text-gray-400 text-[10px] block">Resolved</span>
            <span className="text-gray-600 font-mono text-[11px]">
              {bounty.resolved_at ? new Date(bounty.resolved_at).toLocaleDateString() : '—'}
            </span>
          </div>
        </div>

        {/* Description */}
        <div className="pt-3 border-t border-gray-100">
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
            Description
          </h4>
          <div className="text-xs text-gray-800 whitespace-pre-wrap leading-relaxed bg-gray-50/50 p-3.5 rounded-xl border border-gray-100 font-sans">
            {bounty.description_md}
          </div>
        </div>

        {/* Evidence Link & Artifact */}
        {(bounty.linked_artifact || bounty.linked_github_issue) && (
          <div className="pt-2 flex flex-wrap gap-2 text-xs">
            {bounty.linked_artifact && (
              <a
                href={bounty.linked_artifact}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center space-x-1 px-2.5 py-1.5 bg-purple-50 text-[#7C5CFF] border border-[#7C5CFF]/30 rounded-lg hover:bg-purple-100/50 transition-colors"
              >
                <GitBranch className="w-3.5 h-3.5" />
                <span>Verification Artifact</span>
                <ExternalLink className="w-3 h-3 ml-0.5" />
              </a>
            )}
            {bounty.linked_github_issue && (
              <a
                href={bounty.linked_github_issue}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center space-x-1 px-2.5 py-1.5 bg-gray-100 text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-200/60 transition-colors"
              >
                <span>GitHub Issue</span>
                <ExternalLink className="w-3 h-3 ml-0.5" />
              </a>
            )}
          </div>
        )}

        {/* Escrow State Card */}
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3.5 flex items-center justify-between text-xs font-mono">
          <div className="flex items-center space-x-2">
            <Lock className="w-4 h-4 text-[#7C5CFF]" />
            <div>
              <span className="font-semibold text-gray-900">
                {bounty.status === 'accepted' ? 'Escrow Released' : 'Locked in Escrow'}
              </span>
              <p className="text-[10px] text-gray-500 font-sans">
                {formatCredits(bounty.price_units)} reward held securely on ledger
              </p>
            </div>
          </div>
          {bounty.escrow_tx_id && (
            <span className="text-[10px] text-gray-400" title={bounty.escrow_tx_id}>
              tx: {bounty.escrow_tx_id.slice(0, 8)}...
            </span>
          )}
        </div>

        {/* Action Buttons depending on viewer and status */}
        <div className="pt-2 flex flex-wrap items-center justify-end gap-2" data-testid="bounty-actions">
          {/* Claim Action */}
          {bounty.status === 'open' && !isPoster && (
            <button
              onClick={handleClaim}
              className="px-4 py-2 text-xs font-semibold text-white bg-gray-900 hover:bg-black rounded-lg shadow-2xs transition-colors cursor-pointer"
              data-testid="claim-bounty-button"
            >
              Claim Bounty
            </button>
          )}

          {/* Cancel Action */}
          {bounty.status === 'open' && isPoster && (
            <button
              onClick={handleCancel}
              className="px-4 py-2 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors cursor-pointer"
              data-testid="cancel-bounty-button"
            >
              Cancel Bounty (Refund Escrow)
            </button>
          )}

          {/* Submit Action */}
          {bounty.status === 'claimed' && isClaimant && (
            <button
              onClick={() => setIsSubmittingWork(true)}
              className="px-4 py-2 text-xs font-semibold text-white bg-gray-900 hover:bg-black rounded-lg shadow-2xs transition-colors cursor-pointer"
              data-testid="open-submit-work-button"
            >
              Submit Completed Work
            </button>
          )}

          {/* Accept Action */}
          {bounty.status === 'submitted' && isPoster && (
            <button
              onClick={handleAccept}
              className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-2xs transition-colors cursor-pointer flex items-center gap-1.5"
              data-testid="accept-bounty-button"
            >
              <CheckCircle2 className="w-4 h-4" />
              Accept & Release Escrow
            </button>
          )}
        </div>
      </div>

      {/* Submission Form Modal/Section if claimant clicked Submit */}
      {isSubmittingWork && (
        <div className="bg-white border border-[#7C5CFF]/30 rounded-2xl p-5 shadow-sm space-y-3 animate-in fade-in duration-150">
          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
            <GitBranch className="w-4 h-4 text-[#7C5CFF]" />
            Submit Work for Acceptance
          </h3>
          <p className="text-xs text-gray-500">
            Provide a commit URL, PR, or artifact link as proof of work.
          </p>

          <form onSubmit={handleSubmitWork} className="space-y-3" data-testid="submit-work-form">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Linked Artifact / Commit URL
              </label>
              <input
                type="text"
                value={artifactUrl}
                onChange={(e) => setArtifactUrl(e.target.value)}
                placeholder="https://github.com/dsect-net/quantum/commit/..."
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-mono text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#7C5CFF]/30 focus:border-[#7C5CFF]"
                data-testid="artifact-url-input"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Completion Notes
              </label>
              <textarea
                value={submissionNotes}
                onChange={(e) => setSubmissionNotes(e.target.value)}
                placeholder="Summary of changes and test verification results..."
                rows={3}
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#7C5CFF]/30 focus:border-[#7C5CFF]"
                data-testid="submission-notes-input"
              />
            </div>

            <div className="flex justify-end space-x-2 pt-1">
              <button
                type="button"
                onClick={() => setIsSubmittingWork(false)}
                className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-semibold text-white bg-gray-900 hover:bg-black rounded-lg cursor-pointer shadow-2xs"
                data-testid="confirm-submit-work-button"
              >
                Submit Evidence
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Discussion / Comments Section */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-2xs space-y-4">
        <h3 className="text-sm font-semibold text-gray-900 flex items-center space-x-2">
          <MessageSquare className="w-4 h-4 text-gray-400" />
          <span>Discussion & Comments ({comments.length})</span>
        </h3>

        {/* Existing comments list */}
        {comments.length === 0 ? (
          <p className="text-xs text-gray-400 italic py-2">No comments yet. Start the discussion below.</p>
        ) : (
          <div className="space-y-3">
            {comments.map((comment) => (
              <div
                key={comment.id}
                className="p-3 bg-gray-50/70 border border-gray-100 rounded-xl space-y-1 text-xs"
              >
                <div className="flex items-center justify-between text-[11px] text-gray-500">
                  <span className="font-semibold text-gray-800 font-mono flex items-center gap-1">
                    <User className="w-3 h-3 text-gray-400" />
                    {comment.author}
                  </span>
                  <span className="text-gray-400 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(comment.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p className="text-gray-800 whitespace-pre-wrap">{comment.body_md}</p>
              </div>
            ))}
          </div>
        )}

        {/* Add comment input */}
        <form onSubmit={handleAddComment} className="pt-2 flex items-start space-x-2">
          <textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder={`Comment as ${viewer || 'viewer'}...`}
            rows={2}
            className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#7C5CFF]/30 focus:border-[#7C5CFF]"
            data-testid="bounty-comment-input"
          />
          <button
            type="submit"
            disabled={isPostingComment || !commentText.trim()}
            className="px-3.5 py-2 bg-gray-900 hover:bg-black disabled:bg-gray-200 text-white rounded-xl transition-colors cursor-pointer shrink-0"
            title="Post comment"
            data-testid="post-comment-button"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
