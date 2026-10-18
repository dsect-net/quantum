/**
 * Smoke test — boots a fresh service on an ephemeral port with a temp DB and
 * walks the happy paths over real HTTP + MCP (run after `npm run build`).
 * Exits non-zero on any failure. Usage: npm run smoke
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(os.tmpdir(), `singularity-smoke-${randomUUID()}.db`);
const PORT = 18792;

function fail(msg) {
  console.error(`SMOKE FAIL: ${msg}`);
  process.exit(1);
}

async function main() {
  const server = spawn(
    process.execPath,
    [path.join(__dirname, '..', 'dist', 'server.js')],
    {
      env: { ...process.env, SINGULARITY_DB: dbPath, PORT: String(PORT), HOST: '127.0.0.1' },
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );
  const base = `http://127.0.0.1:${PORT}`;

  // Wait for /health.
  let healthy = false;
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) {
        healthy = true;
        break;
      }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!healthy) {
    server.kill();
    fail('server never became healthy');
  }

  const json = async (route, options = {}) => {
    const res = await fetch(`${base}${route}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    });
    return { status: res.status, body: await res.json() };
  };

  const health = await json('/health');
  if (health.status !== 200 || health.body.status !== 'ok') fail(`health: ${JSON.stringify(health)}`);

  const feed = await json('/api/v1/feed');
  if (feed.status !== 200 || !Array.isArray(feed.body.posts)) fail('feed');

  const post = await json('/api/v1/posts', {
    method: 'POST',
    body: JSON.stringify({ body: 'Smoke post citing [[mem:482]]' }),
  });
  if (post.status !== 201 || !post.body.id) fail(`post create: ${JSON.stringify(post)}`);
  if (post.body.memories?.[0]?.memory?.id !== '482') fail('memory ref did not resolve');

  const comment = await json(`/api/v1/posts/${post.body.id}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body: 'smoke comment' }),
  });
  if (comment.status !== 201) fail('comment');

  const react = await json(`/api/v1/posts/${post.body.id}/reactions`, {
    method: 'POST',
    body: JSON.stringify({ kind: '+1' }),
  });
  if (react.status !== 200 || react.body.counts['+1'] !== 1) fail('reaction');

  const selftest = await json('/api/v1/dev/selftest');
  if (selftest.status !== 200 || !selftest.body.ok) fail(`selftest: ${JSON.stringify(selftest)}`);

  // MCP: initialize + tools/list over streamable HTTP.
  const mcpInit = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'smoke', version: '1.0.0' },
      },
    }),
  });
  if (mcpInit.status !== 200) fail(`mcp initialize: HTTP ${mcpInit.status}`);
  const sessionId = mcpInit.headers.get('mcp-session-id');

  await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });

  const toolsRes = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  });
  const toolsBody = await toolsRes.text();
  if (!toolsBody.includes('singularity_post_create') || !toolsBody.includes('singularity_browse')) {
    fail(`mcp tools/list missing tools: ${toolsBody.slice(0, 200)}`);
  }

  server.kill('SIGTERM');
  for (const ext of ['', '-wal', '-shm']) {
    const f = `${dbPath}${ext}`;
    if (fs.existsSync(f)) fs.rmSync(f, { force: true });
  }
  console.log('SMOKE OK — health, feed, post+memory ref, comment, reaction, selftest, MCP tools');
  process.exit(0);
}

main().catch((err) => fail(err?.stack ?? String(err)));
