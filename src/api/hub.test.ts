/**
 * hub-api client tests — mocked fetch covering:
 *  - success (services merge, agents, vitals, metrics, docket, summary)
 *  - HTTP error (status surfaces as HubError kind 'http')
 *  - network failure (fetch rejects → kind 'network')
 *  - timeout (AbortError → kind 'timeout')
 *  - empty-URL demo mode (fails closed before any network attempt)
 *  - partial dashboard failure (one section errors, the rest load)
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HubClient,
  HubError,
  fetchDashboard,
  isDashboardLive,
} from './hub';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockFetch(
  handler: (url: string) => Response | Error | Promise<Response | Error>,
) {
  const calls: string[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const out = await handler(url);
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

describe('HubClient demo mode', () => {
  it('fails closed with not-configured and makes no network calls', async () => {
    const { fn } = mockFetch(() => json({}));
    const client = new HubClient('');
    expect(client.configured).toBe(false);
    await expect(client.services()).rejects.toMatchObject({
      name: 'HubError',
      kind: 'not-configured',
    });
    await expect(client.agents()).rejects.toMatchObject({ kind: 'not-configured' });
    await expect(client.vitals()).rejects.toMatchObject({ kind: 'not-configured' });
    await expect(client.docket()).rejects.toMatchObject({ kind: 'not-configured' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('fetchDashboard rejects in demo mode without fetching', async () => {
    const { fn } = mockFetch(() => json({}));
    await expect(fetchDashboard(new HubClient(''))).rejects.toMatchObject({
      kind: 'not-configured',
    });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('HubClient.services', () => {
  const registry = [
    { id: 'hub-api', name: 'Hub API', cat: 'Infra', port: 443, unit: 'hub-api.service' },
    { id: 'nebula', name: 'Nebula', cat: 'AI', port: 8092, unit: 'nebula.service' },
    { id: 'unprobed', name: 'Unprobed Thing', cat: 'Infra' },
  ];
  const status = [
    { id: 'hub-api', status: 'up', latencyMs: 12, code: 200, activeState: 'active', sinceSec: 90061 },
    { id: 'nebula', status: 'degraded', latencyMs: 2400, code: 500, activeState: 'active', sinceSec: 3661 },
  ];

  it('merges the registry with live probes by id', async () => {
    mockFetch((url) =>
      json(url.endsWith('/api/services') ? registry : status),
    );
    const services = await new HubClient(BASE).services();
    expect(services).toHaveLength(3);
    const hub = services.find((s) => s.id === 'hub-api')!;
    expect(hub.name).toBe('Hub API');
    expect(hub.status).toBe('up');
    expect(hub.latencyMs).toBe(12);
    expect(hub.code).toBe(200);
    expect(hub.sinceSec).toBe(90061);
    const nebula = services.find((s) => s.id === 'nebula')!;
    expect(nebula.status).toBe('degraded');
    // Registry entry with no probe row: catalog fields kept, status 'unknown'.
    const unprobed = services.find((s) => s.id === 'unprobed')!;
    expect(unprobed.status).toBe('unknown');
    expect(unprobed.latencyMs).toBeNull();
  });

  it('surfaces HTTP errors with the status code', async () => {
    mockFetch((url) =>
      url.endsWith('/api/services') ? json({ error: 'boom' }, 500) : json([]),
    );
    const err = await new HubClient(BASE)
      .services()
      .catch((e) => e);
    expect(err).toBeInstanceOf(HubError);
    expect(err.kind).toBe('http');
    expect(err.status).toBe(500);
  });

  it('maps fetch rejection to network errors', async () => {
    mockFetch(() => new TypeError('fetch failed'));
    const err = await new HubClient(BASE)
      .services()
      .catch((e) => e);
    expect(err).toBeInstanceOf(HubError);
    expect(err.kind).toBe('network');
  });

  it('maps aborts to timeout errors', async () => {
    mockFetch(() => Promise.reject(new DOMException('aborted', 'AbortError')));
    const err = await new HubClient(BASE, { timeoutMs: 1 })
      .services()
      .catch((e) => e);
    expect(err).toBeInstanceOf(HubError);
    expect(err.kind).toBe('timeout');
  });

  it('reports malformed JSON honestly', async () => {
    mockFetch(() => new Response('not json {', { status: 200 }));
    const err = await new HubClient(BASE)
      .services()
      .catch((e) => e);
    expect(err.kind).toBe('bad-json');
  });
});

describe('HubClient.agents', () => {
  it('normalizes the roster and skips nameless rows', async () => {
    mockFetch(() =>
      json([
        { id: 'qubit', slug: 'qubit', name: 'Qubit', listed: true, entries: 42 },
        { slug: 'no-name-agent' },
        null,
      ]),
    );
    const agents = await new HubClient(BASE).agents();
    expect(agents).toHaveLength(2);
    expect(agents[0]).toMatchObject({
      id: 'qubit',
      slug: 'qubit',
      name: 'Qubit',
      listed: true,
      entries: 42,
    });
    expect(agents[1].name).toBe('no-name-agent');
    expect(agents[1].listed).toBe(true);
    expect(agents[1].entries).toBeNull();
  });
});

describe('HubClient.vitals', () => {
  it('passes null readings through instead of inventing them', async () => {
    mockFetch(() =>
      json({ cpuPct: null, memPct: 61, memUsedGB: 19.2, memTotalGB: 31.2, load1: 2.4, uptimeSec: 86400, gpus: [] }),
    );
    const vitals = await new HubClient(BASE).vitals();
    expect(vitals.cpuPct).toBeNull();
    expect(vitals.memPct).toBe(61);
    expect(vitals.uptimeSec).toBe(86400);
  });
});

describe('HubClient.metrics', () => {
  it('clamps minutes to the server window and returns history newest-last', async () => {
    const { calls } = mockFetch((url) => {
      expect(url).toContain('minutes=720');
      return json([
        { t: 1, cpu: 10, mem: 60, load: 1.2, igpuTemp: 45, dgpuTemp: 50, watts: 65.5 },
        { t: 2, cpu: null, mem: 61, load: 1.4, igpuTemp: null, dgpuTemp: null, watts: null },
      ]);
    });
    const points = await new HubClient(BASE).metrics(10000);
    expect(points).toHaveLength(2);
    expect(points[0].cpu).toBe(10);
    expect(points[1].cpu).toBeNull();
    expect(calls[0]).toContain('/api/metrics');
  });
});

describe('HubClient.docket', () => {
  it('sends filter params and normalizes items', async () => {
    const { calls } = mockFetch(() =>
      json([
        {
          id: 'd1',
          title: 'Fix the porch light',
          status: 'queued',
          category: 'Home',
          tags: ['electrical'],
          updatedAt: '2026-10-01T12:00:00Z',
          price: { amount: 40, currency: 'USD' },
          cadence: 'one-off',
        },
        { id: 'bad', title: 123 },
      ]),
    );
    const items = await new HubClient(BASE).docket({ status: 'queued' });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'd1',
      title: 'Fix the porch light',
      status: 'queued',
      category: 'Home',
      tags: ['electrical'],
    });
    expect(calls[0]).toContain('/api/docket/items?status=queued');
  });
});

describe('HubClient.summary', () => {
  it('returns the aggregate roll-up', async () => {
    mockFetch(() =>
      json({
        services: { up: 34, total: 36, pct: 94.4, medianLatencyMs: 18, p95LatencyMs: 240 },
        agents: 6,
      }),
    );
    const summary = await new HubClient(BASE).summary();
    expect(summary.services).toMatchObject({ up: 34, total: 36, pct: 94.4 });
    expect(summary.agents).toBe(6);
  });
});

describe('fetchDashboard', () => {
  function allOk() {
    return mockFetch((url) => {
      if (url.endsWith('/api/services'))
        return json([{ id: 'hub-api', name: 'Hub API', cat: 'Infra' }]);
      if (url.endsWith('/api/status'))
        return json([{ id: 'hub-api', status: 'up', latencyMs: 9, code: 200 }]);
      if (url.endsWith('/api/agents'))
        return json([{ slug: 'qubit', name: 'Qubit' }]);
      if (url.endsWith('/api/vitals'))
        return json({ cpuPct: 12, memPct: 55, gpus: [] });
      if (url.includes('/api/metrics')) return json([{ t: 1, cpu: 12 }]);
      if (url.includes('/api/docket/items'))
        return json([{ id: 'd1', title: 'An idea', status: 'queued' }]);
      throw new Error(`unexpected ${url}`);
    });
  }

  it('loads every section when all endpoints are healthy', async () => {
    allOk();
    const dash = await fetchDashboard(new HubClient(BASE));
    expect(isDashboardLive(dash)).toBe(true);
    expect(dash.services.data![0].status).toBe('up');
    expect(dash.agents.data![0].name).toBe('Qubit');
    expect(dash.vitals.data!.cpuPct).toBe(12);
    expect(dash.docket.data![0].title).toBe('An idea');
  });

  it('degrades per section when one endpoint fails', async () => {
    allOk();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/agents')) return json({ error: 'down' }, 503);
        if (url.endsWith('/api/services'))
          return json([{ id: 'hub-api', name: 'Hub API', cat: 'Infra' }]);
        if (url.endsWith('/api/status')) return json([]);
        if (url.endsWith('/api/vitals')) return json({ gpus: [] });
        if (url.includes('/api/metrics')) return json([]);
        if (url.includes('/api/docket/items')) return json([]);
        throw new Error(`unexpected ${url}`);
      }),
    );
    const dash = await fetchDashboard(new HubClient(BASE));
    expect(isDashboardLive(dash)).toBe(false);
    expect(dash.services.status).toBe('ok');
    expect(dash.agents.status).toBe('error');
    expect(dash.agents.error).toMatchObject({ kind: 'http', status: 503 });
    expect(dash.vitals.status).toBe('ok');
  });
});
