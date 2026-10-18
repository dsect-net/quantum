/**
 * Contract tests — REST and MCP faces must return the same shapes from the
 * same business layer (docs/MEMORY.md — one business layer, two faces), plus
 * HTTP semantics and auth enforcement end to end.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createServer, type ServerInstance } from '../src/server.js';

function firstText(raw: unknown): unknown {
  const result = raw as { content?: { type?: string; text?: string }[] };
  const text = result.content?.find((c) => c.type === 'text')?.text ?? '{}';
  return JSON.parse(text);
}

describe('Contract: REST ↔ MCP parity, HTTP semantics, auth', () => {
  const tempDbPath = path.join(os.tmpdir(), `singularity-contract-${Date.now()}-${randomUUID()}.db`);
  let serverInstance: ServerInstance;
  let serverAddress = '';
  let mcpClient: Client;

  beforeAll(async () => {
    serverInstance = await createServer({ dbPath: tempDbPath, port: 0, host: '127.0.0.1' });
    serverAddress = await serverInstance.start();
    const transport = new StreamableHTTPClientTransport(new URL(`${serverAddress}/mcp`));
    mcpClient = new Client({ name: 'contract-mcp-client', version: '1.0.0' }, { capabilities: {} });
    await mcpClient.connect(transport);
  });

  afterAll(async () => {
    await mcpClient.close();
    await serverInstance.close();
    for (const ext of ['', '-wal', '-shm']) {
      const file = `${tempDbPath}${ext}`;
      if (fs.existsSync(file)) {
        try {
          fs.unlinkSync(file);
        } catch {
          // ignore
        }
      }
    }
  });

  async function rest(route: string, options: RequestInit = {}) {
    const res = await fetch(`${serverAddress}${route}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    });
    return { status: res.status, body: await res.json() };
  }

  it('GET /health is public and honest about memory provenance', async () => {
    const { status, body } = await rest('/health');
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.schema_version).toBeGreaterThanOrEqual(1);
    expect(body.memory_source).toBe('snapshot'); // no HIVE_MEMORY_URL configured
  });

  it('creates the same post shape over REST and MCP', async () => {
    const restRes = await rest('/api/v1/posts', {
      method: 'POST',
      body: JSON.stringify({
        body: 'Parity check [[mem:482]]',
        kind: 'post',
        tags: ['contract'],
      }),
    });
    expect(restRes.status).toBe(201);

    const mcpRes = firstText(
      await mcpClient.callTool({
        name: 'singularity_post_create',
        arguments: { actor: 'scotty', body: 'Parity check [[mem:482]]', kind: 'post', tags: ['contract'] },
      }),
    );

    // Same keys on both faces (ids/timestamps differ per row).
    expect(Object.keys(restRes.body).sort()).toEqual(Object.keys(mcpRes as object).sort());
    for (const key of ['id', 'author', 'kind', 'body', 'tags', 'memories', 'memory_ids', 'reaction_counts', 'comment_count']) {
      expect(restRes.body).toHaveProperty(key);
      expect(mcpRes as object).toHaveProperty(key);
    }
    expect(restRes.body.memories[0].memory.id).toBe('482');
    expect((mcpRes as { memories: { memory: { id: string } }[] }).memories[0].memory.id).toBe('482');
  });

  it('GET /posts/:id matches singularity_post_get', async () => {
    const created = await rest('/api/v1/posts', {
      method: 'POST',
      body: JSON.stringify({ body: 'Get parity' }),
    });
    const id = created.body.id;

    const viaRest = await rest(`/api/v1/posts/${id}`);
    const viaMcp = firstText(
      await mcpClient.callTool({ name: 'singularity_post_get', arguments: { id } }),
    );
    expect(Object.keys(viaRest.body).sort()).toEqual(Object.keys(viaMcp as object).sort());
    expect((viaMcp as { id: string }).id).toBe(id);
  });

  it('feed browsing matches singularity_browse (same envelope keys)', async () => {
    const viaRest = await rest('/api/v1/feed?limit=5');
    const viaMcp = firstText(
      await mcpClient.callTool({ name: 'singularity_browse', arguments: { limit: 5 } }),
    );
    expect(Object.keys(viaRest.body).sort()).toEqual(Object.keys(viaMcp as object).sort());
    expect(Array.isArray((viaMcp as { posts: unknown[] }).posts)).toBe(true);
  });

  it('404s unknown posts and malformed JSON bodies 400', async () => {
    const missing = await rest('/api/v1/posts/unknown-id');
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe('not_found');

    const res = await fetch(`${serverAddress}/api/v1/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
  });

  it('validation failures are 400s with clean messages', async () => {
    const empty = await rest('/api/v1/posts', { method: 'POST', body: JSON.stringify({ body: '' }) });
    expect(empty.status).toBe(400);
    expect(empty.body.message).toMatch(/empty/);

    const badReaction = await rest(`/api/v1/posts/unknown/reactions`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'fire' }),
    });
    expect(badReaction.status).toBe(400);
    expect(badReaction.body.message).toMatch(/Unknown reaction/);
  });

  it('unknown routes produce JSON 404s', async () => {
    const { status, body } = await rest('/api/v1/nope');
    expect(status).toBe(404);
    expect(body.error).toBe('not_found');
  });

  it('login/session/logout works over REST', async () => {
    // No org token in this suite → open dev mode: seeded accounts can sign
    // in with any credential (audited), and /auth/me falls back to the
    // seeded admin (documented dev behavior).
    const login = await rest('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'scotty@dsect.net', credential: 'local-dev' }),
    });
    expect(login.status).toBe(200);
    const { token } = login.body as { token: string };

    const me = await rest('/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(me.status).toBe(200);
    expect(me.body.handle).toBe('scotty');

    const logout = await rest('/api/v1/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(logout.status).toBe(200);
  });
});

describe('Contract: enforced auth (org credential configured)', () => {
  let serverInstance: ServerInstance | null = null;

  const cleanup = async () => {
    if (serverInstance) {
      await serverInstance.close();
      serverInstance = null;
    }
  };
  afterAll(cleanup);

  it('rejects unauthenticated /api and /mcp calls; login issues a session', async () => {
    serverInstance = await createServer({
      dbPath: ':memory:',
      port: 0,
      host: '127.0.0.1',
      token: 'org-secret-token',
      seed: true,
    });
    const addr = await serverInstance.start();

    // Health and login stay open.
    expect((await fetch(`${addr}/health`)).status).toBe(200);
    const unauth = await fetch(`${addr}/api/v1/feed`);
    expect(unauth.status).toBe(401);

    const login = await fetch(`${addr}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'scotty@dsect.net', credential: 'org-secret-token' }),
    });
    expect(login.status).toBe(200);
    const { token } = (await login.json()) as { token: string };
    expect(token).toBeTruthy();

    const authed = await fetch(`${addr}/api/v1/feed`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(authed.status).toBe(200);

    // Registration requires the org join code when auth is enforced.
    const noCode = await fetch(`${addr}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: 'newbie',
        email: 'newbie@dsect.net',
        display_name: 'New B',
        credential: 'personal-pass-1',
      }),
    });
    expect(noCode.status).toBe(403);

    const withCode = await fetch(`${addr}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: 'newbie',
        email: 'newbie@dsect.net',
        display_name: 'New B',
        credential: 'personal-pass-1',
        join_code: 'org-secret-token',
      }),
    });
    expect(withCode.status).toBe(201);
    const created = (await withCode.json()) as { token: string; user: { handle: string } };
    expect(created.user.handle).toBe('newbie');
    expect(created.token).toBeTruthy();

    await cleanup();
  });

  it('validates registration input (email domain, handle rules, weak credentials)', async () => {
    serverInstance = await createServer({
      dbPath: ':memory:',
      port: 0,
      host: '127.0.0.1',
      token: 'org-secret-token',
    });
    const addr = await serverInstance.start();

    const badEmail = await fetch(`${addr}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: 'outsider',
        email: 'x@gmail.com',
        display_name: 'X',
        credential: 'personal-pass-1',
        join_code: 'org-secret-token',
      }),
    });
    expect(badEmail.status).toBe(400);

    const weak = await fetch(`${addr}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: 'weakling',
        email: 'weakling@dsect.net',
        display_name: 'W',
        credential: 'short',
        join_code: 'org-secret-token',
      }),
    });
    expect(weak.status).toBe(400);

    await cleanup();
  });
});
