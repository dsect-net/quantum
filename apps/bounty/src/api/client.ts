import {
  Account,
  AccountBalanceResponse,
  Bounty,
  BountyComment,
  BountyWithComments,
  EconomySummary,
  VerifyResult,
  LeaderboardResponse,
  Block,
  BlockWithTransactions,
  Transaction,
  AssessmentRecord,
  PolicyParams,
  PolicyRecord,
  CataloguePurchase,
  Quest,
  QuestDetails,
  QuestSubmission,
  QuestVerification,
  AccountQuestEarnings,
} from '../types.js';

export class EconomyApiClient {
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
        // use fallback errorMsg
      }
      throw new Error(errorMsg);
    }

    return res.json() as Promise<T>;
  }

  // ==========================================
  // ACCOUNTS
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

  public async getAccountHistory(id: string, limit = 50, offset = 0): Promise<Transaction[]> {
    return this.request<Transaction[]>(`/api/v1/accounts/${encodeURIComponent(id)}/history?limit=${limit}&offset=${offset}`);
  }

  // ==========================================
  // BOUNTIES
  // ==========================================

  public async listBounties(filters: {
    status?: string;
    poster?: string;
    claimant?: string;
  } = {}): Promise<Bounty[]> {
    const params = new URLSearchParams();
    if (filters.status) params.append('status', filters.status);
    if (filters.poster) params.append('poster', filters.poster);
    if (filters.claimant) params.append('claimant', filters.claimant);

    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<Bounty[]>(`/api/v1/bounties${query}`);
  }

  public async getBounty(id: string): Promise<BountyWithComments> {
    return this.request<BountyWithComments>(`/api/v1/bounties/${encodeURIComponent(id)}`);
  }

  public async postBounty(input: {
    poster_account: string;
    title: string;
    description_md: string;
    price_units: number;
    fee_bps?: number;
    linked_github_issue?: string | null;
    linked_artifact?: string | null;
  }): Promise<Bounty> {
    return this.request<Bounty>('/api/v1/bounties', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  public async claimBounty(id: string, claimant_account: string): Promise<Bounty> {
    return this.request<Bounty>(`/api/v1/bounties/${encodeURIComponent(id)}/claim`, {
      method: 'POST',
      body: JSON.stringify({ claimant_account }),
    });
  }

  public async submitBounty(
    id: string,
    claimant_account: string,
    submission: { linked_artifact?: string; notes?: string }
  ): Promise<Bounty> {
    return this.request<Bounty>(`/api/v1/bounties/${encodeURIComponent(id)}/submit`, {
      method: 'POST',
      body: JSON.stringify({
        claimant_account,
        linked_artifact: submission.linked_artifact,
        notes: submission.notes,
      }),
    });
  }

  public async acceptBounty(id: string, poster_account: string): Promise<Bounty> {
    return this.request<Bounty>(`/api/v1/bounties/${encodeURIComponent(id)}/accept`, {
      method: 'POST',
      body: JSON.stringify({ poster_account }),
    });
  }

  public async cancelBounty(id: string, poster_account: string): Promise<Bounty> {
    return this.request<Bounty>(`/api/v1/bounties/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ poster_account }),
    });
  }

  public async addBountyComment(id: string, author: string, body_md: string): Promise<BountyComment> {
    return this.request<BountyComment>(`/api/v1/bounties/${encodeURIComponent(id)}/comments`, {
      method: 'POST',
      body: JSON.stringify({ author, body_md }),
    });
  }

  // ==========================================
  // QUESTS (Amendment A3)
  // ==========================================

  public async listQuests(filters: {
    status?: string;
    quest_type?: string;
    funder?: string;
  } = {}): Promise<Quest[]> {
    const params = new URLSearchParams();
    if (filters.status) params.append('status', filters.status);
    if (filters.quest_type) params.append('quest_type', filters.quest_type);
    if (filters.funder) params.append('funder', filters.funder);

    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<Quest[]>(`/api/v1/quests${query}`);
  }

  public async getQuestDetails(id: string): Promise<QuestDetails> {
    return this.request<QuestDetails>(`/api/v1/quests/${encodeURIComponent(id)}`);
  }

  public async postQuest(input: {
    funder_account: string;
    title: string;
    prompt_md: string;
    quest_type: string;
    tier: string;
    payout_units: number;
  }): Promise<Quest> {
    return this.request<Quest>('/api/v1/quests', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  public async submitQuest(
    id: string,
    input: { submitter_account: string; body_md: string }
  ): Promise<QuestSubmission> {
    return this.request<QuestSubmission>(`/api/v1/quests/${encodeURIComponent(id)}/submit`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  public async reviseQuest(
    id: string,
    input: { submitter_account: string; body_md: string }
  ): Promise<QuestSubmission> {
    return this.request<QuestSubmission>(`/api/v1/quests/${encodeURIComponent(id)}/revise`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  public async verifyQuest(id: string): Promise<{
    quest: Quest;
    paid_units: number;
    verifications: QuestVerification[];
    knowledgeRecord: any;
  }> {
    return this.request<{
      quest: Quest;
      paid_units: number;
      verifications: QuestVerification[];
      knowledgeRecord: any;
    }>(`/api/v1/quests/${encodeURIComponent(id)}/verify`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  public async getAccountQuestEarnings(account: string): Promise<AccountQuestEarnings> {
    return this.request<AccountQuestEarnings>(`/api/v1/quests/earnings/${encodeURIComponent(account)}`);
  }

  // ==========================================
  // ECONOMY & FED
  // ==========================================

  public async getEconomySummary(): Promise<EconomySummary> {
    return this.request<EconomySummary>('/api/v1/economy/summary');
  }

  public async verifyChain(): Promise<VerifyResult> {
    return this.request<VerifyResult>('/api/v1/economy/verify');
  }

  public async getLatestAssessment(): Promise<AssessmentRecord> {
    return this.request<AssessmentRecord>('/api/v1/fed/assessment/latest');
  }

  public async getEffectivePolicy(): Promise<PolicyParams & {
    mining_reward_multiplier: number;
    bounty_posting_fee_bps: number;
    savings_rate_bps: number;
    treasury_grant_max_units: number;
  }> {
    return this.request('/api/v1/fed/policy');
  }

  public async getPendingPolicies(): Promise<PolicyRecord[]> {
    return this.request<PolicyRecord[]>('/api/v1/fed/policy/pending');
  }

  // ==========================================
  // LEADERBOARD
  // ==========================================

  public async getLeaderboard(limit = 50, offset = 0): Promise<LeaderboardResponse> {
    return this.request<LeaderboardResponse>(`/api/v1/leaderboard?limit=${limit}&offset=${offset}`);
  }

  // ==========================================
  // EXPLORER
  // ==========================================

  public async listBlocks(limit = 20, offset = 0): Promise<Block[]> {
    const res = await this.request<any>(`/api/v1/ledger/blocks?limit=${limit}&offset=${offset}`);
    if (Array.isArray(res)) return res;
    return res?.blocks || [];
  }

  public async getBlockDetails(height: number): Promise<BlockWithTransactions> {
    return this.request<BlockWithTransactions>(`/api/v1/ledger/blocks/${height}`);
  }

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
  // CATALOGUE PURCHASES
  // ==========================================

  public async listPurchases(accountId?: string): Promise<CataloguePurchase[]> {
    const query = accountId ? `?account_id=${encodeURIComponent(accountId)}` : '';
    return this.request<CataloguePurchase[]>(`/api/v1/catalogue/purchases${query}`);
  }
}

export const api = new EconomyApiClient();
