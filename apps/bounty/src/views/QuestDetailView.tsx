import React, { useState, useEffect, useCallback } from 'react';
import { QuestDetails } from '../types.js';
import { api } from '../api/client.js';
import { useAccount } from '../context/AccountContext.js';
import { StatusChip } from '../components/StatusChip.js';
import { formatCredits } from '../utils/currency.js';
import {
  ArrowLeft,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  FileText,
  Database,
  Brain,
  Award,
} from 'lucide-react';

interface QuestDetailViewProps {
  questId: string;
  onBack: () => void;
  onQuestUpdated?: () => void;
}

export const QuestDetailView: React.FC<QuestDetailViewProps> = ({
  questId,
  onBack,
  onQuestUpdated,
}) => {
  const { currentAccount, refreshBalance } = useAccount();

  const [details, setDetails] = useState<QuestDetails | null>(null);
  const [solutionText, setSolutionText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchQuestDetails = useCallback(async () => {
    try {
      setErrorMessage(null);
      const res = await api.getQuestDetails(questId);
      setDetails(res);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load quest details');
    }
  }, [questId]);

  useEffect(() => {
    fetchQuestDetails();
  }, [fetchQuestDetails]);

  if (!details) {
    return (
      <div className="py-12 text-center text-gray-400 text-xs">
        {errorMessage || 'Loading quest details...'}
      </div>
    );
  }

  const { quest, submissions, verifications, knowledgeRecord } = details;
  const latestSubmission = submissions[submissions.length - 1] || null;

  const handleSubmitSolution = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentAccount || !solutionText.trim()) return;

    try {
      setIsSubmitting(true);
      setErrorMessage(null);

      if (quest.status === 'failed') {
        // Revision
        await api.reviseQuest(quest.id, {
          submitter_account: currentAccount.id,
          body_md: solutionText.trim(),
        });
      } else {
        await api.submitQuest(quest.id, {
          submitter_account: currentAccount.id,
          body_md: solutionText.trim(),
        });
      }

      await fetchQuestDetails();
      setSuccessMessage('Solution submitted! Ready for AI verification pipeline.');
      if (onQuestUpdated) onQuestUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to submit quest work');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRunVerification = async () => {
    try {
      setIsVerifying(true);
      setErrorMessage(null);
      const result = await api.verifyQuest(quest.id);
      await fetchQuestDetails();
      await refreshBalance();
      if (result.quest.status === 'paid' || result.quest.status === 'passed') {
        setSuccessMessage(`AI Verification passed! Paid ${formatCredits(result.paid_units)} to submitter.`);
      } else {
        setErrorMessage('Verification failed: submission did not meet minimum rubric score or exceeded dedupe threshold.');
      }
      if (onQuestUpdated) onQuestUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to verify quest');
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="space-y-4 max-w-3xl mx-auto" data-testid="quest-detail-view">
      <button
        onClick={onBack}
        className="inline-flex items-center space-x-1.5 text-xs font-medium text-gray-500 hover:text-gray-900 transition-colors cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to Quests</span>
      </button>

      {errorMessage && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start space-x-2 text-rose-700 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}
      {successMessage && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start space-x-2 text-emerald-800 text-xs">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Quest Meta Card */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-2xs space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <StatusChip status={quest.status} size="md" />
              <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs font-mono uppercase">
                {quest.quest_type}
              </span>
              <span className="px-2 py-0.5 bg-purple-50 text-[#7C5CFF] rounded text-xs font-mono font-medium">
                {quest.tier}
              </span>
            </div>
            <h2 className="text-lg font-bold text-gray-900 leading-snug">{quest.title}</h2>
          </div>
          <div className="text-right shrink-0">
            <span className="text-xl font-bold font-mono text-[#7C5CFF]" data-testid="quest-payout-amount">
              {formatCredits(quest.payout_units)}
            </span>
            <p className="text-[10px] text-gray-400 font-mono">
              +10% quality bonus: {formatCredits(quest.bonus_pool_units)}
            </p>
          </div>
        </div>

        <div className="pt-3 border-t border-gray-100 text-xs flex justify-between text-gray-500 font-mono">
          <span>Funder: @{quest.funder_account}</span>
          <span>Created: {new Date(quest.created_at).toLocaleDateString()}</span>
        </div>

        {/* Prompt */}
        <div className="pt-2">
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 flex items-center gap-1 font-sans">
            <FileText className="w-3.5 h-3.5" />
            Knowledge Prompt
          </h4>
          <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-100 text-xs text-gray-800 whitespace-pre-wrap leading-relaxed font-sans">
            {quest.prompt_md}
          </div>
        </div>
      </div>

      {/* Submission Card / Form */}
      {quest.status === 'open' || quest.status === 'failed' ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-2xs space-y-3">
          <h3 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
            <Brain className="w-4 h-4 text-[#7C5CFF]" />
            {quest.status === 'failed' ? 'Revise Submission' : 'Contribute Knowledge'}
          </h3>
          <p className="text-xs text-gray-500">
            Explain in your own words. The 2-verifier AI pipeline evaluates accuracy, specificity, originality, usefulness, and semantic dedupe against existing knowledge.
          </p>

          <form onSubmit={handleSubmitSolution} className="space-y-3" data-testid="submit-quest-form">
            <textarea
              value={solutionText}
              onChange={(e) => setSolutionText(e.target.value)}
              placeholder="Enter comprehensive explanation, architecture details, or structured information..."
              rows={6}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#7C5CFF]/30 focus:border-[#7C5CFF]"
              data-testid="quest-solution-input"
              required
            />
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isSubmitting || !solutionText.trim()}
                className="px-4 py-2 text-xs font-semibold text-white bg-gray-900 hover:bg-black disabled:bg-gray-300 rounded-lg cursor-pointer shadow-2xs"
                data-testid="confirm-submit-quest-button"
              >
                {isSubmitting ? 'Submitting...' : 'Submit Knowledge Contribution'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {/* In-progress Submission with AI Verifier Action */}
      {latestSubmission && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
              <FileText className="w-4 h-4 text-gray-700" />
              Latest Submission (by @{latestSubmission.submitter_account})
            </h3>
            <span className="text-[10px] text-gray-400 font-mono">
              hash: {latestSubmission.content_hash.slice(0, 12)}...
            </span>
          </div>

          <div className="p-3.5 bg-gray-50/70 border border-gray-100 rounded-xl text-xs text-gray-800 whitespace-pre-wrap leading-relaxed font-sans">
            {latestSubmission.body_md}
          </div>

          {quest.status === 'submitted' && (
            <div className="pt-2 flex justify-end">
              <button
                onClick={handleRunVerification}
                disabled={isVerifying}
                className="px-4 py-2 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 rounded-lg shadow-2xs flex items-center gap-1.5 cursor-pointer transition-colors"
                data-testid="run-ai-verification-button"
              >
                <Sparkles className="w-4 h-4" />
                {isVerifying ? 'Evaluating Rubric & Dedupe...' : 'Run 2-Verifier AI Evaluation'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* AI Verifier Outcomes & Rubric Scores (Amendment A3) */}
      {verifications.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-2xs space-y-4" data-testid="verification-results-card">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3">
            <h3 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
              <Award className="w-4 h-4 text-[#7C5CFF]" />
              AI Verifier Pipeline Feedback ({verifications.length} Verifiers)
            </h3>
            <span className="text-xs font-mono font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
              Quorum Verified
            </span>
          </div>

          <div className="space-y-3">
            {verifications.map((v) => (
              <div
                key={v.id}
                className="p-3.5 bg-gray-50/80 rounded-xl border border-gray-200 space-y-2 text-xs font-mono"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-gray-900">Verifier: {v.verifier_id}</span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      v.verdict === 'pass' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                    }`}
                  >
                    {v.verdict}
                  </span>
                </div>

                {/* Rubric Score Breakdown */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1">
                  <div className="p-2 bg-white rounded border border-gray-200">
                    <span className="text-[10px] text-gray-400 block font-sans">Accuracy</span>
                    <span className="font-bold text-gray-900">{v.rubric.accuracy} / 25</span>
                  </div>
                  <div className="p-2 bg-white rounded border border-gray-200">
                    <span className="text-[10px] text-gray-400 block font-sans">Specificity</span>
                    <span className="font-bold text-gray-900">{v.rubric.specificity} / 25</span>
                  </div>
                  <div className="p-2 bg-white rounded border border-gray-200">
                    <span className="text-[10px] text-gray-400 block font-sans">Originality</span>
                    <span className="font-bold text-gray-900">{v.rubric.originality} / 25</span>
                  </div>
                  <div className="p-2 bg-white rounded border border-gray-200">
                    <span className="text-[10px] text-gray-400 block font-sans">Usefulness</span>
                    <span className="font-bold text-gray-900">{v.rubric.usefulness} / 25</span>
                  </div>
                  <div className="col-span-2 sm:col-span-1 p-2 bg-purple-50 rounded border border-[#7C5CFF]/30">
                    <span className="text-[10px] text-[#7C5CFF] block font-sans font-semibold">Total Score</span>
                    <span className="font-bold text-[#7C5CFF]" data-testid="rubric-total-score">{v.rubric.total} / 100</span>
                  </div>
                </div>

                {/* Dedupe Score */}
                <div className="flex items-center justify-between text-[11px] text-gray-600 pt-1 font-sans">
                  <span>Semantic Dedupe Similarity:</span>
                  <span className="font-mono font-semibold text-gray-900">
                    {(v.dedupe_similarity * 100).toFixed(1)}% match
                  </span>
                </div>

                {/* Feedback */}
                <p className="text-[11px] text-gray-600 font-sans italic pt-1 border-t border-gray-200/60">
                  "{v.feedback_md}"
                </p>
              </div>
            ))}
          </div>

          {/* Knowledge Record on Ledger */}
          {knowledgeRecord && (
            <div className="p-3 bg-purple-50/50 border border-[#7C5CFF]/30 rounded-xl text-xs space-y-1">
              <span className="font-semibold text-gray-900 flex items-center gap-1 font-mono">
                <Database className="w-3.5 h-3.5 text-[#7C5CFF]" />
                Committed to Fleet Knowledge Store: {knowledgeRecord.id}
              </span>
              <p className="text-[11px] text-gray-500 font-mono">
                payout: {formatCredits(knowledgeRecord.paid_units)} released to @{knowledgeRecord.submitter}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
