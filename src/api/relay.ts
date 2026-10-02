/**
 * Hermes relay HTTP client — the agent-chat team-chat surface.
 *
 * Relay API (behind https://team.dsect.net, proxied as /api/relay):
 *   GET  /recent?limit=            most recent messages, chronological
 *   GET  /messages?since=&limit=    messages newer than `since` (an id — NOT `since_id`)
 *   GET  /search?q=&author=&limit=  server-side search over the whole log
 *   POST /send                     { author, content }
 *   POST /ask                      { author, author_display, content } — synchronous model answer
 *   GET  /api/whoami               tailnet identity (sibling of /api/relay, same host)
 *
 * Auth is Tailscale identity headers — no login UI, no tokens in code.
 * Shapes mirror dsect-net/agent-chat's relay.ts (the web client).
 */

export interface RelayMessage {
  id: number;
  uuid: string;
  author: string;
  author_display: string;
  content: string;
  /** JSON-encoded string on the wire; parsed to string[] here. */
  mentions: string[];
  platform: string;
  /** Epoch seconds. */
  timestamp: number;
  created_at: string;
  intent: string | null;
  routed_to: string[];
  thread_id: number | null;
  conversation_id: number;
}

export interface RelayAskResult {
  question: RelayMessage;
  answer: RelayMessage & { model: string };
}

export interface RelayIdentity {
  handle: string;
  login: string;
  name: string;
}

export interface RelayThread {
  conversationId: number;
  /** Display name: top authors, newest first. */
  name: string;
  lastMessage: RelayMessage;
  messageCount: number;
}

export class RelayError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'RelayError';
    this.status = status;
  }
}

const DEFAULT_TIMEOUT_MS = 10000;

/** The relay stores these as JSON *strings*; parse defensively so one
 *  malformed row never takes down a message list. */
export function parseList(raw: unknown): string[] {
  if (!raw) return [];
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function normalize(raw: Record<string, unknown>): RelayMessage {
  return {
    id: Number(raw.id),
    uuid: String(raw.uuid ?? ''),
    author: String(raw.author ?? ''),
    author_display: String(raw.author_display ?? raw.author ?? ''),
    content: String(raw.content ?? ''),
    mentions: parseList(raw.mentions),
    platform: String(raw.platform ?? ''),
    timestamp: Number(raw.timestamp ?? 0),
    created_at: String(raw.created_at ?? ''),
    intent: raw.intent == null ? null : String(raw.intent),
    routed_to: parseList(raw.routed_to),
    thread_id: raw.thread_id == null ? null : Number(raw.thread_id),
    conversation_id: Number(raw.conversation_id ?? 0),
  };
}

function asMessages(data: unknown): RelayMessage[] {
  const rows = Array.isArray(data)
    ? data
    : (data as { messages?: unknown })?.messages;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => normalize(r as Record<string, unknown>))
    .sort((a, b) => a.id - b.id);
}

