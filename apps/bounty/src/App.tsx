import React, { useState } from 'react';
import { AccountProvider } from './context/AccountContext.js';
import { Header } from './components/Header.js';
import { TabType, MobileNavigation } from './components/Navigation.js';
import { CurrencyNotice } from './components/CurrencyNotice.js';
import { BoardView } from './views/BoardView.js';
import { BountyDetailView } from './views/BountyDetailView.js';
import { QuestsView } from './views/QuestsView.js';
import { QuestDetailView } from './views/QuestDetailView.js';
import { WalletView } from './views/WalletView.js';
import { EconomyView } from './views/EconomyView.js';
import { LeaderboardView } from './views/LeaderboardView.js';
import { ExplorerView } from './views/ExplorerView.js';

export const AppContent: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('board');
  const [selectedBountyId, setSelectedBountyId] = useState<string | null>(null);
  const [selectedQuestId, setSelectedQuestId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleSelectTab = (tab: TabType) => {
    setActiveTab(tab);
    // Reset drill-down views when changing top tab
    setSelectedBountyId(null);
    setSelectedQuestId(null);
  };

  const handleRefreshAll = () => {
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#111827] flex flex-col font-sans selection:bg-[#7C5CFF]/20 selection:text-[#7C5CFF]">
      {/* Top Header */}
      <Header
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        onRefreshAll={handleRefreshAll}
      />

      {/* Main View Area */}
      <main className="flex-1 max-w-4xl w-full mx-auto p-4 sm:p-6 pb-20 sm:pb-6" key={refreshKey}>
        {activeTab === 'board' && (
          selectedBountyId ? (
            <BountyDetailView
              bountyId={selectedBountyId}
              onBack={() => setSelectedBountyId(null)}
              onBountyUpdated={handleRefreshAll}
            />
          ) : (
            <BoardView
              onSelectBounty={(id) => setSelectedBountyId(id)}
            />
          )
        )}

        {activeTab === 'quests' && (
          selectedQuestId ? (
            <QuestDetailView
              questId={selectedQuestId}
              onBack={() => setSelectedQuestId(null)}
              onQuestUpdated={handleRefreshAll}
            />
          ) : (
            <QuestsView
              onSelectQuest={(id) => setSelectedQuestId(id)}
            />
          )
        )}

        {activeTab === 'wallet' && <WalletView />}
        {activeTab === 'economy' && <EconomyView />}
        {activeTab === 'leaderboard' && <LeaderboardView />}
        {activeTab === 'explorer' && <ExplorerView />}
      </main>

      {/* Mobile Bottom Fixed Tab Bar */}
      <MobileNavigation activeTab={activeTab} onSelectTab={handleSelectTab} />

      {/* Honest simulated currency notice */}
      <CurrencyNotice />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <AccountProvider>
      <AppContent />
    </AccountProvider>
  );
};

export default App;
