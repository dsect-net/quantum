import type { Page } from '@playwright/test';

/**
 * Live-mode E2E fixtures — a deterministic stub hub-api (+ Nebula jobs)
 * for the Quantum app, served entirely by Playwright route interception.
 *
 * The Oct 16 app-shell spec proves the honest demo / not-connected states
 * with a clean profile. This module proves the opposite side of the
 * contract: when a base URL IS configured, the screens render the data
 * the API actually returned — service counts, probe states, roster,
 * vitals, docket — with no live Tritium, no tailnet, and no secrets.
 *
 * How it works:
 *  - `seedLiveSettings` points the hub + nebula base URLs at the preview
 *    origin itself (see playwright.config.ts, port 5199) via the app's
 *    own localStorage settings key — the same store the Settings screen
 *    writes, so the app boots in live mode on first paint.
 *  - `installStubApi` intercepts every API request before it leaves
 *    the page and fulfils it from the fixture tables below.
 *    Unmapped API paths get a JSON 404 instead of falling through to
 *    the preview server (which would answer with index.html and turn a
 *    missing fixture into a confusing bad-JSON error).
 *
 * The fixture data is deliberately *internally consistent*: the summary
 * roll-up (2/4 up, 50%) matches the registry + probe tables, the median
 * latency the services section computes matches the probe latencies, and
 * the agent count matches the roster. Assertions in live-mode.spec.ts
 * lean on that consistency — if a fixture changes, change them together.
 *
 * Extending: add a path to `routes()` (or a `fail` override for error
 * cases). Mail and the MCP-backed Services screen speak POST /mcp
 * (JSON-RPC) rather than plain GETs; stub those at the route layer in
 * the spec that needs them, using this file's seed + origin helpers.
 */

/** Must match the preview port in playwright.config.ts. */
export const STUB_ORIGIN = 'http://127.0.0.1:5199';

/** GET /api/services — the registry catalog (static). */
export const STUB_SERVICES = [
  { id: 'hub-api', name: 'Hub API', cat: 'Infra', desc: 'Operations hub', tags: ['hub'], port: 8787, exposure: 'tailnet', url: null, probe: 'http', unit: 'hub-api.service', ver: '1.0' },
  { id: 'nebula', name: 'Nebula', cat: 'AI', desc: 'Media generation hub', tags: ['gpu', 'media'], port: 8092, exposure: 'tailnet', url: null, probe: 'http', unit: 'nebula.service', ver: '1.0' },
  { id: 'eclipse', name: 'Eclipse (Jellyfin)', cat: 'Media', desc: 'Household media server', tags: ['media'], port: 8096, exposure: 'tailnet', url: null, probe: 'http', unit: 'jellyfin.service', ver: '12.2.0' },
  { id: 'mail', name: 'DSECT Mail', cat: 'Infra', desc: 'Household mail server', tags: ['mail'], port: 993, exposure: 'public', url: null, probe: 'tcp', unit: 'dovecot.service', ver: '2.3' },
];

/** GET /api/status — measured probes, keyed by the same ids. */
export const STUB_STATUS = [
  { id: 'hub-api', status: 'up', latencyMs: 12, code: 200, activeState: 'active', sinceSec: 90061 },
  { id: 'nebula', status: 'up', latencyMs: 34, code: 200, activeState: 'active', sinceSec: 45200 },
  { id: 'eclipse', status: 'down', latencyMs: null, code: 0, activeState: 'failed', sinceSec: null },
  { id: 'mail', status: 'degraded', latencyMs: 58, code: 200, activeState: 'active', sinceSec: 12000 },
];

/** GET /api/summary — consistent with the tables above: 2 of 4 up. */
export const STUB_SUMMARY = {
  services: { up: 2, total: 4, pct: 50, medianLatencyMs: 23, p95LatencyMs: 41 },
  agents: 3,
};

/** GET /api/vitals — one AMD iGPU (the glance tile picks vendor 'amd'). */
export const STUB_VITALS = {
  cpuPct: 37,
  nproc: 16,
  load1: 1.25,
  load5: 1.1,
  load15: 0.98,
  memPct: 39,
  memUsedGB: 12.4,
  memTotalGB: 32,
  swapPct: 4,
  uptimeSec: 90061,
  rxKBs: 128,
  txKBs: 64,
  gpus: [
    { vendor: 'amd', name: 'Radeon 780M', tempC: 55, busyPct: 21 },
    { vendor: 'nvidia', name: 'RTX 2060 Super', tempC: 61, busyPct: 0 },
  ],
};

/** GET /api/metrics — newest last; the glance power tile reads 142 W. */
export const STUB_METRICS = [
  { t: 1760000000, cpu: 31, mem: 38, load: 1.0, igpuTemp: 54, dgpuTemp: 60, watts: 138 },
  { t: 1760000060, cpu: 35, mem: 39, load: 1.15, igpuTemp: 55, dgpuTemp: 61, watts: 140 },
  { t: 1760000120, cpu: 37, mem: 39, load: 1.25, igpuTemp: 55, dgpuTemp: 61, watts: 142 },
];

