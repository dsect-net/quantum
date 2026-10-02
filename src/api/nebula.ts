/**
 * Nebula JSON API client — the client behind the Quantum "Create" tab.
 *
 * Nebula is the working ComfyUI PWA on Tritium. Its documented JSON API
 * (verified against nebula/server.py, Oct 2026):
 *
 *   GET  /api/workflows        → { workflows: [names], items: [{name,title,short,family,kind,order}], kinds }
 *   GET  /api/workflow/{name}  → { name, params: [...], layers, nodes, family, preset, basic, advanced }
 *   POST /api/run              → { prompt_id, ... } | { deferred: true, message } | { error, detail }
 *   GET  /api/jobs?n=          → { active: [...], recent: [...], busy, waiting, ... }
 *   POST /api/cancel           → { ok, action, id }
 *   GET  /api/gallery?kind=    → { total, items: [{path,kind,mtime,dir,tags,backend}] }
 *   GET  /api/thumb/{path}?s=  → image bytes (thumbnail)
 *   GET  /api/file/{path}      → image bytes (full)
 *
 * Auth: on Scotty's tailnet, `tailscale serve` attaches identity headers —
 * the app sends nothing. Off-tailnet, the user-entered passphrase goes in an
 * `Authorization: Bearer <passphrase>` header (the scheme Nebula's own PWA
 * uses; its server has no ?k= fallback by design). The passphrase is passed
 * in per call — never stored in this module, never logged.
 *
 * The X-Nebula-Agent header is the loopback agent path's gate; the mobile
 * client uses the documented JSON API above and must NOT send it.
 *
 * Polling/abort/timeout discipline mirrors Sol's comfyui.js: every request
 * carries a combined timeout+external AbortSignal, transient poll failures
 * keep waiting until the cap, and errors are typed NebulaApiError codes.
 */

export const DEFAULT_TIMEOUT_MS = 30000;
export const POLL_INTERVAL_MS = 2500;
export const JOB_TIMEOUT_MS = 600000; // 10 min cap per watched job

export type NebulaErrorCode =
  | 'config'
  | 'network'
  | 'timeout'
  | 'aborted'
  | 'http'
  | 'auth'
  | 'invalid-json'
  | 'rejected';

export class NebulaApiError extends Error {
  readonly code: NebulaErrorCode;
  readonly status: number | null;

  constructor(code: NebulaErrorCode, message: string, options: { status?: number | null } = {}) {
    super(message);
    this.name = 'NebulaApiError';
    this.code = code;
    this.status = options.status ?? null;
  }
}

export function normalizeBaseUrl(raw: unknown): string {
  return String(raw ?? '').trim().replace(/\/+$/, '');
}

function requireBase(baseUrl: unknown): string {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) throw new NebulaApiError('config', 'Nebula base URL is empty — configure it in Connection settings.');
  return base;
}

/** Authorization header for the off-tailnet passphrase. Empty when unset (tailnet does auth). */
function authHeaders(passphrase?: string | null): Record<string, string> {
  const p = String(passphrase ?? '').trim();
  return p ? { Authorization: 'Bearer ' + p } : {};
}

function combinedSignal(timeoutMs: number, external: AbortSignal | null) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(external?.reason);
  if (external) {
    if (external.aborted) controller.abort(external.reason);
    else external.addEventListener('abort', onAbort, { once: true });
  }
  const timer =
    timeoutMs > 0
      ? setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeoutMs)
      : null;
  return {
    signal: controller.signal,
    cleanup() {
      if (timer) clearTimeout(timer);
      if (external) external.removeEventListener('abort', onAbort);
    },
  };
}

function toRequestError(error: unknown, baseUrl: string): NebulaApiError {
  if (error instanceof NebulaApiError) return error;
  const name = (error as { name?: unknown } | null)?.name;
  const message = String((error as { message?: unknown } | null)?.message ?? '');
  if (name === 'TimeoutError' || /timed out/i.test(message)) {
    return new NebulaApiError('timeout', 'The request timed out.');
  }
  if (name === 'AbortError') {
    return new NebulaApiError('aborted', 'The request was stopped.');
  }
  return new NebulaApiError(
    'network',
    'Could not reach Nebula at ' + baseUrl + '. Check the base URL and that the service is up.',
  );
}

