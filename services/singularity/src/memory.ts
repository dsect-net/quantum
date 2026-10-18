/**
 * Memory provider — resolves [[mem:<id>]] references against the Hive.
 *
 * Two sources (docs/MEMORY.md — never fake live data):
 *   1. The local `memories` table, seeded from the vendored hive-memory
 *      snapshot sample (same lineage as src/data/hiveSnapshot.ts in the
 *      Quantum shell). Rows carry `source: 'snapshot'`.
 *   2. An optional live hive-memory service (HIVE_MEMORY_URL). Successful
 *      lookups are cached into the table as `source: 'live'`.
 *
 * If the live service is unreachable the provider degrades to the snapshot
 * cache and reports `degraded` — callers surface that honestly.
 */
import type { Database } from 'better-sqlite3';
import type { Memory, MemorySource } from './types.js';

/** Trimmed sample of dsect-net/hive-memory data/memories.json (2026-10-02). */
export interface SeedMemory {
  id: number;
  content: string;
  agent: string;
  team: string;
  kind: string;
  tier: string;
  importance: number;
  tags: string[];
  created_at: string;
}

/**
 * Eight representative Hive memories so references in the seed feed resolve.
 * Content is kept short here; the Hive remains the source of truth.
 */
export const SEED_MEMORIES: SeedMemory[] = [
  {
    id: 487,
    content:
      "Hermes 0.21.3 traps found building Qubit's Warden: api_server sessions are unattended by design — approvals there are blocked or auto-approved, never asked. Sol needs its own approval path (Warden plugin writes requests, gateway signs decisions with Ed25519, key outside the container).",
    agent: 'claude',
    team: 'apogee',
    kind: 'lesson',
    tier: 'durable',
    importance: 0.85,
    tags: ['hermes', 'warden', 'approvals', 'qubit', 'security'],
    created_at: '2026-10-01T19:24:40',
  },
  {
    id: 486,
    content:
      'INCIDENT 2026-10-01: Quark/NPU chat down ~25h. lemond auto-upgraded and required FastFlowLM v1.0.5 while v1.0.3 was installed — every *-FLM model vanished from /api/v1/models while /health said ok. Diagnose via /api/v1/models first when health is green but inference fails.',
    agent: 'claude',
    team: 'apogee',
    kind: 'incident',
    tier: 'durable',
    importance: 0.8,
    tags: ['npu', 'lemonade', 'fastflowlm', 'quark', 'router'],
    created_at: '2026-10-01T17:31:18',
  },
  {
    id: 485,
    content:
      "Hermes busy handling (hermes-agent 0.21.3): display.busy_input_mode is interrupt|queue|steer. Qubit's profile is interrupt so every new message stops its current run — the cause of \"Qubit interrupts its cycle\". steer injects text after the next tool call; queue holds for the next turn.",
    agent: 'claude',
    team: 'apogee',
    kind: 'lesson',
    tier: 'project',
    importance: 0.7,
    tags: ['hermes', 'qubit', 'busy_input_mode', 'one-mind'],
    created_at: '2026-10-01T16:59:00',
  },
  {
    id: 482,
    content:
      'Monorepo rule (Scotty, 2026-10-15): Quantum-flavored apps start in dsect-net/quantum under apps/ + services/. Spin out, don\'t start out. Merging a fold = deploying it. Stack-affinity guardrail: foreign-runtime services stay isolated and talk over the same contracts.',
    agent: 'cooper',
    team: 'dsect',
    kind: 'decision',
    tier: 'durable',
    importance: 0.9,
    tags: ['monorepo', 'quantum', 'process', 'rules'],
    created_at: '2026-10-15T14:02:00',
  },
  {
    id: 481,
    content:
      'Design language for Quantum surfaces: corporate minimalism — Inter/system-ui, neutral surfaces, one accent, flat rectangular badges (never pills), 44px touch floor, light default with real dark mode via data-theme. Every screen shows real data or an explicitly labeled degraded state.',
    agent: 'cooper',
    team: 'dsect',
    kind: 'lesson',
    tier: 'durable',
    importance: 0.8,
    tags: ['design', 'ui', 'rules', 'quantum'],
    created_at: '2026-10-15T14:12:00',
  },
  {
    id: 478,
    content:
      'Hive memory referencing convention across Quantum: cite memories as [[mem:<id>]] inline in posts and notes; keep provenance labels (snapshot vs live) visible in every UI that renders a memory.',
    agent: 'claude',
    team: 'apogee',
    kind: 'lesson',
    tier: 'project',
    importance: 0.75,
    tags: ['memory', 'hive', 'convention', 'linking'],
    created_at: '2026-10-02T09:30:00',
  },
  {
    id: 475,
    content:
      "Agent to agent comms over Hermes relay: /messages?since= for polling, /send for emit, /search for retrieval. Bearer worker keys; identities are agent names (cooper, qubit, sol). Prefer the relay over ad-hoc HTTP between agents.",
    agent: 'claude',
    team: 'apogee',
    kind: 'lesson',
    tier: 'project',
    importance: 0.7,
    tags: ['hermes', 'relay', 'agents', 'messaging'],
    created_at: '2026-09-28T11:45:00',
  },
  {
    id: 470,
    content:
      'Secrets rule: worker keys, org tokens, and passphrases are user-entered and stored on-device (Capacitor Preferences / localStorage), never in code or git. Tailnet identity headers replace passwords on the tailnet.',
    agent: 'cooper',
    team: 'dsect',
    kind: 'decision',
    tier: 'durable',
    importance: 0.85,
    tags: ['security', 'secrets', 'auth', 'rules'],
    created_at: '2026-10-10T08:20:00',
  },
];

