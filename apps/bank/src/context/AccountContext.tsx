import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  Account,
  AccountBalanceResponse,
  EffectivePolicy,
  EconomySummary,
} from '../types.js';
import { api } from '../api/client.js';

interface AccountContextType {
  allAccounts: Account[];
  actingAccount: Account | null;
  savingsAccount: Account | null;
  checkingBalance: AccountBalanceResponse | null;
  savingsBalance: AccountBalanceResponse | null;
  netWorthUnits: number;
  policy: EffectivePolicy | null;
  summary: EconomySummary | null;
  isLoading: boolean;
  error: string | null;
  setActingAccountId: (id: string) => void;
  createSavingsAccount: () => Promise<Account>;
  refreshAll: () => Promise<void>;
}

const AccountContext = createContext<AccountContextType | null>(null);

const STORAGE_KEY = 'quantum_bank_acting_account';

export const AccountProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [allAccounts, setAllAccounts] = useState<Account[]>([]);
  const [actingAccountId, setActingAccountIdState] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEY) || 'cooper';
  });
  const [checkingBalance, setCheckingBalance] = useState<AccountBalanceResponse | null>(null);
  const [savingsBalance, setSavingsBalance] = useState<AccountBalanceResponse | null>(null);
  const [policy, setPolicy] = useState<EffectivePolicy | null>(null);
  const [summary, setSummary] = useState<EconomySummary | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Derived accounts
  const actingAccount = allAccounts.find(
    (a) => a.id === actingAccountId && a.account_type === 'checking'
  ) || allAccounts.find((a) => a.id === actingAccountId) || null;

  const savingsId = `${actingAccountId}:savings`;
  const savingsAccount = allAccounts.find(
    (a) => a.id === savingsId || (a.id === actingAccountId && a.account_type === 'savings')
  ) || null;

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const [accountsList, policyData, summaryData] = await Promise.all([
        api.listAccounts(),
        api.getEffectivePolicy().catch(() => null),
        api.getEconomySummary().catch(() => null),
      ]);

      setAllAccounts(accountsList);
      if (policyData) setPolicy(policyData);
      if (summaryData) setSummary(summaryData);

      // Determine active ID
      let activeId = actingAccountId;
      const exists = accountsList.some((a) => a.id === activeId);
      if (!exists && accountsList.length > 0) {
        const defaultAcc =
          accountsList.find((a) => a.id === 'cooper') ||
          accountsList.find((a) => a.id === 'scotty') ||
          accountsList[0];
        activeId = defaultAcc.id.replace(/:savings$/, '');
        setActingAccountIdState(activeId);
        localStorage.setItem(STORAGE_KEY, activeId);
      }

      // Fetch balances for checking and savings (if present)
      try {
        const chkBal = await api.getAccountBalance(activeId);
        setCheckingBalance(chkBal);
      } catch {
        setCheckingBalance(null);
      }

      const sId = `${activeId}:savings`;
      const hasSavings = accountsList.some((a) => a.id === sId);
      if (hasSavings) {
        try {
          const savBal = await api.getAccountBalance(sId);
          setSavingsBalance(savBal);
        } catch {
          setSavingsBalance(null);
        }
      } else {
        setSavingsBalance(null);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load banking data');
    } finally {
      setIsLoading(false);
    }
  }, [actingAccountId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const setActingAccountId = (id: string) => {
    const cleanId = id.replace(/:savings$/, '');
    setActingAccountIdState(cleanId);
    localStorage.setItem(STORAGE_KEY, cleanId);
  };

  const handleCreateSavingsAccount = async (): Promise<Account> => {
    if (!actingAccount) throw new Error('No active account');
    const created = await api.createSavingsAccount(actingAccount.id);
    await loadData();
    return created;
  };

  const netWorthUnits =
    (checkingBalance?.balance_units || 0) + (savingsBalance?.balance_units || 0);

  return (
    <AccountContext.Provider
      value={{
        allAccounts,
        actingAccount,
        savingsAccount,
        checkingBalance,
        savingsBalance,
        netWorthUnits,
        policy,
        summary,
        isLoading,
        error,
        setActingAccountId,
        createSavingsAccount: handleCreateSavingsAccount,
        refreshAll: loadData,
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
