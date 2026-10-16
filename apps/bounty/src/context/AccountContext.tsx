import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Account, AccountBalanceResponse } from '../types.js';
import { api } from '../api/client.js';

interface AccountContextType {
  accounts: Account[];
  currentAccount: Account | null;
  balance: AccountBalanceResponse | null;
  isLoading: boolean;
  error: string | null;
  setCurrentAccountId: (id: string) => void;
  refreshAccounts: () => Promise<void>;
  refreshBalance: () => Promise<void>;
}

const AccountContext = createContext<AccountContextType | null>(null);

const STORAGE_KEY = 'quantum_acting_account';

export const AccountProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [currentAccount, setCurrentAccount] = useState<Account | null>(null);
  const [balance, setBalance] = useState<AccountBalanceResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAccounts = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const accList = await api.listAccounts();
      setAccounts(accList);

      const savedId = localStorage.getItem(STORAGE_KEY);
      const matched = accList.find((a) => a.id === savedId);

      // Default to cooper (first active validator agent) or scotty (founder)
      const defaultAcc = matched || accList.find((a) => a.id === 'cooper') || accList.find((a) => a.id === 'scotty') || accList[0] || null;
      setCurrentAccount(defaultAcc);

      if (defaultAcc) {
        localStorage.setItem(STORAGE_KEY, defaultAcc.id);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load accounts');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchBalance = useCallback(async () => {
    if (!currentAccount) return;
    try {
      const bal = await api.getAccountBalance(currentAccount.id);
      setBalance(bal);
    } catch {
      // Balance fetch failed, ignore or retain current
    }
  }, [currentAccount]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  useEffect(() => {
    if (currentAccount) {
      fetchBalance();
    }
  }, [currentAccount, fetchBalance]);

  const setCurrentAccountId = (id: string) => {
    const acc = accounts.find((a) => a.id === id);
    if (acc) {
      setCurrentAccount(acc);
      localStorage.setItem(STORAGE_KEY, acc.id);
    }
  };

  return (
    <AccountContext.Provider
      value={{
        accounts,
        currentAccount,
        balance,
        isLoading,
        error,
        setCurrentAccountId,
        refreshAccounts: fetchAccounts,
        refreshBalance: fetchBalance,
      }}
    >
      {children}
    </AccountContext.Provider>
  );
};

export function useAccount(): AccountContextType {
  const context = useContext(AccountContext);
  if (!context) {
    throw new Error('useAccount must be used within an AccountProvider');
  }
  return context;
}
