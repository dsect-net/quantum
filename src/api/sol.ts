/**
 * Sol gateway client — Quantum's conversational AI + fleet surface.
 *
 * Port of the reference patterns in sol-app (`src/api/chat.js`,
 * `src/fleet.js`), adapted to TypeScript and to Quantum's always-gateway
 * posture:
 *
 *  - Chat: OpenAI-compatible `POST {base}/api/sol/v1/chat/completions`
 *    (SSE streaming supported), `GET {base}/api/sol/v1/models`.
 *  - Fleet: `GET {base}/api/sol/agents`, `/me`, `/desk`, `POST
 *    /desk/{takeover,handback,dismiss}`, `GET/POST /dm/{agentId}`.
 *
 * Auth is tailnet identity — there is deliberately NO apiKey parameter.
 * Every state-changing request carries the `X-Sol-Request: 1` CSRF header
 * (a cross-site page can only set it after a CORS preflight, which only
 * the app's own origins pass), exactly as the Sol gateway requires.
 *
 * No URLs, keys, or model names are hardcoded here; everything comes from
 * the user's configured Sol gateway base URL in Connection settings.
 */

export const DEFAULT_TIMEOUT_MS = 120_000;
export const STREAM_IDLE_TIMEOUT_MS = 60_000;

export type SolErrorCode =
  | 'config'
  | 'network'
  | 'timeout'
  | 'aborted'
  | 'http'
  | 'invalid-json'
  | 'stream'
  | 'not_gateway';

export class SolApiError extends Error {
  readonly code: SolErrorCode;
  /** HTTP status, when the error came from an HTTP response. */
  readonly status: number | null;
  /** The server's own error.code, e.g. unknown_model. */
  readonly apiCode: string | null;