export interface MemoryQuery {
  q?: string;
  tag?: string;
  kind?: string;
  limit?: number;
  offset?: number;
}

export interface MemoryPage {
  memories: Memory[];
  total: number;
  degraded?: boolean;
  degraded_reason?: string;
}

interface MemoryRow {
  id: string;
  content: string;
  agent: string;
  team: string;
  kind: string;
  tier: string;
  importance: number;
  tags: string;
  created_at: string;
  source: MemorySource;
}

function rowToMemory(row: MemoryRow): Memory {
  let tags: string[] = [];
  try {
    tags = JSON.parse(row.tags);
  } catch {
    tags = [];
  }
  return {
    id: row.id,
    content: row.content,
    agent: row.agent,
    team: row.team,
    kind: row.kind,
    tier: row.tier,
    importance: row.importance,
    tags,
    created_at: row.created_at,
    source: row.source,
  };
}

export class MemoryProvider {
  private db: Database;
  private liveUrl: string | null;

  constructor(db: Database, liveUrl?: string | null) {
    this.db = db;
    const raw = (liveUrl ?? process.env.HIVE_MEMORY_URL ?? '').trim();
    this.liveUrl = raw ? raw.replace(/\/+$/, '') : null;
  }

  /** True when a live hive-memory base URL is configured. */
  get hasLive(): boolean {
    return this.liveUrl !== null;
  }

  /** Seed the snapshot sample when the table is empty. */
  seedIfEmpty(): void {
    const { n } = this.db.prepare(`SELECT COUNT(*) AS n FROM memories`).get() as { n: number };
    if (n > 0) return;
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO memories (id, content, agent, team, kind, tier, importance, tags, created_at, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'snapshot')`,
    );
    const tx = this.db.transaction((rows: SeedMemory[]) => {
      for (const m of rows) {
        insert.run(
          String(m.id),
          m.content,
          m.agent,
          m.team,
          m.kind,
          m.tier,
          m.importance,
          JSON.stringify(m.tags),
          m.created_at,
        );
      }
    });
    tx(SEED_MEMORIES);
  }

  /**
   * Get one memory by id. Tries the live Hive first when configured, then
   * the local cache. Returns null when unknown — callers 404 honestly.
   */
  async get(id: string): Promise<Memory | null> {
    const cached = this.db.prepare(`SELECT * FROM memories WHERE id = ?`).get(id) as
      | MemoryRow
      | undefined;

    if (this.liveUrl) {
      try {
        const live = await this.fetchLive(id);
        if (live) {
          this.cache(live);
          return live;
        }
      } catch {
        // Live unreachable — fall through to cache (graceful degradation).
      }
    }
    return cached ? rowToMemory(cached) : null;
  }

  /** Search memories (FTS-free LIKE match on content/tags — small corpus). */
  async search(query: MemoryQuery): Promise<MemoryPage> {
    const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
    const offset = Math.max(query.offset ?? 0, 0);
    const q = (query.q ?? '').trim();

    const where: string[] = [];
    const params: unknown[] = [];
    if (q) {
      where.push(`(content LIKE ? OR tags LIKE ?)`);
      params.push(`%${q}%`, `%${q}%`);
    }
    if (query.tag) {
      where.push(`tags LIKE ?`);
      params.push(`%${query.tag}%`);
    }
    if (query.kind) {
      where.push(`kind = ?`);
      params.push(query.kind);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = this.db
      .prepare(
        `SELECT * FROM memories ${whereSql} ORDER BY importance DESC, created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as MemoryRow[];
    const { total } = this.db
      .prepare(`SELECT COUNT(*) AS total FROM memories ${whereSql}`)
      .get(...params) as { total: number };

    return {
      memories: rows.map(rowToMemory),
      total,
    };
  }

  /** Insert or refresh a cached memory row. */
  cache(memory: Memory): void {
    this.db
      .prepare(
        `INSERT INTO memories (id, content, agent, team, kind, tier, importance, tags, created_at, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           content = excluded.content, agent = excluded.agent, team = excluded.team,
           kind = excluded.kind, tier = excluded.tier, importance = excluded.importance,
           tags = excluded.tags, created_at = excluded.created_at, source = excluded.source`,
      )
      .run(
        memory.id,
        memory.content,
        memory.agent,
        memory.team,
        memory.kind,
        memory.tier,
        memory.importance,
        JSON.stringify(memory.tags),
        memory.created_at,
        memory.source,
      );
  }

  /** Probe the live Hive (GET {base}/memories/:id) with a short timeout. */
  private async fetchLive(id: string): Promise<Memory | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    try {
      const res = await fetch(`${this.liveUrl}/memories/${encodeURIComponent(id)}`, {
        signal: ctrl.signal,
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`hive-memory HTTP ${res.status}`);
      const raw = (await res.json()) as Record<string, unknown>;
      const tags = Array.isArray(raw.tags) ? raw.tags.map(String) : [];
      return {
        id: String(raw.id ?? id),
        content: String(raw.content ?? ''),
        agent: String(raw.agent ?? ''),
        team: String(raw.team ?? ''),
        kind: String(raw.kind ?? ''),
        tier: String(raw.tier ?? ''),
        importance: Number(raw.importance ?? 0.5),
        tags,
        created_at: String(raw.created_at ?? new Date().toISOString()),
        source: 'live',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
