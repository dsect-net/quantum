import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createServer, ServerInstance } from '../src/server.js';

describe('Contract Tests: MCP and REST Parity & HTTP Semantics', () => {
  const tempDbPath = path.join(
    os.tmpdir(),
    `notekeeper-contract-${Date.now()}-${randomUUID()}.db`
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

  // Helper for REST calls
  async function rest(path: string, options: RequestInit = {}) {
    const res = await fetch(`${serverAddress}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      // not json
    }
    return { status: res.status, ok: res.ok, data };
  }

  it('add/create: MCP and REST produce identical item shape', async () => {
    // 1. Add via MCP
    const mcpRes = await mcpClient.callTool({
      name: 'note_add',
      arguments: {
        title: 'MCP Parity Item',
        body: 'Testing parity body',
        type: 'task',
        priority: 2,
        author: 'cooper',
        tags: ['Parity', 'Test'],
      },
    });
    expect(mcpRes.isError).toBeFalsy();
    const mcpPayload = JSON.parse((mcpRes.content[0] as any).text);

    // 2. Add via REST
    const restRes = await rest('/api/v1/items', {
      method: 'POST',
      body: JSON.stringify({
        title: 'REST Parity Item',
        body: 'Testing parity body',
        type: 'task',
        priority: 2,
        author: 'cooper',
        tags: ['Parity', 'Test'],
      }),
    });
    expect(restRes.status).toBe(201);
    const restPayload = restRes.data;

    // Verify envelope matches: { id, item }
    expect(Object.keys(mcpPayload).sort()).toEqual(['id', 'item']);
    expect(Object.keys(restPayload).sort()).toEqual(['id', 'item']);

    // Verify item keys match 1:1
    const mcpItemKeys = Object.keys(mcpPayload.item).sort();
    const restItemKeys = Object.keys(restPayload.item).sort();
    expect(restItemKeys).toEqual(mcpItemKeys);

    expect(restPayload.item.tags).toEqual(mcpPayload.item.tags);
    expect(restPayload.item.priority).toBe(mcpPayload.item.priority);
    expect(restPayload.item.type).toBe(mcpPayload.item.type);
    expect(restPayload.item.status).toBe(mcpPayload.item.status);
    expect(restPayload.item.embedding_status).toBe(mcpPayload.item.embedding_status);
  });

  it('get: MCP note_get and REST GET /items/:id return identical item shape and revisions', async () => {
    const postRes = await rest('/api/v1/items', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Item to inspect',
        body: 'Markdown details',
        type: 'todo',
        author: 'scotty',
      }),
    });
    const itemId = postRes.data.id;

    // GET via MCP
    const mcpGet = await mcpClient.callTool({
      name: 'note_get',
      arguments: { id: itemId, include_revisions: true },
    });
    const mcpItem = JSON.parse((mcpGet.content[0] as any).text);

    // GET via REST
    const restGet = await rest(`/api/v1/items/${itemId}?include_revisions=true`);
    expect(restGet.status).toBe(200);
    const restItem = restGet.data;

    expect(restItem).toEqual(mcpItem);
  });

  it('complete and reopen: parity between MCP and REST', async () => {
    // Create task
    const postRes = await rest('/api/v1/items', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Toggle Task',
        type: 'task',
        author: 'scotty',
      }),
    });
    const itemId = postRes.data.id;

    // Complete via REST
    const restComplete = await rest(`/api/v1/items/${itemId}/complete`, { method: 'POST' });
    expect(restComplete.status).toBe(200);
    expect(restComplete.data.status).toBe('done');
    expect(restComplete.data.completed_at).toBeDefined();

    // Reopen via MCP
    const mcpReopen = await mcpClient.callTool({
      name: 'note_reopen',
      arguments: { id: itemId, author: 'cooper' },
    });
    const mcpReopenData = JSON.parse((mcpReopen.content[0] as any).text);
    expect(mcpReopenData.status).toBe('open');
    expect(mcpReopenData.completed_at).toBeNull();

    // Complete via MCP
    const mcpComplete = await mcpClient.callTool({
      name: 'note_complete',
      arguments: { id: itemId, author: 'cooper' },
    });
    const mcpCompleteData = JSON.parse((mcpComplete.content[0] as any).text);
    expect(mcpCompleteData.status).toBe('done');

    // Reopen via REST
    const restReopen = await rest(`/api/v1/items/${itemId}/reopen`, { method: 'POST' });
    expect(restReopen.status).toBe(200);
    expect(restReopen.data.status).toBe('open');
    expect(restReopen.data.completed_at).toBeNull();
  });

  it('delete and restore: parity between MCP and REST', async () => {
    const postRes = await rest('/api/v1/items', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Trash Me',
        type: 'note',
      }),
    });
    const itemId = postRes.data.id;

    // Delete via REST
    const restDel = await rest(`/api/v1/items/${itemId}`, { method: 'DELETE' });
    expect(restDel.status).toBe(200);
    expect(restDel.data.id).toBe(itemId);
    expect(restDel.data.deleted_at).toBeDefined();

    // GET on deleted fails with 404 on REST and error on MCP
    const restGetDel = await rest(`/api/v1/items/${itemId}`);
    expect(restGetDel.status).toBe(404);

    const mcpGetDel = await mcpClient.callTool({
      name: 'note_get',
      arguments: { id: itemId },
    });
    expect(mcpGetDel.isError).toBe(true);

    // Restore via REST
    const restRestore = await rest(`/api/v1/items/${itemId}/restore`, { method: 'POST' });
    expect(restRestore.status).toBe(200);
    expect(restRestore.data.deleted_at).toBeNull();

    // Delete via MCP
    const mcpDel = await mcpClient.callTool({
      name: 'note_delete',
      arguments: { id: itemId, author: 'cooper' },
    });
    const mcpDelData = JSON.parse((mcpDel.content[0] as any).text);
    expect(mcpDelData.deleted_at).toBeDefined();

    // Restore via MCP
    const mcpRestore = await mcpClient.callTool({
      name: 'note_restore',
      arguments: { id: itemId, author: 'cooper' },
    });
    const mcpRestoreData = JSON.parse((mcpRestore.content[0] as any).text);
    expect(mcpRestoreData.deleted_at).toBeNull();
  });

  it('move: parity between MCP and REST', async () => {
    const postRes = await rest('/api/v1/items', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Move Me',
        type: 'note',
        list: 'Ideas & Tasks',
      }),
    });
    const itemId = postRes.data.id;

    // Move via REST to Quantum
    const restMove = await rest(`/api/v1/items/${itemId}/move`, {
      method: 'POST',
      body: JSON.stringify({ to_list: 'Quantum' }),
    });
    expect(restMove.status).toBe(200);
    const quantumList = (await rest('/api/v1/lists/Quantum')).data.list;
    expect(restMove.data.list_id).toBe(quantumList.id);

    // Move via MCP back to Creative
    const mcpMove = await mcpClient.callTool({
      name: 'list_move_item',
      arguments: { item_id: itemId, to_list: 'Creative', author: 'scotty' },
    });
    const mcpMoveData = JSON.parse((mcpMove.content[0] as any).text);
    const creativeList = (await rest('/api/v1/lists/Creative')).data.list;
    expect(mcpMoveData.list_id).toBe(creativeList.id);
  });

  it('search: parity between MCP note_search and REST GET /search', async () => {
    await rest('/api/v1/items', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Telemetry Analytics Engine',
        body: 'Distributed tracing design',
        author: 'scotty',
      }),
    });

    // REST search
    const restSearch = await rest('/api/v1/search?q=Telemetry');
    expect(restSearch.status).toBe(200);
    expect(typeof restSearch.data.degraded).toBe('boolean');
    expect(restSearch.data.results.length).toBeGreaterThanOrEqual(1);

    // MCP search
    const mcpSearch = await mcpClient.callTool({
      name: 'note_search',
      arguments: { query: 'Telemetry' },
    });
    const mcpSearchData = JSON.parse((mcpSearch.content[0] as any).text);
    expect(mcpSearchData.degraded).toBe(restSearch.data.degraded);
    expect(mcpSearchData.results.length).toBeGreaterThanOrEqual(1);

    // Verify result shapes match
    const restResult0 = restSearch.data.results[0];
    const mcpResult0 = mcpSearchData.results[0];
    expect(restResult0.match).toBe(mcpResult0.match);
    expect(Object.keys(restResult0.item).sort()).toEqual(Object.keys(mcpResult0.item).sort());
  });

  it('lists: GET /api/v1/lists returns active lists with open_count', async () => {
    const res = await rest('/api/v1/lists');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data)).toBe(true);
    expect(res.data.length).toBeGreaterThanOrEqual(7);

    const inbox = res.data.find((l: any) => l.name === 'Ideas & Tasks');
    expect(inbox).toBeDefined();
    expect(inbox.open_count).toBeDefined();
    expect(inbox.counts).toBeDefined();
    expect(inbox.counts.open).toBe(inbox.open_count);
  });

  it('author default: REST mutations default author to "scotty" when omitted', async () => {
    const postRes = await rest('/api/v1/items', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Author Default Note',
      }),
    });
    expect(postRes.status).toBe(201);
    expect(postRes.data.item.author).toBe('scotty');

    const updateRes = await rest(`/api/v1/items/${postRes.data.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        title: 'Author Default Updated',
      }),
    });
    expect(updateRes.status).toBe(200);
    expect(updateRes.data.author).toBe('scotty');
  });

  it('autosave: PATCH /api/v1/items/:id with autosave: true passes coalesce mode', async () => {
    const postRes = await rest('/api/v1/items', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Autosave Note',
        body: 'Initial paragraph',
        author: 'scotty',
      }),
    });
    const itemId = postRes.data.id;

    // Normal patch -> revision 2
    await rest(`/api/v1/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify({ body: 'Paragraph 1' }),
    });

    let getRes = await rest(`/api/v1/items/${itemId}?include_revisions=true`);
    expect(getRes.data.revisions).toHaveLength(2);

    // Autosave patch -> coalesces into revision 2, count remains 2
    await rest(`/api/v1/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify({ body: 'Paragraph 1 + 2', autosave: true }),
    });

    getRes = await rest(`/api/v1/items/${itemId}?include_revisions=true`);
    expect(getRes.data.revisions).toHaveLength(2); // Coalesced!
  });

  it('HTTP error semantics: 400 for bad input, 404 for missing/deleted', async () => {
    // 400: missing title
    const badAdd = await rest('/api/v1/items', {
      method: 'POST',
      body: JSON.stringify({ body: 'no title' }),
    });
    expect(badAdd.status).toBe(400);
    expect(badAdd.data.error).toBeDefined();

    // 400: complete a note
    const note = (await rest('/api/v1/items', { method: 'POST', body: JSON.stringify({ title: 'N', type: 'note' }) })).data.id;
    const badComplete = await rest(`/api/v1/items/${note}/complete`, { method: 'POST' });
    expect(badComplete.status).toBe(400);
    expect(badComplete.data.error).toMatch(/Cannot complete item of type 'note'/i);

    // 404: nonexistent item
    const missing = await rest('/api/v1/items/00000000-0000-0000-0000-000000000000');
    expect(missing.status).toBe(404);
    expect(missing.data.error).toBeDefined();

    // 404: nonexistent list
    const missingList = await rest('/api/v1/lists/nonexistent-list-id');
    expect(missingList.status).toBe(404);
  });

  it('links: MCP and REST parity for internal/external links, backlinks, duplicates, and deleted ends', async () => {
    // 1. Setup items
    const aRes = await rest('/api/v1/items', {
      method: 'POST',
      body: JSON.stringify({ title: 'Alpha Note', author: 'scotty' }),
    });
    const itemAId = aRes.data.id;

    const bRes = await rest('/api/v1/items', {
      method: 'POST',
      body: JSON.stringify({ title: 'Beta Task', type: 'task', author: 'scotty' }),
    });
    const itemBId = bRes.data.id;

    // 2. Create internal link via MCP: A -> B ('blocks')
    const mcpLinkCall = await mcpClient.callTool({
      name: 'note_link',
      arguments: {
        from_item_id: itemAId,
        to_item_id: itemBId,
        relation: 'blocks',
        author: 'cooper',
      },
    });
    expect(mcpLinkCall.isError).toBeFalsy();
    const mcpLinkData = JSON.parse((mcpLinkCall.content[0] as any).text);

    // Read back via REST GET /items/:id/links
    const restLinksARes = await rest(`/api/v1/items/${itemAId}/links`);
    expect(restLinksARes.status).toBe(200);
    expect(restLinksARes.data.outgoing).toHaveLength(1);
    const restOut = restLinksARes.data.outgoing[0];
    expect(restOut.id).toBe(mcpLinkData.id);
    expect(restOut.from_item_id).toBe(itemAId);
    expect(restOut.to_item_id).toBe(itemBId);
    expect(restOut.relation).toBe('blocks');
    expect(restOut.target.title).toBe('Beta Task');
    expect(restOut.target.type).toBe('task');
    expect(restOut.target.deleted).toBe(false);

    // Check backlinks on target B via REST
    const restLinksBRes = await rest(`/api/v1/items/${itemBId}/links`);
    expect(restLinksBRes.status).toBe(200);
    expect(restLinksBRes.data.incoming).toHaveLength(1);
    const restIn = restLinksBRes.data.incoming[0];
    expect(restIn.id).toBe(mcpLinkData.id);
    expect(restIn.source.id).toBe(itemAId);
    expect(restIn.source.title).toBe('Alpha Note');
    expect(restIn.source.deleted).toBe(false);

    // 3. Create internal link via REST: B -> A ('spawned') (tests author defaulting to 'scotty')
    const restCreateLinkRes = await rest(`/api/v1/items/${itemBId}/links`, {
      method: 'POST',
      body: JSON.stringify({
        to_item_id: itemAId,
        relation: 'spawned',
      }),
    });
    expect(restCreateLinkRes.status).toBe(201);
    const restCreatedLink = restCreateLinkRes.data;
    expect(restCreatedLink.from_item_id).toBe(itemBId);
    expect(restCreatedLink.to_item_id).toBe(itemAId);
    expect(restCreatedLink.relation).toBe('spawned');

    // Read back via MCP note_links on itemA
    const mcpLinksACall = await mcpClient.callTool({
      name: 'note_links',
      arguments: { item_id: itemAId },
    });
    expect(mcpLinksACall.isError).toBeFalsy();
    const mcpLinksA = JSON.parse((mcpLinksACall.content[0] as any).text);
    expect(mcpLinksA.incoming).toHaveLength(1);
    expect(mcpLinksA.incoming[0].id).toBe(restCreatedLink.id);
    expect(mcpLinksA.incoming[0].source.title).toBe('Beta Task');

    // 4. External link via MCP: A -> external URL
    const mcpExtCall = await mcpClient.callTool({
      name: 'note_link',
      arguments: {
        from_item_id: itemAId,
        external_url: 'https://github.com/dsect-net/quantum/pull/99',
        relation: 'reference',
        author: 'cooper',
      },
    });
    expect(mcpExtCall.isError).toBeFalsy();
    const mcpExtData = JSON.parse((mcpExtCall.content[0] as any).text);

    // Read back via REST
    const restLinksA2 = await rest(`/api/v1/items/${itemAId}/links`);
    const extMatch = restLinksA2.data.outgoing.find((l: any) => l.id === mcpExtData.id);
    expect(extMatch).toBeDefined();
    expect(extMatch.external_url).toBe('https://github.com/dsect-net/quantum/pull/99');
    expect(extMatch.relation).toBe('reference');
    expect(extMatch.target).toBeNull();

    // 5. External link via REST: B -> external URL
    const restExtPost = await rest(`/api/v1/items/${itemBId}/links`, {
      method: 'POST',
      body: JSON.stringify({
        external_url: 'https://notion.so/architecture',
        relation: 'related',
      }),
    });
    expect(restExtPost.status).toBe(201);

    // Read back via MCP
    const mcpLinksBCall = await mcpClient.callTool({
      name: 'note_links',
      arguments: { item_id: itemBId },
    });
    const mcpLinksB = JSON.parse((mcpLinksBCall.content[0] as any).text);
    const mcpExtMatch = mcpLinksB.outgoing.find((l: any) => l.id === restExtPost.data.id);
    expect(mcpExtMatch).toBeDefined();
    expect(mcpExtMatch.external_url).toBe('https://notion.so/architecture');

    // 6. Duplicate link returns existing row (REST and MCP)
    const dupRest = await rest(`/api/v1/items/${itemBId}/links`, {
      method: 'POST',
      body: JSON.stringify({
        to_item_id: itemAId,
        relation: 'spawned',
      }),
    });
    expect(dupRest.status).toBe(201);
    expect(dupRest.data.id).toBe(restCreatedLink.id);

    // 7. Validation errors
    // Both targets
    const badBoth = await rest(`/api/v1/items/${itemAId}/links`, {
      method: 'POST',
      body: JSON.stringify({
        to_item_id: itemBId,
        external_url: 'https://example.com',
        relation: 'related',
      }),
    });
    expect(badBoth.status).toBe(400);

    // Neither target
    const badNeither = await rest(`/api/v1/items/${itemAId}/links`, {
      method: 'POST',
      body: JSON.stringify({ relation: 'related' }),
    });
    expect(badNeither.status).toBe(400);

    // Bad relation
    const badRel = await rest(`/api/v1/items/${itemAId}/links`, {
      method: 'POST',
      body: JSON.stringify({ to_item_id: itemBId, relation: 'loves' }),
    });
    expect(badRel.status).toBe(400);

    // 8. Soft-deleted item validation & deleted-other-end marking
    // Soft delete itemB
    await rest(`/api/v1/items/${itemBId}`, { method: 'DELETE' });

    // Creating link to deleted item is error
    const linkToDeleted = await rest(`/api/v1/items/${itemAId}/links`, {
      method: 'POST',
      body: JSON.stringify({ to_item_id: itemBId, relation: 'related' }),
    });
    expect(linkToDeleted.status).toBe(400);

    // Creating link from deleted item is error (404)
    const linkFromDeleted = await rest(`/api/v1/items/${itemBId}/links`, {
      method: 'POST',
      body: JSON.stringify({ to_item_id: itemAId, relation: 'related' }),
    });
    expect(linkFromDeleted.status).toBe(404);

    // note_links on live item A still lists the link to B, with deleted: true
    const linksAfterDelete = await rest(`/api/v1/items/${itemAId}/links`);
    const linkToB = linksAfterDelete.data.outgoing.find((l: any) => l.to_item_id === itemBId);
    expect(linkToB).toBeDefined();
    expect(linkToB.target.deleted).toBe(true);
    expect(linkToB.deleted).toBe(true);
  });

  it('auth: 401 on /api/v1 when NOTEKEEPER_TOKEN is configured and token is missing/invalid', async () => {
    const authServer = await createServer({
      dbPath: ':memory:',
      port: 0,
      host: '127.0.0.1',
      token: 'quantum-secret-key',
    });
    const authAddr = await authServer.start();

    // /health is public
    const health = await fetch(`${authAddr}/health`);
    expect(health.status).toBe(200);

    // /api/v1 without token -> 401
    const unauth = await fetch(`${authAddr}/api/v1/lists`);
    expect(unauth.status).toBe(401);
    const unauthData = await unauth.json();
    expect(unauthData.error).toMatch(/missing Bearer token/i);

    // /api/v1 with wrong token -> 401
    const wrong = await fetch(`${authAddr}/api/v1/lists`, {
      headers: { Authorization: 'Bearer wrong-key' },
    });
    expect(wrong.status).toBe(401);

    // /api/v1 with valid token -> 200
    const authed = await fetch(`${authAddr}/api/v1/lists`, {
      headers: { Authorization: 'Bearer quantum-secret-key' },
    });
    expect(authed.status).toBe(200);

    await authServer.close();
  });
});
