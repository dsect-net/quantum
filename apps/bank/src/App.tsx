import React, { useState } from 'react';
import { BankView } from './types.js';
import { AccountProvider, useAccount } from './context/AccountContext.js';
import { Header } from './components/Header.js';
import { Navigation } from './components/Navigation.js';
import { AccountsView } from './views/AccountsView.js';
import { ActivityView } from './views/ActivityView.js';
import { MoveMoneyView } from './views/MoveMoneyView.js';
import { IncomeView } from './views/IncomeView.js';
import { EconomySnapshotView } from './views/EconomySnapshotView.js';
import { ScheduledPaymentsView } from './views/ScheduledPaymentsView.js';

const BankAppContent: React.FC = () => {
  const [currentView, setCurrentView] = useState<BankView>('accounts');
  const { isLoading, error } = useAccount();

  return (
    <div className="min-h-screen bg-[#f8f9fa] flex flex-col font-sans selection:bg-violet-100 selection:text-violet-900">
      <Header />
      <Navigation currentView={currentView} onSelectView={setCurrentView} />

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-6 pb-28 sm:pb-12">
        {isLoading && !error && (
          <div className="flex items-center justify-center p-12 text-xs text-neutral-400">
            <div className="animate-spin rounded-full h-5 w-5 border-2 border-neutral-300 border-t-neutral-900 mr-2" />
            Connecting to Quantum Bank ledger...
          </div>
        )}

        {error && (
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 mb-6">
            <strong>Connection Error:</strong> {error}
          </div>
        )}

        {currentView === 'accounts' && <AccountsView onNavigate={setCurrentView} />}
        {currentView === 'activity' && <ActivityView />}
        {currentView === 'move-money' && <MoveMoneyView onNavigate={setCurrentView} />}
        {currentView === 'scheduled' && <ScheduledPaymentsView />}
        {currentView === 'income' && <IncomeView />}
        {currentView === 'economy' && <EconomySnapshotView />}
      </main>
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <AccountProvider>
      <BankAppContent />
    </AccountProvider>
  );
};

export default App;
