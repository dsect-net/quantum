export type AccountKind = 'human' | 'agent' | 'system';
export type AccountType = 'checking' | 'savings' | 'system';

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

export type BountyStatus =
  | 'open'
  | 'claimed'
  | 'submitted'
  | 'accepted'
  | 'cancelled'
  | 'disputed';

export interface Bounty {
  id: string;
  poster_account: string;
  title: string;
  description_md: string;
  price_units: number;
  fee_units: number;
  status: BountyStatus;
  claimant_account: string | null;
  linked_github_issue: string | null;
  linked_artifact: string | null;
  created_at: string;
  claimed_at: string | null;
  submitted_at: string | null;
  resolved_at: string | null;
  escrow_tx_id: string | null;
}

export interface BountyComment {
  id: string;
  bounty_id: string;
  author: string;
  body_md: string;
  created_at: string;
}

export interface BountyWithComments extends Bounty {
  comments: BountyComment[];
}

export type QuestType = 'explain' | 'write' | 'dataset' | 'label' | 'qa';
export type QuestTier = 'quick' | 'standard' | 'deep';
export type QuestStatus = 'open' | 'submitted' | 'passed' | 'failed' | 'paid' | 'cancelled';

export interface Quest {
  id: string;
  funder_account: string;
  title: string;
  prompt_md: string;
  quest_type: QuestType;
  tier: QuestTier;
  payout_units: number;
  bonus_pool_units: number;
  status: QuestStatus;
  created_at: string;
  escrow_tx_id: string | null;
}

export interface QuestSubmission {
  id: string;
  quest_id: string;
  submitter_account: string;
  body_md: string;
  content_hash: string;
  created_at: string;
  revision_count: number;
}

export interface RubricScores {
  accuracy: number;     // 0-25
  specificity: number;  // 0-25
  originality: number;  // 0-25
  usefulness: number;   // 0-25
  total: number;        // 0-100
}

export interface QuestVerification {
  id: string;
  submission_id: string;
  verifier_id: string;
  rubric: RubricScores;
  dedupe_similarity: number;
  verdict: 'pass' | 'fail';
  feedback_md: string;
  created_at: string;
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

export interface QuestDetails {
  quest: Quest;
  submissions: QuestSubmission[];
  verifications: QuestVerification[];
  knowledgeRecord: KnowledgeRecord | null;
}

export interface AccountQuestEarnings {
  account_id: string;
  total_earned_units: number;
  completed_quests_count: number;
  records: KnowledgeRecord[];
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

export interface VerifyResult {
  valid: boolean;
  highest_block?: number;
  state_hash?: string;
  failed_at_height?: number;
  reason?: string;
}

export interface LeaderboardEntry {
  rank: number;
  account_id: string;
  kind: AccountKind;
  display_name: string;
  checking_balance_units: number;
  savings_balance_units: number;
  escrow_locked_units: number;
  net_worth_units: number;
}

export interface LeaderboardResponse {
  total_accounts: number;
  entries: LeaderboardEntry[];
  calculated_at: string;
}

export interface ValidatorSignature {
  validator_id: string;
  signature: string;
}

export interface Block {
  id: string;
  height: number;
  prev_hash: string;
  hash: string;
  sealed_at: string;
  validator_signatures: ValidatorSignature[];
  tx_count: number;
  difficulty_bits: number;
  nonce: number;
}

export interface Transaction {
  id: string;
  block_height: number | null;
  tx_index: number;
  type: string;
  from_account: string | null;
  to_account: string | null;
  amount_units: number;
  fee_units: number;
  memo: string | null;
  actor_signature: string;
  created_at: string;
  payload: Record<string, unknown> | null;
}

export interface BlockWithTransactions {
  block: Block;
  transactions: Transaction[];
}

export interface PolicyParams {
  mining_reward_multiplier?: number;
  bounty_posting_fee_bps?: number;
  savings_rate_bps?: number;
  treasury_grant_max_units?: number;
}

export interface PolicyProposal {
  mining_reward_multiplier: number;
  bounty_posting_fee_bps: number;
  savings_rate_bps: number;
  rationale: string;
  recommended_at: string;
}

export interface AssessmentMetrics {
  height: number;
  issued_units: number;
  supply_cap_units: number;
  issued_pct: number;
  inflation_per_period: number;
  tx_velocity: number;
  bounty_completion_rate: number;
  balance_concentration?: {
    top3_share_pct: number;
    top_holders: Array<{ account_id: string; balance_units: number; share_pct: number }>;
  };
  escrow_locked_units: number;
  burn_total_units: number;
  wash_flags_count?: number;
  proposal?: PolicyProposal;
}

export interface AssessmentRecord {
  id: string;
  block_height: number;
  metrics: AssessmentMetrics;
  wash_flags: string[];
  created_at: string;
}

export interface PolicyRecord {
  id: string;
  params: PolicyParams;
  effective_at: string;
  enacted_by_tx: string;
}

export interface CataloguePurchase {
  id: string;
  account_id: string;
  item_id: string;
  item_title?: string;
  price_units: number;
  tx_id: string;
  granted_at: string;
  status: string;
  message: string;
}
