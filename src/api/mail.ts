/**
 * Mail client for the Quantum Mail tab.
 *
 * There is NO standalone HTTP mail API on the DSECT hub (verified
 * 2026-10-02 against hub-api: server.js exposes zero /api/mail* routes, and
 * IMAP/SMTP/webmail are bound to the tailnet only, which a WebView app
 * cannot speak anyway). Mail over HTTP exists only as MCP tools on the hub
 * MCP gateway — POST {base}/mcp, streamable-HTTP JSON-RPC, Bearer worker key
 * (hub-api lib/mcp-mail.js, documented in hub-api docs/mcp-onboarding.md):
 *
 *   dsect_mail_list      folder listing (uid, flags, from/to/subject/date,
 *                        HERALD triage summary; no body text)
 *   dsect_mail_read      full message text (plain text only; attachment
 *                        CONTENT is never returned, only names/types/sizes)
 *   dsect_mail_mark      mark read / unread
 *   dsect_mail_send      send as the worker's own @dsect.net address
 *                        (<=10 recipients, 1-line subject <=200 chars,
 *                        body <=20,000 chars, secret-scanned, daily limit)
 *   dsect_mail_mailboxes mailboxes the key may use (the mailbox is scoped
 *                        to the worker key server-side)
 *
 * This module wraps those tools in a small typed `MailClient` interface on
 * top of the existing session-scoped `McpClient` (./mcp). Credentials are
 * the hub base URL + MCP worker key from Connection settings (stored via
 * Capacitor Preferences); nothing mail-specific is hardcoded or logged, and
 * no IMAP/SMTP password exists anywhere — the MCP key IS the credential.
 *
 * Unconfigured (empty base URL or key) -> `NotConfiguredMailClient`, whose
 * every method throws a clear 'not_configured' error so the UI can render
 * its honest "Mail is not connected" state. The inbox is NEVER faked.
 */

import {
  McpApiError,
  McpClient,
  type McpClientOptions,
  type McpContentBlock,
} from './mcp';

export type MailFolder = 'INBOX' | 'Sent' | 'Drafts' | 'Junk' | 'Trash';

export const MAIL_FOLDERS: readonly MailFolder[] = [
  'INBOX',
  'Sent',
  'Drafts',
  'Junk',
  'Trash',
];

export function folderLabel(folder: MailFolder): string {
  switch (folder) {
    case 'INBOX':
      return 'Inbox';
    case 'Sent':
      return 'Sent';
    case 'Drafts':
      return 'Drafts';
    case 'Junk':
      return 'Junk';
    case 'Trash':
      return 'Trash';
  }
}

/** Mirror of the server-side send limits (hub-api lib/mcp-mail.js). */
export const MAIL_SEND_LIMITS = {
  maxRecipients: 10,
  maxSubjectChars: 200,
  maxBodyChars: 20_000,
} as const;

export type MailErrorCode =
  | 'not_configured'
  | 'config'
  | 'auth'
  | 'network'
  | 'timeout'
  | 'http'
  | 'rpc'
  | 'server'
  | 'validation';

export class MailError extends Error {
  readonly code: MailErrorCode;
  /** HTTP status, when the failure came from an HTTP response. */
  readonly status: number | null;
  /** The server's tool error code (e.g. 'daily_limit'), when one was given. */
  readonly serverCode: string | null;

  constructor(
    code: MailErrorCode,
    message: string,
    options: { status?: number | null; serverCode?: string | null } = {},
  ) {
    super(message);
    this.name = 'MailError';
    this.code = code;
    this.status = options.status ?? null;
    this.serverCode = options.serverCode ?? null;
  }

  static fromMcpError(e: unknown): MailError {
    if (e instanceof McpApiError) {
      const map: Record<string, MailErrorCode> = {
        config: 'config',
        network: 'network',
        timeout: 'timeout',
        auth: 'auth',
        http: 'http',
        rpc: 'rpc',
        not_connected: 'config',
      };
      return new MailError(map[e.code] ?? 'rpc', e.message, {
        status: e.status,
      });
    }
    if (e instanceof MailError) return e;
    return new MailError('rpc', e instanceof Error ? e.message : String(e));
  }