  constructor(
    code: SolErrorCode,
    message: string,
    options: { status?: number | null; apiCode?: string | null } = {},
  ) {
    super(message);
    this.name = 'SolApiError';
    this.code = code;
    this.status = options.status ?? null;
    this.apiCode = options.apiCode ?? null;
  }
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface SolModel {
  id: string;
}

/** One fleet agent, as reported by GET /api/sol/agents. */
export interface FleetAgent {
  id: string;
  name: string;
  workspace?: string;
  state?: string; // working | blocked | idle (gateway vocabulary)
  status?: { text?: string };
  handoff?: { reason?: string; status?: string; bot?: string };
  last_action?: { action?: string };
  last_action_age_s?: number | null;
  relay_seen_age_s?: number | null;
}

/** The shared desk, as reported inside /api/sol/agents. */
export interface DeskInfo {
  holder_kind?: string; // 'human' when Scotty has it
  holder?: string | null;
  handoff?: { reason?: string; status?: string; bot?: string } | null;
}

export interface FleetSnapshot {
  agents: FleetAgent[];
  desk: DeskInfo | null;
}

export interface DmMessage {
  id?: string | number;
  author?: string;
  text?: string;
  ts?: number;
  [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/* URL helpers                                                        */
/* ------------------------------------------------------------------ */

function normalizeBaseUrl(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .replace(/\/+$/, '');
}

/**
 * Chat root for a configured base URL. Accepts the bare host
 * (https://team.dsect.net), a path-prefixed gateway (…/api/sol), or a
 * fully-qualified v1 root (…/api/sol/v1) without doubling segments.
 */
export function solChatRoot(rawBaseUrl: unknown): string {
  let base = normalizeBaseUrl(rawBaseUrl);
  if (base.toLowerCase().endsWith('/api/sol/v1')) return base;
  if (base.toLowerCase().endsWith('/api/sol')) return base + '/v1';
  return base + '/api/sol/v1';
}

/** Fleet root mirrors the chat root one segment up (/api/sol). */
export function solFleetRoot(rawBaseUrl: unknown): string {
  const chat = solChatRoot(rawBaseUrl);
  return chat.replace(/\/v1$/, '');
}

/* ------------------------------------------------------------------ */
/* Request plumbing                                                   */
/* ------------------------------------------------------------------ */

// Combine an external AbortSignal with a timeout into one signal.
function combinedSignal(timeoutMs: number, external: AbortSignal | null) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(external?.reason);
  if (external) {
    if (external.aborted) {
      controller.abort(external.reason);
    } else {
      external.addEventListener('abort', onAbort, { once: true });
    }
  }
  const timer =
    timeoutMs > 0
      ? setTimeout(
          () => controller.abort(new DOMException('Request timed out', 'TimeoutError')),
          timeoutMs,
        )
      : null;
  return {
    signal: controller.signal,
    cleanup() {
      if (timer) clearTimeout(timer);
      if (external) external.removeEventListener('abort', onAbort);
    },
  };
}

function toRequestError(error: unknown): SolApiError {
  if (error instanceof SolApiError) return error;
  const name = (error as { name?: unknown })?.name;
  const message = String((error as { message?: unknown })?.message ?? '');
  if (name === 'TimeoutError' || /timed out/i.test(message)) {
    return new SolApiError('timeout', 'The request timed out.');
  }
  if (name === 'AbortError') {
    return new SolApiError('aborted', 'The request was stopped.');
  }
  return new SolApiError(
    'network',
    'Could not reach the Sol gateway. Check the base URL and the network connection.',
  );
}

async function toHttpError(response: Response): Promise<SolApiError> {
  let detail = '';
  let apiCode: string | null = null;
  try {
    const body = JSON.parse(await response.text());
    detail = (body && body.error && body.error.message) || '';
    apiCode = (body && body.error && body.error.code) || null;
  } catch {
    detail = '';
  }
  return new SolApiError(
    'http',
    'The Sol gateway returned HTTP ' + response.status + (detail ? ': ' + detail : '.'),
    { status: response.status, apiCode },
  );
}

async function requireJson(response: Response): Promise<unknown> {
  let data: unknown = {};
  let parsed = false;
  try {
    data = await response.json();
    parsed = data !== null && typeof data === 'object';
  } catch {
    /* screenshot, HTML page, or empty body */
  }
  // A 200 that isn't JSON is not the gateway: a dev server or a misrouted
  // proxy answering with an HTML page. Sol learned this the hard way — the
  // fleet view crashed reading `agents` off undefined, so we fail loudly.
  if (response.ok && !parsed) {
    throw new SolApiError(
      'not_gateway',
      "Something answered at the fleet address, but it isn't the Sol gateway.",
      { status: response.status },
    );
  }
  if (!parsed) data = {};
  if (!response.ok) throw await toHttpError(response);
  return data;
}

async function fleetCall(
  baseUrl: string,
  path: string,
  { method = 'GET', body }: { method?: string; body?: unknown } = {},
): Promise<Record<string, unknown>> {
  const root = normalizeBaseUrl(baseUrl);
  if (!root) throw new SolApiError('config', 'Sol gateway base URL is empty.');
  const combined = combinedSignal(DEFAULT_TIMEOUT_MS, null);
  try {
    let response: Response;
    try {
      response = await fetch(root + path, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          // Every state change carries this; a page on another site can only
          // send it after a CORS preflight, which only the app's own origins
          // pass. Reads (GET) are safe without it.
          ...(method !== 'GET' ? { 'X-Sol-Request': '1' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: 'no-store',
        signal: combined.signal,
      });
    } catch (error) {
      throw toRequestError(error);
    }
    return (await requireJson(response)) as Record<string, unknown>;
  } finally {
    combined.cleanup();
  }
}

/* ------------------------------------------------------------------ */
/* Chat                                                               */
/* ------------------------------------------------------------------ */

export interface FetchModelsOptions {
  baseUrl: string;
  signal?: AbortSignal | null;
  timeoutMs?: number;
}

/** GET {baseUrl}/api/sol/v1/models -> [{ id }]. */
export async function fetchModels({
  baseUrl,
  signal = null,
  timeoutMs = 30_000,
}: FetchModelsOptions): Promise<SolModel[]> {
  const root = normalizeBaseUrl(baseUrl);
  if (!root) throw new SolApiError('config', 'Sol gateway base URL is empty.');
  const combined = combinedSignal(timeoutMs, signal);
  try {
    let response: Response;
    try {
      response = await fetch(solChatRoot(root) + '/models', {
        headers: {},
        signal: combined.signal,
      });
    } catch (error) {
      throw toRequestError(error);
    }
    if (!response.ok) throw await toHttpError(response);
    let body: { data?: unknown };
    try {
      body = await response.json();
    } catch {
      throw new SolApiError('invalid-json', 'The gateway returned an unreadable model list.');
    }
    const list = body && Array.isArray(body.data) ? body.data : [];
    return list
      .map((item) => ({
        id: String((item as { id?: unknown } | null)?.id ?? ''),
      }))
      .filter((item) => item.id);
  } finally {
    combined.cleanup();
  }
}

export interface TestConnectionResult {
  ok: true;
  models: SolModel[];
  modelFound: boolean;
  latencyMs: number;
}

/**
 * Lightweight reachability check. Succeeds when the gateway answers;
 * reports whether the configured model appears in the list.
 */
export async function testSolConnection({
  baseUrl,
  model = '',
  signal = null,
  timeoutMs = 30_000,
}: FetchModelsOptions & { model?: string }): Promise<TestConnectionResult> {
  const started = Date.now();
  const models = await fetchModels({ baseUrl, signal, timeoutMs });
  const wanted = String(model || '').trim();
  return {
    ok: true,
    models,
    modelFound: !wanted || models.some((item) => item.id === wanted),
    latencyMs: Date.now() - started,
  };
}

// Read an SSE stream from a chat completions response, calling onToken for
// each content delta and resolving with the full text.
async function readSse(response: Response, onToken: ((delta: string) => void) | null): Promise<string> {
  const body = response.body;
  if (!body || typeof (body as ReadableStream).getReader !== 'function') {
    throw new SolApiError('stream', 'Streaming is not supported by this environment.');
  }
  const reader = (body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let idleTimedOut = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimedOut = true;
      try {
        reader.cancel();
      } catch {
        /* already closed */
      }
    }, STREAM_IDLE_TIMEOUT_MS);
  };
  try {
    armIdle();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (idleTimedOut) break;
      armIdle();
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let data: unknown;
        try {
          data = JSON.parse(payload);
        } catch {
          continue; // skip malformed chunk, keep the stream alive
        }
        const delta = (data as { choices?: { delta?: { content?: unknown } }[] } | null)?.choices?.[0]
          ?.delta?.content;
        if (typeof delta === 'string' && delta) {
          full += delta;
          if (onToken) onToken(delta);
        }
      }
    }
  } catch (error) {
    if (idleTimedOut) {
      throw new SolApiError('timeout', 'The stream stalled for too long and was stopped.');
    }
    throw toRequestError(error);
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    try {
      reader.releaseLock();
    } catch {
      /* already closed */
    }
  }
  if (idleTimedOut && !full) {
    throw new SolApiError('timeout', 'The stream stalled for too long and was stopped.');
  }
  return full;
}

