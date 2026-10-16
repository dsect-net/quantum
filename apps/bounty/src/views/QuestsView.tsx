import React, { useState, useEffect, useCallback } from 'react';
import { Quest, AccountQuestEarnings } from '../types.js';
import { api } from '../api/client.js';
import { useAccount } from '../context/AccountContext.js';
import { StatusChip } from '../components/StatusChip.js';
import { EmptyState } from '../components/EmptyState.js';
import { PostQuestModal } from './PostQuestModal.js';
import { formatCredits } from '../utils/currency.js';
import {
  Compass,
  Plus,
  ArrowRight,
  Database,
  Award,
} from 'lucide-react';

interface QuestsViewProps {
  onSelectQuest: (id: string) => void;
}

export const QuestsView: React.FC<QuestsViewProps> = ({ onSelectQuest }) => {
  const { currentAccount } = useAccount();

  const [quests, setQuests] = useState<Quest[]>([]);
  const [earnings, setEarnings] = useState<AccountQuestEarnings | null>(null);
  const [filter, setFilter] = useState<'available' | 'all' | 'earnings'>('available');
  const [isLoading, setIsLoading] = useState(true);
  const [isPostModalOpen, setIsPostModalOpen] = useState(false);

  const fetchQuests = useCallback(async () => {
    try {
      setIsLoading(true);
      const list = await api.listQuests();
      setQuests(list);

      if (currentAccount) {
        try {
          const earn = await api.getAccountQuestEarnings(currentAccount.id);
          setEarnings(earn);
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    } finally {
      setIsLoading(false);
    }
  }, [currentAccount]);

  useEffect(() => {
    fetchQuests();
  }, [fetchQuests]);

  const filteredQuests = quests.filter((q) => {
    if (filter === 'available') return q.status === 'open' || q.status === 'submitted';
    return true; // 'all'
  });

  return (
    <div className="space-y-4 max-w-4xl mx-auto" data-testid="quests-view">
      {/* Top action bar: Filters + Post Quest Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-1 bg-gray-100 p-1 rounded-xl border border-gray-200/80">
          {(
            [
              { id: 'available', label: 'Available Quests' },
              { id: 'all', label: 'All Quests' },
              { id: 'earnings', label: 'My Quest Earnings' },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${
                filter === f.id
                  ? 'bg-white text-gray-900 shadow-2xs font-semibold'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
              data-testid={`quest-filter-${f.id}`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <button
          onClick={() => setIsPostModalOpen(true)}
          className="flex items-center justify-center space-x-1.5 px-4 py-2 bg-gray-900 hover:bg-black text-white text-xs font-semibold rounded-xl shadow-2xs transition-colors cursor-pointer"
          data-testid="open-post-quest-button"
        >
          <Plus className="w-4 h-4" />
          <span>Commission a Quest</span>
        </button>
      </div>

      {/* Main Content */}
      {isLoading ? (
        <div className="py-12 text-center text-gray-400">
          <div className="w-8 h-8 border-2 border-gray-300 border-t-[#7C5CFF] rounded-full animate-spin mx-auto mb-2" />
          <span className="text-xs">Loading fleet knowledge quests...</span>
        </div>
      ) : filter === 'earnings' ? (
        /* Earnings Tab */
        <div className="space-y-4" data-testid="quest-earnings-panel">
          <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-2xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center text-[#7C5CFF]">
                  <Award className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900">Knowledge Contributions & Earnings</h3>
                  <p className="text-[10px] text-gray-400 font-mono">
                    Tacit human and expert knowledge converted into structured assets (A3)
                  </p>
                </div>
              </div>
              <span className="text-lg font-bold font-mono text-[#7C5CFF]" data-testid="quest-total-earnings">
                {formatCredits(earnings?.total_earned_units ?? 0)}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-3 border-t border-gray-100 font-mono text-xs">
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                <span className="text-[10px] text-gray-400 block font-sans">Completed Quests</span>
                <span className="text-base font-bold text-gray-900">
                  {earnings?.completed_quests_count ?? 0}
                </span>
              </div>
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                <span className="text-[10px] text-gray-400 block font-sans">Knowledge Records</span>
                <span className="text-base font-bold text-gray-900">
                  {earnings?.records?.length ?? 0}
                </span>
              </div>
            </div>
          </div>

          {/* Knowledge Records on Ledger */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
              Permanent Knowledge Assets Created
            </h4>
            {!earnings?.records || earnings.records.length === 0 ? (
              <EmptyState
                icon={Database}
                title="No Knowledge Records Yet"
                description="Complete quests and pass the 2-verifier AI quorum to record knowledge onto the ledger."
              />
            ) : (
              earnings.records.map((rec) => (
                <div
                  key={rec.id}
                  className="bg-white border border-gray-200 rounded-xl p-4 shadow-2xs space-y-1.5 text-xs font-mono"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-gray-900">{rec.id}</span>
                    <span className="font-bold text-emerald-600">
                      +{formatCredits(rec.paid_units)}
                    </span>
                  </div>
                  <p className="text-gray-600 font-sans line-clamp-2">{rec.body}</p>
                  <div className="text-[10px] text-gray-400 flex items-center justify-between pt-1 border-t border-gray-100">
                    <span>hash: {rec.content_hash.slice(0, 16)}...</span>
                    <span>{new Date(rec.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : filteredQuests.length === 0 ? (
        <EmptyState
          icon={Compass}
          title="No Available Quests"
          description="There are currently no active quests. Commission a new knowledge quest above."
          actionText="Commission a Quest"
          onAction={() => setIsPostModalOpen(true)}
        />
      ) : (
        /* Quests Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3" data-testid="quests-list">
          {filteredQuests.map((q) => (
            <div
              key={q.id}
              onClick={() => onSelectQuest(q.id)}
              className="group bg-white hover:bg-gray-50/70 border border-gray-200 hover:border-gray-300 rounded-2xl p-4 shadow-2xs transition-all cursor-pointer flex flex-col justify-between space-y-3"
              data-testid={`quest-card-${q.id}`}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-1.5">
                    <StatusChip status={q.status} />
                    <span className="px-1.5 py-0.2 bg-gray-100 text-gray-600 rounded text-[10px] font-mono uppercase">
                      {q.quest_type}
                    </span>
                  </div>
                  <span className="text-sm font-bold font-mono text-[#7C5CFF]">
                    {formatCredits(q.payout_units)}
                  </span>
                </div>

                <h3 className="text-sm font-semibold text-gray-900 leading-snug line-clamp-2">
                  {q.title}
                </h3>

                <p className="text-xs text-gray-500 mt-1 line-clamp-2 leading-relaxed">
                  {q.prompt_md}
                </p>
              </div>

              <div className="pt-2 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-500 font-mono">
                <span>funder: @{q.funder_account}</span>
                <div className="flex items-center space-x-1 text-gray-400 group-hover:text-gray-900 transition-colors">
                  <span>View</span>
                  <ArrowRight className="w-3 h-3 transition-transform group-hover:translate-x-0.5" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Post Quest Modal */}
      <PostQuestModal
        isOpen={isPostModalOpen}
        onClose={() => setIsPostModalOpen(false)}
        onQuestPosted={(newQuest) => {
          setQuests((prev) => [newQuest, ...prev]);
          onSelectQuest(newQuest.id);
        }}
      />
    </div>
  );
};
