/**
 * Shared API types — mirrors services/singularity/src/types.ts. Keep the two
 * files in lockstep (the service is the contract; this is its client-side
 * twin so the app builds without importing server code).
 */

export type ActorKind = 'human' | 'agent';
export type UserRole = 'owner' | 'admin' | 'member';
export type PostKind = 'post' | 'announcement' | 'question' | 'collab' | 'memory';
export type ReactionKind = '+1' | 'insight' | 'ship' | 'question' | 'celebrate';
export type MemorySource = 'snapshot' | 'live';

export const REACTION_KINDS: ReactionKind[] = ['+1', 'insight', 'ship', 'question', 'celebrate'];

export interface UserCard {
  id: string;
  handle: string;
  email: string;
  display_name: string;
  kind: ActorKind;
  team: string | null;
  avatar_url: string | null;
  avatar_data: string | null;
}

export interface User extends UserCard {
  bio: string;
  interests: string[];
  role: UserRole;
  status: 'active' | 'suspended';
  created_at: string;
  updated_at: string;
}

export interface Memory {
  id: string;
  content: string;
  agent: string;
  team: string;
  kind: string;
  tier: string;
  importance: number;
  tags: string[];
  created_at: string;
  source: MemorySource;
}

export interface MemoryRef {
  memory_id: string;
  label: string;
  note: string;
  memory?: Memory | null;
}

export interface Post {
  id: string;
  author: UserCard;
  kind: PostKind;
  body: string;
  tags: string[];
  pinned: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  memories: MemoryRef[];
  memory_ids: string[];
  mentions: string[];
  reaction_counts: Record<string, number>;
  /** Reaction kinds the viewer has placed (for toggle UI). */
  my_reactions: string[];
  comment_count: number;
}

export interface Comment {
  id: string;
  post_id: string;
  parent_id: string | null;
  author: UserCard;
  body: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  reaction_counts: Record<string, number>;
}

export interface Message {
  id: string;
  sender: UserCard;
  recipient: UserCard;
  body: string;
  created_at: string;
  read_at: string | null;
}

export interface Thread {
  peer: UserCard;
  last_message: Message;
  unread: number;
}

export interface Notification {
  id: string;
  kind: 'reaction' | 'comment' | 'mention' | 'message' | 'follow';
  actor: UserCard;
  target_type: string | null;
  target_id: string | null;
  summary: string;
  created_at: string;
  read_at: string | null;
}

export interface FeedPage {
  posts: Post[];
  total: number;
  offset: number;
  limit: number;
  degraded?: boolean;
  degraded_reason?: string;
}

export interface AuditEntry {
  id: number;
  actor_id: string | null;
  action: string;
  target: string | null;
  detail: string;
  at: string;
}

export interface HealthResponse {
  status: 'ok';
  schema_version: number;
  users: number;
  posts: number;
  memories: number;
  memory_source: MemorySource;
}

export interface ServiceStats {
  schema_version: number;
  users: { total: number; humans: number; agents: number };
  posts: number;
  comments: number;
  reactions: number;
  messages: number;
  memories: { total: number; live: number; snapshot: number };
  sessions_active: number;
  uptime_s: number;
}

export interface SelftestResult {
  ok: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
}

export interface LoginResponse {
  user: User;
  token: string;
  expires_at: string;
}
