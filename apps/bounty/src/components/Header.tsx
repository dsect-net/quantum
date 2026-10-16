import React from 'react';
import { AccountSwitcher } from './AccountSwitcher.js';
import { DesktopNavigation, TabType } from './Navigation.js';
import { RefreshCw, Sparkles } from 'lucide-react';
import { useAccount } from '../context/AccountContext.js';

interface HeaderProps {
  activeTab: TabType;
  onSelectTab: (tab: TabType) => void;
  onRefreshAll?: () => void;
  isRefreshing?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onSelectTab,
  onRefreshAll,
  isRefreshing = false,
}) => {
  const { refreshBalance } = useAccount();

  const handleRefresh = async () => {
    refreshBalance();
    if (onRefreshAll) onRefreshAll();
  };

  return (
    <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-gray-200 px-4 py-2.5 transition-shadow">
      <div className="max-w-4xl mx-auto flex items-center justify-between">
        {/* Brand and Badge */}
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-lg bg-gray-900 flex items-center justify-center text-white font-bold text-sm tracking-tight shadow-2xs">
            <span className="text-[#7C5CFF]">Q</span>B
          </div>
          <div>
            <div className="flex items-center space-x-1.5">
              <h1 className="text-sm font-bold text-gray-900 tracking-tight">Quantum Bounty</h1>
              <span className="px-1.5 py-0.2 bg-purple-50 text-[#7C5CFF] border border-[#7C5CFF]/20 text-[9px] font-semibold rounded uppercase tracking-wider flex items-center gap-0.5">
                <Sparkles className="w-2.5 h-2.5" />
                Simulated
              </span>
            </div>
            <p className="text-[10px] text-gray-400 font-mono hidden sm:block">
              Credits Economy v1 • Proof-of-Work & Quorum Ledger
            </p>
          </div>
        </div>

        {/* Center Desktop Navigation */}
        <DesktopNavigation activeTab={activeTab} onSelectTab={onSelectTab} />

        {/* Actions: Refresh & Account Switcher */}
        <div className="flex items-center space-x-2">
          {onRefreshAll && (
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className={`p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer ${
                isRefreshing ? 'animate-spin text-[#7C5CFF]' : ''
              }`}
              title="Refresh live data"
              aria-label="Refresh live data"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}
          <AccountSwitcher />
        </div>
      </div>
    </header>
  );
};