  /**
   * Map a `{ ok: false, error, detail, status }` tool payload to a MailError.
   * Known server codes get a plain-language message; anything else is a
   * generic server failure carrying the code for diagnostics.
   */
  static fromToolError(
    payload: { error?: unknown; detail?: unknown; status?: unknown },
    tool: string,
  ): MailError {
    const serverCode =
      typeof payload.error === 'string' ? payload.error : 'unknown';
    const detail =
      typeof payload.detail === 'string' && payload.detail.trim()
        ? payload.detail.trim()
        : `The mail service reported: ${serverCode}`;
    const status =
      typeof payload.status === 'number' ? payload.status : null;
    switch (serverCode) {
      case 'no_mailbox':
        return new MailError(
          'config',
          'This worker key has no mailbox registered. Ask Scott to add one (add-worker --email).',
          { serverCode, status },
        );
      case 'mailbox_forbidden':
      case 'send_as_refused':
        return new MailError('auth', detail, { serverCode, status });
      case 'secret_refused':
        return new MailError('validation', detail, { serverCode, status });
      default:
        return new MailError('server', `${tool}: ${detail}`, {
          serverCode,
          status,
        });
    }
  }
}

export interface MailAttachment {
  filename: string;
  type: string;
  bytes: number;
}

export interface MailMessageSummary {
  uid: number;
  mailbox: string;
  folder: MailFolder;
  from: string;
  to: string;
  subject: string;
  /** As returned by the server (doveadm date.received); '' when absent. */
  date: string;
  messageId: string;
  bytes: number;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  /**
   * HERALD triage summary when the server attached one, otherwise ''.
   * The list endpoint carries no body text — a body snippet is only
   * available after opening the message.
   */
  snippet: string;
}

export interface MailMessage extends MailMessageSummary {
  cc: string;
  replyTo: string;
  /** Plain text body (HTML-only mail arrives tag-stripped by the server). */
  text: string;
  truncated: boolean;
  htmlOnly: boolean;
  attachments: MailAttachment[];
  /** The server's untrusted-input notice for this message. */
  untrustedNote: string;
}

export interface MailListResult {
  messages: MailMessageSummary[];
  /** Total matched on the server (before the page limit). */
  matched: number;
  /** Cursor for the next page, or null when the listing is complete. */
  nextBeforeUid: number | null;
}

export interface MailListOptions {
  limit?: number;
  unreadOnly?: boolean;
  /** Fetch messages with uid < beforeUid (pagination cursor). */
  beforeUid?: number;
}

export interface MailSendArgs {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  /** uid of the INBOX message being replied to (threads the reply). */
  inReplyToUid?: number;
}

export interface MailSendResult {
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  sentToday: number;
  dailyLimit: number;
}

export interface MailClient {
  readonly kind: 'mcp' | 'not-configured';
  readonly connected: boolean;
  /** Open the MCP session. Throws MailError on any failure. */
  connect(): Promise<void>;
  /** The worker's own mailbox address, as scoped by the server. */
  ownMailbox(): Promise<string>;
  listMessages(
    folder: MailFolder,
    opts?: MailListOptions,
  ): Promise<MailListResult>;
  readMessage(
    folder: MailFolder,
    uid: number,
    markRead?: boolean,
  ): Promise<MailMessage>;
  markMessage(folder: MailFolder, uid: number, seen: boolean): Promise<void>;
  sendMessage(args: MailSendArgs): Promise<MailSendResult>;
  close(): void;
}

/* ------------------------------------------------------------------ */
/* Wire helpers                                                        */
/* ------------------------------------------------------------------ */

const TOOL_LIST = 'dsect_mail_list';
const TOOL_READ = 'dsect_mail_read';
const TOOL_MARK = 'dsect_mail_mark';
const TOOL_SEND = 'dsect_mail_send';
const TOOL_MAILBOXES = 'dsect_mail_mailboxes';

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null
    ? (v as Record<string, unknown>)
    : {};
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function blocksToText(blocks: McpContentBlock[]): string {
  return blocks
    .map((b) => (typeof b?.text === 'string' ? b.text : ''))
    .join('\n')
    .trim();
}

