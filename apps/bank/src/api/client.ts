import {
  Account,
  AccountBalanceResponse,
  EconomySummary,
  EffectivePolicy,
  Transaction,
  AccountQuestEarnings,
  TransferRequest,
} from '../types.js';

export class BankApiClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl =
      baseUrl ||
      (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_ECONOMY_API_URL) ||
      'http://127.0.0.1:8792';
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public setBaseUrl(url: string): void {
    this.baseUrl = url;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };

    const res = await fetch(url, {
      ...options,
      headers,
    });

    if (!res.ok) {
      let errorMsg = `HTTP ${res.status}: ${res.statusText}`;
      try {
        const errJson = await res.json();
        if (errJson.message) {
          errorMsg = errJson.message;
        } else if (errJson.error) {
          errorMsg = errJson.error;
        }
      } catch {
        // fallback
      }
      throw new Error(errorMsg);
    }

    return res.json() as Promise<T>;
  }

  // ==========================================
  // ACCOUNTS & SAVINGS
  // ==========================================

  public async listAccounts(): Promise<Account[]> {
    return this.request<Account[]>('/api/v1/accounts');
  }

  public async getAccount(id: string): Promise<Account> {
    return this.request<Account>(`/api/v1/accounts/${encodeURIComponent(id)}`);
  }

  public async getAccountBalance(id: string): Promise<AccountBalanceResponse> {
    return this.request<AccountBalanceResponse>(`/api/v1/accounts/${encodeURIComponent(id)}/balance`);
  }

  public async createSavingsAccount(ownerId: string): Promise<Account> {
    return this.request<Account>(`/api/v1/accounts/${encodeURIComponent(ownerId)}/savings`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  public async getAccountHistory(id: string, limit = 50, offset = 0): Promise<Transaction[]> {
    return this.request<Transaction[]>(
      `/api/v1/accounts/${encodeURIComponent(id)}/history?limit=${limit}&offset=${offset}`
    );
  }

  // ==========================================
  // TRANSFERS
  // ==========================================

  public async postTransfer(transfer: TransferRequest): Promise<Transaction> {
    return this.request<Transaction>('/api/v1/transfers', {
      method: 'POST',
      body: JSON.stringify(transfer),
    });
  }

  // ==========================================
  // ECONOMY & POLICY
  // ==========================================

  public async getEconomySummary(): Promise<EconomySummary> {
    return this.request<EconomySummary>('/api/v1/economy/summary');
  }

  public async getEffectivePolicy(): Promise<EffectivePolicy> {
    return this.request<EffectivePolicy>('/api/v1/fed/policy');
  }

  // ==========================================
  // QUESTS EARNINGS
  // ==========================================

  public async getAccountQuestEarnings(account: string): Promise<AccountQuestEarnings> {
    return this.request<AccountQuestEarnings>(`/api/v1/quests/earnings/${encodeURIComponent(account)}`);
  }

  // ==========================================
  // LEDGER TRANSACTIONS
  // ==========================================

  public async listTransactions(filters: {
    account?: string;
    type?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<Transaction[]> {
    const params = new URLSearchParams();
    if (filters.account) params.append('account', filters.account);
    if (filters.type) params.append('type', filters.type);
    if (filters.limit) params.append('limit', filters.limit.toString());
    if (filters.offset) params.append('offset', filters.offset.toString());

    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await this.request<any>(`/api/v1/ledger/transactions${query}`);
    if (Array.isArray(res)) return res;
    return res?.transactions || [];
  }
  // ==========================================
  // SCHEDULED PAYMENTS (Amendment A4 / Chunk 5)
  // ==========================================

  public async listScheduledPayments(options: {
    account?: string;
    status?: import('../types.js').ScheduleStatus;
    limit?: number;
    offset?: number;
  } = {}): Promise<import('../types.js').ScheduledPayment[]> {
    const params = new URLSearchParams();
    if (options.account) params.append('account', options.account);
    if (options.status) params.append('status', options.status);
    if (options.limit !== undefined) params.append('limit', options.limit.toString());
    if (options.offset !== undefined) params.append('offset', options.offset.toString());

    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<import('../types.js').ScheduledPayment[]>(`/api/v1/schedules${query}`);
  }

  public async getScheduledPayment(id: string): Promise<import('../types.js').ScheduleDetailResponse> {
    return this.request<import('../types.js').ScheduleDetailResponse>(
      `/api/v1/schedules/${encodeURIComponent(id)}`
    );
  }

  public async createScheduledPayment(
    input: import('../types.js').CreateScheduledPaymentInput
  ): Promise<import('../types.js').ScheduledPayment> {
    return this.request<import('../types.js').ScheduledPayment>('/api/v1/schedules', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  public async cancelScheduledPayment(
    id: string,
    callerAccount?: string
  ): Promise<import('../types.js').ScheduledPayment> {
    return this.request<import('../types.js').ScheduledPayment>(
      `/api/v1/schedules/${encodeURIComponent(id)}/cancel`,
      {
        method: 'POST',
        body: JSON.stringify({ caller_account: callerAccount }),
      }
    );
  }

  public async processDueScheduledPayments(
    now?: string,
    blockHeight?: number
  ): Promise<import('../types.js').ProcessScheduledPaymentsResult> {
    return this.request<import('../types.js').ProcessScheduledPaymentsResult>('/api/v1/schedules/process', {
      method: 'POST',
      body: JSON.stringify({ now, block_height: blockHeight }),
    });
  }
}

export const api = new BankApiClient();

