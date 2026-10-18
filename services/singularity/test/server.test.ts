/**
 * Server tests — health, developer-mode endpoints, open-mode actor
 * attribution (docs/MEMORY.md — developer mode is a settings toggle).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type ServerInstance } from '../src/server.js';
import { MCP_TOOL_NAMES } from '../src/rest.js';

describe('Singularity server', () => {
  let serverInstance: ServerInstance | null = null;

  afterEach(async () => {
    if (serverInstance) {
      await serverInstance.close();
      serverInstance = null;
    }
  });

  it('GET /health reports status, schema_version, and counts', async () => {
    serverInstance = await createServer({ dbPath: ':memory:', port: 0, host: '127.0.0.1' });
    const addr = await serverInstance.start();

    const res = await fetch(`${addr}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe('ok');
    expect(body.schema_version).toBeGreaterThanOrEqual(1);
    expect(body.users).toBe(3); // seeded scotty + cooper + qubit
    expect(body.posts).toBeGreaterThanOrEqual(2);
    expect(body.memory_source).toBe('snapshot');
  });

  it('developer endpoints return stats, selftest, audit trail, and the MCP catalog', async () => {
    serverInstance = await createServer({ dbPath: ':memory:', port: 0, host: '127.0.0.1' });
    const addr = await serverInstance.start();

    const stats = await (await fetch(`${addr}/api/v1/dev/stats`)).json();
    expect(stats.users.agents).toBe(2);
    expect(stats.memories.snapshot).toBeGreaterThan(0);

    const selftest = (await (await fetch(`${addr}/api/v1/dev/selftest`)).json()) as {
      ok: boolean;
      checks: { name: string; ok: boolean }[];
    };
    expect(selftest.ok).toBe(true);
    expect(selftest.checks.length).toBeGreaterThanOrEqual(4);

    const audit = (await (await fetch(`${addr}/api/v1/dev/audit`)).json()) as { action: string }[];
    expect(audit.some((e) => e.action === 'seed.complete')).toBe(true);

    const tools = (await (await fetch(`${addr}/api/v1/dev/mcp-tools`)).json()) as { tools: string[] };
    expect(tools.tools).toEqual([...MCP_TOOL_NAMES]);
  });

  it('open mode attributes mutations via X-DSECT-Actor', async () => {
    serverInstance = await createServer({ dbPath: ':memory:', port: 0, host: '127.0.0.1' });
    const addr = await serverInstance.start();

    const res = await fetch(`${addr}/api/v1/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-DSECT-Actor': 'cooper' },
      body: JSON.stringify({ body: 'posted as cooper' }),
    });
    expect(res.status).toBe(201);
    const post = (await res.json()) as { author: { handle: string } };
    expect(post.author.handle).toBe('cooper');

    // Unknown actor handle is an honest 404.
    const bad = await fetch(`${addr}/api/v1/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-DSECT-Actor': 'ghost' },
      body: JSON.stringify({ body: 'x' }),
    });
    expect(bad.status).toBe(404);
  });

  it('supports empty JSON bodies on POST (agent callers omit fields)', async () => {
    serverInstance = await createServer({ dbPath: ':memory:', port: 0, host: '127.0.0.1' });
    const addr = await serverInstance.start();

    const res = await fetch(`${addr}/api/v1/notifications/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '',
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { read: number }).toHaveProperty('read');
  });
});
