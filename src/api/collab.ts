/**
 * Collaboration system client — Quantum's data layer for the DSECT
 * collab backend (dsect-net/hub-api `lib/collab/`, REST `/api/collab/*`).
 *
 * Mirrors src/api/hub.ts conventions:
 *  - Empty base URL = demo mode. Every call fails closed with kind
 *    'not-configured' BEFORE any network attempt.
 *  - Responses are normalized defensively but never invented: a missing
 *    field becomes null/undefined, never a plausible-looking guess.
 *  - Tailnet identity auth — the app sends no bearer token (same as hub.ts).
 */
import { normalizeBaseUrl } from '../lib/settings';
import { HubError } from './hub';

export { HubError };

export type GoalStatus = 'active' | 'paused' | 'done' | 'archived';
export type SubGoalStatus = 'open' | 'done';
export type TaskStatus = 'todo' | 'doing' | 'done';

export interface CollabTag {
  id: string;
  label: string;
  color: string;
  uses?: number;
}

export interface CollabTask {
  id: string;
  subGoalId: string;
  title: string;
  status: TaskStatus;
  assignee: string | null;
  tags: string[];
  dueDate: string | null;
  notes: string | null;
  createdAt?: string;
  updatedAt?: string;
  /** Board-enriched only. */
  subGoalTitle?: string | null;
  goalTitle?: string | null;
}

export interface CollabSubGoal {
  id: string;
  goalId: string;
  title: string;
  status: SubGoalStatus;
  owner: string | null;
  tags: string[];
  progress: number;
  counts?: { total: number; todo: number; doing: number; done: number };
  tasks?: CollabTask[];
}

export interface CollabGoal {
  id: string;
  title: string;
  description: string | null;
  status: GoalStatus;
  owner: string | null;
  tags: string[];
  progress: number;
  createdAt?: string;
  updatedAt?: string;
  subgoals?: CollabSubGoal[];
}

export interface CollabActivityEvent {
  id: string;
  at: string;
  actor: string | null;
  kind: string;
  entityType: string;
  entityId: string;
  detail: string | null;
}

export interface KanbanBoard {
  goalId: string | null;
  columns: { todo: CollabTask[]; doing: CollabTask[]; done: CollabTask[] };
  counts: { todo: number; doing: number; done: number };
}

const GOAL_STATUSES: ReadonlySet<string> = new Set(['active', 'paused', 'done', 'archived']);
const TASK_STATUSES: ReadonlySet<string> = new Set(['todo', 'doing', 'done']);

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function asGoalStatus(v: unknown): GoalStatus {
  return typeof v === 'string' && GOAL_STATUSES.has(v) ? (v as GoalStatus) : 'active';
}

function asTaskStatus(v: unknown): TaskStatus {
  return typeof v === 'string' && TASK_STATUSES.has(v) ? (v as TaskStatus) : 'todo';
}

function asProgress(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

export function normalizeTask(raw: unknown): CollabTask | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  const id = asString(t.id);
  const title = asString(t.title);
  if (!id || !title) return null;
  return {
    id,
    subGoalId: asString(t.subGoalId) ?? '',
    title,
    status: asTaskStatus(t.status),
    assignee: asString(t.assignee),
    tags: asStringArray(t.tags),
    dueDate: asString(t.dueDate),
    notes: asString(t.notes),
    createdAt: asString(t.createdAt) ?? undefined,
    updatedAt: asString(t.updatedAt) ?? undefined,
    subGoalTitle: asString(t.subGoalTitle),
    goalTitle: asString(t.goalTitle),
  };
}

export function normalizeGoal(raw: unknown): CollabGoal | null {
  if (!raw || typeof raw !== 'object') return null;
  const g = raw as Record<string, unknown>;
  const id = asString(g.id);
  const title = asString(g.title);
  if (!id || !title) return null;
  const subgoals = Array.isArray(g.subgoals)
    ? (g.subgoals.map((s) => normalizeSubGoal(s)).filter(Boolean) as CollabSubGoal[])
    : undefined;
  return {
    id,
    title,
    description: asString(g.description),
    status: asGoalStatus(g.status),
    owner: asString(g.owner),
    tags: asStringArray(g.tags),
    progress: asProgress(g.progress),
    createdAt: asString(g.createdAt) ?? undefined,
    updatedAt: asString(g.updatedAt) ?? undefined,
    subgoals,
  };
}

export function normalizeSubGoal(raw: unknown): CollabSubGoal | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const id = asString(s.id);
  const title = asString(s.title);
  if (!id || !title) return null;
  return {
    id,
    goalId: asString(s.goalId) ?? '',
    title,
    status: s.status === 'done' ? 'done' : 'open',
    owner: asString(s.owner),
    tags: asStringArray(s.tags),
    progress: asProgress(s.progress),
    counts: undefined,
    tasks: Array.isArray(s.tasks)
      ? (s.tasks.map((t) => normalizeTask(t)).filter(Boolean) as CollabTask[])
      : undefined,
  };
}

