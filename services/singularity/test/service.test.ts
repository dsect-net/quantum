/**
 * SingularityService tests — posts, feed, comments, reactions, messages,
 * notifications, memory references, profiles, search, selftest.
 * Runs against :memory: SQLite with a fixed two-human/two-agent cast.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from '../src/db.js';
import { AuthService } from '../src/auth.js';
import { MemoryProvider, SEED_MEMORIES } from '../src/memory.js';
import {
  SingularityService,
  parseMentions,
  parseMemoryIds,
} from '../src/service.js';
import { type User } from '../src/types.js';
import type { Database } from 'better-sqlite3';

function build(): {
  db: Database;
  auth: AuthService;
  service: SingularityService;
  scotty: User;
  cooper: User;
} {
  const db = openDatabase(':memory:');
  const auth = new AuthService(db, { orgToken: '' });
  const memories = new MemoryProvider(db, null);
  const service = new SingularityService(db, auth, memories);
  memories.seedIfEmpty();

  const ts = new Date().toISOString();
  const mk = (id: string, handle: string, kind: 'human' | 'agent', role: 'owner' | 'member'): User => {
    db.prepare(
      `INSERT INTO users (id, handle, email, display_name, kind, team, bio, interests,
                          avatar_url, avatar_data, role, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'dsect', '', '[]', NULL, NULL, ?, 'active', ?, ?)`,
    ).run(id, handle, `${handle}@dsect.net`, handle, kind, role, ts, ts);
    return auth.getUserById(id)!;
  };
  const scotty = mk('u-scotty', 'scotty', 'human', 'owner');
  const cooper = mk('u-cooper', 'cooper', 'agent', 'member');
  mk('u-qubit', 'qubit', 'agent', 'member');
  return { db, auth, service, scotty, cooper };
}

describe('text parsing', () => {
  it('extracts [[mem:id]] tokens in order, deduped', () => {
    expect(parseMemoryIds('see [[mem:482]] and [[mem:481]] plus [[mem:482]] again')).toEqual([
      '482',
      '481',
    ]);
    expect(parseMemoryIds('no refs here')).toEqual([]);
  });

  it('extracts @mentions without matching inside words, emails, or @@', () => {
    expect(parseMentions('cc @cooper and @qubit, not mail@domain')).toEqual(['cooper', 'qubit']);
    expect(parseMentions('email me at scotty@dsect.net')).toEqual([]);
    expect(parseMentions('@@double at-sign is not a mention')).toEqual([]);
    expect(parseMentions('@scotty hello')).toEqual(['scotty']);
  });
});

describe('SingularityService — posts & feed', () => {
  let service: SingularityService;
  let scotty: User;
  let cooper: User;

  beforeEach(() => {
    ({ service, scotty, cooper } = build());
  });

  it('creates a post with tags, memory refs, and parsed inline refs', async () => {
    const post = service.createPost(scotty, {
      body: 'Follow the monorepo rule [[mem:482]] — cc @cooper',
      kind: 'announcement',
      tags: ['Rules', 'rules', '#Quantum'],
      memory_refs: [{ memory_id: '481', label: 'Design', note: 'why' }],
    });

    expect(post.author.handle).toBe('scotty');
    expect(post.kind).toBe('announcement');
    expect(post.tags).toEqual(['rules', 'quantum']);
    expect(post.memory_ids).toEqual(['482']);
    expect(post.mentions).toEqual(['cooper']);
    expect(post.memories.map((m) => m.memory_id).sort()).toEqual(['481', '482']);
  });

  it('rejects empty and over-long bodies', () => {
    expect(() => service.createPost(scotty, { body: '  ' })).toThrow(/empty/);
    expect(() => service.createPost(scotty, { body: 'x'.repeat(8001) })).toThrow(/too long/);
  });

  it('feeds newest-first with pinned on top', () => {
    service.createPost(scotty, { body: 'first' });
    service.createPost(cooper, { body: 'second' });
    const pinned = service.createPost(scotty, { body: 'pin me', pinned: true });

    return service.feed().then((page) => {
      expect(page.posts[0].id).toBe(pinned.id);
      expect(page.posts[0].pinned).toBe(true);
      expect(page.total).toBe(3);
    });
  });

  it('filters the feed by kind, tag, author, and text', async () => {
    service.createPost(scotty, { body: 'infra update', kind: 'post', tags: ['infra'] });
    service.createPost(cooper, { body: 'agent note about hermes', kind: 'post', tags: ['agents'] });

    expect((await service.feed({ kind: 'post' })).total).toBe(2);
    expect((await service.feed({ tag: 'infra' })).total).toBe(1);
    expect((await service.feed({ author: 'cooper' })).posts[0].author.handle).toBe('cooper');
    expect((await service.feed({ q: 'hermes' })).total).toBe(1);
  });

  it('soft-deletes and hides posts, with permission checks', async () => {
    const qubit = service.getProfile('qubit');
    const post = service.createPost(scotty, { body: 'human post' });
    expect(() => service.deletePost(qubit, post.id)).toThrow(/Only the author/);

    service.deletePost(scotty, post.id);
    expect(() => service.getPost(post.id)).toThrow(/not found/);
    expect((await service.feed()).total).toBe(0);

    // Owner may delete anyone's post (moderation path).
    const agentPost = service.createPost(cooper, { body: 'agent post' });
    service.deletePost(scotty, agentPost.id);
    expect(() => service.getPost(agentPost.id)).toThrow(/not found/);
    expect((await service.feed()).total).toBe(0);
  });

  it('updates a post and re-syncs memory refs (inline ∪ explicit, labels survive)', async () => {
    const post = service.createPost(scotty, {
      body: 'ref [[mem:482]]',
      memory_refs: [{ memory_id: '481', label: 'Design' }],
    });
    // Body edit keeps previously attached refs (482 inline + 481 structured).
    const updated = service.updatePost(scotty, post.id, { body: 'now citing [[mem:481]]' });
    expect(updated.memory_ids).toEqual(['481']);
    expect(updated.memories.map((m) => m.memory_id).sort()).toEqual(['481', '482']);
    // Label survives the edit.
    expect(updated.memories.find((m) => m.memory_id === '481')?.label).toBe('Design');

    // Explicit memory_refs: [] drops the structured ref that left the body.
    const trimmed = service.updatePost(scotty, post.id, {
      body: 'now citing [[mem:481]]',
      memory_refs: [],
    });
    expect(trimmed.memories.map((m) => m.memory_id)).toEqual(['481']);

    expect(() => service.updatePost(cooper, post.id, { body: 'nope' })).toThrow(/Only the author/);
  });

  it('postsBy returns the author feed with totals', () => {
    service.createPost(cooper, { body: 'a' });
    service.createPost(cooper, { body: 'b' });
    service.createPost(scotty, { body: 'c' });
    const page = service.postsBy('cooper');
    expect(page.total).toBe(2);
    expect(page.posts.every((p) => p.author.handle === 'cooper')).toBe(true);
  });
});

describe('SingularityService — comments & reactions', () => {
  let service: SingularityService;
  let scotty: User;
  let cooper: User;

  beforeEach(() => {
    ({ service, scotty, cooper } = build());
  });

  it('adds threaded comments and notifies the author', () => {
    const post = service.createPost(scotty, { body: 'thoughts?' });
    const c1 = service.addComment(cooper, post.id, 'looks good');
    const c2 = service.addComment(scotty, post.id, 'thanks!', c1.id);

    expect(c2.parent_id).toBe(c1.id);
    expect(service.listComments(post.id)).toHaveLength(2);
    const notes = service.notifications(scotty);
    expect(notes.some((n) => n.kind === 'comment')).toBe(true);
  });

  it('rejects comments on missing posts and bad parents', () => {
    expect(() => service.addComment(scotty, 'nope', 'hi')).toThrow(/not found/);
    const post = service.createPost(scotty, { body: 'p' });
    const other = service.createPost(scotty, { body: 'q' });
    const c = service.addComment(cooper, other.id, 'on q');
    expect(() => service.addComment(cooper, post.id, 'reply', c.id)).toThrow(/another post/);
  });

  it('reactions are idempotent per user+kind and counted', () => {
    const post = service.createPost(scotty, { body: 'ship it' });
    const r1 = service.react(cooper, 'post', post.id, 'ship');
    const r2 = service.react(cooper, 'post', post.id, 'ship');
    expect(r1.counts.ship).toBe(1);
    expect(r2.counts.ship).toBe(1);

    service.react(scotty, 'post', post.id, 'ship');
    service.react(scotty, 'post', post.id, '+1');
    expect(service.getPost(post.id).reaction_counts).toEqual({ ship: 2, '+1': 1 });

    service.unreact(cooper, 'post', post.id, 'ship');
    expect(service.getPost(post.id).reaction_counts).toEqual({ ship: 1, '+1': 1 });
  });

  it('rejects unknown reaction kinds with the allowed set', () => {
    const post = service.createPost(scotty, { body: 'p' });
    expect(() => service.react(cooper, 'post', post.id, 'fire')).toThrow(/Unknown reaction/);
  });

  it('notifies on reactions and mentions exactly once per actor', () => {
    const post = service.createPost(scotty, { body: 'ping @cooper' });
    const mentions = service.notifications(cooper).filter((n) => n.kind === 'mention');
    expect(mentions).toHaveLength(1);

    service.react(cooper, 'post', post.id, '+1');
    const reactions = service.notifications(scotty).filter((n) => n.kind === 'reaction');
    expect(reactions).toHaveLength(1);
  });
});

describe('SingularityService — messages (agent to agent)', () => {
  it('sends messages, lists threads with unread, marks read in conversation', () => {
    const { service, scotty, cooper } = build();
    const qubit = service.getProfile('qubit');

    service.sendMessage(cooper, 'qubit', 'status?');
    service.sendMessage(qubit, 'cooper', 'all green [[mem:486]]');

    const threads = service.threads(cooper);
    expect(threads).toHaveLength(1);
    expect(threads[0].peer.handle).toBe('qubit');
    expect(threads[0].unread).toBe(1);

    const convo = service.conversation(cooper, 'qubit');
    expect(convo.messages.map((m) => m.body)).toEqual(['status?', 'all green [[mem:486]]']);
    expect(service.threads(cooper)[0].unread).toBe(0);

    expect(() => service.sendMessage(scotty, 'scotty', 'x')).toThrow(/cannot message yourself/);
  });
});

describe('SingularityService — profiles', () => {
  it('updates profile fields and validates avatar uploads', () => {
    const { service, scotty } = build();
    const updated = service.updateProfile(scotty, {
      display_name: 'Scotty',
      bio: 'Founder',
      interests: ['platform', 'agents', 'platform'],
      team: 'dsect',
    });
    expect(updated.bio).toBe('Founder');
    expect(updated.interests).toEqual(['platform', 'agents']);

    const withPhoto = service.setAvatar(scotty, {
      avatar_data: 'data:image/png;base64,AAAA',
    });
    expect(withPhoto.avatar_data).toBe('data:image/png;base64,AAAA');

    expect(() =>
      service.setAvatar(scotty, { avatar_data: 'not-a-data-url' }),
    ).toThrow(/data:image/);
    expect(() =>
      service.updateProfile(scotty, { bio: 'x'.repeat(2001) }),
    ).toThrow(/too long/);

    const linked = service.setAvatar(scotty, { avatar_url: 'https://dsect.net/u/scotty.png' });
    expect(linked.avatar_url).toBe('https://dsect.net/u/scotty.png');
    expect(linked.avatar_data).toBe('data:image/png;base64,AAAA'); // upload still wins
  });

  it('lists and searches members including agents', () => {
    const { service } = build();
    expect(service.listUsers().total).toBe(3);
    expect(service.listUsers({ kind: 'agent' }).total).toBe(2);
    expect(service.listUsers({ q: 'cooper' }).users[0].handle).toBe('cooper');
  });
});

describe('SingularityService — memory refs & search', () => {
  it('resolves inline and structured refs against the snapshot', async () => {
    const { service, scotty } = build();
    const post = service.createPost(scotty, {
      body: 'per [[mem:482]]',
      memory_refs: [{ memory_id: '99999', label: 'missing' }],
    });
    const resolved = await service.resolvePostMemories(post.body, post.memories);
    const byId = new Map(resolved.memories.map((m) => [m.memory_id, m]));
    expect(byId.get('482')?.memory?.source).toBe('snapshot');
    expect(byId.get('482')?.memory?.id).toBe('482');
    expect(byId.get('99999')?.memory).toBeNull(); // unknown ids resolve to null, honestly
    expect(resolved.memory_ids).toEqual(['482']);
  });

  it('search spans posts, users, and memories', async () => {
    const { service, scotty } = build();
    service.createPost(scotty, { body: 'the monorepo rule applies here' });
    const results = await service.search('monorepo');
    expect(results.posts.length).toBe(1);
    expect(results.memories.some((m) => m.id === '482')).toBe(true);
    await expect(service.search('  ')).rejects.toThrow(/not be empty/);
  });

  it('snapshot seed matches the vendored hive sample size', async () => {
    const { service } = build();
    const page = await service.memories.search({ limit: 100 });
    expect(page.total).toBe(SEED_MEMORIES.length);
  });
});

describe('SingularityService — developer mode surfaces', () => {
  it('reports stats and passes selftest on a healthy db', () => {
    const { service, scotty } = build();
    service.createPost(scotty, { body: 'p' });
    const stats = service.stats();
    expect(stats.users.total).toBe(3);
    expect(stats.posts).toBe(1);
    expect(stats.memories.snapshot).toBe(SEED_MEMORIES.length);

    const selftest = service.selftest();
    expect(selftest.ok).toBe(true);
    expect(selftest.checks.map((c) => c.name)).toContain('sqlite.integrity');
  });

  it('records mutations in the audit log', () => {
    const { service, scotty, cooper } = build();
    const post = service.createPost(scotty, { body: 'p' });
    service.react(cooper, 'post', post.id, '+1');
    const log = service.auditLog();
    const actions = log.map((e) => e.action);
    expect(actions).toContain('post.create');
    expect(actions).toContain('reaction.add');
  });
});
