import React from 'react';
import { ShieldAlert } from 'lucide-react';

export const CurrencyNotice: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  if (compact) {
    return (
      <div
        data-testid="currency-notice-compact"
        className="flex items-center gap-1.5 text-xs text-neutral-500 bg-neutral-100/80 px-2.5 py-1 rounded-full border border-neutral-200/60"
      >
        <ShieldAlert className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
        <span>Quantum Credits (QC) are a simulated internal economic unit. No real-world monetary value.</span>
      </div>
    );
  }

  return (
    <div
      data-testid="currency-notice-full"
      className="p-3.5 bg-neutral-50 border border-neutral-200 rounded-xl text-xs text-neutral-600 flex items-start gap-3"
    >
      <ShieldAlert className="w-4 h-4 text-violet-600 shrink-0 mt-0.5" />
      <div className="space-y-0.5">
        <p className="font-medium text-neutral-800">Quantum Bank — Simulated Economy Disclaimer</p>
        <p className="text-neutral-500 leading-relaxed">
          Quantum Credits (QC) are simulated internal accounting tokens operating exclusively within the
          Quantum OS fleet ledger. They represent computational incentives, bounties, and internal salaries.
          Credits possess no fiat conversion, no real-money claims, and no external financial backing.
        </p>
      </div>
    </div>
  );
};