/** GET /api/agents — the roster (3 = STUB_SUMMARY.agents). */
export const STUB_AGENTS = [
  { id: 1, slug: 'cooper', name: 'Cooper', listed: true, entries: 128 },
  { id: 2, slug: 'qubit', name: 'Qubit', listed: true, entries: 96 },
  { id: 3, slug: 'helm', name: 'Helm', listed: true, entries: 41 },
];

/** GET /api/docket/items — the wishlist board. */
export const STUB_DOCKET = [
  {
    id: 'docket-ovms',
    title: 'OVMS kit for Jinx',
    status: 'queued',
    category: 'hardware',
    tags: ['jinx', 'telematics'],
    updatedAt: '2026-10-19T12:00:00Z',
    createdAt: '2026-10-18T12:00:00Z',
    requester: 'scotty',
    price: { amount: 260, currency: 'USD' },
    cadence: null,
  },
  {
    id: 'docket-voice',
    title: 'Voice Preview Edition satellite',
    status: 'approved',
    category: 'hardware',
    tags: ['home-assistant', 'voice'],
    updatedAt: '2026-10-20T12:00:00Z',
    createdAt: '2026-10-19T12:00:00Z',
    requester: 'scotty',
    price: { amount: 69, currency: 'USD' },
    cadence: null,
  },
];

/** GET /api/jobs (Nebula) — one running, one finished. */
export const STUB_JOBS = {
  active: [
    {
      id: 'stub-job-1',
      state: 'running',
      workflow: 'stub-t2i.json',
      title: 'Stub render — fox portrait',
      user: 'cooper',
      backend: 'nvidia',
      device: 'RTX 2060 Super',
      queued_at: 1760000000,
      progress: { value: 4, max: 8, phase: 'sampling' },
      outputs: [],
    },
  ],
  recent: [
    {
      id: 'stub-job-0',
      state: 'success',
      workflow: 'stub-t2i.json',
      title: 'Stub render — harbour at dusk',
      user: 'cooper',
      backend: 'nvidia',
      device: 'RTX 2060 Super',
      queued_at: 1759990000,
      progress: null,
      outputs: ['t2i/stub_harbour_0001.png'],
    },
  ],
  busy: false,
  waiting: 1,
};

/** GET /api/workflows (Nebula) — the single stub workflow. */
export const STUB_WORKFLOWS = {
  workflows: ['stub-t2i.json'],
  items: [
    { name: 'stub-t2i.json', title: 'Stub Text to Image', short: 'Fixture workflow', family: 'image', kind: 't2i', order: 1 },
  ],
  kinds: ['t2i'],
};

export interface StubApiOptions {
  /**
   * Pathname → HTTP status. Matching requests are fulfilled with that
   * status and a JSON error body instead of the fixture — the way to
   * prove one failing endpoint degrades only its own screen section.
   */
  fail?: Record<string, number>;
}

function routes(opts: StubApiOptions): Record<string, unknown> {
  return {
    '/api/services': STUB_SERVICES,
    '/api/status': STUB_STATUS,
    '/api/summary': STUB_SUMMARY,
    '/api/vitals': STUB_VITALS,
    '/api/metrics': STUB_METRICS,
    '/api/agents': STUB_AGENTS,
    '/api/docket/items': STUB_DOCKET,
    '/api/jobs': STUB_JOBS,
    '/api/workflows': STUB_WORKFLOWS,
  };
}

/**
 * Seed the app's own settings store so hub + nebula boot in live mode,
 * pointed at the preview origin (which the route stub then answers).
 * Must run before `page.goto` — uses an init script.
 */
export async function seedLiveSettings(page: Page): Promise<void> {
  await page.addInitScript((origin) => {
    const settings = {
      hub: { baseUrl: origin },
      nebula: { baseUrl: origin },
      relay: { baseUrl: '' },
      sol: { baseUrl: '' },
      mcpKey: '',
      nebulaPassphrase: '',
    };
    try {
      window.localStorage.setItem('quantum.settings', JSON.stringify(settings));
    } catch {
      // A profile that refuses localStorage also refuses the app's own
      // settings — there is nothing honest to fall back to in a fixture.
    }
  }, STUB_ORIGIN);
}

/** Intercept all /api/** traffic and answer it from the fixtures. */
export async function installStubApi(page: Page, opts: StubApiOptions = {}): Promise<void> {
  const table = routes(opts);
  const fail = opts.fail ?? {};
  await page.route('**/api/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    const failStatus = fail[pathname];
    if (failStatus != null) {
      await route.fulfill({
        status: failStatus,
        contentType: 'application/json',
        body: JSON.stringify({ error: `stubbed failure for ${pathname}` }),
      });
      return;
    }
    // Nebula media endpoints answer image bytes, not JSON: job cards
    // fetch output thumbnails from them, so serve a 1x1 PNG rather
    // than letting the card render its broken-image state.
    if (pathname.startsWith('/api/thumb/') || pathname.startsWith('/api/file/')) {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
          'base64',
        ),
      });
      return;
    }
    const body = table[pathname];
    if (body === undefined) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: `no stub fixture for ${pathname}` }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}
