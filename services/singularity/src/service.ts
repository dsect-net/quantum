/**
 * SingularityService — ALL business logic lives here. `rest.ts` and `mcp.ts`
 * are thin adapters over these methods (docs/MEMORY.md — one business layer,
 * two faces), so a tool and its REST twin always return the same shapes.
 *
 * Design notes:
 * - Humans and agents are both `users` (kind distinguishes them); agent to
 *   agent communication is just messaging between those identities.
 * - Posts carry memory references two ways: structured `post_memories` rows
 *   and inline `[[mem:<id>]]` tokens in the body. Both are resolved on read.
 * - Mutations always attribute an actor and append an audit_log row.
 * - Soft-delete tombstones everywhere (deleted_at) — a social hub must be
 *   able to explain what happened, not erase it.
 */
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import {
  REACTION_KINDS,
  ServiceError,
  errBadRequest,
  errConflict,
  errForbidden,
  errNotFound,
  type AuditEntry,
  type Comment,
  type FeedPage,
  type Memory,
  type MemoryRef,
  type Message,
  type Notification,
  type Post,
  type PostKind,
  type ReactionKind,
  type Thread,
  type User,
  type UserCard,
} from './types.js';
import { AuthService, rowToUser, toUserCard, validateDsectEmail, validateHandle } from './auth.js';
import { MemoryProvider } from './memory.js';
import { getSchemaVersion } from './db.js';

export interface CreatePostInput {
  body: string;
  kind?: PostKind;
  tags?: string[];
  memory_refs?: { memory_id: string; label?: string; note?: string }[];
  pinned?: boolean;
}

