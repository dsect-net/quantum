import React from 'react';
import { BankView } from '../types.js';
import { Landmark, ReceiptText, ArrowLeftRight, Banknote, PieChart } from 'lucide-react';

interface NavigationProps {
  currentView: BankView;
  onSelectView: (view: BankView) => void;
}

interface NavItem {
  id: BankView;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'accounts', label: 'Accounts', icon: Landmark },
  { id: 'activity', label: 'Activity', icon: ReceiptText },
  { id: 'move-money', label: 'Move Money', icon: ArrowLeftRight },
  { id: 'income', label: 'Paychecks', icon: Banknote },
  { id: 'economy', label: 'Economy', icon: PieChart },
];

export const Navigation: React.FC<NavigationProps> = ({ currentView, onSelectView }) => {
  return (
    <>
      {/* Desktop Sub-Header Navigation */}
      <nav className="hidden sm:block bg-white border-b border-neutral-200">
        <div className="max-w-5xl mx-auto px-4 flex gap-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                data-testid={`desktop-nav-${item.id}`}
                onClick={() => onSelectView(item.id)}
                className={`flex items-center gap-2 px-4 py-3 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
                  isActive
                    ? 'border-neutral-900 text-neutral-900 bg-neutral-50/50'
                    : 'border-transparent text-neutral-500 hover:text-neutral-800 hover:border-neutral-300'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-violet-600' : 'text-neutral-400'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Mobile Sticky Bottom Navigation (390x844 phone primary) */}
      <nav
        data-testid="mobile-navigation"
        className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-neutral-200/90 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 px-2"
      >
        <div className="grid grid-cols-5 gap-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                data-testid={`mobile-nav-${item.id}`}
                onClick={() => onSelectView(item.id)}
                className={`flex flex-col items-center justify-center py-1 rounded-lg transition-colors cursor-pointer ${
                  isActive
                    ? 'text-neutral-900 font-semibold'
                    : 'text-neutral-400 hover:text-neutral-600 font-normal'
                }`}
              >
                <div
                  className={`p-1 rounded-full ${
                    isActive ? 'bg-violet-50 text-violet-700' : 'text-neutral-400'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                </div>
                <span className="text-[10px] mt-0.5 tracking-tight">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
};
