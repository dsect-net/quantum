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

  it('enforces Bearer token auth on REST endpoints when token is configured', async () => {
    serverInstance = await createServer({
      dbPath: ':memory:',
      port: 0,
      host: '127.0.0.1',
      token: 'rest-secret-token',
    });
    const addr = await serverInstance.start();

    // GET /api/v1/lists without token -> 401
    const unauthRes = await fetch(`${addr}/api/v1/lists`);
    expect(unauthRes.status).toBe(401);
    const unauthBody = await unauthRes.json();
    expect(unauthBody.error).toMatch(/Unauthorized/i);

    // GET /api/v1/lists with wrong token -> 401
    const wrongRes = await fetch(`${addr}/api/v1/lists`, {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    expect(wrongRes.status).toBe(401);

    // GET /api/v1/lists with correct token -> 200
    const authRes = await fetch(`${addr}/api/v1/lists`, {
      headers: { Authorization: 'Bearer rest-secret-token' },
    });
    expect(authRes.status).toBe(200);
    const lists = await authRes.json();
    expect(Array.isArray(lists)).toBe(true);
  });

  it('returns 400 for malformed JSON body on REST endpoints', async () => {
    serverInstance = await createServer({
      dbPath: ':memory:',
      port: 0,
      host: '127.0.0.1',
    });
    const addr = await serverInstance.start();

    const res = await fetch(`${addr}/api/v1/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"title": "Broken Json without closing',
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Bad Request');
    expect(body.message).toBeDefined();
  });

  it('returns JSON 404 for unknown routes', async () => {
    serverInstance = await createServer({
      dbPath: ':memory:',
      port: 0,
      host: '127.0.0.1',
    });
    const addr = await serverInstance.start();

    const res = await fetch(`${addr}/api/v1/non-existent-route-xyz`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body).toEqual({
      error: 'Not Found',
      message: 'Route GET /api/v1/non-existent-route-xyz not found',
    });
  });

  it('returns clean tool errors for invalid MCP tool arguments', async () => {
    serverInstance = await createServer({
      dbPath: ':memory:',
      port: 0,
      host: '127.0.0.1',
    });
    const addr = await serverInstance.start();

    const transport = new StreamableHTTPClientTransport(new URL(`${addr}/mcp`));
    const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
    await client.connect(transport);

    try {
      // note_add requires title and author; passing missing required fields
      const toolResult = await client.callTool({
        name: 'note_add',
        arguments: {
          title: '',
          author: '',
        },
      });

      expect(toolResult.isError).toBe(true);
      expect((toolResult.content[0] as any).text).toMatch(/Author is required|Title is required/i);

      // Call tool with non-existent item to complete
      const completeResult = await client.callTool({
        name: 'note_complete',
        arguments: {
          id: 'non-existent-id',
          author: 'scotty',
        },
      });
      expect(completeResult.isError).toBe(true);
      expect((completeResult.content[0] as any).text).toMatch(/not found/i);

      // Call tool with invalid argument schema (missing required author on note_complete)
      const invalidSchemaResult = await client.callTool({
        name: 'note_complete',
        arguments: {
          id: 'some-id',
        },
      });
      expect(invalidSchemaResult.isError).toBe(true);
      expect((invalidSchemaResult.content[0] as any).text).toMatch(/Input validation error|Required|Invalid input/i);
    } finally {
      await client.close();
    }
  });
});