/**
 * Extract the JSON payload from a tools/call text block. A non-empty
 * non-JSON response is treated as a server error message, not a parse
 * failure — the gateway meant it as an error.
 */
export function parseMailToolPayload(text: string, tool: string): unknown {
  const t = text.trim();
  const start = t.indexOf('{');
  if (start < 0) {
    throw new MailError(
      'server',
      t
        ? `${tool}: ${t.slice(0, 200)}`
        : `${tool} returned an empty response`,
    );
  }
  try {
    return JSON.parse(t.slice(start));
  } catch {
    throw new MailError('rpc', `${tool} returned malformed JSON`);
  }
}

function throwIfToolError(payload: unknown, tool: string): void {
  const r = asRecord(payload);
  if (r['ok'] === false) {
    throw MailError.fromToolError(
      { error: r['error'], detail: r['detail'], status: r['status'] },
      tool,
    );
  }
}

function toSummary(
  row: unknown,
  mailbox: string,
  folder: MailFolder,
): MailMessageSummary | null {
  const r = asRecord(row);
  const uid = num(r['uid']);
  if (!(uid > 0)) return null;
  return {
    uid,
    mailbox,
    folder,
    from: str(r['from']),
    to: str(r['to']),
    subject: str(r['subject']) || '(no subject)',
    date: str(r['received']),
    messageId: str(r['message_id']),
    bytes: num(r['bytes']),
    seen: r['seen'] === true,
    flagged: r['flagged'] === true,
    answered: r['answered'] === true,
    snippet: str(r['triage']),
  };
}

function toMessage(
  payload: Record<string, unknown>,
  mailbox: string,
  folder: MailFolder,
  uid: number,
): MailMessage {
  const atts = Array.isArray(payload['attachments'])
    ? payload['attachments'].map((a) => {
        const r = asRecord(a);
        return {
          filename: str(r['filename']) || '(unnamed)',
          type: str(r['type']) || 'application/octet-stream',
          bytes: num(r['bytes']),
        };
      })
    : [];
  const text = str(payload['text']);
  return {
    uid,
    mailbox,
    folder,
    from: str(payload['from']),
    to: str(payload['to']),
    subject: str(payload['subject']) || '(no subject)',
    date: str(payload['date']),
    messageId: str(payload['message_id']),
    bytes: num(payload['bytes']),
    seen: payload['seen'] === true,
    flagged: false,
    answered: false,
    snippet: mailSnippet(text),
    cc: str(payload['cc']),
    replyTo: str(payload['reply_to']),
    text,
    truncated: payload['truncated'] === true,
    htmlOnly: payload['html_only'] === true,
    attachments: atts,
    untrustedNote: str(payload['untrusted']),
  };
}

const ADDR_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Client-side mirror of the server's send validation. Returns an error
 * message, or null when the args are acceptable. The server re-validates;
 * this just fails fast without a round trip.
 */
