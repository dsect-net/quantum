/**
 * Mail settings — metadata and helpers for the Mail entry in Connection
 * settings, following the per-service pattern of ./settings.
 *
 * Mail adds NO new persisted fields. There is no standalone mail base URL
 * or mail password: the mail surface is the hub MCP gateway's dsect_mail_*
 * tools (hub-api lib/mcp-mail.js), so Mail reuses the `hub` base URL and
 * the `mcpKey` worker key. The mailbox is scoped to the key server-side.
 * IMAP/SMTP stay on the tailnet; a phone app cannot speak them directly.
 */
import { createMailClient, MailError } from '../api/mail';
import type { QuantumSettings } from './settings';

/**
 * SERVICE_META-style metadata for the Mail section. Same shape as the
 * entries in settings.ts so SettingsScreen can render it uniformly —
 * except there is no base URL of its own (see module docstring).
 */
export const MAIL_META = {
  label: 'Mail',
  description:
    'DSECT mail over the hub MCP gateway (dsect_mail_list / _read / _mark / _send): inbox, reading, and sending as your own @dsect.net address. Uses the Hub API base URL and MCP worker key — mail has no separate base URL or password, and the mailbox is scoped to the key server-side.',
  note: 'Mail runs over the hub MCP gateway at {hub base URL}/mcp. Reads return plain text; attachments are listed by name only.',
} as const;

/** True when Mail can be attempted: hub base URL AND worker key present. */
export function mailConfigured(settings: QuantumSettings): boolean {
  return (
    settings.hub.baseUrl.trim().length > 0 && settings.mcpKey.trim().length > 0
  );
}

/** Honest one-line status for the settings UI. */
export function mailStatusLine(settings: QuantumSettings): string {
  const hasBase = settings.hub.baseUrl.trim().length > 0;
  const hasKey = settings.mcpKey.trim().length > 0;
  if (!hasBase && !hasKey)
    return 'Mail is not connected — add the Hub API base URL and MCP worker key below.';
  if (!hasBase) return 'Mail needs the Hub API base URL.';
  if (!hasKey) return 'Mail needs the MCP worker key.';
  return 'Mail is configured (hub MCP gateway).';
}

export interface MailTestResult {
  ok: true;
  mailbox: string;
}

/**
 * Connection test for the Mail section: open an MCP session and ask the
 * gateway which mailbox this key may use. Resolves with the own mailbox
 * address. Throws MailError on any failure (including 'not_configured'
 * when base URL or key is missing).
 */
export async function testMailConnection(
  baseUrl: string,
  mcpKey: string,
  fetchImpl?: typeof fetch,
): Promise<MailTestResult> {
  const client = createMailClient(
    baseUrl,
    mcpKey,
    fetchImpl ? { fetchImpl } : {},
  );
  try {
    await client.connect();
  } catch (e) {
    throw e instanceof MailError ? e : MailError.fromMcpError(e);
  }
  try {
    const mailbox = await client.ownMailbox();
    return { ok: true, mailbox };
  } finally {
    client.close();
  }
}