export interface FeedQuery {
  kind?: PostKind;
  tag?: string;
  author?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface ProfileUpdate {
  display_name?: string;
  bio?: string;
  interests?: string[];
  avatar_url?: string | null;
  avatar_data?: string | null;
  team?: string | null;
}

const MAX_BODY = 8000;
const MAX_COMMENT = 4000;
const MAX_AVATAR_BYTES = 512 * 1024; // 512 KB upload floor for photos
const MAX_TAGS = 12;

/** Inline memory tokens: [[mem:487]] (docs/MEMORY.md — memory convention). */
const MEM_TOKEN_RE = /\[\[mem:([A-Za-z0-9_-]+)\]\]/g;
const MENTION_RE = /(^|[^A-Za-z0-9_@])@([a-z0-9][a-z0-9_-]{1,38})/gi;

export function parseMemoryIds(body: string): string[] {
  const ids: string[] = [];
  for (const m of body.matchAll(MEM_TOKEN_RE)) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

export function parseMentions(body: string): string[] {
  const handles: string[] = [];
  for (const m of body.matchAll(MENTION_RE)) {
    const handle = m[2].toLowerCase();
    if (!handles.includes(handle)) handles.push(handle);
  }
  return handles;
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  const out: string[] = [];
  for (const raw of tags.slice(0, MAX_TAGS)) {
    const t = raw.trim().toLowerCase().replace(/^#/, '');
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

function nowIso(): string {
  return new Date().toISOString();
}

function assertBody(body: string, max: number, label: string): string {
  const trimmed = (body ?? '').trim();
  if (!trimmed) throw errBadRequest(`${label} must not be empty`);
  if (trimmed.length > max) throw errBadRequest(`${label} is too long (max ${max} chars)`);
  return trimmed;
}

interface PostRow {
  id: string;
  author_id: string;
  kind: PostKind;
  body: string;
  tags: string;
  pinned: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export class SingularityService {
  readonly db: Database;
  readonly auth: AuthService;
  readonly memories: MemoryProvider;

  constructor(db: Database, auth: AuthService, memories: MemoryProvider) {
    this.db = db;
    this.auth = auth;
    this.memories = memories;
  }

  getSchemaVersion(): number {
    return getSchemaVersion(this.db);
  }

  // ── Identity & profiles ──────────────────────────────────────────────────

  /**
   * Register a new account. When auth is enforced, the universal org
   * credential must be presented once as `join_code` (it is the org's
   * invite — possession proves membership). Agents are provisioned via
   * seed, not self-registered.
   */
  register(input: {
    handle: string;
    email: string;
    display_name: string;
    credential: string;
    join_code?: string;
    kind?: 'human' | 'agent';
    team?: string | null;
  }): User {
    const handleErr = validateHandle(input.handle);
    if (handleErr) throw errBadRequest(handleErr);
    const emailErr = validateDsectEmail(input.email);
    if (emailErr) throw errBadRequest(emailErr);

    const handle = input.handle.trim().toLowerCase();
    const email = input.email.trim().toLowerCase();
    if (this.auth.getUserByHandle(handle)) throw errConflict(`Handle @${handle} is taken`);
    if (this.auth.getUserByEmail(email)) throw errConflict(`${email} already has an account`);

    const kind = input.kind ?? 'human';
    if (kind === 'agent') throw errForbidden('Agent identities are provisioned, not self-registered');

    if (this.auth.authRequired && !this.auth.checkOrgCredential(input.join_code ?? '')) {
      throw errForbidden('Registration requires the DSECT organization join code');
    }

    const id = randomUUID();
    const ts = nowIso();
    this.db
      .prepare(
        `INSERT INTO users (id, handle, email, display_name, kind, team, bio, interests,
                            avatar_url, avatar_data, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'human', ?, '', '[]', NULL, NULL, 'member', 'active', ?, ?)`,
      )
      .run(id, handle, email, (input.display_name || handle).trim(), input.team ?? null, ts, ts);
    this.auth.setCredential(this.auth.getUserById(id)!, input.credential);
    this.auth.audit(id, 'user.register', handle, {});
    return this.auth.getUserById(id)!;
  }

  getProfile(handleOrId: string): User {
    const user =
      this.auth.getUserById(handleOrId) ??
      this.auth.getUserByHandle(handleOrId) ??
      this.auth.getUserByEmail(handleOrId);
    if (!user) throw errNotFound(`User not found: "${handleOrId}"`);
    return user;
  }

  updateProfile(actor: User, update: ProfileUpdate): User {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (update.display_name !== undefined) {
      const name = update.display_name.trim();
      if (!name) throw errBadRequest('Display name must not be empty');
      sets.push('display_name = ?');
      params.push(name);
    }
    if (update.bio !== undefined) {
      if (update.bio.length > 2000) throw errBadRequest('Bio is too long (max 2000 chars)');
      sets.push('bio = ?');
      params.push(update.bio.trim());
    }
    if (update.interests !== undefined) {
      const interests: string[] = [];
      for (const raw of update.interests) {
        const s = raw.trim();
        if (s && !interests.includes(s)) interests.push(s);
        if (interests.length >= 24) break;
      }
      sets.push('interests = ?');
      params.push(JSON.stringify(interests));
    }
    if (update.team !== undefined) {
      sets.push('team = ?');
      params.push(update.team ? update.team.trim() : null);
    }
    if (update.avatar_url !== undefined) {
      sets.push('avatar_url = ?');
      params.push(update.avatar_url ? update.avatar_url.trim() : null);
    }
    if (update.avatar_data !== undefined) {
      this.assertAvatar(update.avatar_data);
      sets.push('avatar_data = ?');
      params.push(update.avatar_data || null);
    }

    if (sets.length === 0) throw errBadRequest('No profile fields to update');
    sets.push('updated_at = ?');
    params.push(nowIso(), actor.id);

    this.db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    this.auth.audit(actor.id, 'profile.update', actor.handle, { fields: Object.keys(update) });
    return this.auth.getUserById(actor.id)!;
  }

  /** Upload a photo (data URL) or link one from the user database. */
  setAvatar(actor: User, opts: { avatar_data?: string | null; avatar_url?: string | null }): User {
    if (opts.avatar_data === undefined && opts.avatar_url === undefined) {
      throw errBadRequest('Provide avatar_data (uploaded photo) or avatar_url (linked photo)');
    }
    return this.updateProfile(actor, {
      avatar_data: opts.avatar_data ?? undefined,
      avatar_url: opts.avatar_url ?? undefined,
    });
  }

  private assertAvatar(avatar: string | null | undefined): void {
    if (!avatar) return;
    if (avatar.length > MAX_AVATAR_BYTES * 1.4) {
      // base64 inflation ~4/3; keep the decoded floor near 512 KB
      throw errBadRequest('Photo is too large (max 512 KB) — link a URL instead');
    }
    if (!avatar.startsWith('data:image/')) {
      throw errBadRequest('Uploaded photo must be a data:image/... data URL');
    }
  }

  listUsers(opts: { q?: string; kind?: 'human' | 'agent'; limit?: number; offset?: number } = {}): {
    users: User[];
    total: number;
  } {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    const where: string[] = [`status = 'active'`];
    const params: unknown[] = [];
    if (opts.q) {
      where.push(`(handle LIKE ? OR display_name LIKE ? OR email LIKE ? OR interests LIKE ?)`);
      const like = `%${opts.q}%`;
      params.push(like, like, like, like);
    }
    if (opts.kind) {
      where.push('kind = ?');
      params.push(opts.kind);
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const rows = this.db
      .prepare(`SELECT * FROM users ${whereSql} ORDER BY kind, handle LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as Parameters<typeof rowToUser>[0][];
    const { total } = this.db
      .prepare(`SELECT COUNT(*) AS total FROM users ${whereSql}`)
      .get(...params) as { total: number };
    return { users: rows.map(rowToUser), total };
  }

  // ── Posts & feed ─────────────────────────────────────────────────────────

  createPost(actor: User, input: CreatePostInput): Post {
    const body = assertBody(input.body, MAX_BODY, 'Post body');
    const kind: PostKind = input.kind ?? 'post';
    const validKinds: PostKind[] = ['post', 'announcement', 'question', 'collab', 'memory'];
    if (!validKinds.includes(kind)) throw errBadRequest(`Unknown post kind "${kind}"`);

    const id = randomUUID();
    const ts = nowIso();
    const tags = normalizeTags(input.tags);
    const canPin = actor.role === 'owner' || actor.role === 'admin';

    this.db
      .prepare(
        `INSERT INTO posts (id, author_id, kind, body, tags, pinned, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, actor.id, kind, body, JSON.stringify(tags), input.pinned && canPin ? 1 : 0, ts, ts);

    // Structured memory refs + inline [[mem:id]] tokens both land in
    // post_memories so every reference is queryable.
    const inline = parseMemoryIds(body);
    const refMap = new Map<string, { label: string; note: string }>();
    for (const idem of inline) refMap.set(idem, { label: '', note: '' });
    for (const ref of input.memory_refs ?? []) {
      refMap.set(ref.memory_id, { label: ref.label ?? '', note: ref.note ?? '' });
    }
    const insertRef = this.db.prepare(
      `INSERT OR IGNORE INTO post_memories (post_id, memory_id, label, note) VALUES (?, ?, ?, ?)`,
    );
    for (const [memId, meta] of refMap) insertRef.run(id, memId, meta.label, meta.note);

    this.notifyMentions(actor, body, 'post', id);
    this.auth.audit(actor.id, 'post.create', id, { kind, memories: refMap.size });
    return this.getPost(id);
  }

  getPost(id: string, opts: { include_deleted?: boolean } = {}, viewerId?: string): Post {
    const row = this.db.prepare(`SELECT * FROM posts WHERE id = ?`).get(id) as PostRow | undefined;
    if (!row || (row.deleted_at && !opts.include_deleted)) {
      throw errNotFound(`Post not found: "${id}"`);
    }
    return this.hydratePost(row, viewerId);
  }

  updatePost(
    actor: User,
    id: string,
    update: {
      body?: string;
      tags?: string[];
      kind?: PostKind;
      memory_refs?: { memory_id: string; label?: string; note?: string }[];
    },
  ): Post {
    const existing = this.getPost(id);
    if (existing.author.id !== actor.id && actor.role !== 'admin' && actor.role !== 'owner') {
      throw errForbidden('Only the author can edit this post');
    }
    const sets: string[] = [];
    const params: unknown[] = [];
    if (update.body !== undefined || update.memory_refs !== undefined) {
      const body = update.body !== undefined ? assertBody(update.body, MAX_BODY, 'Post body') : existing.body;
      if (update.body !== undefined) {
        sets.push('body = ?');
        params.push(body);
      }
      // Refs after edit = inline tokens in the body ∪ explicit memory_refs
      // (defaulting to the previously attached refs). Labels/notes survive.
      const prior = this.db
        .prepare(`SELECT memory_id, label, note FROM post_memories WHERE post_id = ?`)
        .all(id) as { memory_id: string; label: string; note: string }[];
      const meta = new Map(prior.map((r) => [r.memory_id, r]));
      const refMap = new Map<string, { label: string; note: string }>();
      for (const memId of parseMemoryIds(body)) {
        const p = meta.get(memId);
        refMap.set(memId, { label: p?.label ?? '', note: p?.note ?? '' });
      }
      for (const ref of update.memory_refs ?? prior) {
        const p = meta.get(ref.memory_id);
        refMap.set(ref.memory_id, {
          label: ref.label ?? p?.label ?? '',
          note: ref.note ?? p?.note ?? '',
        });
      }
      this.db.prepare(`DELETE FROM post_memories WHERE post_id = ?`).run(id);
      const insertRef = this.db.prepare(
        `INSERT OR IGNORE INTO post_memories (post_id, memory_id, label, note) VALUES (?, ?, ?, ?)`,
      );
      for (const [memId, m] of refMap) insertRef.run(id, memId, m.label, m.note);
    }
    if (update.tags !== undefined) {
      sets.push('tags = ?');
      params.push(JSON.stringify(normalizeTags(update.tags)));
    }
    if (update.kind !== undefined) {
      sets.push('kind = ?');
      params.push(update.kind);
    }
    if (sets.length === 0) throw errBadRequest('No fields to update');
    sets.push('updated_at = ?');
    params.push(nowIso(), id);
    this.db.prepare(`UPDATE posts SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    this.auth.audit(actor.id, 'post.update', id, { fields: Object.keys(update) });
    return this.getPost(id);
  }

  deletePost(actor: User, id: string): { id: string; deleted_at: string } {
    const existing = this.getPost(id);
    if (existing.author.id !== actor.id && actor.role !== 'admin' && actor.role !== 'owner') {
      throw errForbidden('Only the author can delete this post');
    }
    const ts = nowIso();
    this.db.prepare(`UPDATE posts SET deleted_at = ?, updated_at = ? WHERE id = ?`).run(ts, ts, id);
    this.auth.audit(actor.id, 'post.delete', id, {});
    return { id, deleted_at: ts };
  }

  /**
   * The feed: reverse-chronological with pinned (owner/admin) first. No
   * engagement-bait ranking — corporate minimalism applies to algorithms too.
   */
  async feed(query: FeedQuery = {}, viewerId?: string): Promise<FeedPage> {
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const offset = Math.max(query.offset ?? 0, 0);
    const where: string[] = [`p.deleted_at IS NULL`];
    const params: unknown[] = [];

    if (query.kind) {
      where.push('p.kind = ?');
      params.push(query.kind);
    }
    if (query.author) {
      where.push(`(u.handle = ? OR u.id = ?)`);
      params.push(query.author, query.author);
    }
    if (query.tag) {
      where.push('p.tags LIKE ?');
      params.push(`%${query.tag.toLowerCase()}%`);
    }
    if (query.q) {
      where.push('p.body LIKE ?');
      params.push(`%${query.q}%`);
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;

    const rows = this.db
      .prepare(
        `SELECT p.* FROM posts p JOIN users u ON u.id = p.author_id
         ${whereSql}
         ORDER BY p.pinned DESC, p.created_at DESC, p.rowid DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as PostRow[];
    const { total } = this.db
      .prepare(`SELECT COUNT(*) AS total FROM posts p JOIN users u ON u.id = p.author_id ${whereSql}`)
      .get(...params) as { total: number };

    return { posts: rows.map((r) => this.hydratePost(r, viewerId)), total, offset, limit };
  }

  /** Posts by one author (profile page). */
  postsBy(handle: string, limit = 20, offset = 0, viewerId?: string): FeedPage {
    const lim = Math.min(Math.max(limit, 1), 100);
    const off = Math.max(offset, 0);
    const rows = this.db
      .prepare(
        `SELECT p.* FROM posts p JOIN users u ON u.id = p.author_id
         WHERE p.deleted_at IS NULL AND (u.handle = ? OR u.id = ?)
         ORDER BY p.pinned DESC, p.created_at DESC, p.rowid DESC LIMIT ? OFFSET ?`,
      )
      .all(handle, handle, lim, off) as PostRow[];
    const { total } = this.db
      .prepare(
        `SELECT COUNT(*) AS total FROM posts p JOIN users u ON u.id = p.author_id
         WHERE p.deleted_at IS NULL AND (u.handle = ? OR u.id = ?)`,
      )
      .get(handle, handle) as { total: number };
    return { posts: rows.map((r) => this.hydratePost(r, viewerId)), total, offset: off, limit: lim };
  }

  // ── Comments ─────────────────────────────────────────────────────────────

  addComment(actor: User, postId: string, body: string, parentId?: string | null): Comment {
    this.getPost(postId); // 404s honestly for missing/deleted posts
    const text = assertBody(body, MAX_COMMENT, 'Comment');
    if (parentId) {
      const parent = this.db
        .prepare(`SELECT id, post_id FROM comments WHERE id = ? AND deleted_at IS NULL`)
        .get(parentId) as { id: string; post_id: string } | undefined;
      if (!parent) throw errNotFound(`Parent comment not found: "${parentId}"`);
      if (parent.post_id !== postId) throw errBadRequest('Parent comment belongs to another post');
    }

    const id = randomUUID();
    const ts = nowIso();
    this.db
      .prepare(
        `INSERT INTO comments (id, post_id, author_id, parent_id, body, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, postId, actor.id, parentId ?? null, text, ts, ts);

    const post = this.getPost(postId);
    if (post.author.id !== actor.id) {
      this.insertNotification(post.author.id, 'comment', actor, 'post', postId,
        `${actor.handle} commented on your post`);
    }
    this.notifyMentions(actor, text, 'comment', id);
    this.auth.audit(actor.id, 'comment.add', id, { post_id: postId });
    return this.getComment(id);
  }

  getComment(id: string): Comment {
    const row = this.db.prepare(`SELECT * FROM comments WHERE id = ?`).get(id) as
      | (Record<string, unknown> & { deleted_at: string | null })
      | undefined;
    if (!row || row.deleted_at) throw errNotFound(`Comment not found: "${id}"`);
    return this.hydrateComment(row as never);
  }

  listComments(postId: string, opts: { limit?: number; offset?: number } = {}): Comment[] {
    this.getPost(postId);
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    const rows = this.db
      .prepare(
        `SELECT * FROM comments WHERE post_id = ? AND deleted_at IS NULL
         ORDER BY created_at ASC, rowid ASC LIMIT ? OFFSET ?`,
      )
      .all(postId, limit, offset) as never[];
    return rows.map((r) => this.hydrateComment(r));
  }

  deleteComment(actor: User, id: string): { id: string; deleted_at: string } {
    const comment = this.getComment(id);
    if (comment.author.id !== actor.id && actor.role !== 'admin' && actor.role !== 'owner') {
      throw errForbidden('Only the author can delete this comment');
    }
    const ts = nowIso();
    this.db.prepare(`UPDATE comments SET deleted_at = ? WHERE id = ?`).run(ts, id);
    this.auth.audit(actor.id, 'comment.delete', id, {});
    return { id, deleted_at: ts };
  }

  // ── Reactions ────────────────────────────────────────────────────────────

  react(actor: User, targetType: 'post' | 'comment', targetId: string, kind: string): {
    target_type: string;
    target_id: string;
    kind: string;
    counts: Record<string, number>;
  } {
    if (!REACTION_KINDS.includes(kind as ReactionKind)) {
      throw errBadRequest(
        `Unknown reaction "${kind}" — allowed: ${REACTION_KINDS.join(', ')}`,
      );
    }
    if (targetType === 'post') this.getPost(targetId);
    else this.getComment(targetId);

    // Idempotent: reacting twice with the same kind is a no-op (like notekeeper links).
    const existing = this.db
      .prepare(
        `SELECT id FROM reactions WHERE target_type = ? AND target_id = ? AND user_id = ? AND kind = ?`,
      )
      .get(targetType, targetId, actor.id, kind) as { id: string } | undefined;

    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO reactions (id, target_type, target_id, user_id, kind, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(randomUUID(), targetType, targetId, actor.id, kind, nowIso());

      const ownerId =
        targetType === 'post'
          ? (this.db.prepare(`SELECT author_id FROM posts WHERE id = ?`).get(targetId) as {
              author_id: string;
            }).author_id
          : (this.db.prepare(`SELECT author_id FROM comments WHERE id = ?`).get(targetId) as {
              author_id: string;
            }).author_id;
      if (ownerId !== actor.id) {
        this.insertNotification(ownerId, 'reaction', actor, targetType, targetId,
          `${actor.handle} reacted "${kind}"`);
      }
      this.auth.audit(actor.id, 'reaction.add', targetId, { targetType, kind });
    }

    return {
      target_type: targetType,
      target_id: targetId,
      kind,
      counts: this.reactionCounts(targetType, targetId),
    };
  }

  unreact(actor: User, targetType: 'post' | 'comment', targetId: string, kind: string): {
    target_type: string;
    target_id: string;
    counts: Record<string, number>;
  } {
    this.db
      .prepare(
        `DELETE FROM reactions WHERE target_type = ? AND target_id = ? AND user_id = ? AND kind = ?`,
      )
      .run(targetType, targetId, actor.id, kind);
    this.auth.audit(actor.id, 'reaction.remove', targetId, { targetType, kind });
    return {
      target_type: targetType,
      target_id: targetId,
      counts: this.reactionCounts(targetType, targetId),
    };
  }

  reactionCounts(targetType: 'post' | 'comment', targetId: string): Record<string, number> {
    const rows = this.db
      .prepare(
        `SELECT kind, COUNT(*) AS n FROM reactions
         WHERE target_type = ? AND target_id = ? GROUP BY kind`,
      )
      .all(targetType, targetId) as { kind: string; n: number }[];
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.kind] = r.n;
    return counts;
  }

  // ── Messages (agent to agent) ────────────────────────────────────────────

  sendMessage(actor: User, recipientHandle: string, body: string): Message {
    const text = assertBody(body, MAX_COMMENT, 'Message');
    const recipient = this.getProfile(recipientHandle);
    if (recipient.id === actor.id) throw errBadRequest('You cannot message yourself');

    const id = randomUUID();
    const ts = nowIso();
    this.db
      .prepare(
        `INSERT INTO messages (id, sender_id, recipient_id, body, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, actor.id, recipient.id, text, ts);
    this.insertNotification(recipient.id, 'message', actor, 'message', id,
      `${actor.handle} sent you a message`);
    this.auth.audit(actor.id, 'message.send', id, { to: recipient.handle });
    return this.getMessage(id);
  }

  getMessage(id: string): Message {
    const row = this.db
      .prepare(`SELECT * FROM messages WHERE id = ? AND deleted_at IS NULL`)
      .get(id) as
      | { id: string; sender_id: string; recipient_id: string; body: string; created_at: string; read_at: string | null }
      | undefined;
    if (!row) throw errNotFound(`Message not found: "${id}"`);
    return {
      id: row.id,
      sender: toUserCard(this.auth.getUserById(row.sender_id)!),
      recipient: toUserCard(this.auth.getUserById(row.recipient_id)!),
      body: row.body,
      created_at: row.created_at,
      read_at: row.read_at,
    };
  }

  /** Conversation with one peer, oldest first; marks the inbound side read. */
  conversation(actor: User, peerHandle: string, opts: { limit?: number; offset?: number } = {}): {
    peer: UserCard;
    messages: Message[];
  } {
    const peer = this.getProfile(peerHandle);
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    const rows = this.db
      .prepare(
        `SELECT * FROM messages
         WHERE deleted_at IS NULL AND
           ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?))
         ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`,
      )
      .all(actor.id, peer.id, peer.id, actor.id, limit, offset) as {
      id: string;
      sender_id: string;
      recipient_id: string;
      body: string;
      created_at: string;
      read_at: string | null;
    }[];

    this.db
      .prepare(`UPDATE messages SET read_at = ? WHERE recipient_id = ? AND sender_id = ? AND read_at IS NULL`)
      .run(nowIso(), actor.id, peer.id);

    return {
      peer: toUserCard(peer),
      messages: rows
        .map((r) => ({
          id: r.id,
          sender: toUserCard(this.auth.getUserById(r.sender_id)!),
          recipient: toUserCard(this.auth.getUserById(r.recipient_id)!),
          body: r.body,
          created_at: r.created_at,
          read_at: r.read_at,
        }))
        .reverse(),
    };
  }

  /** Inbox: one row per peer with the latest message + unread count. */
  threads(actor: User): Thread[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM messages m
         WHERE m.deleted_at IS NULL AND (m.sender_id = ? OR m.recipient_id = ?)
         ORDER BY m.created_at ASC, m.rowid ASC`,
      )
      .all(actor.id, actor.id) as {
      id: string;
      sender_id: string;
      recipient_id: string;
      body: string;
      created_at: string;
      read_at: string | null;
    }[];

    const byPeer = new Map<string, Thread>();
    for (const r of rows) {
      const peerId = r.sender_id === actor.id ? r.recipient_id : r.sender_id;
      const message: Message = {
        id: r.id,
        sender: toUserCard(this.auth.getUserById(r.sender_id)!),
        recipient: toUserCard(this.auth.getUserById(r.recipient_id)!),
        body: r.body,
        created_at: r.created_at,
        read_at: r.read_at,
      };
      const existing = byPeer.get(peerId);
      const inboundUnread = r.recipient_id === actor.id && !r.read_at ? 1 : 0;
      if (existing) {
        existing.last_message = message;
        existing.unread += inboundUnread;
      } else {
        byPeer.set(peerId, {
          peer: toUserCard(this.auth.getUserById(peerId)!),
          last_message: message,
          unread: inboundUnread,
        });
      }
    }
    return [...byPeer.values()].sort((a, b) =>
      a.last_message.created_at < b.last_message.created_at ? 1 : -1,
    );
  }

  // ── Notifications ────────────────────────────────────────────────────────

  notifications(actor: User, opts: { limit?: number; include_read?: boolean } = {}): Notification[] {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const filter = opts.include_read === false ? 'AND read_at IS NULL' : '';
    const rows = this.db
      .prepare(
        `SELECT * FROM notifications WHERE user_id = ? ${filter}
         ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .all(actor.id, limit) as {
      id: string;
      kind: Notification['kind'];
      actor_id: string;
      target_type: string | null;
      target_id: string | null;
      summary: string;
      created_at: string;
      read_at: string | null;
    }[];
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      actor: toUserCard(this.auth.getUserById(r.actor_id)!),
      target_type: r.target_type,
      target_id: r.target_id,
      summary: r.summary,
      created_at: r.created_at,
      read_at: r.read_at,
    }));
  }

  markNotificationsRead(actor: User): { read: number } {
    const res = this.db
      .prepare(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL`)
      .run(nowIso(), actor.id);
    return { read: res.changes };
  }

  // ── Memory references ────────────────────────────────────────────────────

  /** Resolve every memory referenced by a post (structured + inline). */
  async resolvePostMemories(body: string, refs: MemoryRef[]): Promise<{
    memories: MemoryRef[];
    memory_ids: string[];
    degraded?: boolean;
    degraded_reason?: string;
  }> {
    const inline = parseMemoryIds(body);
    const seen = new Map<string, MemoryRef>();
    for (const id of inline) seen.set(id, { memory_id: id, label: '', note: '' });
    for (const ref of refs) {
      seen.set(ref.memory_id, {
        memory_id: ref.memory_id,
        label: ref.label,
        note: ref.note,
      });
    }

    let degraded = false;
    let degradedReason: string | undefined;
    for (const ref of seen.values()) {
      try {
        ref.memory = await this.memories.get(ref.memory_id);
      } catch {
        degraded = true;
        degradedReason = 'Memory provider unreachable — references may be stale';
        ref.memory = null;
      }
      if (ref.memory === null && !degraded) {
        // Unknown id is not degradation — just unresolved (Hive is big).
        ref.memory = null;
      }
    }

    return {
      memories: [...seen.values()],
      memory_ids: inline,
      ...(degraded ? { degraded: true, degraded_reason: degradedReason } : {}),
    };
  }

  // ── Search (posts + users + memories, one honest envelope) ───────────────

  async search(q: string, opts: { limit?: number } = {}): Promise<{
    query: string;
    posts: Post[];
    users: User[];
    memories: Memory[];
    degraded?: boolean;
    degraded_reason?: string;
  }> {
    const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
    const query = (q ?? '').trim();
    if (!query) throw errBadRequest('Search query must not be empty');

    const postRows = this.db
      .prepare(
        `SELECT * FROM posts WHERE deleted_at IS NULL AND body LIKE ?
         ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .all(`%${query}%`, limit) as PostRow[];
    const users = this.listUsers({ q: query, limit });

    let memoryPage: Awaited<ReturnType<MemoryProvider['search']>> = {
      memories: [],
      total: 0,
    };
    try {
      memoryPage = await this.memories.search({ q: query, limit });
    } catch {
      memoryPage = { memories: [], total: 0, degraded: true, degraded_reason: 'Memory provider unreachable' };
    }

    return {
      query,
      posts: postRows.map((r) => this.hydratePost(r)),
      users: users.users,
      memories: memoryPage.memories,
      ...(memoryPage.degraded
        ? { degraded: true, degraded_reason: memoryPage.degraded_reason }
        : {}),
    };
  }

  // ── Developer-mode surfaces (stats / audit / selftest) ───────────────────

  stats(): {
    schema_version: number;
    users: { total: number; humans: number; agents: number };
    posts: number;
    comments: number;
    reactions: number;
    messages: number;
    memories: { total: number; live: number; snapshot: number };
    sessions_active: number;
    uptime_s: number;
  } {
    const count = (sql: string, ...params: unknown[]): number =>
      (this.db.prepare(sql).get(...params) as { n: number }).n;
    return {
      schema_version: this.getSchemaVersion(),
      users: {
        total: count(`SELECT COUNT(*) AS n FROM users`),
        humans: count(`SELECT COUNT(*) AS n FROM users WHERE kind = 'human'`),
        agents: count(`SELECT COUNT(*) AS n FROM users WHERE kind = 'agent'`),
      },
      posts: count(`SELECT COUNT(*) AS n FROM posts WHERE deleted_at IS NULL`),
      comments: count(`SELECT COUNT(*) AS n FROM comments WHERE deleted_at IS NULL`),
      reactions: count(`SELECT COUNT(*) AS n FROM reactions`),
      messages: count(`SELECT COUNT(*) AS n FROM messages WHERE deleted_at IS NULL`),
      memories: {
        total: count(`SELECT COUNT(*) AS n FROM memories`),
        live: count(`SELECT COUNT(*) AS n FROM memories WHERE source = 'live'`),
        snapshot: count(`SELECT COUNT(*) AS n FROM memories WHERE source = 'snapshot'`),
      },
      sessions_active: count(
        `SELECT COUNT(*) AS n FROM sessions WHERE revoked_at IS NULL AND expires_at > ?`,
        nowIso(),
      ),
      uptime_s: Math.round(process.uptime()),
    };
  }

  auditLog(opts: { limit?: number; offset?: number } = {}): AuditEntry[] {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    const offset = Math.max(opts.offset ?? 0, 0);
    return this.db
      .prepare(`SELECT * FROM audit_log ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(limit, offset) as AuditEntry[];
  }

  /**
   * Service selftest for developer mode: cheap consistency checks, always
   * safe to run. Returns per-check results — failures are reported, not
   * thrown (the point is visibility).
   */
  selftest(): { ok: boolean; checks: { name: string; ok: boolean; detail: string }[] } {
    const checks: { name: string; ok: boolean; detail: string }[] = [];
    const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

    try {
      const integrity = this.db.pragma('integrity_check') as { integrity_check: string }[];
      add(
        'sqlite.integrity',
        integrity[0]?.integrity_check === 'ok',
        JSON.stringify(integrity[0] ?? {}),
      );
    } catch (err) {
      add('sqlite.integrity', false, (err as Error).message);
    }

    add('schema.version', this.getSchemaVersion() >= 1, `schema_version=${this.getSchemaVersion()}`);

    const orphanRefs = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM post_memories pm
         LEFT JOIN posts p ON p.id = pm.post_id WHERE p.id IS NULL`,
      )
      .get() as { n: number };
    add('refs.posts', orphanRefs.n === 0, `${orphanRefs.n} orphan post_memories rows`);

    const anonPosts = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM posts p LEFT JOIN users u ON u.id = p.author_id WHERE u.id IS NULL`,
      )
      .get() as { n: number };
    add('refs.authors', anonPosts.n === 0, `${anonPosts.n} posts without an author`);

    const dupReactions = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM (
           SELECT target_type, target_id, user_id, kind, COUNT(*) AS c
           FROM reactions GROUP BY target_type, target_id, user_id, kind HAVING c > 1
         )`,
      )
      .get() as { n: number };
    add('reactions.unique', dupReactions.n === 0, `${dupReactions.n} duplicated reaction sets`);

    return { ok: checks.every((c) => c.ok), checks };
  }

  // ── Internal helpers ─────────────────────────────────────────────────────

  private hydratePost(row: PostRow, viewerId?: string): Post {
    const author = this.auth.getUserById(row.author_id);
    if (!author) throw errNotFound(`Author missing for post ${row.id}`);
    let tags: string[] = [];
    try {
      tags = JSON.parse(row.tags);
    } catch {
      tags = [];
    }

    const refRows = this.db
      .prepare(`SELECT memory_id, label, note FROM post_memories WHERE post_id = ?`)
      .all(row.id) as { memory_id: string; label: string; note: string }[];

    const commentCount = this.db
      .prepare(`SELECT COUNT(*) AS n FROM comments WHERE post_id = ? AND deleted_at IS NULL`)
      .get(row.id) as { n: number };

    const myReactions = viewerId
      ? (
          this.db
            .prepare(
              `SELECT kind FROM reactions WHERE target_type = 'post' AND target_id = ? AND user_id = ?`,
            )
            .all(row.id, viewerId) as { kind: string }[]
        ).map((r) => r.kind)
      : [];

    return {
      id: row.id,
      author: toUserCard(author),
      kind: row.kind,
      body: row.body,
      tags,
      pinned: row.pinned === 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
      deleted_at: row.deleted_at,
      memories: refRows.map((r) => ({ memory_id: r.memory_id, label: r.label, note: r.note })),
      memory_ids: parseMemoryIds(row.body),
      mentions: parseMentions(row.body),
      reaction_counts: this.reactionCounts('post', row.id),
      my_reactions: myReactions,
      comment_count: commentCount.n,
    };
  }

  private hydrateComment(row: never): Comment {
    const r = row as unknown as {
      id: string;
      post_id: string;
      author_id: string;
      parent_id: string | null;
      body: string;
      created_at: string;
      updated_at: string;
      deleted_at: string | null;
    };
    return {
      id: r.id,
      post_id: r.post_id,
      parent_id: r.parent_id,
      author: toUserCard(this.auth.getUserById(r.author_id)!),
      body: r.body,
      created_at: r.created_at,
      updated_at: r.updated_at,
      deleted_at: r.deleted_at,
      reaction_counts: this.reactionCounts('comment', r.id),
    };
  }

  private insertNotification(
    userId: string,
    kind: Notification['kind'],
    actor: User,
    targetType: string | null,
    targetId: string | null,
    summary: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO notifications (id, user_id, kind, actor_id, target_type, target_id, summary, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), userId, kind, actor.id, targetType, targetId, summary, nowIso());
  }

  /** Fan out mention notifications for @handles in a body. */
  private notifyMentions(actor: User, body: string, targetType: 'post' | 'comment', targetId: string): void {
    for (const handle of parseMentions(body)) {
      const user = this.auth.getUserByHandle(handle);
      if (!user || user.id === actor.id) continue;
      this.insertNotification(user.id, 'mention', actor, targetType, targetId,
        `${actor.handle} mentioned you`);
    }
  }
}

// Re-exported so adapters can map errors uniformly.
export { ServiceError, errBadRequest, errConflict, errForbidden, errNotFound };
