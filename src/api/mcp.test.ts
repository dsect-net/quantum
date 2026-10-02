/**
 * MCP client tests: session handshake, tools/list, tools/call, and the
 * error paths — all against a mocked fetch. No network, no secrets.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  McpClient,
  classifyTool,
  mcpConfigured,
  renderToolResult,
  toolArea,
} from './mcp';

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

interface SeenRequest {
  url: string;
  init: RequestInit;
}

function mockFetch(scenarios: Record<string, (seen: SeenRequest) => Response>) {
  const seen: SeenRequest[] = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init: init ?? {} });
    const body = JSON.parse(String(init?.body ?? '{}'));
    const handler = scenarios[body.method];
    if (!handler) throw new Error(`unexpected method ${body.method}`);
    return handler({ url: String(url), init: init ?? {} });
  });
  return { impl: impl as unknown as typeof fetch, seen };
}

const SESSION = 'test-session-id-abc';

describe('McpClient.connect', () => {
  it('completes the initialize handshake and keeps the session id', async () => {
    const { impl, seen } = mockFetch({
      initialize: () =>
        jsonResponse({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'hub' } } }, { sessionId: SESSION }),
      'notifications/initialized': () => new Response(null, { status: 202 }),
    });
    const client = new McpClient('https://hub.example.ts.net', 'key-123', { fetchImpl: impl });
    const session = await client.connect();
    expect(session).toBe(SESSION);
    expect(client.connected).toBe(true);
    expect(client.hasKey).toBe(true);
    // Bearer key rides the Authorization header, never the body.
    const auth = (seen[0].init.headers as Record<string, string>)['Authorization'];
    expect(auth).toBe('Bearer key-123');
    expect(String(seen[0].init.body)).not.toContain('key-123');
  });

  it('rejects 401 as an auth error', async () => {
    const { impl } = mockFetch({
      initialize: () => jsonResponse({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'bad key' } }, { status: 401 }),
    });
    const client = new McpClient('https://hub.example.ts.net', 'wrong-key', { fetchImpl: impl });
    await expect(client.connect()).rejects.toMatchObject({ code: 'auth', status: 401 });
  });

  it('fails with config when no base URL is given', async () => {
    const client = new McpClient('', 'key-123', { fetchImpl: mockFetch({}).impl });
    await expect(client.connect()).rejects.toMatchObject({ code: 'config' });
  });

  it('fails with config when no worker key is given', async () => {
    const client = new McpClient('https://hub.example.ts.net', '', { fetchImpl: mockFetch({}).impl });
    await expect(client.connect()).rejects.toMatchObject({ code: 'config' });
  });

  it('maps JSON-RPC errors to rpc errors with the server code', async () => {
    const { impl } = mockFetch({
      initialize: () =>
        jsonResponse({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } }, { sessionId: SESSION }),
    });
    const client = new McpClient('https://hub.example.ts.net', 'key-123', { fetchImpl: impl });
    await expect(client.connect()).rejects.toMatchObject({ code: 'rpc', rpcCode: -32601 });
  });
});

describe('McpClient.listTools', () => {
  function connectedClient() {
    const { impl, seen } = mockFetch({
      initialize: () =>
        jsonResponse({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'hub' } } }, { sessionId: SESSION }),
      'notifications/initialized': () => new Response(null, { status: 202 }),
      'tools/list': () =>
        jsonResponse({
          jsonrpc: '2.0',
          id: 3,
          result: {
            tools: [
              { name: 'dsect_services_status', description: 'Service health' },
              { name: 'dsect_service_restart', description: 'Restart a service' },
            ],
          },
        }),
    });
    return { client: new McpClient('https://hub.example.ts.net', 'key-123', { fetchImpl: impl }), seen };
  }

  it('returns the tool list and sends the session header', async () => {
    const { client, seen } = connectedClient();
    await client.connect();
    const tools = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['dsect_services_status', 'dsect_service_restart']);
    const listReq = seen.find((s) => String(s.init.body).includes('tools/list'));
    expect(listReq).toBeDefined();
    expect((listReq!.init.headers as Record<string, string>)['mcp-session-id']).toBe(SESSION);
  });

  it('refuses to list before connect()', async () => {
    const { client } = connectedClient();
    await expect(client.listTools()).rejects.toMatchObject({ code: 'not_connected' });
  });

  it('disconnect() clears the session', async () => {
    const { client } = connectedClient();
    await client.connect();
    client.disconnect();
    expect(client.connected).toBe(false);
    await expect(client.listTools()).rejects.toMatchObject({ code: 'not_connected' });
  });
});

describe('McpClient.callTool', () => {
  function clientWithCall(callResult: unknown) {
    const { impl } = mockFetch({
      initialize: () =>
        jsonResponse({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'hub' } } }, { sessionId: SESSION }),
      'notifications/initialized': () => new Response(null, { status: 202 }),
      'tools/call': () => jsonResponse({ jsonrpc: '2.0', id: 3, result: callResult }),
    });
    return new McpClient('https://hub.example.ts.net', 'key-123', { fetchImpl: impl });
  }

  it('returns content blocks as-is', async () => {
    const client = clientWithCall({ content: [{ type: 'text', text: '{"ok":true}' }] });
    await client.connect();
    const blocks = await client.callTool('dsect_services_status', { only_problems: false });
    expect(blocks).toEqual([{ type: 'text', text: '{"ok":true}' }]);
  });

  it('returns [] when the result has no content array', async () => {
    const client = clientWithCall({});
    await client.connect();
    expect(await client.callTool('dsect_whoami')).toEqual([]);
  });

  it('wraps fetch rejections as network errors', async () => {
    const failing = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const client = new McpClient('https://hub.example.ts.net', 'key-123', {
      fetchImpl: failing as unknown as typeof fetch,
    });
    await expect(client.connect()).rejects.toMatchObject({ code: 'network' });
    expect(failing).toHaveBeenCalled();
  });
});

describe('classifyTool', () => {
  it('marks known read-only tools read', () => {
    expect(classifyTool('dsect_whoami')).toBe('read');
  });

  it('marks destructive verbs mutating', () => {
    for (const name of [
      'dsect_service_restart',
      'dsect_mail_send',
      'dsect_hass_call_service',
      'dsect_sandbox_shell',
      'dsect_docket_add',
      'dsect_codex_write',
      'dsect_mail_mark',
    ]) {
      expect(classifyTool(name)).toBe('mutating');
    }
  });

  it('marks reads and unknowns honestly', () => {
    expect(classifyTool('dsect_services_status')).not.toBe('mutating');
    expect(classifyTool('dsect_mail_list')).not.toBe('mutating');
    expect(classifyTool('dsect_service_logs')).not.toBe('mutating');
  });
});

describe('renderToolResult', () => {
  it('surfaces text blocks directly', () => {
    expect(renderToolResult([{ type: 'text', text: 'hello' }])).toEqual(['hello']);
  });

  it('JSON-stringifies non-text blocks', () => {
    const out = renderToolResult([{ type: 'image', data: 'abc' }]);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0])).toEqual({ type: 'image', data: 'abc' });
  });
});

describe('mcpConfigured', () => {
  it('requires both base URL and key', () => {
    expect(mcpConfigured('https://x', 'k')).toBe(true);
    expect(mcpConfigured('', 'k')).toBe(false);
    expect(mcpConfigured('https://x', '')).toBe(false);
    expect(mcpConfigured('https://x', '   ')).toBe(false);
  });
});

describe('toolArea', () => {
  it('groups dsect_* tools by infix', () => {
    expect(toolArea('dsect_mail_list')).toBe('mail');
    expect(toolArea('dsect_service_logs')).toBe('service');
    expect(toolArea('dsect_whoami')).toBe('whoami');
    expect(toolArea('weird')).toBe('other');
  });
});
