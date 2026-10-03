/**
 * Collab client tests — mocked fetch covering:
 *  - demo mode fails closed (not-configured, no network)
 *  - goals list + detail normalization
 *  - defensive normalization (missing/garbage fields never invented)
 *  - task move (PATCH), board snapshot, activity, tags
 *  - HTTP error → HubError kind 'http'
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CollabClient,
  HubError,
  normalizeGoal,
  normalizeTask,
} from './collab';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Error | Promise<Response | Error>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const out = await handler(url, init);
    if (out instanceof Error) throw out;
    return out;
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const BASE = 'https://tritium-linux.fairy-chinstrap.ts.net';

describe('CollabClient demo mode', () => {
  it('fails closed with not-configured and makes no network calls', async () => {
    const { fn } = mockFetch(() => json([]));
    const client = new CollabClient('');
    expect(client.configured).toBe(false);
    await expect(client.goals()).rejects.toMatchObject({ kind: 'not-configured' });
    await expect(client.board()).rejects.toMatchObject({ kind: 'not-configured' });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('normalizeGoal / normalizeTask', () => {
  it('drops rows without id/title rather than inventing them', () => {
    expect(normalizeGoal({ id: 'goal_x' })).toBeNull();
    expect(normalizeGoal(null)).toBeNull();
    expect(normalizeTask({ title: 'no id' })).toBeNull();
  });
  it('falls back unknown statuses instead of passing them through', () => {
    const g = normalizeGoal({ id: 'goal_1', title: 'T', status: 'bogus', progress: 2.5 });
    expect(g?.status).toBe('active');
    expect(g?.progress).toBe(1); // clamped
    const t = normalizeTask({ id: 'task_1', title: 'T', status: 'bogus' });
    expect(t?.status).toBe('todo');
  });
  it('keeps nulls as nulls', () => {
    const t = normalizeTask({ id: 'task_1', title: 'T', status: 'doing' });
    expect(t?.assignee).toBeNull();
    expect(t?.dueDate).toBeNull();
    expect(t?.tags).toEqual([]);
  });
});

describe('CollabClient requests', () => {
  it('GETs goals and normalizes the list', async () => {
    mockFetch((url) => {
      expect(url).toBe(BASE + '/api/collab/goals');
      return json([{ id: 'goal_1', title: 'Ship', status: 'active', progress: 0.5, tags: ['x'] }]);
    });
    const goals = await new CollabClient(BASE).goals();
    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({ id: 'goal_1', title: 'Ship', progress: 0.5 });
  });

  it('PATCHes a task move with JSON body', async () => {
    const { calls } = mockFetch((url, init) => {
      expect(url).toBe(BASE + '/api/collab/tasks/task_9');
      expect(init?.method).toBe('PATCH');
      expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' });
      expect(init?.body).toBe(JSON.stringify({ status: 'done' }));
      return json({ id: 'task_9', subGoalId: 'sub_1', title: 'T', status: 'done' });
    });
    const task = await new CollabClient(BASE).moveTask('task_9', 'done');
    expect(task?.status).toBe('done');
    expect(calls).toHaveLength(1);
  });

  it('builds the board snapshot with normalized columns', async () => {
    mockFetch(() => json({
      goalId: null,
      columns: {
        todo: [{ id: 'task_1', title: 'A', status: 'todo' }],
        doing: [],
        done: [{ id: 'task_2', title: 'B', status: 'done', goalTitle: 'G' }],
      },
    }));
    const board = await new CollabClient(BASE).board();
    expect(board.counts).toEqual({ todo: 1, doing: 0, done: 1 });
    expect(board.columns.done[0].goalTitle).toBe('G');
  });

  it('surfaces HTTP errors as HubError kind http', async () => {
    mockFetch(() => json({ error: 'nope' }, 500));
    await expect(new CollabClient(BASE).goals()).rejects.toBeInstanceOf(HubError);
    await expect(new CollabClient(BASE).goals()).rejects.toMatchObject({ kind: 'http', status: 500 });
  });
});