async function toHttpError(response: Response, baseUrl: string): Promise<NebulaApiError> {
  let detail = '';
  try {
    const body = await response.clone().json();
    detail = String((body && (body.error || body.message || body.detail)) ?? '');
  } catch {
    detail = '';
  }
  if (response.status === 401 || response.status === 403) {
    return new NebulaApiError(
      'auth',
      'Nebula refused the credentials (HTTP ' + response.status + '). ' +
        (detail ? detail + ' — ' : '') +
        'If you are off the tailnet, check the Nebula passphrase in Connection settings.',
      { status: response.status },
    );
  }
  // A 4xx with an {error} body is Nebula *refusing* the request (unknown
  // workflow, rejected graph, bad cancel) — a caller-actionable refusal,
  // not a transport failure.
  if (
    response.status >= 400 &&
    response.status < 500 &&
    detail
  ) {
    return new NebulaApiError('rejected', 'Nebula refused the request: ' + detail, {
      status: response.status,
    });
  }
  return new NebulaApiError(
    'http',
    'Nebula returned HTTP ' + response.status + (detail ? ': ' + detail : '.') +
      ' (' + baseUrl + ')',
    { status: response.status },
  );
}

interface RequestOptions {
  baseUrl: unknown;
  passphrase?: string | null;
  signal?: AbortSignal | null;
  timeoutMs?: number;
}

async function getJson(path: string, opts: RequestOptions): Promise<unknown> {
  const base = requireBase(opts.baseUrl);
  const combined = combinedSignal(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, opts.signal ?? null);
  try {
    let response: Response;
    try {
      response = await fetch(base + path, {
        headers: authHeaders(opts.passphrase),
        cache: 'no-store',
        signal: combined.signal,
      });
    } catch (error) {
      throw toRequestError(error, base);
    }
    if (!response.ok) throw await toHttpError(response, base);
    try {
      return await response.json();
    } catch {
      throw new NebulaApiError('invalid-json', 'Nebula returned an unreadable response.');
    }
  } finally {
    combined.cleanup();
  }
}

async function postJson(path: string, body: unknown, opts: RequestOptions): Promise<unknown> {
  const base = requireBase(opts.baseUrl);
  const combined = combinedSignal(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, opts.signal ?? null);
  try {
    let response: Response;
    try {
      response = await fetch(base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(opts.passphrase) },
        body: JSON.stringify(body),
        signal: combined.signal,
      });
    } catch (error) {
      throw toRequestError(error, base);
    }
    if (!response.ok) throw await toHttpError(response, base);
    try {
      return await response.json();
    } catch {
      throw new NebulaApiError('invalid-json', 'Nebula returned an unreadable response.');
    }
  } finally {
    combined.cleanup();
  }
}

// ---------------------------------------------------------------- types

export interface WorkflowSummary {
  name: string;
  title: string;
  short: string;
  family: string;
  kind: string;
  order: number;
}

export type ParamKind = 'choice' | 'bool' | 'int' | 'float' | 'text' | 'image' | 'unsupported';

export interface WorkflowParam {
  node: string;
  key: string;
  kind: ParamKind;
  value: unknown;
  label: string;
  min: number | null;
  max: number | null;
  step: number | null;
  choices: string[] | null;
  unavailable: string[];
  note: string;
  level: 'basic' | 'advanced' | 'hidden';
}

export interface WorkflowDetail {
  name: string;
  family: string;
  params: WorkflowParam[];
  basic: number;
  advanced: number;
}

export interface JobOverride {
  node: string;
  key: string;
  value: unknown;
}

export interface RunResponse {
  /** ComfyUI prompt id — null when the server deferred the run to its own queue. */
  promptId: string | null;
  deferred: boolean;
  message: string;
  backend: string;
}

export interface JobProgress {
  value: number;
  max: number;
  node?: string;
  phase?: string;
}

export type JobState = string; // "running" | "pending" | "waiting" | "success" | "done" | "cancelled" | "error" | ...

export interface NebulaJob {
  id: string;
  state: JobState;
  workflow: string;
  title: string;
  user: string;
  backend: string;
  device: string;
  queuedAt: number | null;
  progress: JobProgress | null;
  outputs: string[];
}

export interface JobsResponse {
  active: NebulaJob[];
  recent: NebulaJob[];
  busy: boolean;
  waiting: number;
}

export interface GalleryItem {
  path: string;
  kind: string;
  mtime: number;
  dir: string;
  tags: string[];
  backend: string | null;
}

export interface GalleryResponse {
  total: number;
  items: GalleryItem[];
}

// ---------------------------------------------------------------- parsing

const KNOWN_PARAM_KINDS: ParamKind[] = ['choice', 'bool', 'int', 'float', 'text', 'image'];

