/**
 * Quantum hub-api client — the Home tab's data layer.
 *
 * hub-api (dsect-net/hub-api, Tritium) is Quantum's single dashboard backend:
 *  - GET /api/services      the service registry (static catalog)
 *  - GET /api/status        live probe + systemd-unit state per registry entry
 *  - GET /api/agents        agent roster (proxied to Reeve's ledger)
 *  - GET /api/vitals        current host vitals (CPU, memory, load, uptime)
 *  - GET /api/metrics       per-minute metric history ({minutes} window)
 *  - GET /api/docket/items  the wishlist/docket board
 *  - GET /api/summary       aggregate services/agents snapshot
 *
 * Endpoint shapes verified 2026-10-02 against the hub-api tree
 * (server.js). Fields the app does not need are not typed.
 *
 * Auth: on Scotty's tailnet, Tailscale identity headers carry auth — the app
 * sends nothing ("being on the tailnet is the token", per the Quantum plan).
 * No bearer keys or secrets are read here; the MCP key in settings is for
 * POST /mcp only and is never attached by this client.
 *
 * Honesty rules:
 *  - Empty base URL = demo mode. Every call fails closed with kind
 *    'not-configured' BEFORE any network attempt.
 *  - Responses are normalized defensively but never invented: a missing
 *    field becomes null/undefined, never a plausible-looking guess.
 *  - fetchDashboard uses Promise.allSettled so one failing endpoint degrades
 *    its own section instead of taking the whole screen down.
 */
import { normalizeBaseUrl } from '../lib/settings';

export type ServiceStatus = 'up' | 'down' | 'degraded' | 'unknown';

/** One row of GET /api/services — the registry catalog (static). */
export interface HubServiceEntry {
  id: string;
  name: string;
  cat: string;
  desc?: string;
  tags?: string[];
  port?: number;
  exposure?: string;
  url?: string | null;
  probe?: string | null;
  unit?: string | null;
  ver?: string | null;
}

/** One row of GET /api/status — measured probe + unit state. */
export interface HubServiceProbe {
  id: string;
  status: ServiceStatus;
  latencyMs: number | null;
  code: number | null;
  activeState?: string | null;
  /** Seconds since the systemd unit entered the active state; null = unknown. */
  sinceSec?: number | null;
}

/** Registry entry merged with its live probe, keyed by id. */
export type HubService = HubServiceEntry & HubServiceProbe;

/** One agent from GET /api/agents (Reeve ledger proxy). */
export interface HubAgent {
  id: string | number | null;
  slug: string | null;
  name: string;
  listed: boolean;
  entries: number | null;
}

/** GET /api/vitals — current host snapshot. cpuPct is null before the first
 *  rate sample is taken; the client must render that honestly. */
export interface HubVitals {
  cpuPct: number | null;
  nproc: number | null;
  load1: number | null;
  load5: number | null;
  load15: number | null;
  memPct: number | null;
  memUsedGB: number | null;
  memTotalGB: number | null;
  swapPct: number | null;
  uptimeSec: number | null;
  rxKBs: number | null;
  txKBs: number | null;
  gpus: HubGpu[];
}

export interface HubGpu {
  vendor: string;
  name?: string | null;
  tempC?: number | null;
  busyPct?: number | null;
}

/** One sample of GET /api/metrics — one point per minute, newest last. */
export interface HubMetricPoint {
  t: number;
  cpu: number | null;
  mem: number | null;
  load: number | null;
  igpuTemp: number | null;
  dgpuTemp: number | null;
  watts: number | null;
}

/** One card of GET /api/docket/items — the wishlist/docket board. */
export interface HubDocketItem {
  id: string;
  title: string;
  status: string;
  category: string | null;
  tags: string[];
  updatedAt: string | null;
  createdAt: string | null;
  requester: string | null;
  price: { amount: number | null; currency: string } | null;
  cadence: string | null;
}

/** GET /api/summary — the aggregate roll-up. */
export interface HubSummary {
  services: {
    up: number;
    total: number;
    pct: number | null;
    medianLatencyMs: number | null;
    p95LatencyMs: number | null;
  } | null;
  agents: number | null;
}

export type HubErrorKind =
  | 'not-configured'
  | 'http'
  | 'network'
  | 'timeout'
  | 'bad-json'
  | 'bad-shape';

/** Every hub-api failure arrives as one of these — no silent surprises. */
export class HubError extends Error {
  readonly kind: HubErrorKind;
  readonly status?: number;
  readonly url?: string;

  constructor(kind: HubErrorKind, message: string, status?: number, url?: string) {
    super(message);
    this.name = 'HubError';
    this.kind = kind;
    this.status = status;
    this.url = url;
  }
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

const SERVICE_STATUSES: ReadonlySet<string> = new Set([
  'up',
  'down',
  'degraded',
  'unknown',
]);

export const DEFAULT_TIMEOUT_MS = 12000;
/** The server clamps minutes to 5–720; clamp here too so asks stay honest. */
export const MAX_METRICS_MINUTES = 720;
export const MIN_METRICS_MINUTES = 5;

export interface HubClientOptions {
  timeoutMs?: number;
}

export class HubClient {
  readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, options: HubClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** False = demo mode: no base URL configured, no network calls allowed. */
  get configured(): boolean {
    return this.baseUrl !== '';
  }

