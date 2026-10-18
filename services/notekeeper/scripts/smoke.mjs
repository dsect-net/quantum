#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createServer } from '../dist/server.js';

async function runSmoke() {
  const tempDbPath = path.join(
    os.tmpdir(),
    `notekeeper-smoke-${Date.now()}-${randomUUID()}.db`
  );

  console.log(`[smoke] Starting server with temp db: ${tempDbPath}`);
  const server = await createServer({
    dbPath: tempDbPath,
    port: 0,
    host: '127.0.0.1',
  });

  const serverAddress = await server.start();
  console.log(`[smoke] Server listening at ${serverAddress}`);

  try {
    // 1. Health check
    const healthRes = await fetch(`${serverAddress}/health`);
    if (!healthRes.ok) {
      throw new Error(`Health check failed with HTTP ${healthRes.status}`);
    }
    const health = await healthRes.json();
    console.log('[smoke] Health response:', JSON.stringify(health));
    if (health.status !== 'ok' || health.schema_version !== 2 || health.lists !== 7) {
      throw new Error(`Unexpected health payload: ${JSON.stringify(health)}`);
    }

    // 2. Check 7 lists exist
    const lists = server.service.getAllLists();
    console.log(`[smoke] Seed lists count: ${lists.length}`);
    if (lists.length !== 7) {
      throw new Error(`Expected 7 lists, found ${lists.length}`);
    }

    // 3. MCP list_get tool call
    console.log('[smoke] Connecting MCP client to /mcp...');
    const transport = new StreamableHTTPClientTransport(new URL(`${serverAddress}/mcp`));
    const client = new Client({ name: 'smoke-script', version: '1.0.0' }, { capabilities: {} });
    await client.connect(transport);

    console.log('[smoke] Calling MCP tool list_get for "Ideas & Tasks"...');
    const result = await client.callTool({
      name: 'list_get',
      arguments: { name: 'Ideas & Tasks' },
    });

    if (result.isError) {
      throw new Error(`MCP tool call returned error: ${JSON.stringify(result)}`);
    }

    const payload = JSON.parse(result.content[0].text);
    console.log('[smoke] MCP tool result:', JSON.stringify(payload));

    if (!payload.list || !payload.counts) {
      throw new Error(`Invalid shape returned: missing list or counts`);
    }
    if (payload.list.name !== 'Ideas & Tasks') {
      throw new Error(`Expected list name 'Ideas & Tasks', got ${payload.list.name}`);
    }
    if (payload.counts.open !== 0 || payload.counts.total !== 0) {
      throw new Error(`Expected 0 counts on fresh DB, got ${JSON.stringify(payload.counts)}`);
    }

    await client.close();
    console.log('[smoke] Smoke check passed successfully!');
  } finally {
    await server.close();
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
  }
}

runSmoke().catch((err) => {
  console.error('[smoke] Smoke test failed:', err);
  process.exit(1);
});