function asString(v: unknown): string {
  return v == null ? '' : String(v);
}

function asNumberOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseParam(raw: unknown): WorkflowParam | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (p.node == null || p.key == null) return null;
  const rawKind = asString(p.kind);
  const kind: ParamKind = (KNOWN_PARAM_KINDS as string[]).includes(rawKind) ? (rawKind as ParamKind) : 'unsupported';
  const level = p.level === 'advanced' ? 'advanced' : p.level === 'hidden' ? 'hidden' : 'basic';
  const choices = Array.isArray(p.choices) ? p.choices.map(String) : null;
  return {
    node: String(p.node),
    key: String(p.key),
    kind,
    value: p.value,
    label: asString(p.label) || String(p.key).replace(/_/g, ' '),
    min: asNumberOrNull(p.min),
    max: asNumberOrNull(p.max),
    step: asNumberOrNull(p.step),
    choices,
    unavailable: Array.isArray(p.unavailable) ? p.unavailable.map(String) : [],
    note: asString(p.note),
    level,
  };
}

function parseJob(raw: unknown): NebulaJob | null {
  if (!raw || typeof raw !== 'object') return null;
  const j = raw as Record<string, unknown>;
  if (j.id == null) return null;
  const prog = (j.progress as Record<string, unknown> | null) ?? null;
  return {
    id: String(j.id),
    state: asString(j.state) || 'unknown',
    workflow: asString(j.workflow),
    title: asString(j.title),
    user: asString(j.user),
    backend: asString(j.backend),
    device: asString(j.device),
    queuedAt: asNumberOrNull(j.queued_at),
    progress:
      prog && asNumberOrNull(prog.max) != null && (prog.max as number) > 0
        ? {
            value: asNumberOrNull(prog.value) ?? 0,
            max: Number(prog.max),
            node: prog.node != null ? String(prog.node) : undefined,
            phase: prog.phase != null ? String(prog.phase) : undefined,
          }
        : null,
    outputs: Array.isArray(j.outputs) ? j.outputs.map(String) : [],
  };
}

// ---------------------------------------------------------------- calls

export async function listWorkflows(opts: RequestOptions): Promise<WorkflowSummary[]> {
  const body = (await getJson('/api/workflows', opts)) as Record<string, unknown>;
  const items = Array.isArray(body?.items) ? body.items : [];
  const names = Array.isArray(body?.workflows) ? body.workflows.map(String) : [];
  const out: WorkflowSummary[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const w = raw as Record<string, unknown>;
    const name = asString(w.name);
    if (!name) continue;
    out.push({
      name,
      title: asString(w.title) || name,
      short: asString(w.short) || asString(w.title) || name,
      family: asString(w.family),
      kind: asString(w.kind) || 'Other',
      order: asNumberOrNull(w.order) ?? 9,
    });
  }
  if (out.length === 0) {
    // Older shape: plain name list only. The server's current shape always
    // carries `items`; this fallback keeps the client honest against a
    // response it does not fully understand instead of showing an empty list.
    for (const name of names) {
      const title = name.replace(/\.json$/, '');
      out.push({ name, title, short: title, family: '', kind: 'Other', order: 9 });
    }
  }
  return out;
}

export async function getWorkflow(name: string, opts: RequestOptions): Promise<WorkflowDetail> {
  const body = (await getJson('/api/workflow/' + encodeURIComponent(name), opts)) as Record<string, unknown>;
  const params = (Array.isArray(body?.params) ? body.params : []).map(parseParam).filter((p) => p !== null);
  return {
    name: asString(body?.name) || name,
    family: asString(body?.family),
    params,
    basic: asNumberOrNull(body?.basic) ?? params.filter((p) => p.level === 'basic').length,
    advanced: asNumberOrNull(body?.advanced) ?? params.filter((p) => p.level === 'advanced').length,
  };
}

export interface RunOptions extends RequestOptions {
  workflow: string;
  overrides?: JobOverride[];
  backend?: string;
  randomizeSeed?: boolean;
}

/**
 * Queue a workflow run. Returns a promptId for polling, or a deferred
 * response when the backend is busy (the server will submit it itself).
 * Throws NebulaApiError("rejected") when the server refuses the run
 * (unknown workflow, graph rejected by ComfyUI).
 */