export interface SendChatOptions {
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  onToken?: ((delta: string) => void) | null;
  signal?: AbortSignal | null;
  /** true (default) = SSE streaming with live token callbacks. */
  stream?: boolean;
  timeoutMs?: number;
}

/**
 * POST {baseUrl}/api/sol/v1/chat/completions.
 * stream: false -> resolves with the full reply text.
 * stream: true  -> calls onToken(delta) per SSE chunk, resolves with full text.
 *
 * Never invents a reply: every failure surfaces as a SolApiError with a
 * user-readable message and a machine-readable `code`.
 */
export async function sendChatCompletion({
  baseUrl,
  model,
  messages,
  onToken = null,
  signal = null,
  stream = true,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: SendChatOptions): Promise<string> {
  const root = normalizeBaseUrl(baseUrl);
  const name = String(model || '').trim();
  if (!root) throw new SolApiError('config', 'Sol gateway base URL is empty.');
  if (!name) throw new SolApiError('config', 'No model selected.');
  if (!Array.isArray(messages) || !messages.length) {
    throw new SolApiError('config', 'No messages to send.');
  }
  const combined = combinedSignal(timeoutMs, signal);
  let response: Response;
  try {
    try {
      response = await fetch(solChatRoot(root) + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // The Sol gateway refuses state changes without X-Sol-Request
          // (CSRF: a page on another site can only send a custom header
          // after a CORS preflight, which only the app's own origins pass),
          // and it takes no key — identity is the tailnet.
          'X-Sol-Request': '1',
        },
        body: JSON.stringify({
          model: name,
          messages: messages.map((item) => ({ role: item.role, content: item.content })),
          stream: !!stream,
        }),
        signal: combined.signal,
      });
    } catch (error) {
      throw toRequestError(error);
    }
    if (!response.ok) throw await toHttpError(response);
    if (!stream) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new SolApiError('invalid-json', 'The gateway returned an unreadable reply.');
      }
      const text = (body as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]
        ?.message?.content;
      return typeof text === 'string' ? text : '';
    }
    return await readSse(response, onToken);
  } finally {
    combined.cleanup();
  }
}

