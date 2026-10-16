import React, { useState, useRef, useEffect } from 'react';
import { useAccount } from '../context/AccountContext.js';
import { ChevronDown, User, Bot, Check, Shield } from 'lucide-react';
import { formatBankAccountId } from '../utils/currency.js';

export const AccountSwitcher: React.FC = () => {
  const { allAccounts, actingAccount, setActingAccountId } = useAccount();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Group checking accounts (human and agent)
  const selectableAccounts = allAccounts.filter(
    (a) => a.kind !== 'system' && (a.account_type === 'checking' || !a.account_type)
  );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        data-testid="account-switcher-button"
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 bg-white border border-neutral-200 rounded-lg text-sm text-neutral-800 hover:border-neutral-300 hover:bg-neutral-50 transition-colors shadow-2xs cursor-pointer"
      >
        <div className="w-5 h-5 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center text-xs font-semibold">
          {actingAccount?.kind === 'agent' ? (
            <Bot className="w-3 h-3" />
          ) : actingAccount?.id === 'scotty' ? (
            <Shield className="w-3 h-3 text-violet-700" />
          ) : (
            <User className="w-3 h-3" />
          )}
        </div>
        <div className="text-left">
          <div className="font-medium text-xs leading-none">
            {actingAccount?.display_name || 'Select Account'}
          </div>
          <div className="text-[10px] text-neutral-400 font-mono mt-0.5 leading-none">
            {actingAccount ? formatBankAccountId(actingAccount.id) : ''}
          </div>
        </div>
        <ChevronDown className="w-3.5 h-3.5 text-neutral-400 ml-1" />
      </button>

      {isOpen && (
        <div
          data-testid="account-switcher-dropdown"
          className="absolute right-0 mt-1.5 w-64 bg-white border border-neutral-200 rounded-xl shadow-lg py-1.5 z-50 text-sm max-h-80 overflow-y-auto"
        >
          <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 border-b border-neutral-100">
            Switch Customer Account
          </div>
          {selectableAccounts.map((acc) => {
            const isSelected = acc.id === actingAccount?.id;
            return (
              <button
                key={acc.id}
                data-testid={`account-option-${acc.id}`}
                type="button"
                onClick={() => {
                  setActingAccountId(acc.id);
                  setIsOpen(false);
                }}
                className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-neutral-50 transition-colors cursor-pointer ${
                  isSelected ? 'bg-violet-50/60 text-violet-900' : 'text-neutral-700'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                      isSelected
                        ? 'bg-violet-600 text-white'
                        : 'bg-neutral-100 text-neutral-600'
                    }`}
                  >
                    {acc.kind === 'agent' ? <Bot className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
                  </div>
                  <div>
                    <div className="font-medium text-xs text-neutral-900">{acc.display_name}</div>
                    <div className="text-[10px] text-neutral-400 font-mono">
                      {formatBankAccountId(acc.id)}
                    </div>
                  </div>
                </div>
                {isSelected && <Check className="w-4 h-4 text-violet-600 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
