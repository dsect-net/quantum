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

export type BankView = 'accounts' | 'activity' | 'move-money' | 'scheduled' | 'income' | 'economy';

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

// ==========================================
// SCHEDULED PAYMENTS TYPES (Amendment A4 / Chunk 5)
// ==========================================

export type ScheduleType = 'one_off' | 'recurring';
export type ScheduleStatus = 'active' | 'cancelled' | 'completed' | 'failed';
export type ScheduleExecutionStatus = 'succeeded' | 'failed' | 'skipped';

export interface ScheduledPayment {
  id: string;
  from_account: string;
  to_account: string;
  amount_units: number;
  schedule_type: ScheduleType;
  first_due_at: string;
  next_due_at: string;
  interval_seconds?: number | null;
  first_due_block?: number | null;
  next_due_block?: number | null;
  interval_blocks?: number | null;
  memo?: string | null;
  status: ScheduleStatus;
  total_executions: number;
  last_executed_at?: string | null;
  created_at: string;
  cancelled_at?: string | null;
}

export interface ScheduledPaymentExecution {
  id: string;
  schedule_id: string;
  scheduled_for: string;
  executed_at: string;
  status: ScheduleExecutionStatus;
  tx_id?: string | null;
  reason?: string | null;
  amount_units: number;
}

export interface CreateScheduledPaymentInput {
  from_account: string;
  to_account: string;
  amount_units: number;
  schedule_type?: ScheduleType;
  first_due_at?: string;
  interval_seconds?: number;
  first_due_block?: number;
  interval_blocks?: number;
  memo?: string;
  caller_account?: string;
  signingPrivateKeyPem?: string;
}

export interface ScheduleDetailResponse {
  schedule: ScheduledPayment;
  executions: ScheduledPaymentExecution[];
}

export interface ProcessScheduledPaymentsResult {
  processed_count: number;
  succeeded_count: number;
  failed_count: number;
  skipped_count: number;
  executions: ScheduledPaymentExecution[];
}