  private async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    if (!this.configured) {
      throw new HubError(
        'not-configured',
        'No Hub API base URL configured — demo mode. Add one in More → Connection settings.',
      );
    }
    const query = params
      ? '?' + new URLSearchParams(params).toString()
      : '';
    const url = this.baseUrl + path + query;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        cache: 'no-store',
        signal: ctrl.signal,
        headers: { Accept: 'application/json' },
      });
    } catch (err) {
      throw new HubError(
        err instanceof DOMException && err.name === 'AbortError'
          ? 'timeout'
          : 'network',
        err instanceof DOMException && err.name === 'AbortError'
          ? `Hub API request timed out after ${this.timeoutMs} ms (${url}).`
          : `Could not reach the Hub API (${url}). Check the tailnet connection.`,
        undefined,
        url,
      );
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw new HubError(
        'http',
        `Hub API returned HTTP ${res.status} for ${path}.`,
        res.status,
        url,
      );
    }
    try {
      return (await res.json()) as T;
    } catch {
      throw new HubError(
        'bad-json',
        `Hub API returned non-JSON for ${path}.`,
        res.status,
        url,
      );
    }
  }

  /**
   * Services with live state: merges the registry catalog
   * (GET /api/services) with measured probes (GET /api/status) by id.
   * A registry entry with no probe row keeps catalog fields and reports
   * 'unknown' — the server's own honest convention for unmeasured services.
   */
  async services(): Promise<HubService[]> {
    const [registryRaw, statusRaw] = await Promise.all([
      this.get<unknown[]>('/api/services'),
      this.get<unknown[]>('/api/status'),
    ]);
    const probes = new Map<string, Record<string, unknown>>();
    for (const row of asArray<Record<string, unknown>>(statusRaw)) {
      if (row && typeof row.id === 'string') probes.set(row.id, row);
    }
    const out: HubService[] = [];
    for (const row of asArray<Record<string, unknown>>(registryRaw)) {
      if (!row || typeof row.id !== 'string' || typeof row.name !== 'string')
        continue;
      const probe = probes.get(row.id);
      const status = asString(probe?.status);
      out.push({
        id: row.id,
        name: row.name,
        cat: asString(row.cat) ?? 'Infra',
        desc: asString(row.desc) ?? undefined,
        tags: Array.isArray(row.tags)
          ? row.tags.filter((t): t is string => typeof t === 'string')
          : undefined,
        port: asNumber(row.port) ?? undefined,
        exposure: asString(row.exposure) ?? undefined,
        url: asString(row.url),
        probe: asString(row.probe),
        unit: asString(row.unit),
        ver: asString(row.ver),
        status:
          status && SERVICE_STATUSES.has(status)
            ? (status as ServiceStatus)
            : 'unknown',
        latencyMs: asNumber(probe?.latencyMs),
        code: asNumber(probe?.code),
        activeState: asString(probe?.activeState),
        sinceSec: asNumber(probe?.sinceSec),
      });
    }
    return out;
  }

  /** Agent roster from GET /api/agents (Reeve ledger proxy). */
  async agents(): Promise<HubAgent[]> {
    const raw = await this.get<unknown>('/api/agents');
    const out: HubAgent[] = [];
    for (const row of asArray<Record<string, unknown>>(raw)) {
      if (!row) continue;
      const slug = asString(row.slug);
      const name = asString(row.name) ?? slug;
      if (!name) continue;
      out.push({
        id:
          typeof row.id === 'string' || typeof row.id === 'number'
            ? row.id
            : null,
        slug,
        name,
        listed: row.listed == null ? true : row.listed === true,
        entries: asNumber(row.entries),
      });
    }
    return out;
  }

  /** Current host vitals from GET /api/vitals. */
  async vitals(): Promise<HubVitals> {
    const raw = await this.get<Record<string, unknown>>('/api/vitals');
    if (!raw || typeof raw !== 'object') {
      throw new HubError('bad-shape', 'Hub API /api/vitals returned an unexpected shape.');
    }
    const gpus: HubGpu[] = [];
    for (const g of asArray<Record<string, unknown>>(raw.gpus)) {
      if (!g || typeof g.vendor !== 'string') continue;
      gpus.push({
        vendor: g.vendor,
        name: asString(g.name),
        tempC: asNumber(g.tempC),
        busyPct: asNumber(g.busyPct),
      });
    }
    return {
      cpuPct: asNumber(raw.cpuPct),
      nproc: asNumber(raw.nproc),
      load1: asNumber(raw.load1),
      load5: asNumber(raw.load5),
      load15: asNumber(raw.load15),
      memPct: asNumber(raw.memPct),
      memUsedGB: asNumber(raw.memUsedGB),
      memTotalGB: asNumber(raw.memTotalGB),
      swapPct: asNumber(raw.swapPct),
      uptimeSec: asNumber(raw.uptimeSec),
      rxKBs: asNumber(raw.rxKBs),
      txKBs: asNumber(raw.txKBs),
      gpus,
    };
  }

  /** Per-minute metric history, newest last. minutes clamps to 5–720. */
  async metrics(minutes = 60): Promise<HubMetricPoint[]> {
    const clamped = Math.min(
      MAX_METRICS_MINUTES,
      Math.max(MIN_METRICS_MINUTES, Math.floor(minutes) || 60),
    );
    const raw = await this.get<unknown>('/api/metrics', {
      minutes: String(clamped),
    });
    const out: HubMetricPoint[] = [];
    for (const row of asArray<Record<string, unknown>>(raw)) {
      if (!row) continue;
      out.push({
        t: asNumber(row.t) ?? 0,
        cpu: asNumber(row.cpu),
        mem: asNumber(row.mem),
        load: asNumber(row.load),
        igpuTemp: asNumber(row.igpuTemp),
        dgpuTemp: asNumber(row.dgpuTemp),
        watts: asNumber(row.watts),
      });
    }
    return out;
  }

  /** Docket board items (server sorts updatedAt desc by default). */
  async docket(params?: {
    status?: string;
    category?: string;
    tag?: string;
    q?: string;
  }): Promise<HubDocketItem[]> {
    const query: Record<string, string> = {};
    if (params?.status) query.status = params.status;
    if (params?.category) query.category = params.category;
    if (params?.tag) query.tag = params.tag;
    if (params?.q) query.q = params.q;
    const raw = await this.get<unknown>('/api/docket/items', query);
    const out: HubDocketItem[] = [];
    for (const row of asArray<Record<string, unknown>>(raw)) {
      if (!row || typeof row.id !== 'string' || typeof row.title !== 'string')
        continue;
      const price =
        row.price && typeof row.price === 'object'
          ? {
              amount: asNumber((row.price as Record<string, unknown>).amount),
              currency:
                asString((row.price as Record<string, unknown>).currency) ??
                'USD',
            }
          : null;
      out.push({
        id: row.id,
        title: row.title,
        status: asString(row.status) ?? 'queued',
        category: asString(row.category),
        tags: Array.isArray(row.tags)
          ? row.tags.filter((t): t is string => typeof t === 'string')
          : [],
        updatedAt: asString(row.updatedAt),
        createdAt: asString(row.createdAt),
        requester: asString(row.requester),
        price,
        cadence: asString(row.cadence),
      });
    }
    return out;
  }

  /** Aggregate roll-up from GET /api/summary. */
  async summary(): Promise<HubSummary> {
    const raw = await this.get<Record<string, unknown>>('/api/summary');
    if (!raw || typeof raw !== 'object') {
      throw new HubError('bad-shape', 'Hub API /api/summary returned an unexpected shape.');
    }
    const svc =
      raw.services && typeof raw.services === 'object'
        ? (raw.services as Record<string, unknown>)
        : null;
    return {
      services: svc
        ? {
            up: asNumber(svc.up) ?? 0,
            total: asNumber(svc.total) ?? 0,
            pct: asNumber(svc.pct),
            medianLatencyMs: asNumber(svc.medianLatencyMs),
            p95LatencyMs: asNumber(svc.p95LatencyMs),
          }
        : null,
      agents: asNumber(raw.agents),
    };
  }
}