export async function runWorkflow(opts: RunOptions): Promise<RunResponse> {
  if (!asString(opts.workflow)) throw new NebulaApiError('config', 'No workflow selected.');
  const body = (await postJson(
    '/api/run',
    {
      workflow: opts.workflow,
      backend: opts.backend ?? 'nvidia',
      overrides: opts.overrides ?? [],
      randomize_seed: opts.randomizeSeed ?? true,
    },
    opts,
  )) as Record<string, unknown>;
  if (body && typeof body.error === 'string' && body.error) {
    throw new NebulaApiError('rejected', 'Nebula refused the run: ' + body.error +
      (body.detail ? ' — ' + String(body.detail) : ''));
  }
  if (body && body.deferred) {
    return {
      promptId: null,
      deferred: true,
      message: asString(body.message) || 'The backend is busy — the run is queued and will start automatically.',
      backend: asString(body.backend) || asString(opts.backend) || 'nvidia',
    };
  }
  const promptId = body && body.prompt_id != null ? String(body.prompt_id) : '';
  if (!promptId) {
    throw new NebulaApiError('invalid-json', 'Nebula queued the run but returned no prompt id.');
  }
  return {
    promptId,
    deferred: false,
    message: '',
    backend: asString(body.backend) || asString(opts.backend) || 'nvidia',
  };
}

export async function getJobs(n: number, opts: RequestOptions): Promise<JobsResponse> {
  const body = (await getJson('/api/jobs?n=' + Math.max(1, Math.min(200, Math.floor(n) || 20)), opts)) as Record<string, unknown>;
  const active = (Array.isArray(body?.active) ? body.active : []).map(parseJob).filter((j) => j !== null);
  const recent = (Array.isArray(body?.recent) ? body.recent : []).map(parseJob).filter((j) => j !== null);
  return {
    active,
    recent,
    busy: body?.busy === true,
    waiting: asNumberOrNull(body?.waiting) ?? 0,
  };
}

export async function cancelJob(id: string, opts: RequestOptions & { backend?: string }): Promise<{ ok: boolean; action: string }> {
  if (!asString(id)) throw new NebulaApiError('config', 'Job id is missing.');
  const body = (await postJson('/api/cancel', { id, backend: opts.backend ?? 'nvidia' }, opts)) as Record<string, unknown>;
  if (body && typeof body.error === 'string' && body.error) {
    throw new NebulaApiError('rejected', 'Nebula could not cancel the job: ' + body.error);
  }
  return { ok: body?.ok === true, action: asString(body?.action) };
}

export type JobWatchState = 'queued' | 'running' | 'done' | 'failed';

const TERMINAL_FAILED = new Set(['cancelled', 'error', 'failed', 'interrupted']);

export interface PollJobOptions extends RequestOptions {
  promptId: string;
  onProgress?: ((state: JobWatchState, job: NebulaJob | null) => void) | null;
  timeoutMs?: number;
  intervalMs?: number;
}

/**
 * Watch one job until it lands in the server's recent list. Mirrors
 * Sol's pollHistory discipline: transient fetch failures keep waiting
 * until the timeout cap; the cap and abort are honored exactly.
 *
 * Resolves with the terminal job record (state kept as the server
 * reported it — "cancelled" and "error" included). onProgress is called
 * with "queued" | "running" | "done" | "failed" on transitions.
 */
export async function pollJob(opts: PollJobOptions): Promise<NebulaJob> {
  requireBase(opts.baseUrl);
  if (!asString(opts.promptId)) throw new NebulaApiError('config', 'Prompt id is missing.');
  const timeoutMs = opts.timeoutMs ?? JOB_TIMEOUT_MS;
  const intervalMs = Math.max(50, opts.intervalMs ?? POLL_INTERVAL_MS);
  const combined = combinedSignal(timeoutMs, opts.signal ?? null);
  const report = opts.onProgress ?? null;
  let lastState: JobWatchState | null = null;
  const capHit = () =>
    combined.signal.aborted &&
    combined.signal.reason instanceof DOMException &&
    combined.signal.reason.name === 'TimeoutError';
  try {
    for (;;) {
      let jobs: JobsResponse | null = null;
      try {
        jobs = await getJobs(20, { ...opts, timeoutMs: DEFAULT_TIMEOUT_MS, signal: combined.signal });
      } catch (error) {
        // The overall cap fired: say "timeout", not "aborted".
        if (capHit()) throw new NebulaApiError('timeout', 'The job did not finish in time.');
        if (error instanceof NebulaApiError && (error.code === 'aborted' || error.code === 'timeout' || error.code === 'auth')) {
          throw error;
        }
        // Transient failure while polling: keep waiting until the cap.
        await sleepOrThrow(intervalMs, combined.signal);
        continue;
      }
      const active = jobs.active.find((j) => j.id === opts.promptId) ?? null;
      const finished = jobs.recent.find((j) => j.id === opts.promptId) ?? null;
      if (finished) {
        // The server distinguishes cancelled vs errored in `state` ("error"
        // only when it really was an error); anything not in TERMINAL_FAILED
        // — "success", "done" and friends — counts as done.
        const terminal: JobWatchState = TERMINAL_FAILED.has(finished.state) ? 'failed' : 'done';
        if ((lastState as JobWatchState | null) !== terminal && report) {
          lastState = terminal;
          report(terminal, finished);
        }
        return finished;
      }
      if (active) {
        const state: JobWatchState = active.state === 'running' || active.progress ? 'running' : 'queued';
        if (state !== lastState && report) {
          lastState = state;
          report(state, active);
        }
      } else if (lastState !== 'queued' && report) {
        // Not visible yet (server still recording it) — same posture as
        // Sol's "queued" state before the history entry appears.
        lastState = 'queued';
        report('queued', null);
      }
      await sleepOrThrow(intervalMs, combined.signal);
    }
  } finally {
    combined.cleanup();
  }
}

