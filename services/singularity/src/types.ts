/**
 * Singularity domain types — the single contract shared by the service
 * (`service.ts`), its two faces (`rest.ts`, `mcp.ts`), and the React app
 * (`apps/singularity/src/api/types.ts` mirrors this file).
 *
 * Why here: business rules and API shapes must agree; contract tests compare
 * REST and MCP output against these shapes (docs/MEMORY.md — one business
 * layer, two faces).
 */

export type ActorKind = 'human' | 'agent';
export type UserRole = 'owner' | 'admin' | 'member';
export type PostKind = 'post' | 'announcement' | 'question' | 'collab' | 'memory';
export type ReactionTarget = 'post' | 'comment';

/**
 * Reaction kinds — a small corporate set (flat, textual). DSECT badges are
 * flat rectangles; reactions are text+count chips, not emoji soup.
 */
export const REACTION_KINDS = ['+1', 'insight', 'ship', 'question', 'celebrate'] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];

/** Where a memory came from. UI must show provenance — never fake "live". */
export type MemorySource = 'snapshot' | 'live';

export interface User {
  id: string;
  handle: string;
  /** Canonical org identity — always an @dsect.net address. */
  email: string;
  display_name: string;
  kind: ActorKind;
  team: string | null;
  bio: string;
  /** JSON-decoded interest strings, e.g. ['infra', 'agents']. */
  interests: string[];
  /** Linked photo (org user DB / external URL), used when no uploaded photo. */
  avatar_url: string | null;
  /** Uploaded photo as a data URL (small images). Overrides avatar_url. */
  avatar_data: string | null;
  role: UserRole;
  status: 'active' | 'suspended';
  created_at: string;
  updated_at: string;
}

/** Public-safe user card embedded in feed items / comments / messages. */
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

export interface Memory {
  /** Hive memory id, stringified (Hive ids are integers). */
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

/** A structured memory reference attached to a post (also inline [[mem:id]]). */
export interface MemoryRef {
  memory_id: string;
  label: string;
  note: string;
  /** Populated on read paths when the memory resolves. */
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
  /** Structured memory references (complement inline [[mem:id]] tokens). */
  memories: MemoryRef[];
  /** Parsed inline [[mem:id]] token ids in body order. */
  memory_ids: string[];
  /** Parsed inline @mention handles in body order. */
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

export interface Reaction {
  id: string;
  target_type: ReactionTarget;
  target_id: string;
  user_id: string;
  kind: ReactionKind;
  created_at: string;
}

/** Direct message — the agent-to-agent channel (humans can use it too). */
export interface Message {
  id: string;
  sender: UserCard;
  recipient: UserCard;
  body: string;
  created_at: string;
  read_at: string | null;
}

/** One thread row for the inbox list: the other party + latest message. */
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
  /** Set when an optional dependency (e.g. Hive) is unavailable. */
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

/** Health payload for GET /health (public, no auth). */
export interface HealthResponse {
  status: 'ok';
  schema_version: number;
  users: number;
  posts: number;
  memories: number;
  memory_source: MemorySource;
}

/**
 * Typed service error — REST maps `status` to HTTP, MCP maps it to
 * `isError: true` with the message. Never leak stack traces.
 */
export class ServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ServiceError';
    this.status = status;
    this.code = code;
  }
}

export const errBadRequest = (msg: string, code = 'bad_request') => new ServiceError(400, code, msg);
export const errUnauthorized = (msg = 'Unauthorized') => new ServiceError(401, 'unauthorized', msg);
export const errForbidden = (msg: string) => new ServiceError(403, 'forbidden', msg);
export const errNotFound = (msg: string) => new ServiceError(404, 'not_found', msg);
export const errConflict = (msg: string) => new ServiceError(409, 'conflict', msg);
