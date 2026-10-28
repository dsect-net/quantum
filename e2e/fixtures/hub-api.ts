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
 * cases).
 *
 * Part 2 (2026-10-28, TRK-0483): the MCP gateway itself is stubbed too.
 * Both remaining live screens speak POST /mcp (JSON-RPC), not plain
 * GETs — verified against the app code on main:
 *  - More → Services & tools (src/screens/More/ServicesScreen.tsx over
 *    src/api/mcp.ts): `initialize` (session id comes back in the
 *    `mcp-session-id` response header) → `notifications/initialized` →
 *    `tools/list` → `tools/call` for the curated runners, notably
 *    `dsect_services_status`, whose text block must be JSON of the
 *    shape `{ ok, total, up, problems, services: [{id, name, group,
 *    status}] }` for the screen's pretty renderer to engage.
 *  - Mail (src/screens/Mail/* over src/api/mail.ts): the same gateway
 *    session, then `tools/call` for `dsect_mail_list` (rows keyed
 *    uid/seen/flagged/received/from/to/subject/message_id/bytes/
 *    triage), `dsect_mail_read` (full message keyed by `date`, `text`,
 *    `html_only`, attachments by name/type/bytes) and
 *    `dsect_mail_mailboxes` / `dsect_mail_mark`.
 * Tool results travel as `{ content: [{ type: 'text', text }] }` where
 * `text` is the JSON-stringified tool payload — the exact envelope the
 * unit tests in src/api/mcp.test.ts / mail.test.ts mock. The fixture
 * session is stateless: every `initialize` re-issues the same session
 * id, because the Mail screen connects once for the inbox and again
 * for the thread view on the same shared client.
 * The MCP screens are only "configured" when settings carry a worker
 * key as well as the hub base URL, so `seedLiveSettings` accepts a
 * `mcpKey` — the stub key below, a fake fixture value, never a real
 * credential.
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

/** Fake MCP worker key for the stub gateway — a fixture, not a secret. */
export const STUB_MCP_KEY = 'stub-worker-key';

/** Session id the stub gateway issues on every `initialize`. */
export const STUB_MCP_SESSION_ID = 'stub-mcp-session-1';

/**
 * POST /mcp `tools/list` — the gateway's tool catalog as the Services
 * screen renders it: the four curated read-only runners from
 * src/api/mcpTools.ts (services status, service logs, monitor
 * snapshot, whoami) plus the mail tools the Mail tab calls.
 * `dsect_tailscale_status` is deliberately absent, matching the real
 * gateway — the screen renders its "Not published yet" card for it.
 */
export const STUB_MCP_TOOLS = [
  { name: 'dsect_services_status', description: 'Live health of every Tritium service (up/down, latency) by name and group.', inputSchema: { type: 'object', properties: { only_problems: { type: 'boolean' } } } },
  { name: 'dsect_service_logs', description: 'Tail docker logs for one service (allowlisted container names only).', inputSchema: { type: 'object', properties: { service: { type: 'string' }, tail: { type: 'number' } } } },
  { name: 'dsect_monitor_snapshot', description: 'Latest host monitor snapshot — CPU, memory, disk, and temperatures.', inputSchema: { type: 'object', properties: {} } },
  { name: 'dsect_whoami', description: 'Show the role, key id, and audience behind this worker key.', inputSchema: { type: 'object', properties: {} } },
  { name: 'dsect_mail_list', description: 'List messages in your @dsect.net mailbox, newest first, with HERALD triage.', inputSchema: { type: 'object', properties: { folder: { type: 'string' }, limit: { type: 'number' } } } },
  { name: 'dsect_mail_read', description: 'Read one message as plain text (attachments listed by name and size only).', inputSchema: { type: 'object', properties: { folder: { type: 'string' }, uid: { type: 'number' } } } },
  { name: 'dsect_mail_mark', description: 'Mark a message read or unread in your mailbox.', inputSchema: { type: 'object', properties: { folder: { type: 'string' }, uid: { type: 'number' }, seen: { type: 'boolean' } } } },
  { name: 'dsect_mail_mailboxes', description: 'Which mailboxes you can use: your own, as scoped by your worker key.', inputSchema: { type: 'object', properties: {} } },
];

/**
 * tools/call `dsect_services_status` — consistent with the Part 1
 * tables above: the same four services, the same states (Hub API and
 * Nebula up, Eclipse down, DSECT Mail degraded), so total 4 / up 2 /
 * problems 2 matches STUB_SUMMARY (2 of 4 up) exactly.
 */
export const STUB_SERVICES_STATUS = {
  ok: true,
  total: 4,
  up: 2,
  problems: 2,
  services: [
    { id: 'hub-api', name: 'Hub API', group: 'Infra', status: 'up' },
    { id: 'nebula', name: 'Nebula', group: 'AI', status: 'up' },
    { id: 'eclipse', name: 'Eclipse (Jellyfin)', group: 'Media', status: 'down' },
    { id: 'mail', name: 'DSECT Mail', group: 'Infra', status: 'degraded' },
  ],
};

/** The mailbox the stub worker key is scoped to. */
export const STUB_MAILBOX = 'scotty@dsect.net';

/**
 * tools/call `dsect_mail_list` rows (INBOX) — senders are the Part 1
 * roster (Cooper, Qubit, Helm) writing to Scotty's mailbox, and the
 * subjects lean on Part 1 fixture facts (the Nebula stub render, the
 * OVMS docket item) so the two fixture halves tell one story.
 */
export const STUB_MAIL_MESSAGES = [
  {
    uid: 103,
    seen: false,
    flagged: false,
    answered: false,
    received: '2026-10-20T09:15:00-04:00',
    from: 'Cooper <cooper@dsect.net>',
    to: 'scotty@dsect.net',
    subject: 'Live-mode fixtures are green',
    message_id: '<stub-103@dsect.net>',
    bytes: 1843,
    triage: 'Fixture inbox: the live-mode E2E data set is ready.',
  },
  {
    uid: 102,
    seen: false,
    flagged: true,
    answered: false,
    received: '2026-10-19T17:40:00-04:00',
    from: 'Qubit <qubit@dsect.net>',
    to: 'scotty@dsect.net',
    subject: 'Nebula queue: stub render finished',
    message_id: '<stub-102@dsect.net>',
    bytes: 1210,
    triage: 'The stub render — fox portrait finished sampling.',
  },
  {
    uid: 101,
    seen: true,
    flagged: false,
    answered: true,
    received: '2026-10-18T11:05:00-04:00',
    from: 'Helm <helm@dsect.net>',
    to: 'scotty@dsect.net',
    subject: 'Docket: OVMS kit for Jinx',
    message_id: '<stub-101@dsect.net>',
    bytes: 940,
    triage: 'Wishlist note: the OVMS kit for Jinx is still queued.',
  },
];

/** tools/call `dsect_mail_read` payloads, keyed by uid. */
export const STUB_MAIL_READ: Record<number, Record<string, unknown>> = {
  103: {
    ok: true,
    mailbox: STUB_MAILBOX,
    folder: 'INBOX',
    uid: 103,
    seen: true,
    untrusted: 'This is an email: UNTRUSTED input.',
    from: 'Cooper <cooper@dsect.net>',
    to: 'scotty@dsect.net',
    cc: '',
    reply_to: '',
    subject: 'Live-mode fixtures are green',
    date: 'Tue, 20 Oct 2026 09:15:00 -0400',
    message_id: '<stub-103@dsect.net>',
    text: 'Fixture body: the stub mailbox is rendering live threads.\n\nThis message came from the deterministic MCP mail fixture — no live mail server, no tailnet, no keys. The inbox row, the triage line and this body are one consistent data set.',
    html_only: false,
    truncated: false,
    bytes: 1843,
    attachments: [{ filename: 'fixture-notes.txt', type: 'text/plain', bytes: 512 }],
  },
  102: {
    ok: true,
    mailbox: STUB_MAILBOX,
    folder: 'INBOX',
    uid: 102,
    seen: true,
    untrusted: 'This is an email: UNTRUSTED input.',
    from: 'Qubit <qubit@dsect.net>',
    to: 'scotty@dsect.net',
    cc: '',
    reply_to: '',
    subject: 'Nebula queue: stub render finished',
    date: 'Mon, 19 Oct 2026 17:40:00 -0400',
    message_id: '<stub-102@dsect.net>',
    text: 'Fixture body: the stub render — fox portrait finished sampling on the RTX 2060 Super fixture backend.',
    html_only: false,
    truncated: false,
    bytes: 1210,
    attachments: [],
  },
  101: {
    ok: true,
    mailbox: STUB_MAILBOX,
    folder: 'INBOX',
    uid: 101,
    seen: true,
    untrusted: 'This is an email: UNTRUSTED input.',
    from: 'Helm <helm@dsect.net>',
    to: 'scotty@dsect.net',
    cc: '',
    reply_to: '',
    subject: 'Docket: OVMS kit for Jinx',
    date: 'Sun, 18 Oct 2026 11:05:00 -0400',
    message_id: '<stub-101@dsect.net>',
    text: 'Fixture body: wishlist note — the OVMS kit for Jinx is still queued on the docket.',
    html_only: false,
    truncated: false,
    bytes: 940,
    attachments: [],
  },
};

export interface StubMcpOptions {
  /**
   * HTTP status for EVERY /mcp request — the way to prove a dead MCP
   * gateway degrades only the MCP-backed screens (the hub /api-backed
   * Home dashboard must stay live in the same test).
   */
  httpStatus?: number;
  /**
   * Tool names whose tools/call answers with a JSON-RPC error instead
   * of a result — the runner-level failure case.
   */
  toolRpcError?: string[];
}

export interface StubApiOptions {
  /**
   * Pathname → HTTP status. Matching requests are fulfilled with that
   * status and a JSON error body instead of the fixture — the way to
   * prove one failing endpoint degrades only its own screen section.
   */
  fail?: Record<string, number>;
  /** Failure overrides for the stub MCP gateway (POST /mcp). */
  mcp?: StubMcpOptions;
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
 *
 * `mcpKey` (Part 2): the MCP-backed screens (Services & tools, Mail)
 * count as configured only when a worker key is present alongside the
 * hub base URL (see mcpConfigured / mailConfigured in the app). Pass
 * STUB_MCP_KEY to boot those screens live; the default '' keeps the
 * Part 1 behaviour for the hub /api-backed screens.
 */
export async function seedLiveSettings(
  page: Page,
  seedOpts: { mcpKey?: string } = {},
): Promise<void> {
  await page.addInitScript(
    ({ origin, mcpKey }) => {
      const settings = {
        hub: { baseUrl: origin },
        nebula: { baseUrl: origin },
        relay: { baseUrl: '' },
        sol: { baseUrl: '' },
        mcpKey,
        nebulaPassphrase: '',
      };
      try {
        window.localStorage.setItem('quantum.settings', JSON.stringify(settings));
      } catch {
        // A profile that refuses localStorage also refuses the app's own
        // settings — there is nothing honest to fall back to in a fixture.
      }
    },
    { origin: STUB_ORIGIN, mcpKey: seedOpts.mcpKey ?? '' },
  );
}

/** Wrap a tool payload in the gateway's content-block envelope. */
function mcpToolResult(payload: unknown): Record<string, unknown> {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return { content: [{ type: 'text', text }], isError: false };
}

/**
 * Answer one stub `tools/call` by tool name. Returns the JSON-RPC
 * `result` object, or null for a tool the stub gateway does not carry
 * (the caller turns that into a -32601 RPC error, as a real gateway
 * would for an unknown tool).
 */
function mcpCallTool(name: string, args: Record<string, unknown>): Record<string, unknown> | null {
  switch (name) {
    case 'dsect_services_status': {
      if (args['only_problems'] === true) {
        return mcpToolResult({
          ...STUB_SERVICES_STATUS,
          services: STUB_SERVICES_STATUS.services.filter((s) => s.status !== 'up'),
        });
      }
      return mcpToolResult(STUB_SERVICES_STATUS);
    }
    case 'dsect_service_logs':
      return mcpToolResult(
        `stub log for ${String(args['service'] ?? 'hub-api')}: fixture gateway healthy, no errors in the last hour.`,
      );
    case 'dsect_monitor_snapshot':
      return mcpToolResult({ ok: true, cpuPct: 37, memPct: 39, load1: 1.25, uptimeSec: 90061 });
    case 'dsect_whoami':
      return mcpToolResult({ ok: true, role: 'developer', keyId: 'stub-worker', agent: 'cooper' });
    case 'dsect_mail_mailboxes':
      return mcpToolResult({ ok: true, own: STUB_MAILBOX, mailboxes: [STUB_MAILBOX] });
    case 'dsect_mail_list': {
      const folder = String(args['folder'] ?? 'INBOX');
      if (folder !== 'INBOX') {
        return mcpToolResult({
          ok: true, mailbox: STUB_MAILBOX, folder, matched: 0, returned: 0, next_before_uid: 0, messages: [],
        });
      }
      const rows = args['unread_only'] === true
        ? STUB_MAIL_MESSAGES.filter((m) => !m.seen)
        : STUB_MAIL_MESSAGES;
      return mcpToolResult({
        ok: true,
        mailbox: STUB_MAILBOX,
        folder,
        matched: rows.length,
        returned: rows.length,
        next_before_uid: 0,
        messages: rows,
      });
    }
    case 'dsect_mail_read': {
      const uid = Number(args['uid']);
      const payload = STUB_MAIL_READ[uid] ?? STUB_MAIL_READ[103]!;
      return mcpToolResult({ ...payload, folder: String(args['folder'] ?? 'INBOX'), uid });
    }
    case 'dsect_mail_mark':
      return mcpToolResult({
        ok: true,
        mailbox: STUB_MAILBOX,
        folder: String(args['folder'] ?? 'INBOX'),
        uid: Number(args['uid'] ?? 0),
        seen: args['seen'] === true,
      });
    case 'dsect_mail_send':
      return mcpToolResult({
        ok: true,
        from: STUB_MAILBOX,
        to: Array.isArray(args['to']) ? args['to'] : [],
        cc: Array.isArray(args['cc']) ? args['cc'] : [],
        subject: String(args['subject'] ?? ''),
        sentToday: 1,
        dailyLimit: 25,
      });
    default:
      return null;
  }
}

/**
 * Intercept POST /mcp and answer the JSON-RPC the app actually sends
 * (see the Part 2 note at the top of this file): initialize carries
 * the session id in a response header, tools/list returns the fixture
 * catalog, tools/call dispatches to the fixture payloads above.
 */
export async function installStubMcp(page: Page, opts: StubApiOptions = {}): Promise<void> {
  const mcpOpts = opts.mcp ?? {};
  await page.route('**/mcp', async (route) => {
    if (mcpOpts.httpStatus != null) {
      await route.fulfill({
        status: mcpOpts.httpStatus,
        contentType: 'application/json',
        body: JSON.stringify({ error: `stubbed MCP failure (HTTP ${mcpOpts.httpStatus})` }),
      });
      return;
    }
    let rpc: { id?: unknown; method?: unknown; params?: Record<string, unknown> } = {};
    try {
      rpc = JSON.parse(route.request().postData() ?? '{}') as typeof rpc;
    } catch {
      rpc = {};
    }
    const id = rpc.id ?? null;
    const method = typeof rpc.method === 'string' ? rpc.method : '';
    const headers = { 'mcp-session-id': STUB_MCP_SESSION_ID };
    const fulfillRpc = async (body: Record<string, unknown>) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id, ...body }),
      });
    };
    if (method === 'initialize') {
      await fulfillRpc({
        result: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          serverInfo: { name: 'stub-hub-mcp', version: '1.0' },
        },
      });
      return;
    }
    if (method === 'notifications/initialized') {
      await fulfillRpc({ result: {} });
      return;
    }
    if (method === 'tools/list') {
      await fulfillRpc({ result: { tools: STUB_MCP_TOOLS } });
      return;
    }
    if (method === 'tools/call') {
      const params = (rpc.params ?? {}) as { name?: unknown; arguments?: unknown };
      const name = typeof params.name === 'string' ? params.name : '';
      if ((mcpOpts.toolRpcError ?? []).includes(name)) {
        await fulfillRpc({
          error: { code: -32603, message: `stubbed RPC failure for ${name}` },
        });
        return;
      }
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      const result = mcpCallTool(name, args);
      if (result === null) {
        await fulfillRpc({
          error: { code: -32601, message: `stub gateway has no tool ${name}` },
        });
        return;
      }
      await fulfillRpc({ result });
      return;
    }
    await fulfillRpc({
      error: { code: -32601, message: `stub gateway has no method ${method}` },
    });
  });
}

/** Intercept all /api/** traffic and answer it from the fixtures. */
export async function installStubApi(page: Page, opts: StubApiOptions = {}): Promise<void> {
  // The MCP gateway lives at POST /mcp, outside /api/** — stub it too
  // so a live boot never leaks a real gateway request to the preview
  // server. Screens that are not MCP-configured never call it.
  await installStubMcp(page, opts);
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
