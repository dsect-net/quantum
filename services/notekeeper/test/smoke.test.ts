import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createServer, ServerInstance } from '../src/server.js';
import { ListGetResult } from '../src/types.js';

describe('Smoke Test: End-to-End Server & MCP', () => {
  const tempDbPath = path.join(
    os.tmpdir(),
    `notekeeper-smoke-${Date.now()}-${randomUUID()}.db`
  );
  let serverInstance: ServerInstance | null = null;
  let serverAddress = '';

  afterAll(async () => {
    if (serverInstance) {
      await serverInstance.close();
    }
    // Clean up temporary database files
    for (const ext of ['', '-wal', '-shm']) {
      const file = `${tempDbPath}${ext}`;
      if (fs.existsSync(file)) {
        try {
          fs.unlinkSync(file);
        } catch {
          // ignore cleanup errors
        }
      }
    }
  });

  it('boots server on throwaway temp DB, checks /health and 7 seed lists, and executes MCP list_get', async () => {
    // 1. Boot server on throwaway temp DB with port 0 (ephemeral)
    serverInstance = await createServer({
      dbPath: tempDbPath,
      port: 0,
      host: '127.0.0.1',
    });
    serverAddress = await serverInstance.start();
    expect(serverAddress).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    // 2. Assert /health returns OK with schema_version and lists count
    const healthRes = await fetch(`${serverAddress}/health`);
    expect(healthRes.status).toBe(200);
    const healthJson = await healthRes.json();
    expect(healthJson).toEqual({
      status: 'ok',
      schema_version: 2,
      lists: 7,
    });

    // 3. Assert the 7 seed lists exist
    const allLists = serverInstance.service.getAllLists();
    expect(allLists).toHaveLength(7);
    const seedNames = allLists.map((l) => l.name);
    expect(seedNames).toContain('Ideas & Tasks');
    expect(seedNames).toContain('Quantum');
    expect(seedNames).toContain('Mental Health');
    expect(seedNames).toContain('Creative');
    expect(seedNames).toContain('Business');
    expect(seedNames).toContain('Home & Family');
    expect(seedNames).toContain('Finance');

    // 4. Connect real MCP client from SDK to /mcp via StreamableHTTPClientTransport
    const mcpClientTransport = new StreamableHTTPClientTransport(
      new URL(`${serverAddress}/mcp`)
    );
    const mcpClient = new Client(
      { name: 'smoke-test-client', version: '1.0.0' },
      { capabilities: {} }
    );
    await mcpClient.connect(mcpClientTransport);

    // 5. Call MCP list_get tool for "Ideas & Tasks"
    const toolResult = await mcpClient.callTool({
      name: 'list_get',
      arguments: { name: 'Ideas & Tasks' },
    });

    expect(toolResult).toBeDefined();
    expect(toolResult.isError).toBeFalsy();
    expect(Array.isArray(toolResult.content)).toBe(true);
    expect(toolResult.content.length).toBeGreaterThan(0);

    const firstContent = toolResult.content[0] as { type: string; text: string };
    expect(firstContent.type).toBe('text');

    const parsed: ListGetResult = JSON.parse(firstContent.text);
    // 6. Assert shape ({ list, counts })
    expect(parsed).toHaveProperty('list');
    expect(parsed).toHaveProperty('counts');

    expect(parsed.list.name).toBe('Ideas & Tasks');
    expect(parsed.list.category).toBe('inbox');
    expect(parsed.list.private).toBe(0);
    expect(parsed.list.sync_excluded).toBe(0);

    expect(parsed.counts).toEqual({
      open: 0,
      done: 0,
      archived: 0,
      total: 0,
    });

    // Cleanly close client
    await mcpClient.close();
  });
});