export function validateSendArgs(args: MailSendArgs): string | null {
  const to = (args.to ?? []).map((s) => s.trim()).filter(Boolean);
  const cc = (args.cc ?? []).map((s) => s.trim()).filter(Boolean);
  if (to.length === 0) return 'Add at least one recipient.';
  if (to.length + cc.length > MAIL_SEND_LIMITS.maxRecipients) {
    return `At most ${MAIL_SEND_LIMITS.maxRecipients} recipients (to + cc).`;
  }
  const bad = [...to, ...cc].find((a) => !ADDR_RE.test(a));
  if (bad) return `"${bad}" is not a plain email address.`;
  const subject = (args.subject ?? '').trim();
  if (!subject) return 'Add a subject.';
  if (
    subject.length > MAIL_SEND_LIMITS.maxSubjectChars ||
    /[\r\n]/.test(subject)
  ) {
    return `Subject must be one line, ${MAIL_SEND_LIMITS.maxSubjectChars} characters at most.`;
  }
  const body = args.body ?? '';
  if (!body.trim()) return 'Write a message body.';
  if (body.length > MAIL_SEND_LIMITS.maxBodyChars) {
    return `Body is limited to ${MAIL_SEND_LIMITS.maxBodyChars.toLocaleString()} characters.`;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* MCP-backed client                                                   */
/* ------------------------------------------------------------------ */

export class McpMailClient implements MailClient {
  readonly kind = 'mcp' as const;
  private readonly mcp: McpClient;

  constructor(baseUrl: string, mcpKey: string, options: McpClientOptions = {}) {
    this.mcp = new McpClient(baseUrl, mcpKey, options);
  }

  get connected(): boolean {
    return this.mcp.connected;
  }

  async connect(): Promise<void> {
    try {
      await this.mcp.connect();
    } catch (e) {
      throw MailError.fromMcpError(e);
    }
  }

  private async call(
    tool: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    let blocks: McpContentBlock[];
    try {
      blocks = await this.mcp.callTool(tool, args);
    } catch (e) {
      throw MailError.fromMcpError(e);
    }
    const payload = parseMailToolPayload(blocksToText(blocks), tool);
    throwIfToolError(payload, tool);
    return asRecord(payload);
  }

  async ownMailbox(): Promise<string> {
    const p = await this.call(TOOL_MAILBOXES, {});
    const own = str(p['own']);
    if (own) return own;
    const boxes = Array.isArray(p['mailboxes'])
      ? p['mailboxes'].map(str).filter(Boolean)
      : [];
    if (boxes.length > 0) return boxes[0] as string;
    throw new MailError(
      'config',
      'The mail service returned no mailbox for this worker key.',
    );
  }

  async listMessages(
    folder: MailFolder,
    opts: MailListOptions = {},
  ): Promise<MailListResult> {
    const args: Record<string, unknown> = { folder };
    const limit = num(opts.limit, 20);
    args['limit'] = Math.min(Math.max(Math.trunc(limit) || 20, 1), 50);
    if (opts.unreadOnly) args['unread_only'] = true;
    if (opts.beforeUid && opts.beforeUid > 0)
      args['before_uid'] = Math.trunc(opts.beforeUid);
    const p = await this.call(TOOL_LIST, args);
    const mailbox = str(p['mailbox']);
    const rows = Array.isArray(p['messages']) ? p['messages'] : [];
    const messages = rows
      .map((r) => toSummary(r, mailbox, folder))
      .filter((m): m is MailMessageSummary => m !== null);
    const next = num(p['next_before_uid']);
    return {
      messages,
      matched: num(p['matched'], messages.length),
      nextBeforeUid: next > 0 ? next : null,
    };
  }

  async readMessage(
    folder: MailFolder,
    uid: number,
    markRead = false,
  ): Promise<MailMessage> {
    if (!(uid > 0))
      throw new MailError('validation', 'A message uid is required.');
    const args: Record<string, unknown> = { folder, uid };
    if (markRead) args['mark_read'] = true;
    const p = await this.call(TOOL_READ, args);
    return toMessage(p, str(p['mailbox']), folder, num(p['uid'], uid));
  }

  async markMessage(
    folder: MailFolder,
    uid: number,
    seen: boolean,
  ): Promise<void> {
    if (!(uid > 0))
      throw new MailError('validation', 'A message uid is required.');
    await this.call(TOOL_MARK, { folder, uid, seen });
  }

  async sendMessage(args: MailSendArgs): Promise<MailSendResult> {
    const problem = validateSendArgs(args);
    if (problem) throw new MailError('validation', problem);
    const to = args.to.map((s) => s.trim()).filter(Boolean);
    const cc = (args.cc ?? []).map((s) => s.trim()).filter(Boolean);
    const callArgs: Record<string, unknown> = {
      to,
      cc,
      subject: args.subject.trim(),
      body: args.body,
    };
    if (args.inReplyToUid && args.inReplyToUid > 0)
      callArgs['in_reply_to_uid'] = Math.trunc(args.inReplyToUid);
    const p = await this.call(TOOL_SEND, callArgs);
    const pTo = Array.isArray(p['to']) ? p['to'].map(str) : to;
    const pCc = Array.isArray(p['cc']) ? p['cc'].map(str) : cc;
    return {
      from: str(p['from']),
      to: pTo,
      cc: pCc,
      subject: str(p['subject']),
      sentToday: num(p['sentToday']),
      dailyLimit: num(p['dailyLimit'], MAIL_SEND_LIMITS.maxRecipients),
    };
  }

  close(): void {
    this.mcp.disconnect();
  }
}

/* ------------------------------------------------------------------ */
/* Not-configured stub — honest empty state, never fake data            */
/* ------------------------------------------------------------------ */

const NOT_CONFIGURED_MESSAGE =
  'Mail is not connected — add the Hub API base URL and your MCP worker key in More → Connection settings.';

/** Every method throws 'not_configured'. The UI renders its empty state. */
export class NotConfiguredMailClient implements MailClient {
  readonly kind = 'not-configured' as const;
  readonly connected = false;

  private fail(): never {
    throw new MailError('not_configured', NOT_CONFIGURED_MESSAGE);
  }

  async connect(): Promise<void> {
    this.fail();
  }
  async ownMailbox(): Promise<string> {
    this.fail();
  }
  async listMessages(): Promise<MailListResult> {
    this.fail();
  }
  async readMessage(): Promise<MailMessage> {
    this.fail();
  }
  async markMessage(): Promise<void> {
    this.fail();
  }
  async sendMessage(): Promise<MailSendResult> {
    this.fail();
  }
  close(): void {
    /* nothing to close */
  }
}

/**
 * Build the client for the current settings. Empty base URL or key ->
 * the not-configured stub (honest empty state); otherwise the MCP-backed
 * client. Call `connect()` before use.
 */
export function createMailClient(
  baseUrl: string,
  mcpKey: string,
  options: McpClientOptions = {},
): MailClient {
  if (!baseUrl.trim() || !mcpKey.trim()) return new NotConfiguredMailClient();
  return new McpMailClient(baseUrl, mcpKey, options);
}

/* ------------------------------------------------------------------ */
/* Display helpers                                                     */
/* ------------------------------------------------------------------ */

/** Collapse whitespace and truncate to a one-line snippet. */
export function mailSnippet(text: string, maxLen = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= maxLen) return flat;
  return flat.slice(0, Math.max(0, maxLen - 1)).trimEnd() + '…';
}

/**
 * Relative date for list rows: time today, "Yesterday", weekday within the
 * week, else M/D/YY. Falls back to the raw string when unparseable.
 */
export function formatMailDate(raw: string, now: Date = new Date()): string {
  if (!raw.trim()) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const startOfDay = (x: Date): number => {
    const c = new Date(x);
    c.setHours(0, 0, 0, 0);
    return c.getTime();
  };
  const days = Math.round(
    (startOfDay(now) - startOfDay(d)) / 86_400_000,
  );
  if (days <= 0)
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], {
    month: 'numeric',
    day: 'numeric',
    year: '2-digit',
  });
}

export interface ParsedAddress {
  name: string;
  address: string;
}

/** Split a From/To header like `"Doe, Jane" <jane@example.com>` or a bare address. */
export function parseAddressHeader(header: string): ParsedAddress {
  const h = header.trim();
  const m = /^(.*)<([^<>]+)>$/.exec(h);
  if (m) {
    const name = m[1].trim().replace(/^"(.*)"$/, '$1').trim();
    return { name, address: m[2].trim() };
  }
  if (/^[^\s@]+@[^\s@]+$/.test(h)) return { name: '', address: h };
  return { name: h, address: '' };
}

/** Display name for a From header: the name part, else the local-part. */
export function displayNameOf(header: string): string {
  const { name, address } = parseAddressHeader(header);
  if (name) return name;
  if (address) {
    const at = address.indexOf('@');
    return at > 0 ? address.slice(0, at) : address;
  }
  return header.trim() || '(unknown sender)';
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.trunc(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb >= 100 ? Math.round(kb) : kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

/** Short plain-language summary of a MailError for UI display. */
export function friendlyMailError(e: unknown): string {
  if (e instanceof MailError) return e.message;
  return e instanceof Error ? e.message : String(e);
}