async function request(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(baseUrl + path, {
      ...init,
      cache: 'no-store',
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new RelayError(`Relay ${res.status}: ${res.statusText || 'request failed'}`, res.status);
    }
    return res;
  } catch (err) {
    if (err instanceof RelayError) throw err;
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new RelayError('Relay timed out — is the base URL reachable?');
    }
    throw new RelayError(
      `Relay unreachable: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

async function readErrorDetail(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.error === 'string') return body.error;
    if (typeof body?.detail === 'string') return body.detail;
  } catch {
    // not JSON — fall through to the status fallback
  }
  return fallback;
}

/** The most recent `limit` messages, chronological. First-load endpoint —
 *  every poll after it is a `getMessagesSince(lastSeenId)` delta. */
export async function getRecent(baseUrl: string, limit = 200): Promise<RelayMessage[]> {
  const res = await request(baseUrl, `/recent?limit=${limit}`);
  return asMessages(await res.json());
}

/** Messages newer than `since` (a message id).
 *
 * KNOWN TRAP (from agent-chat): the parameter is `since`, NOT `since_id`.
 * FastAPI silently ignores unknown params, so `since_id=` degrades to
 * `since=0` — re-downloading the head of the log on every poll. */
export async function getMessagesSince(
  baseUrl: string,
  since = 0,
  limit = 200,
): Promise<RelayMessage[]> {
  const res = await request(baseUrl, `/messages?since=${since}&limit=${limit}`);
  return asMessages(await res.json());
}

/** Server-side search over the whole log — the client only ever holds a
 *  window of messages, so a client-side filter would quietly search a
 *  fraction of history and report it as if it were all of it. */
export async function searchMessages(
  baseUrl: string,
  q: string,
  author?: string | null,
  limit = 50,
): Promise<RelayMessage[]> {
  const p = new URLSearchParams({ q, limit: String(limit) });
  if (author) p.set('author', author);
  const res = await request(baseUrl, `/search?${p}`);
  return asMessages(await res.json());
}

/** Post a message to the shared log. Authorship is derived server-side from
 *  the tailnet identity; `author` is the display handle. */
export async function sendMessage(
  baseUrl: string,
  author: string,
  content: string,
): Promise<void> {
  await request(baseUrl, '/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ author, content }),
  });
}

/** Synchronous model Q&A. The relay inserts both the question and the
 *  answer into the log itself, so the caller's poll picks both up — this
 *  only needs to report success or failure. */
export async function askRelay(
  baseUrl: string,
  author: string,
  authorDisplay: string,
  content: string,
): Promise<RelayAskResult> {
  let res: Response;
  try {
    res = await fetch(baseUrl + '/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ author, author_display: authorDisplay, content }),
    });
  } catch (err) {
    throw new RelayError(
      `Relay unreachable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    throw new RelayError(await readErrorDetail(res, `Relay ask failed (${res.status})`), res.status);
  }
  const d = await res.json();
  return {
    question: normalize(d.question),
    answer: { ...normalize(d.answer), model: String(d.answer?.model ?? 'unknown') },
  };
}

/** Who the tailnet says the device is. nginx answers /api/whoami on the same
 *  host as the relay; the relay base URL is that host + /api/relay. */
export async function getRelayIdentity(baseUrl: string): Promise<RelayIdentity> {
  const whoamiUrl = baseUrl.replace(/\/api\/relay\/?$/, '/api/whoami');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(whoamiUrl, { cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) throw new RelayError(`Identity check failed (${res.status})`, res.status);
    const login = (res.headers.get('x-user-email') || '').trim().toLowerCase();
    const raw = res.headers.get('x-user-name') || '';
    let name = raw;
    try {
      name = decodeURIComponent(raw);
    } catch {
      // keep the raw value rather than throwing
    }
    if (!login) throw new RelayError('The tailnet returned no identity');
    const handles: Record<string, string> = { 'scottyvenable@gmail.com': 'scotty' };
    return { login, name: name || login, handle: handles[login] ?? login.split('@')[0] };
  } catch (err) {
    if (err instanceof RelayError) throw err;
    throw new RelayError(
      `Identity unreachable: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Group a message window into thread rows for the list screen. */
export function groupIntoThreads(messages: RelayMessage[]): RelayThread[] {
  const byConv = new Map<number, RelayMessage[]>();
  for (const m of messages) {
    const arr = byConv.get(m.conversation_id) ?? [];
    arr.push(m);
    byConv.set(m.conversation_id, arr);
  }
  return [...byConv.entries()]
    .map(([conversationId, rows]) => {
      const sorted = [...rows].sort((a, b) => a.id - b.id);
      const lastMessage = sorted[sorted.length - 1];
      const authors = [...new Set(sorted.map((m) => m.author_display || m.author))].slice(0, 3);
      return {
        conversationId,
        name: authors.join(', ') || `Room ${conversationId}`,
        lastMessage,
        messageCount: sorted.length,
      };
    })
    .sort((a, b) => b.lastMessage.id - a.lastMessage.id);
}

/** Format an epoch-seconds timestamp for a chat bubble. */
export function formatRelayTime(timestamp: number): string {
  if (!timestamp) return '';
  const d = new Date(timestamp * 1000);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
