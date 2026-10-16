import React, { useState, useRef, useEffect } from 'react';
import { useAccount } from '../context/AccountContext.js';
import { formatCredits } from '../utils/currency.js';
import { ChevronDown, Check, User, Bot, Server, Shield } from 'lucide-react';

export const AccountSwitcher: React.FC = () => {
  const { accounts, currentAccount, balance, setCurrentAccountId, isLoading } = useAccount();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  if (isLoading || !currentAccount) {
    return (
      <div className="h-9 w-36 bg-gray-100 animate-pulse rounded-lg border border-gray-200" />
    );
  }

  const getAccountIcon = (kind: string, isValidator: boolean) => {
    if (isValidator) return <Shield className="w-3.5 h-3.5 text-[#7C5CFF]" />;
    if (kind === 'human') return <User className="w-3.5 h-3.5 text-blue-600" />;
    if (kind === 'system') return <Server className="w-3.5 h-3.5 text-amber-600" />;
    return <Bot className="w-3.5 h-3.5 text-emerald-600" />;
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-2 px-2.5 py-1.5 bg-white hover:bg-gray-50 border border-gray-200 rounded-lg text-xs font-medium text-gray-800 transition-colors cursor-pointer shadow-2xs"
        aria-label="Switch active account"
        data-testid="account-switcher-button"
      >
        <span className="p-1 rounded bg-gray-100 flex items-center justify-center">
          {getAccountIcon(currentAccount.kind, currentAccount.is_validator)}
        </span>
        <div className="text-left flex flex-col">
          <span className="font-semibold text-gray-900 leading-tight flex items-center gap-1">
            {currentAccount.id}
            {currentAccount.is_validator && (
              <span className="text-[10px] text-[#7C5CFF] font-mono">val</span>
            )}
          </span>
          {balance && (
            <span className="text-[10px] text-gray-500 font-mono leading-none">
              {formatCredits(balance.available_units, { showUnit: false })} QC
            </span>
          )}
        </div>
        <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
      </button>

      {isOpen && (
        <div
          className="absolute right-0 mt-2 w-72 bg-white rounded-xl shadow-lg border border-gray-200 py-1 z-50 animate-in fade-in zoom-in-95 duration-100"
          data-testid="account-dropdown-menu"
        >
          <div className="px-3 py-2 border-b border-gray-100 bg-gray-50/50">
            <p className="text-[11px] font-semibold text-gray-900 uppercase tracking-wider">
              Acting Account (v1 Switcher)
            </p>
            <p className="text-[10px] text-gray-500">
              Actions will be signed on behalf of this account
            </p>
          </div>

          <div className="max-h-64 overflow-y-auto py-1">
            {accounts.map((acc) => {
              const isSelected = acc.id === currentAccount.id;
              return (
                <button
                  key={acc.id}
                  onClick={() => {
                    setCurrentAccountId(acc.id);
                    setIsOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 flex items-center justify-between text-xs transition-colors cursor-pointer ${
                    isSelected ? 'bg-purple-50/50 text-[#7C5CFF]' : 'hover:bg-gray-50 text-gray-700'
                  }`}
                  data-testid={`account-option-${acc.id}`}
                >
                  <div className="flex items-center space-x-2">
                    <span className="p-1 rounded bg-gray-100 flex items-center justify-center">
                      {getAccountIcon(acc.kind, acc.is_validator)}
                    </span>
                    <div>
                      <div className="font-medium text-gray-900 flex items-center space-x-1">
                        <span>{acc.display_name}</span>
                        {acc.is_validator && (
                          <span className="text-[9px] px-1 py-0.2 bg-purple-100 text-[#7C5CFF] rounded font-mono font-semibold">
                            validator
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-gray-400 font-mono">
                        id: {acc.id} ({acc.kind})
                      </div>
                    </div>
                  </div>
                  {isSelected && <Check className="w-4 h-4 text-[#7C5CFF]" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
