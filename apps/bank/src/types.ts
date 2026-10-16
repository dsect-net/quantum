export type AccountKind = 'human' | 'agent' | 'system';
export type AccountType = 'checking' | 'savings' | 'system';

export type TransactionType =
  | 'genesis'
  | 'mint_reward'
  | 'transfer'
  | 'escrow_lock'
  | 'escrow_release'
  | 'escrow_refund'
  | 'burn'
  | 'fee'
  | 'policy_change'
  | 'purchase'
  | 'treasury_grant'
  | 'paycheck'
  | 'interest'
  | 'work_credit';

export interface Transaction<P = Record<string, unknown>> {
  id: string;
  block_height: number | null;
  tx_index: number;
  type: TransactionType;
  from_account: string | null;
  to_account: string | null;
  amount_units: number;
  fee_units: number;
  memo: string | null;
  actor_signature: string;
  created_at: string;
  payload: P | null;
}

export interface Account {
  id: string;
  kind: AccountKind;
  account_type: AccountType;
  display_name: string;
  public_key: string;
  is_validator: boolean;
  created_at: string;
}

export interface AccountBalanceResponse {
  account_id: string;
  account_type: AccountType;
  balance_units: number;
  available_units: number;
  unvested_units: number;
  verified_at: string;
}

export interface EconomySummary {
  issued_units: number;
  supply_cap_units: number;
  burned_units: number;
  escrow_locked_units: number;
  treasury_balance_units: number;
  current_reward_units: number;
  next_halving_height: number;
  block_height: number;
  validator_count: number;
}

export interface PolicyParams {
  mining_reward_multiplier?: number;
  bounty_posting_fee_bps?: number;
  savings_rate_bps?: number;
  treasury_grant_max_units?: number;
}

export interface EffectivePolicy extends PolicyParams {
  mining_reward_multiplier: number;
  bounty_posting_fee_bps: number;
  savings_rate_bps: number;
  treasury_grant_max_units: number;
}

export interface KnowledgeRecord {
  id: string;
  quest_id: string;
  submission_id: string;
  submitter: string;
  body: string;
  content_hash: string;
  paid_units: number;
  created_at: string;
}

export interface AccountQuestEarnings {
  account_id: string;
  total_earned_units: number;
  completed_quests_count: number;
  records: KnowledgeRecord[];
}

export type BankView = 'accounts' | 'activity' | 'move-money' | 'income' | 'economy';

export interface TransferRequest {
  from_account: string;
  to_account: string;
  amount_units: number;
  memo?: string;
}

export interface RunningBalanceTransaction {
  tx: Transaction;
  running_balance_units: number;
  direction: 'in' | 'out' | 'internal' | 'neutral';
  net_change_units: number;
}
