import React from 'react';
import { Landmark } from 'lucide-react';
import { AccountSwitcher } from './AccountSwitcher.js';

export const Header: React.FC = () => {
  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-neutral-200/80 px-4 py-3">
      <div className="max-w-5xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-neutral-900 text-white flex items-center justify-center shadow-xs">
            <Landmark className="w-4 h-4 text-violet-400" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-sm tracking-tight text-neutral-900">
                Quantum Bank
              </span>
              <span className="text-[10px] uppercase font-semibold tracking-wider px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-100">
                Core
              </span>
            </div>
            <p className="text-[10px] text-neutral-400 font-medium">Official Economy Banking • A4</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <AccountSwitcher />
        </div>
      </div>
    </header>
  );
};
