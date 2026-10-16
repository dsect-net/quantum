import React from 'react';
import {
  Briefcase,
  Compass,
  Wallet,
  TrendingUp,
  Award,
  Layers,
} from 'lucide-react';

export type TabType = 'board' | 'quests' | 'wallet' | 'economy' | 'leaderboard' | 'explorer';

export const NAV_TABS = [
  { id: 'board', label: 'Board', icon: Briefcase },
  { id: 'quests', label: 'Quests', icon: Compass },
  { id: 'wallet', label: 'Wallet', icon: Wallet },
  { id: 'economy', label: 'Economy', icon: TrendingUp },
  { id: 'leaderboard', label: 'Ranks', icon: Award },
  { id: 'explorer', label: 'Explorer', icon: Layers },
] as const;

interface NavigationProps {
  activeTab: TabType;
  onSelectTab: (tab: TabType) => void;
}

export const DesktopNavigation: React.FC<NavigationProps> = ({ activeTab, onSelectTab }) => {
  return (
    <nav className="hidden sm:flex items-center space-x-1 bg-gray-100/80 p-1 rounded-xl border border-gray-200/80">
      {NAV_TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onSelectTab(tab.id as TabType)}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              isActive
                ? 'bg-white text-gray-900 shadow-2xs font-semibold'
                : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
            }`}
            data-testid={`desktop-nav-${tab.id}`}
          >
            <Icon className={`w-4 h-4 ${isActive ? 'text-[#7C5CFF]' : 'text-gray-500'}`} />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
};

export const MobileNavigation: React.FC<NavigationProps> = ({ activeTab, onSelectTab }) => {
  return (
    <nav
      className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-gray-200 px-2 py-1.5 shadow-lg flex justify-around items-center"
      style={{ position: 'fixed', bottom: 0, left: 0, right: 0 }}
    >
      {NAV_TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onSelectTab(tab.id as TabType)}
            className={`flex flex-col items-center justify-center py-1 px-2 rounded-lg transition-colors cursor-pointer ${
              isActive ? 'text-[#7C5CFF]' : 'text-gray-500 hover:text-gray-900'
            }`}
            data-testid={`mobile-nav-${tab.id}`}
          >
            <Icon className={`w-5 h-5 ${isActive ? 'stroke-[2.2]' : 'stroke-[1.5]'}`} />
            <span className={`text-[10px] mt-0.5 font-medium ${isActive ? 'font-semibold' : ''}`}>
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
};

export const Navigation: React.FC<NavigationProps> = (props) => {
  return <DesktopNavigation {...props} />;
};
