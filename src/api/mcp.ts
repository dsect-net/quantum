/**
 * hub-api MCP gateway client — Quantum's Swiss-army knife surface.
 *
 * The hub exposes `POST {base}/mcp` (streamable-HTTP JSON-RPC) with ~30
 * `dsect_*` tools (mail, calendar, drive, codex, github, docket, home
 * assistant, service logs/status/restart). On the tailnet the dashboard
 * endpoints are identity-authenticated; the MCP gateway is Bearer-gated
 * (worker keys), so the key comes from the user's Connection settings and
 * is never hardcoded here — it is passed per-call and never logged.
 *
 * Protocol (verified against hub-api lib/mcp-gateway-http.js, 2026-10-02):
 *  - POST {base}/mcp, JSON-RPC 2.0, header `Authorization: Bearer <key>`
 *  - `initialize` → response carries the `mcp-session-id` response header;
 *    send `notifications/initialized` (no id), then `tools/list` /
 *    `tools/call` with the session header attached.
 *  - Responses are plain JSON (the server `sendJson`s them).
 */
export const MCP_TIMEOUT_MS = 20_000;

export type McpErrorCode =
  | 'config'
  | 'network'
  | 'timeout'
  | 'auth'
  | 'http'
  | 'rpc'
  | 'not_connected';

export class McpApiError extends Error {
  readonly code: McpErrorCode;
  /** HTTP status, when the error came from an HTTP response. */
  readonly status: number | null;
  /** The server's JSON-RPC error code, e.g. -32601. */
  readonly rpcCode: number | null;

  constructor(
    code: McpErrorCode,
    message: string,
    options: { status?: number | null; rpcCode?: number | null } = {},
  ) {
    super(message);
    this.name = 'McpApiError';
    this.code = code;
    this.status = options.status ?? null;
    this.rpcCode = options.rpcCode ?? null;
  }
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/** A single content block from a tools/call result. */
export interface McpContentBlock {
  type?: string;
  text?: string;
  [key: string]: unknown;
}

/**
 * Tool-call classification for the mobile UI. Anything mutating is shown
 * with a "Not run from mobile" badge and NO action button — a destructive
 * action must never be half-wired.
 */
export type ToolKind = 'read' | 'mutating' | 'unknown';

const MUTATING_HINTS = [
  'restart',
  'send',
  'write',
  'add',
  'mark',
  'set_status',
  'setstatus',
  'call_service',
  'propose_change',
  'shell',
  'stop',
  'delete',
  'revoke',
  'mint',
];

/** Conservative classifier: names matching known mutating verbs are mutating. */
export function classifyTool(name: string): ToolKind {
  if (name === 'dsect_whoami') return 'read';
  const lower = name.toLowerCase();
  if (MUTATING_HINTS.some((h) => lower.includes(h))) return 'mutating';
  if (lower.startsWith('dsect_')) return 'unknown';
  return 'unknown';
}

const PROTOCOL_VERSION = '2025-06-18';
const CLIENT_NAME = 'quantum-mobile';
const CLIENT_VERSION = '0.1.0';

function normalizeBaseUrl(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .replace(/\/+$/, '');
}

function headerCaseInsensitive(headers: Headers, name: string): string | null {
  const v = headers.get(name);
  if (v) return v;
  for (const [k, value] of headers.entries()) {
    if (k.toLowerCase() === name.toLowerCase()) return value;
  }
  return null;
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text.trim()) throw new McpApiError('rpc', 'Empty response from MCP gateway');
  // The server sendJson()s responses, but tolerate an SSE envelope in case
  // a transport upgrade ever happens: take the last non-empty data: line.
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed);
  }
  const lines = trimmed.split('\n');
  const dataLines = lines
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim());
  const payload = dataLines.filter((l) => l && l !== '[DONE]').pop();
  if (!payload) throw new McpApiError('rpc', 'Unrecognized response from MCP gateway');
  return JSON.parse(payload);
}

export interface McpClientOptions {
  timeoutMs?: number;
  /** Injected for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Session-scoped MCP client. Construct, `await connect()`, then
 * `listTools()` / `callTool()`. `disconnect()` clears the session.
 */
export class McpClient {
  private readonly baseUrl: string;
  private readonly key: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private sessionId: string | null = null;
  private requestId = 0;

