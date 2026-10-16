import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createServer, ServerInstance } from '../src/server.js';

describe('MCP Tools: Complete Item & List Surface', () => {
  const tempDbPath = path.join(
    os.tmpdir(),
    `notekeeper-mcp-test-${Date.now()}-${randomUUID()}.db`
  );
  let serverInstance: ServerInstance;
  let serverAddress = '';
  let mcpClient: Client;

  beforeAll(async () => {
    serverInstance = await createServer({
      dbPath: tempDbPath,
      port: 0,
      host: '127.0.0.1',
    });
    serverAddress = await serverInstance.start();

    const transport = new StreamableHTTPClientTransport(new URL(`${serverAddress}/mcp`));
    mcpClient = new Client({ name: 'mcp-test-suite', version: '1.0.0' }, { capabilities: {} });
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

  it('registers all 11 item and list MCP tools on tools/list', async () => {
    const listResult = await mcpClient.listTools();
    const toolNames = listResult.tools.map((t) => t.name);

    expect(toolNames).toContain('note_add');
    expect(toolNames).toContain('note_get');
    expect(toolNames).toContain('note_update');
    expect(toolNames).toContain('note_delete');
    expect(toolNames).toContain('note_restore');
    expect(toolNames).toContain('note_complete');
    expect(toolNames).toContain('note_reopen');
    expect(toolNames).toContain('list_create');
    expect(toolNames).toContain('list_get');
    expect(toolNames).toContain('list_items');
    expect(toolNames).toContain('list_move_item');
  });

  it('performs full item lifecycle over MCP: add -> get -> update -> complete -> reopen -> delete -> restore', async () => {
    // 1. note_add
    const addRes = await mcpClient.callTool({
      name: 'note_add',
      arguments: {
        title: 'Quantum MCP Engine',
        body: 'Build streamable tools',
        type: 'task',
        priority: 1,
        author: 'cooper',
        tags: ['MCP', 'Engine', 'mcp'],
        list: 'Quantum',
      },
    });

    expect(addRes.isError).toBeFalsy();
    const addPayload = JSON.parse((addRes.content[0] as any).text);
    expect(addPayload.id).toBeDefined();
    expect(addPayload.item.title).toBe('Quantum MCP Engine');
    expect(addPayload.item.tags).toEqual(['engine', 'mcp']);
    expect(addPayload.item.embedding_status).toBe('pending');
    const itemId = addPayload.id;

    // 2. note_get with include_revisions: true
    const getRes = await mcpClient.callTool({
      name: 'note_get',
      arguments: {
        id: itemId,
        include_revisions: true,
      },
    });
    expect(getRes.isError).toBeFalsy();
    const getPayload = JSON.parse((getRes.content[0] as any).text);
    expect(getPayload.id).toBe(itemId);
    expect(getPayload.revisions).toHaveLength(1);
    expect(getPayload.revisions[0].kind).toBe('create');

    // 3. note_update
    const updateRes = await mcpClient.callTool({
      name: 'note_update',
      arguments: {
        id: itemId,
        author: 'scotty',
        title: 'Quantum MCP Engine v2',
        body: 'Updated description',
        priority: 2,
        tags: ['engine', 'v2'],
      },
    });
    expect(updateRes.isError).toBeFalsy();
    const updatePayload = JSON.parse((updateRes.content[0] as any).text);
    expect(updatePayload.title).toBe('Quantum MCP Engine v2');
    expect(updatePayload.tags).toEqual(['engine', 'v2']);

    // 4. note_complete
    const completeRes = await mcpClient.callTool({
      name: 'note_complete',
      arguments: {
        id: itemId,
        author: 'cooper',
      },
    });
    expect(completeRes.isError).toBeFalsy();
    const completePayload = JSON.parse((completeRes.content[0] as any).text);
    expect(completePayload.status).toBe('done');
    expect(completePayload.completed_at).toBeDefined();

    // 5. note_reopen
    const reopenRes = await mcpClient.callTool({
      name: 'note_reopen',
      arguments: {
        id: itemId,
        author: 'scotty',
      },
    });
    expect(reopenRes.isError).toBeFalsy();
    const reopenPayload = JSON.parse((reopenRes.content[0] as any).text);
    expect(reopenPayload.status).toBe('open');
    expect(reopenPayload.completed_at).toBeNull();

    // 6. note_delete (soft delete)
    const deleteRes = await mcpClient.callTool({
      name: 'note_delete',
      arguments: {
        id: itemId,
        author: 'scotty',
      },
    });
    expect(deleteRes.isError).toBeFalsy();
    const deletePayload = JSON.parse((deleteRes.content[0] as any).text);
    expect(deletePayload.deleted_at).toBeDefined();

    // note_get on deleted item returns error
    const getDeletedRes = await mcpClient.callTool({
      name: 'note_get',
      arguments: { id: itemId },
    });
    expect(getDeletedRes.isError).toBe(true);
    expect((getDeletedRes.content[0] as any).text).toMatch(/Item is deleted/i);

    // 7. note_restore
    const restoreRes = await mcpClient.callTool({
      name: 'note_restore',
      arguments: {
        id: itemId,
        author: 'scotty',
      },
    });
    expect(restoreRes.isError).toBeFalsy();
    const restorePayload = JSON.parse((restoreRes.content[0] as any).text);
    expect(restorePayload.deleted_at).toBeNull();

    // Verify note_get works again and has complete revision chain
    const getRestoredRes = await mcpClient.callTool({
      name: 'note_get',
      arguments: { id: itemId, include_revisions: true },
    });
    const finalPayload = JSON.parse((getRestoredRes.content[0] as any).text);
    expect(finalPayload.revisions).toHaveLength(6);
    const kinds = finalPayload.revisions.map((r: any) => r.kind);
    expect(kinds).toEqual(['restore', 'delete', 'reopen', 'complete', 'edit', 'create']);
  });

  it('rejects completing or reopening a note type item with a clear human-readable error', async () => {
    const addRes = await mcpClient.callTool({
      name: 'note_add',
      arguments: {
        title: 'Meeting Notes',
        type: 'note',
        author: 'cooper',
      },
    });
    const { id } = JSON.parse((addRes.content[0] as any).text);

    const compRes = await mcpClient.callTool({
      name: 'note_complete',
      arguments: { id, author: 'cooper' },
    });
    expect(compRes.isError).toBe(true);
    expect((compRes.content[0] as any).text).toMatch(/Cannot complete item of type 'note'/i);

    const reopenRes = await mcpClient.callTool({
      name: 'note_reopen',
      arguments: { id, author: 'cooper' },
    });
    expect(reopenRes.isError).toBe(true);
    expect((reopenRes.content[0] as any).text).toMatch(/Cannot reopen item of type 'note'/i);
  });

  it('supports list_create, list_move_item, and list_items with filtering and pagination', async () => {
    // 1. list_create
    const createListRes = await mcpClient.callTool({
      name: 'list_create',
      arguments: {
        name: 'Project Alpha',
        category: 'projects',
      },
    });
    expect(createListRes.isError).toBeFalsy();
    const newList = JSON.parse((createListRes.content[0] as any).text);
    expect(newList.name).toBe('Project Alpha');

    // 2. Add 3 items to Project Alpha
    for (let i = 1; i <= 3; i++) {
      await mcpClient.callTool({
        name: 'note_add',
        arguments: {
          title: `Alpha Item ${i}`,
          author: 'cooper',
          list: 'Project Alpha',
          type: i === 1 ? 'task' : 'note',
        },
      });
    }

    // 3. list_items
    const listItemsRes = await mcpClient.callTool({
      name: 'list_items',
      arguments: {
        list: 'Project Alpha',
        limit: 10,
      },
    });
    expect(listItemsRes.isError).toBeFalsy();
    const listItemsPayload = JSON.parse((listItemsRes.content[0] as any).text);
    expect(listItemsPayload.total).toBe(3);
    expect(listItemsPayload.items).toHaveLength(3);

    // 4. list_move_item to Quantum
    const itemToMove = listItemsPayload.items[0];
    const moveRes = await mcpClient.callTool({
      name: 'list_move_item',
      arguments: {
        item_id: itemToMove.id,
        to_list: 'Quantum',
        author: 'scotty',
      },
    });
    expect(moveRes.isError).toBeFalsy();
    const movedItem = JSON.parse((moveRes.content[0] as any).text);

    // Check Project Alpha count decreased to 2
    const afterMoveRes = await mcpClient.callTool({
      name: 'list_items',
      arguments: { list: 'Project Alpha' },
    });
    const afterMovePayload = JSON.parse((afterMoveRes.content[0] as any).text);
    expect(afterMovePayload.total).toBe(2);

    // Check list_get counts reflect changes
    const alphaCountsRes = await mcpClient.callTool({
      name: 'list_get',
      arguments: { name: 'Project Alpha' },
    });
    const alphaCounts = JSON.parse((alphaCountsRes.content[0] as any).text);
    expect(alphaCounts.counts.total).toBe(2);
  });
});