function sleepOrThrow(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      const reason = signal.reason;
      if (reason instanceof NebulaApiError) reject(reason);
      else if (reason instanceof DOMException && reason.name === 'TimeoutError') {
        reject(new NebulaApiError('timeout', 'The job did not finish in time.'));
      } else {
        reject(new NebulaApiError('aborted', 'The request was stopped.'));
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function listGallery(
  limit: number,
  offset: number,
  opts: RequestOptions,
): Promise<GalleryResponse> {
  const lim = Math.max(1, Math.min(200, Math.floor(limit) || 60));
  const off = Math.max(0, Math.floor(offset) || 0);
  const body = (await getJson('/api/gallery?kind=image&limit=' + lim + '&offset=' + off, opts)) as Record<string, unknown>;
  const items: GalleryItem[] = [];
  for (const raw of Array.isArray(body?.items) ? body.items : []) {
    if (!raw || typeof raw !== 'object') continue;
    const it = raw as Record<string, unknown>;
    const path = asString(it.path);
    if (!path) continue;
    items.push({
      path,
      kind: asString(it.kind) || 'image',
      mtime: asNumberOrNull(it.mtime) ?? 0,
      dir: asString(it.dir),
      tags: Array.isArray(it.tags) ? it.tags.map(String) : [],
      backend: it.backend != null ? String(it.backend) : null,
    });
  }
  return { total: asNumberOrNull(body?.total) ?? items.length, items };
}

/** URL for a server-rendered thumbnail. Usable in <img> directly on the tailnet (no auth needed). */
export function thumbUrl(baseUrl: unknown, path: string, size = 320): string {
  const base = requireBase(baseUrl);
  return base + '/api/thumb/' + encodePathSegments(path) + '?s=' + Math.max(64, Math.min(768, size));
}

/** URL for the full file. Usable in <img> directly on the tailnet (no auth needed). */
export function fileUrl(baseUrl: unknown, path: string): string {
  const base = requireBase(baseUrl);
  return base + '/api/file/' + encodePathSegments(path);
}

function encodePathSegments(path: string): string {
  return String(path)
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

/**
 * Fetch a thumbnail or full image as a Blob with auth headers applied.
 * Needed off-tailnet when a passphrase is configured: <img> cannot send
 * the Authorization header, so the app fetches the bytes itself and
 * hands the caller an object URL.
 */
export async function fetchMediaBlob(
  baseUrl: unknown,
  path: string,
  kind: 'thumb' | 'file',
  opts: { passphrase?: string | null; signal?: AbortSignal | null; timeoutMs?: number; size?: number } = {},
): Promise<Blob> {
  const base = requireBase(baseUrl);
  if (!asString(path)) throw new NebulaApiError('config', 'Image path is missing.');
  const url = kind === 'thumb' ? thumbUrl(base, path, opts.size ?? 320) : fileUrl(base, path);
  const combined = combinedSignal(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, opts.signal ?? null);
  try {
    let response: Response;
    try {
      response = await fetch(url, { headers: authHeaders(opts.passphrase), signal: combined.signal });
    } catch (error) {
      throw toRequestError(error, base);
    }
    if (!response.ok) throw await toHttpError(response, base);
    return await response.blob();
  } finally {
    combined.cleanup();
  }
}