  constructor(baseUrl: string, bearerKey: string, options: McpClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.key = bearerKey;
    this.timeoutMs = options.timeoutMs ?? MCP_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  }

  get connected(): boolean {
    return this.sessionId !== null;
  }

  /** Bearer key is never exposed; the client only reports whether one was given. */
  get hasKey(): boolean {
    return this.key.trim().length > 0;
  }

  private nextId(): number {
    this.requestId += 1;
    return this.requestId;
  }

  private async rpc(method: string, params?: unknown): Promise<unknown> {
    if (!this.baseUrl) throw new McpApiError('config', 'No hub base URL configured.');
    if (!this.hasKey) throw new McpApiError('config', 'No MCP worker key configured.');
    const id = this.nextId();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${this.key}`,
      };
      if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
      const res = await this.fetchImpl(this.baseUrl + '/mcp', {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} }),
        signal: ctrl.signal,
      });
      const sid = headerCaseInsensitive(res.headers, 'mcp-session-id');
      if (sid) this.sessionId = sid;
      if (res.status === 401 || res.status === 403) {
        throw new McpApiError('auth', `MCP auth failed (HTTP ${res.status}). Check the worker key.`, {
          status: res.status,
        });
      }
      if (!res.ok) {
        throw new McpApiError('http', `MCP gateway returned HTTP ${res.status}`, {
          status: res.status,
        });
      }
      const body = (await parseBody(res)) as {
        result?: unknown;
        error?: { code?: number; message?: string };
      };
      if (body && typeof body === 'object' && 'error' in body && body.error) {
        throw new McpApiError(
          'rpc',
          `MCP error ${body.error.code ?? ''}: ${body.error.message ?? 'unknown'}`.trim(),
          { rpcCode: body.error.code ?? null },
        );
      }
      return body?.result;
    } catch (e) {
      if (e instanceof McpApiError) throw e;
      if (e instanceof Error && e.name === 'AbortError') {
        throw new McpApiError('timeout', `MCP request timed out after ${this.timeoutMs} ms`);
      }
      throw new McpApiError('network', e instanceof Error ? e.message : 'Network error');
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Open a session: initialize → notifications/initialized. Resolves with
   * the session id. Throws McpApiError on any failure.
   */
  async connect(): Promise<string> {
    await this.rpc('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
    });
    // Fire-and-forget initialized notification (no id → no response body).
    if (this.sessionId) {
      try {
        await this.rpc('notifications/initialized');
      } catch {
        // Notification failures must not fail the handshake.
      }
    }
    if (!this.sessionId) throw new McpApiError('rpc', 'MCP gateway did not issue a session id');
    return this.sessionId;
  }

  /** List the tools this worker key's role may call. */
  async listTools(): Promise<McpTool[]> {
    if (!this.connected) throw new McpApiError('not_connected', 'Not connected — call connect() first.');
    const result = (await this.rpc('tools/list')) as { tools?: McpTool[] } | undefined;
    return Array.isArray(result?.tools) ? result.tools : [];
  }

  /**
   * Call one tool. Returns the result content blocks. The server returns
   * tool errors inside the result (isError), not as JSON-RPC errors, so
   * callers should check for those themselves.
   */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<McpContentBlock[]> {
    if (!this.connected) throw new McpApiError('not_connected', 'Not connected — call connect() first.');
    const result = (await this.rpc('tools/call', { name, arguments: args })) as
      | { content?: McpContentBlock[]; isError?: boolean }
      | undefined;
    return Array.isArray(result?.content) ? result.content : [];
  }

  disconnect(): void {
    this.sessionId = null;
  }
}

/** MCP is configured only when a hub base URL AND a worker key are present. */
export function mcpConfigured(baseUrl: string, key: string): boolean {
  return normalizeBaseUrl(baseUrl).length > 0 && key.trim().length > 0;
}

/**
 * Render a tools/call result to displayable text lines. Tool results are
 * content blocks; we surface `text` blocks and JSON-stringify anything else.
 */
export function renderToolResult(blocks: McpContentBlock[]): string[] {
  return blocks.map((b) => {
    if (typeof b?.text === 'string') return b.text;
    return JSON.stringify(b, null, 2);
  });
}

/** Group tools by their infix area: dsect_mail_* → "mail". */
export function toolArea(name: string): string {
  const m = /^dsect_([a-z]+)/.exec(name);
  return m ? m[1] : 'other';
}
