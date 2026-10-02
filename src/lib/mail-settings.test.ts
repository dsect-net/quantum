/**
 * mail-settings tests: configured detection, status lines, metadata, and
 * the mail connection test against a mocked MCP gateway. No network,
 * no secrets.
 */
import { describe, expect, it, vi } from 'vitest';
import { MailError } from '../api/mail';
import {
  EMPTY_SETTINGS,
  type QuantumSettings,
} from './settings';
import {
  MAIL_META,
  mailConfigured,
  mailStatusLine,
  testMailConnection,
} from './mail-settings';

function withSettings(partial: Partial<QuantumSettings>): QuantumSettings {
  return { ...EMPTY_SETTINGS, ...partial };
}

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

function mockGateway(
  mailboxesPayload: unknown,
  opts: { unauthorized?: boolean } = {},
) {
  const seen: string[] = [];
  const impl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    seen.push(String(body.method));
    if (body.method === 'initialize' && opts.unauthorized) {
      return jsonResponse(
        { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'bad key' } },
        { status: 401 },
      );
    }
    if (body.method === 'initialize') {
      return jsonResponse(
        { jsonrpc: '2.0', id: 1, result: {} },
        { sessionId: 'sess-1' },
      );
    }
    if (body.method === 'notifications/initialized') {
      return new Response(null, { status: 202 });
    }
    if (body.method === 'tools/call') {
      return jsonResponse({
        jsonrpc: '2.0',
        id: 3,
        result: {
          content: [{ type: 'text', text: JSON.stringify(mailboxesPayload) }],
          isError: false,
        },
      });
    }
    throw new Error(`unexpected method ${body.method}`);
  });
  return { impl: impl as unknown as typeof fetch, seen };
}

describe('mailConfigured', () => {
  it('is false when nothing is configured', () => {
    expect(mailConfigured(EMPTY_SETTINGS)).toBe(false);
  });

  it('is false when only the hub base URL is set', () => {
    expect(
      mailConfigured(withSettings({ hub: { baseUrl: 'https://hub.example' } })),
    ).toBe(false);
  });

  it('is false when only the worker key is set', () => {
    expect(mailConfigured(withSettings({ mcpKey: 'key-123' }))).toBe(false);
  });

  it('is true when hub base URL and worker key are both set', () => {
    expect(
      mailConfigured(
        withSettings({ hub: { baseUrl: 'https://hub.example' }, mcpKey: 'key-123' }),
      ),
    ).toBe(true);
  });
});

describe('mailStatusLine', () => {
  it('describes each missing piece honestly', () => {
    expect(mailStatusLine(EMPTY_SETTINGS)).toContain('not connected');
    expect(
      mailStatusLine(withSettings({ hub: { baseUrl: 'https://hub.example' } })),
    ).toContain('worker key');
    expect(mailStatusLine(withSettings({ mcpKey: 'key-123' }))).toContain(
      'base URL',
    );
    expect(
      mailStatusLine(
        withSettings({ hub: { baseUrl: 'https://hub.example' }, mcpKey: 'k' }),
      ),
    ).toContain('configured');
  });
});

describe('MAIL_META', () => {
  it('carries the label and description for the settings UI', () => {
    expect(MAIL_META.label).toBe('Mail');
    expect(MAIL_META.description).toContain('dsect_mail_');
    expect(MAIL_META.description).toContain('MCP worker key');
  });
});

describe('testMailConnection', () => {
  it('resolves with the own mailbox on success', async () => {
    const { impl, seen } = mockGateway({
      ok: true,
      admin: false,
      mailboxes: ['scout@dsect.net'],
    });
    const res = await testMailConnection(
      'https://hub.example',
      'key-123',
      impl,
    );
    expect(res).toEqual({ ok: true, mailbox: 'scout@dsect.net' });
    expect(seen).toContain('tools/call');
  });

  it('throws not_configured without any network call when unconfigured', async () => {
    const { impl, seen } = mockGateway({ ok: true, mailboxes: [] });
    await expect(testMailConnection('', 'key-123', impl)).rejects.toMatchObject(
      { code: 'not_configured' },
    );
    await expect(testMailConnection('https://hub.example', '', impl)).rejects.toMatchObject(
      { code: 'not_configured' },
    );
    expect(seen).toHaveLength(0);
  });

  it('maps a bad worker key to an auth error', async () => {
    const { impl } = mockGateway(
      { ok: true, mailboxes: [] },
      { unauthorized: true },
    );
    const err = await testMailConnection(
      'https://hub.example',
      'wrong-key',
      impl,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MailError);
    expect((err as MailError).code).toBe('auth');
  });
});
