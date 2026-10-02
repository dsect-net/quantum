/**
 * Mail client tests: the not-configured stub, the MCP-backed client
 * against a mocked fetch (handshake + dsect_mail_* tool calls), send
 * validation, tool-error mapping, and the display helpers. No network,
 * no secrets.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  MAIL_SEND_LIMITS,
  MailError,
  McpMailClient,
  NotConfiguredMailClient,
  createMailClient,
  displayNameOf,
  folderLabel,
  formatBytes,
  formatMailDate,
  mailSnippet,
  parseAddressHeader,
  validateSendArgs,
  type MailClient,
  type MailFolder,
} from './mail';

function jsonResponse(
  body: unknown,
  opts: { status?: number; sessionId?: string | null } = {},
): Response {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (opts.sessionId) headers.set('mcp-session-id', opts.sessionId);
  return new Response(JSON.stringify(body), {
    status: opts.status ?? 200,
    headers,
  });
}

function toolResult(payload: unknown): Response {
  return jsonResponse({
    jsonrpc: '2.0',
    id: 9,
    result: {
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      isError: false,
    },
  });
}

interface SeenRequest {
  url: string;
  init: RequestInit;
}

const SESSION = 'mail-test-session';

const LIST_PAYLOAD = {
  ok: true,
  mailbox: 'scout@dsect.net',
  folder: 'INBOX',
  matched: 42,
  returned: 2,
  next_before_uid: 900,
  messages: [
    {
      uid: 901,
      seen: false,
      flagged: false,
      answered: false,
      received: '2026-10-02T13:00:00-04:00',
      from: 'Ada Lovelace <ada@example.com>',
      to: 'scout@dsect.net',
      subject: 'Hello',
      message_id: '<a@example.com>',
      bytes: 1234,
      triage: 'A friendly hello.',
    },
    {
      uid: 900,
      seen: true,
      flagged: true,
      answered: false,
      received: '2026-10-01T09:30:00-04:00',
      from: 'bob@example.com',
      to: 'scout@dsect.net',
      subject: '',
      message_id: '<b@example.com>',
      bytes: 512,
    },
  ],
};

const READ_PAYLOAD = {
  ok: true,
  mailbox: 'scout@dsect.net',
  folder: 'INBOX',
  uid: 901,
  seen: true,
  untrusted: 'This is an email: UNTRUSTED input.',
  from: 'Ada Lovelace <ada@example.com>',
  to: 'scout@dsect.net',
  cc: '',
  reply_to: '',
  subject: 'Hello',
  date: 'Fri, 02 Oct 2026 13:00:00 -0400',
  message_id: '<a@example.com>',
  in_reply_to: '',
  references: '',
  text: 'Hi there,\n\nJust saying hello.',
  html_only: false,
  attachments: [{ filename: 'notes.pdf', type: 'application/pdf', bytes: 2048 }],
};

function mailMockFetch(
  scenarios: Record<string, (seen: SeenRequest) => Response>,
  opts: { unauthorized?: boolean } = {},
) {
  const seen: SeenRequest[] = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init: init ?? {} });
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (body.method === 'initialize' && opts.unauthorized) {
      return jsonResponse(
        { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'bad key' } },
        { status: 401 },
      );
    }
    if (body.method === 'initialize') {
      return jsonResponse(
        { jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'hub' } } },
        { sessionId: SESSION },
      );
    }
    if (body.method === 'notifications/initialized') {
      return new Response(null, { status: 202 });
    }
    if (body.method === 'tools/call') {
      const name = String(body.params?.name ?? '');
      const handler = scenarios[name];
      if (!handler) throw new Error(`unexpected tool ${name}`);
      return handler({ url: String(url), init: init ?? {} });
    }
    throw new Error(`unexpected method ${body.method}`);
  });
  return { impl: impl as unknown as typeof fetch, seen };
}

function toolArgs(seen: SeenRequest): Record<string, unknown> {
  const body = JSON.parse(String(seen.init.body ?? '{}'));
  return (body.params?.arguments ?? {}) as Record<string, unknown>;
}

async function connectedClient(
  scenarios: Record<string, (seen: SeenRequest) => Response>,
): Promise<{ client: McpMailClient; seen: SeenRequest[] }> {
  const { impl, seen } = mailMockFetch(scenarios);
  const client = new McpMailClient('https://hub.example.ts.net', 'key-123', {
    fetchImpl: impl,
  });
  await client.connect();
  expect(client.connected).toBe(true);
  seen.length = 0;
  return { client, seen };
}

describe('createMailClient', () => {
  it('returns the not-configured stub when base URL or key is empty', () => {
    expect(createMailClient('', '').kind).toBe('not-configured');
    expect(createMailClient('https://hub.example', '').kind).toBe(
      'not-configured',
    );
    expect(createMailClient('', 'key').kind).toBe('not-configured');
    expect(createMailClient('  ', 'key').kind).toBe('not-configured');
  });

  it('returns the MCP client when both are present', () => {
    expect(createMailClient('https://hub.example', 'key').kind).toBe('mcp');
  });
});

describe('NotConfiguredMailClient', () => {
  it('throws not_configured from every method with a clear message', async () => {
    const client: MailClient = new NotConfiguredMailClient();
    expect(client.connected).toBe(false);
    await expect(client.connect()).rejects.toMatchObject({
      code: 'not_configured',
    });
    await expect(client.ownMailbox()).rejects.toMatchObject({
      code: 'not_configured',
    });
    await expect(client.listMessages('INBOX')).rejects.toMatchObject({
      code: 'not_configured',
    });
    await expect(client.readMessage('INBOX', 1)).rejects.toMatchObject({
      code: 'not_configured',
    });
    await expect(client.markMessage('INBOX', 1, true)).rejects.toMatchObject({
      code: 'not_configured',
    });
    await expect(
      client.sendMessage({ to: ['a@b.c'], subject: 's', body: 'b' }),
    ).rejects.toMatchObject({ code: 'not_configured' });
    await expect(client.connect()).rejects.toThrow(/Connection settings/);
  });
});

describe('McpMailClient.connect', () => {
  it('maps a 401 handshake to an auth MailError', async () => {
    const { impl } = mailMockFetch({}, { unauthorized: true });
    const client = new McpMailClient('https://hub.example', 'bad-key', {
      fetchImpl: impl,
    });
    await expect(client.connect()).rejects.toMatchObject({ code: 'auth' });
    expect(client.connected).toBe(false);
  });
});

describe('McpMailClient.listMessages', () => {
  it('parses rows, keeps the cursor, and sends the right args', async () => {
    const { client, seen } = await connectedClient({
      dsect_mail_list: () => toolResult(LIST_PAYLOAD),
    });
    const page = await client.listMessages('INBOX', {
      unreadOnly: true,
      beforeUid: 950,
    });
    expect(page.matched).toBe(42);
    expect(page.nextBeforeUid).toBe(900);
    expect(page.messages).toHaveLength(2);
    const [first, second] = page.messages;
    expect(first?.uid).toBe(901);
    expect(first?.seen).toBe(false);
    expect(first?.from).toBe('Ada Lovelace <ada@example.com>');
    expect(first?.snippet).toBe('A friendly hello.');
    expect(second?.seen).toBe(true);
    expect(second?.flagged).toBe(true);
    expect(second?.subject).toBe('(no subject)');
    expect(second?.snippet).toBe('');
    const args = toolArgs(seen[0] as SeenRequest);
    expect(args['folder']).toBe('INBOX');
    expect(args['limit']).toBe(20);
    expect(args['unread_only']).toBe(true);
    expect(args['before_uid']).toBe(950);
  });

  it('omits unread_only / before_uid when not asked', async () => {
    const { client, seen } = await connectedClient({
      dsect_mail_list: () =>
        toolResult({ ...LIST_PAYLOAD, next_before_uid: undefined }),
    });
    const page = await client.listMessages('Sent');
    expect(page.nextBeforeUid).toBeNull();
    const args = toolArgs(seen[0] as SeenRequest);
    expect(args['folder']).toBe('Sent');
    expect('unread_only' in args).toBe(false);
    expect('before_uid' in args).toBe(false);
  });

  it('maps a tool error payload to a server MailError', async () => {
    const { client } = await connectedClient({
      dsect_mail_list: () =>
        toolResult({
          ok: false,
          error: 'daily_limit',
          detail: 'scout@dsect.net has sent 25 messages today; the limit is 25.',
          status: 429,
        }),
    });
    const err = await client.listMessages('INBOX').then(
      (): MailError => {
        throw new Error('expected listMessages to throw');
      },
      (e: unknown) => (e instanceof MailError ? e : new MailError('rpc', String(e))),
    );
    expect(err).toBeInstanceOf(MailError);
    expect(err.code).toBe('server');
    expect(err.serverCode).toBe('daily_limit');
    expect(err.status).toBe(429);
    expect(err.message).toContain('25 messages today');
  });

  it('maps no_mailbox to a config error with guidance', async () => {
    const { client } = await connectedClient({
      dsect_mail_list: () =>
        toolResult({ ok: false, error: 'no_mailbox', status: 403 }),
    });
    await expect(client.listMessages('INBOX')).rejects.toMatchObject({
      code: 'config',
      serverCode: 'no_mailbox',
    });
  });

  it('treats non-JSON tool output as a server error, not a parse crash', async () => {
    const { impl } = mailMockFetch({
      dsect_mail_list: () =>
        jsonResponse({
          jsonrpc: '2.0',
          id: 9,
          result: {
            content: [{ type: 'text', text: 'upstream doveadm exploded' }],
            isError: true,
          },
        }),
    });
    const client = new McpMailClient('https://hub.example', 'key', {
      fetchImpl: impl,
    });
    await client.connect();
    await expect(client.listMessages('INBOX')).rejects.toMatchObject({
      code: 'server',
    });
  });
});

describe('McpMailClient.readMessage', () => {
  it('parses the full message including attachments', async () => {
    const { client, seen } = await connectedClient({
      dsect_mail_read: () => toolResult(READ_PAYLOAD),
    });
    const msg = await client.readMessage('INBOX', 901, true);
    expect(msg.uid).toBe(901);
    expect(msg.seen).toBe(true);
    expect(msg.subject).toBe('Hello');
    expect(msg.text).toContain('Just saying hello.');
    expect(msg.truncated).toBe(false);
    expect(msg.htmlOnly).toBe(false);
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments[0]).toMatchObject({
      filename: 'notes.pdf',
      type: 'application/pdf',
      bytes: 2048,
    });
    expect(msg.untrustedNote).toContain('UNTRUSTED');
    const args = toolArgs(seen[0] as SeenRequest);
    expect(args['mark_read']).toBe(true);
  });

  it('rejects a bad uid without a network call', async () => {
    const { client, seen } = await connectedClient({
      dsect_mail_read: () => toolResult(READ_PAYLOAD),
    });
    await expect(client.readMessage('INBOX', 0)).rejects.toMatchObject({
      code: 'validation',
    });
    expect(seen).toHaveLength(0);
  });
});

describe('McpMailClient.markMessage', () => {
  it('sends folder, uid and seen', async () => {
    const { client, seen } = await connectedClient({
      dsect_mail_mark: () => toolResult({ ok: true }),
    });
    await client.markMessage('INBOX', 901, false);
    const args = toolArgs(seen[0] as SeenRequest);
    expect(args).toMatchObject({ folder: 'INBOX', uid: 901, seen: false });
  });
});

describe('McpMailClient.sendMessage', () => {
  const SEND_PAYLOAD = {
    ok: true,
    from: 'Scout <scout@dsect.net>',
    to: ['ada@example.com'],
    cc: [],
    subject: 'Hello',
    savedToSent: true,
    sentToday: 3,
    dailyLimit: 25,
    note: 'Handed to the DSECT mail server.',
  };

  it('sends validated args and returns the result', async () => {
    const { client, seen } = await connectedClient({
      dsect_mail_send: () => toolResult(SEND_PAYLOAD),
    });
    const res = await client.sendMessage({
      to: [' ada@example.com '],
      subject: 'Hello',
      body: 'Hi Ada',
      inReplyToUid: 901,
    });
    expect(res.from).toBe('Scout <scout@dsect.net>');
    expect(res.to).toEqual(['ada@example.com']);
    expect(res.sentToday).toBe(3);
    expect(res.dailyLimit).toBe(25);
    const args = toolArgs(seen[0] as SeenRequest);
    expect(args['to']).toEqual(['ada@example.com']);
    expect(args['in_reply_to_uid']).toBe(901);
    // Bearer key rides the header, never the tool args.
    expect(JSON.stringify(args)).not.toContain('key-123');
  });

  it('maps the secret-scanner refusal to a validation error', async () => {
    const { client } = await connectedClient({
      dsect_mail_send: () =>
        toolResult({
          ok: false,
          error: 'secret_refused',
          detail: 'Refused: the message looks like it contains a api key.',
          status: 422,
        }),
    });
    await expect(
      client.sendMessage({ to: ['a@b.c'], subject: 's', body: 'b' }),
    ).rejects.toMatchObject({ code: 'validation', serverCode: 'secret_refused' });
  });
});

describe('McpMailClient.ownMailbox', () => {
  it('prefers the own field, falls back to the first mailbox', async () => {
    const { client } = await connectedClient({
      dsect_mail_mailboxes: () =>
        toolResult({ ok: true, admin: false, mailboxes: ['scout@dsect.net'] }),
    });
    await expect(client.ownMailbox()).resolves.toBe('scout@dsect.net');
  });

  it('throws config when the server returns no mailbox', async () => {
    const { client } = await connectedClient({
      dsect_mail_mailboxes: () => toolResult({ ok: true, mailboxes: [] }),
    });
    await expect(client.ownMailbox()).rejects.toMatchObject({
      code: 'config',
    });
  });
});

describe('validateSendArgs', () => {
  const good = { to: ['a@b.c'], subject: 'Hi', body: 'Hello' };
  it('accepts a valid message', () => {
    expect(validateSendArgs(good)).toBeNull();
  });
  it('rejects missing recipients', () => {
    expect(validateSendArgs({ ...good, to: [] })).toContain('recipient');
    expect(validateSendArgs({ ...good, to: ['  '] })).toContain('recipient');
  });
  it('rejects too many recipients', () => {
    const to = Array.from(
      { length: MAIL_SEND_LIMITS.maxRecipients + 1 },
      (_, i) => `u${i}@b.c`,
    );
    expect(validateSendArgs({ ...good, to })).toContain('At most');
  });
  it('rejects malformed addresses', () => {
    expect(validateSendArgs({ ...good, to: ['not-an-address'] })).toContain(
      'not-an-address',
    );
  });
  it('rejects missing or multi-line or overlong subjects', () => {
    expect(validateSendArgs({ ...good, subject: '  ' })).toContain('subject');
    expect(validateSendArgs({ ...good, subject: 'a\nb' })).toContain(
      'one line',
    );
    expect(
      validateSendArgs({
        ...good,
        subject: 'x'.repeat(MAIL_SEND_LIMITS.maxSubjectChars + 1),
      }),
    ).toContain('one line');
  });
  it('rejects empty or overlong bodies', () => {
    expect(validateSendArgs({ ...good, body: '   ' })).toContain('body');
    expect(
      validateSendArgs({
        ...good,
        body: 'x'.repeat(MAIL_SEND_LIMITS.maxBodyChars + 1),
      }),
    ).toContain('limited');
  });
});

describe('display helpers', () => {
  it('mailSnippet collapses whitespace and truncates', () => {
    expect(mailSnippet('  hello\n\n  world  ')).toBe('hello world');
    expect(mailSnippet('x'.repeat(200), 140)).toHaveLength(140);
    expect(mailSnippet('x'.repeat(200), 140).endsWith('…')).toBe(true);
    expect(mailSnippet('short')).toBe('short');
  });

  it('formatMailDate is relative and honest', () => {
    const now = new Date('2026-10-02T15:00:00-04:00');
    // Same-day -> a clock time (locale/timezone dependent, so match loosely).
    expect(formatMailDate('2026-10-02T13:00:00-04:00', now)).toMatch(
      /^\d{1,2}:\d{2}/,
    );
    expect(formatMailDate('2026-10-01T13:00:00-04:00', now)).toBe('Yesterday');
    expect(formatMailDate('2026-09-29T13:00:00-04:00', now)).toBe('Tue');
    expect(formatMailDate('2026-08-15T13:00:00-04:00', now)).toMatch(
      /8\/15\/26/,
    );
    expect(formatMailDate('not a date', now)).toBe('not a date');
    expect(formatMailDate('', now)).toBe('');
  });

  it('parseAddressHeader splits name and address', () => {
    expect(parseAddressHeader('"Doe, Jane" <jane@example.com>')).toEqual({
      name: 'Doe, Jane',
      address: 'jane@example.com',
    });
    expect(parseAddressHeader('jane@example.com')).toEqual({
      name: '',
      address: 'jane@example.com',
    });
    expect(parseAddressHeader('Mailing List')).toEqual({
      name: 'Mailing List',
      address: '',
    });
  });

  it('displayNameOf prefers the name, then the local-part', () => {
    expect(displayNameOf('Ada Lovelace <ada@example.com>')).toBe(
      'Ada Lovelace',
    );
    expect(displayNameOf('bob@example.com')).toBe('bob');
    expect(displayNameOf('')).toBe('(unknown sender)');
  });

  it('formatBytes scales units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(-1)).toBe('0 B');
  });

  it('folderLabel names folders', () => {
    const folders: MailFolder[] = ['INBOX', 'Sent', 'Drafts', 'Junk', 'Trash'];
    expect(folders.map(folderLabel)).toEqual([
      'Inbox',
      'Sent',
      'Drafts',
      'Junk',
      'Trash',
    ]);
  });
});