export interface CollabClientOptions {
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export class CollabClient {
  readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, options: CollabClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** False = demo mode: no base URL configured, no network calls allowed. */
  get configured(): boolean {
    return this.baseUrl !== '';
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.configured) {
      throw new HubError(
        'not-configured',
        'No Hub API base URL configured — demo mode. Add one in More → Connection settings.',
      );
    }
    const url = this.baseUrl + path;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        cache: 'no-store',
        signal: ctrl.signal,
        headers: {
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (err) {
      throw new HubError(
        err instanceof DOMException && err.name === 'AbortError' ? 'timeout' : 'network',
        err instanceof DOMException && err.name === 'AbortError'
          ? `Collab request timed out after ${this.timeoutMs} ms (${url}).`
          : `Could not reach the Hub API (${url}). Check the tailnet connection.`,
        undefined,
        url,
      );
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw new HubError('http', `Hub API returned HTTP ${res.status} for ${path}.`, res.status, url);
    }
    try {
      return (await res.json()) as T;
    } catch {
      throw new HubError('bad-json', `Hub API returned non-JSON for ${path}.`, res.status, url);
    }
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  async goals(): Promise<CollabGoal[]> {
    const raw = await this.get<unknown[]>('/api/collab/goals');
    return (Array.isArray(raw) ? raw : []).map((g) => normalizeGoal(g)).filter(Boolean) as CollabGoal[];
  }

  async goalDetail(id: string): Promise<CollabGoal | null> {
    const raw = await this.get<unknown>(`/api/collab/goals/${encodeURIComponent(id)}`);
    return normalizeGoal(raw);
  }

  async createGoal(input: { title: string; description?: string; owner?: string; tags?: string[] }): Promise<CollabGoal | null> {
    const raw = await this.request<unknown>('POST', '/api/collab/goals', input);
    return normalizeGoal(raw);
  }

  async updateGoal(id: string, patch: Partial<Pick<CollabGoal, 'title' | 'description' | 'status' | 'owner' | 'tags'>>): Promise<CollabGoal | null> {
    const raw = await this.request<unknown>('PATCH', `/api/collab/goals/${encodeURIComponent(id)}`, patch);
    return normalizeGoal(raw);
  }

  async createSubGoal(goalId: string, input: { title: string; owner?: string }): Promise<CollabSubGoal | null> {
    const raw = await this.request<unknown>('POST', '/api/collab/subgoals', { goalId, ...input });
    return normalizeSubGoal(raw);
  }

  async createTask(subGoalId: string, input: { title: string; assignee?: string; dueDate?: string }): Promise<CollabTask | null> {
    const raw = await this.request<unknown>('POST', '/api/collab/tasks', { subGoalId, ...input });
    return normalizeTask(raw);
  }

  async moveTask(id: string, status: TaskStatus): Promise<CollabTask | null> {
    const raw = await this.request<unknown>('PATCH', `/api/collab/tasks/${encodeURIComponent(id)}`, { status });
    return normalizeTask(raw);
  }

  async board(goalId?: string): Promise<KanbanBoard> {
    const path = goalId ? `/api/collab/board?goalId=${encodeURIComponent(goalId)}` : '/api/collab/board';
    const raw = await this.get<Record<string, unknown>>(path);
    const cols = (raw?.columns ?? {}) as Record<string, unknown[]>;
    const norm = (arr: unknown[]): CollabTask[] =>
      (Array.isArray(arr) ? arr : []).map((t) => normalizeTask(t)).filter(Boolean) as CollabTask[];
    return {
      goalId: typeof raw?.goalId === 'string' ? raw.goalId : null,
      columns: { todo: norm(cols.todo), doing: norm(cols.doing), done: norm(cols.done) },
      counts: {
        todo: norm(cols.todo).length,
        doing: norm(cols.doing).length,
        done: norm(cols.done).length,
      },
    };
  }

  async activity(limit = 30): Promise<CollabActivityEvent[]> {
    const raw = await this.get<unknown[]>(`/api/collab/activity?limit=${limit}`);
    return (Array.isArray(raw) ? raw : [])
      .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
      .map((e) => ({
        id: asString(e.id) ?? '',
        at: asString(e.at) ?? '',
        actor: asString(e.actor),
        kind: asString(e.kind) ?? '',
        entityType: asString(e.entityType) ?? '',
        entityId: asString(e.entityId) ?? '',
        detail: asString(e.detail),
      }))
      .filter((e) => e.id !== '');
  }

  async tags(): Promise<CollabTag[]> {
    const raw = await this.get<unknown[]>('/api/collab/tags');
    return (Array.isArray(raw) ? raw : [])
      .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
      .map((t) => ({
        id: asString(t.id) ?? '',
        label: asString(t.label) ?? '',
        color: asString(t.color) ?? '#64748B',
        uses: typeof t.uses === 'number' ? t.uses : undefined,
      }))
      .filter((t) => t.id !== '' && t.label !== '');
  }
}