export interface DashboardSection<T> {
  status: 'ok' | 'error';
  data: T | null;
  error: HubError | null;
}

export interface Dashboard {
  services: DashboardSection<HubService[]>;
  agents: DashboardSection<HubAgent[]>;
  vitals: DashboardSection<HubVitals>;
  metrics: DashboardSection<HubMetricPoint[]>;
  docket: DashboardSection<HubDocketItem[]>;
}

function settle<T>(result: PromiseSettledResult<T>): DashboardSection<T> {
  if (result.status === 'fulfilled') {
    return { status: 'ok', data: result.value, error: null };
  }
  const error =
    result.reason instanceof HubError
      ? result.reason
      : new HubError('network', String(result.reason));
  return { status: 'error', data: null, error };
}

/**
 * Load every Home section in parallel; each settles independently so one
 * failing endpoint degrades its own section instead of the whole screen.
 * Rejects only in demo mode (nothing to even try).
 */
export async function fetchDashboard(
  client: HubClient,
  metricsMinutes = 60,
): Promise<Dashboard> {
  if (!client.configured) {
    throw new HubError(
      'not-configured',
      'No Hub API base URL configured — demo mode.',
    );
  }
  const [services, agents, vitals, metrics, docket] = await Promise.allSettled([
    client.services(),
    client.agents(),
    client.vitals(),
    client.metrics(metricsMinutes),
    client.docket(),
  ]);
  return {
    services: settle(services),
    agents: settle(agents),
    vitals: settle(vitals),
    metrics: settle(metrics),
    docket: settle(docket),
  };
}

/** True only when every section loaded — used for the top-level state. */
export function isDashboardLive(dash: Dashboard): boolean {
  return (
    dash.services.status === 'ok' &&
    dash.agents.status === 'ok' &&
    dash.vitals.status === 'ok' &&
    dash.metrics.status === 'ok' &&
    dash.docket.status === 'ok'
  );
}
