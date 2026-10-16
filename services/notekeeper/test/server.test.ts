import { describe, it, expect, afterEach } from 'vitest';
import { createServer, ServerInstance } from '../src/server.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

describe('Fastify Server & Bearer Auth', () => {
  let serverInstance: ServerInstance | null = null;

  afterEach(async () => {
    if (serverInstance) {
      await serverInstance.close();
      serverInstance = null;
    }
  });

  it('GET /health returns 200 with schema_version and lists count', async () => {
    serverInstance = await createServer({
      dbPath: ':memory:',
      port: 0,
      host: '127.0.0.1',
    });
    const addr = await serverInstance.start();

    const res = await fetch(`${addr}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      status: 'ok',
      schema_version: 2,
      lists: 7,
    });
  });

  it('enforces Bearer token auth on /mcp when token is configured', async () => {
    serverInstance = await createServer({
      dbPath: ':memory:',
      port: 0,
      host: '127.0.0.1',
      token: 'test-secret-token',
    });
    const addr = await serverInstance.start();

    // /health should remain public
    const healthRes = await fetch(`${addr}/health`);
    expect(healthRes.status).toBe(200);

    // /mcp without token should fail with 401
    const unauthTransport = new StreamableHTTPClientTransport(new URL(`${addr}/mcp`));
    const unauthClient = new Client({ name: 'unauth', version: '1.0.0' }, { capabilities: {} });
    await expect(unauthClient.connect(unauthTransport)).rejects.toThrow();

    // /mcp with wrong token should fail
    const wrongTransport = new StreamableHTTPClientTransport(new URL(`${addr}/mcp`), {
      requestInit: {
        headers: { Authorization: 'Bearer wrong-token' },
      },
    });
    const wrongClient = new Client({ name: 'wrong', version: '1.0.0' }, { capabilities: {} });
    await expect(wrongClient.connect(wrongTransport)).rejects.toThrow();

    // /mcp with correct token should succeed
    const authTransport = new StreamableHTTPClientTransport(new URL(`${addr}/mcp`), {
      requestInit: {
        headers: { Authorization: 'Bearer test-secret-token' },
      },
    });
    const authClient = new Client({ name: 'auth', version: '1.0.0' }, { capabilities: {} });
    await authClient.connect(authTransport);

    const toolResult = await authClient.callTool({
      name: 'list_get',
      arguments: { name: 'Ideas & Tasks' },
    });
    expect(toolResult.isError).toBeFalsy();
    const payload = JSON.parse((toolResult.content[0] as any).text);
    expect(payload.list.name).toBe('Ideas & Tasks');

    await authClient.close();
  });
});
