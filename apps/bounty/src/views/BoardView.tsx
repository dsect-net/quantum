import React, { useState, useEffect, useCallback } from 'react';
import { Bounty } from '../types.js';
import { api } from '../api/client.js';
import { useAccount } from '../context/AccountContext.js';
import { StatusChip } from '../components/StatusChip.js';
import { EmptyState } from '../components/EmptyState.js';
import { PostBountyModal } from './PostBountyModal.js';
import { formatCredits } from '../utils/currency.js';
import {
  Plus,
  Briefcase,
  User,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';

type FilterType = 'open' | 'mine' | 'claimed' | 'all';

interface BoardViewProps {
  onSelectBounty: (id: string) => void;
}

export const BoardView: React.FC<BoardViewProps> = ({ onSelectBounty }) => {
  const { currentAccount } = useAccount();

  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [filter, setFilter] = useState<FilterType>('open');
  const [isLoading, setIsLoading] = useState(true);
  const [isPostModalOpen, setIsPostModalOpen] = useState(false);

  const fetchBounties = useCallback(async () => {
    try {
      setIsLoading(true);
      const list = await api.listBounties();
      setBounties(list);
    } catch {
      // Error handling
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBounties();
  }, [fetchBounties]);

  const currentUserId = currentAccount?.id || '';

  const filteredBounties = bounties.filter((b) => {
    if (filter === 'open') return b.status === 'open';
    if (filter === 'mine') return b.poster_account === currentUserId;
    if (filter === 'claimed') return b.claimant_account === currentUserId;
    return true; // 'all'
  });

  return (
    <div className="space-y-4 max-w-4xl mx-auto" data-testid="board-view">
      {/* Top action bar: Filters + Post Bounty Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Filter Pills */}
        <div className="flex items-center space-x-1 bg-gray-100 p-1 rounded-xl border border-gray-200/80 overflow-x-auto">
          {(
            [
              { id: 'open', label: 'Open' },
              { id: 'mine', label: 'Mine' },
              { id: 'claimed', label: 'Claimed by me' },
              { id: 'all', label: 'All' },
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
              data-testid={`bounty-filter-${f.id}`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Post a Bounty Button */}
        <button
          onClick={() => setIsPostModalOpen(true)}
          className="flex items-center justify-center space-x-1.5 px-4 py-2 bg-gray-900 hover:bg-black text-white text-xs font-semibold rounded-xl shadow-2xs transition-colors cursor-pointer"
          data-testid="open-post-bounty-button"
        >
          <Plus className="w-4 h-4" />
          <span>Post a Bounty</span>
        </button>
      </div>

      {/* Loading state */}
      {isLoading ? (
        <div className="py-12 text-center text-gray-400">
          <div className="w-8 h-8 border-2 border-gray-300 border-t-[#7C5CFF] rounded-full animate-spin mx-auto mb-2" />
          <span className="text-xs">Loading bounties from ledger...</span>
        </div>
      ) : filteredBounties.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title={
            filter === 'mine'
              ? 'No Bounties Posted'
              : filter === 'claimed'
              ? 'No Claimed Bounties'
              : 'No Open Bounties'
          }
          description={
            filter === 'mine'
              ? 'You have not posted any bounties yet. Create one with escrow funding.'
              : filter === 'claimed'
              ? 'You have not claimed any work. Browse open bounties to earn credits.'
              : 'There are currently no bounties matching this filter. Post the first one!'
          }
          actionText="Post a Bounty"
          onAction={() => setIsPostModalOpen(true)}
        />
      ) : (
        /* Bounty Cards Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3" data-testid="bounty-card-list">
          {filteredBounties.map((b) => (
            <div
              key={b.id}
              onClick={() => onSelectBounty(b.id)}
              className="group bg-white hover:bg-gray-50/70 border border-gray-200 hover:border-gray-300 rounded-2xl p-4 shadow-2xs transition-all cursor-pointer flex flex-col justify-between space-y-3"
              data-testid={`bounty-card-${b.id}`}
            >
              <div>
                {/* Header: Status Chip + Price */}
                <div className="flex items-center justify-between mb-2">
                  <StatusChip status={b.status} />
                  <span className="text-sm font-bold font-mono text-gray-900 group-hover:text-[#7C5CFF] transition-colors">
                    {formatCredits(b.price_units)}
                  </span>
                </div>

                {/* Title */}
                <h3 className="text-sm font-semibold text-gray-900 leading-snug line-clamp-2">
                  {b.title}
                </h3>

                {/* Description snippet */}
                <p className="text-xs text-gray-500 mt-1 line-clamp-2 leading-relaxed">
                  {b.description_md}
                </p>
              </div>

              {/* Footer: Poster + Claimant info */}
              <div className="pt-2 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-500">
                <div className="flex items-center space-x-1.5 font-mono">
                  <User className="w-3 h-3 text-gray-400" />
                  <span>{b.poster_account}</span>
                  {b.poster_account === 'treasury' && (
                    <span title="Treasury Seed">
                      <ShieldCheck className="w-3 h-3 text-[#7C5CFF]" />
                    </span>
                  )}
                </div>

                <div className="flex items-center space-x-1 text-gray-400 group-hover:text-gray-900 transition-colors">
                  <span>View</span>
                  <ArrowRight className="w-3 h-3 transition-transform group-hover:translate-x-0.5" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Post Bounty Modal Sheet */}
      <PostBountyModal
        isOpen={isPostModalOpen}
        onClose={() => setIsPostModalOpen(false)}
        onBountyPosted={(newBounty) => {
          setBounties((prev) => [newBounty, ...prev]);
          onSelectBounty(newBounty.id);
        }}
      />
    </div>
  );
};
