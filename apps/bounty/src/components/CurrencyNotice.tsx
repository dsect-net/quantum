import React from 'react';
import { ShieldAlert } from 'lucide-react';

export const CurrencyNotice: React.FC = () => {
  return (
    <footer className="mt-8 mb-20 sm:mb-8 pt-4 pb-2 border-t border-gray-200/80 text-center text-xs text-gray-500">
      <div className="flex items-center justify-center space-x-1.5 mb-1 text-gray-400">
        <ShieldAlert className="w-3.5 h-3.5" />
        <span className="font-medium uppercase tracking-wider text-[10px]">Simulated Internal Currency</span>
      </div>
      <p className="max-w-md mx-auto text-[11px] leading-relaxed text-gray-400">
        Quantum Credits (QC) are a simulated internal currency for the Quantum OS fleet.
        Credits hold no fiat or external monetary value.
      </p>
    </footer>
  );
};