/* ------------------------------------------------------------------ */
/* Fleet (Agents tab)                                                 */
/* ------------------------------------------------------------------ */

export function fleetEnabled(baseUrl: string): boolean {
  return Boolean(normalizeBaseUrl(baseUrl));
}

/** GET {base}/api/sol/agents -> { agents, desk }. */
export async function fetchFleetSnapshot(baseUrl: string): Promise<FleetSnapshot> {
  const root = solFleetRoot(baseUrl);
  if (!normalizeBaseUrl(baseUrl)) throw new SolApiError('config', 'Sol gateway base URL is empty.');
  const data = await fleetCall(root, '/agents');
  const agents = Array.isArray(data.agents) ? (data.agents as FleetAgent[]) : [];
  const desk = (data.desk as DeskInfo | null | undefined) ?? null;
  return { agents, desk };
}

/** GET {base}/api/sol/me — who the tailnet says this device is. */
export async function fetchFleetMe(baseUrl: string): Promise<Record<string, unknown>> {
  return fleetCall(solFleetRoot(baseUrl), '/me');
}

/** POST {base}/api/sol/desk/dismiss — clear a stale handoff banner. */
export async function dismissDeskHandoff(baseUrl: string): Promise<Record<string, unknown>> {
  return fleetCall(solFleetRoot(baseUrl), '/desk/dismiss', { method: 'POST', body: {} });
}

/** GET {base}/api/sol/dm/{agentId}?since= — DM history with one agent. */
export async function fetchDm(baseUrl: string, agentId: string, since = 0): Promise<DmMessage[]> {
  const data = await fleetCall(
    solFleetRoot(baseUrl),
    `/dm/${encodeURIComponent(agentId)}?since=${since}`,
  );
  return Array.isArray(data.messages) ? (data.messages as DmMessage[]) : [];
}

/** POST {base}/api/sol/dm/{agentId} — send a DM to one agent. */
export async function sendDm(
  baseUrl: string,
  agentId: string,
  text: string,
): Promise<Record<string, unknown>> {
  return fleetCall(solFleetRoot(baseUrl), `/dm/${encodeURIComponent(agentId)}`, {
    method: 'POST',
    body: { text },
  });
}

/** "4m ago" for relative times; the relay and the workstation both report seconds. */
export function ago(seconds: number | null | undefined): string {
  if (seconds == null) return '';
  if (seconds < 45) return 'just now';
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** One-line activity summary for an agent card. */
export function agentActivityLine(a: FleetAgent): string {
  if (a.handoff?.reason) return a.handoff.reason;
  if (a.status?.text) return a.status.text;
  if (a.last_action?.action) {
    const what = a.last_action.action;
    return a.last_action_age_s != null ? `${what} · ${ago(a.last_action_age_s)}` : what;
  }
  if (a.relay_seen_age_s != null) return `On the relay ${ago(a.relay_seen_age_s)}`;
  return 'No activity on the desk yet';
}

/** Who has the shared desk right now, in a sentence. */
export function deskLine(desk: DeskInfo | null, agents: FleetAgent[]): string {
  if (!desk) return "The desk isn't answering. Retrying.";
  const name = (id: string) => agents.find((a) => a.workspace === id)?.name || id;
  if (desk.holder_kind === 'human') return 'You have the desk.';
  if (desk.holder) return `${name(desk.holder)} is using the desk.`;
  return 'The desk is free. Agents work headless until they need it.';
}
