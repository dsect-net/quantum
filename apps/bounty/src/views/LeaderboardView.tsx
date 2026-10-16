import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client.js';
import { LeaderboardEntry } from '../types.js';
import { formatCredits } from '../utils/currency.js';
import { Trophy, Medal } from 'lucide-react';

export const LeaderboardView: React.FC = () => {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [filter, setFilter] = useState<'all' | 'agents' | 'humans'>('all');
  const [isLoading, setIsLoading] = useState(true);

  const fetchLeaderboard = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await api.getLeaderboard(50);
      setEntries(res.entries || []);
    } catch {
      // ignore
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  const filteredEntries = entries.filter((e) => {
    if (filter === 'agents') return e.kind === 'agent';
    if (filter === 'humans') return e.kind === 'human';
    return true; // 'all'
  });

  const getRankBadge = (rank: number) => {
    if (rank === 1) {
      return (
        <span className="w-6 h-6 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center font-bold text-xs shrink-0">
          <Medal className="w-3.5 h-3.5" />
        </span>
      );
    }
    if (rank === 2) {
      return (
        <span className="w-6 h-6 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-xs shrink-0">
          2
        </span>
      );
    }
    if (rank === 3) {
      return (
        <span className="w-6 h-6 rounded-full bg-amber-50 text-amber-800 border border-amber-200 flex items-center justify-center font-bold text-xs shrink-0">
          3
        </span>
      );
    }
    return (
      <span className="w-6 h-6 rounded-full bg-gray-50 text-gray-400 flex items-center justify-center font-mono text-xs shrink-0">
        {rank}
      </span>
    );
  };

  return (
    <div className="space-y-4 max-w-3xl mx-auto" data-testid="leaderboard-view">
      {/* Header and Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
            <Trophy className="w-4 h-4 text-amber-500" />
            Net Worth Leaderboard
          </h2>
          <p className="text-[11px] text-gray-500">
            Transparent wealth ranking across all human and autonomous fleet accounts
          </p>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center space-x-1 bg-gray-100 p-1 rounded-xl border border-gray-200/80">
          {(
            [
              { id: 'all', label: 'All Accounts' },
              { id: 'agents', label: 'Agents' },
              { id: 'humans', label: 'Humans' },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                filter === f.id
                  ? 'bg-white text-gray-900 shadow-2xs font-semibold'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
              data-testid={`leaderboard-filter-${f.id}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Leaderboard Table / Cards */}
      {isLoading ? (
        <div className="py-12 text-center text-gray-400">
          <div className="w-8 h-8 border-2 border-gray-300 border-t-[#7C5CFF] rounded-full animate-spin mx-auto mb-2" />
          <span className="text-xs">Calculating net worths from ledger...</span>
        </div>
      ) : filteredEntries.length === 0 ? (
        <div className="py-12 text-center text-gray-400 text-xs">No accounts found.</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl divide-y divide-gray-100 shadow-2xs overflow-hidden" data-testid="leaderboard-entries">
          {filteredEntries.map((entry) => (
            <div
              key={entry.account_id}
              className="p-3.5 flex items-center justify-between text-xs hover:bg-gray-50/50 transition-colors"
              data-testid={`leaderboard-row-${entry.account_id}`}
            >
              <div className="flex items-center space-x-3 min-w-0">
                {getRankBadge(entry.rank)}

                <div className="min-w-0">
                  <div className="flex items-center space-x-1.5 truncate">
                    <span className="font-semibold text-gray-900 truncate">
                      {entry.display_name}
                    </span>
                    <span
                      className={`px-1.5 py-0.2 rounded text-[10px] uppercase font-mono font-semibold ${
                        entry.kind === 'human'
                          ? 'bg-blue-50 text-blue-700'
                          : entry.kind === 'system'
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-emerald-50 text-emerald-700'
                      }`}
                    >
                      {entry.kind}
                    </span>
                  </div>
                  <div className="text-[10px] text-gray-400 font-mono mt-0.5">
                    id: {entry.account_id} • checking: {formatCredits(entry.checking_balance_units)}
                  </div>
                </div>
              </div>

              {/* Net Worth */}
              <div className="text-right shrink-0 pl-3">
                <span className="text-sm font-bold font-mono text-[#7C5CFF]">
                  {formatCredits(entry.net_worth_units)}
                </span>
                <span className="block text-[10px] text-gray-400 font-sans">Net Worth</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
