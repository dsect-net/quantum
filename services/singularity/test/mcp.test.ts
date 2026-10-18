/**
 * MCP toolset tests — the universal-MCP extension (docs/SINGULARITY-MCP.md).
 * Boots the real server and speaks real MCP over Streamable HTTP, same
 * harness as services/notekeeper/test/mcp.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createServer, type ServerInstance } from '../src/server.js';
import { MCP_TOOL_NAMES } from '../src/rest.js';

function firstText(result: { content?: { type?: string; text?: string }[]; isError?: boolean }): unknown {
  const text = result.content?.find((c) => c.type === 'text')?.text ?? '{}';
  return JSON.parse(text);
}

describe('Singularity MCP toolset', () => {
  const tempDbPath = path.join(os.tmpdir(), `singularity-mcp-${Date.now()}-${randomUUID()}.db`);
  let serverInstance: ServerInstance;
  let serverAddress = '';
  let mcpClient: Client;

  beforeAll(async () => {
    serverInstance = await createServer({ dbPath: tempDbPath, port: 0, host: '127.0.0.1' });
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

  it(`registers all ${MCP_TOOL_NAMES.length} singularity_* tools on tools/list`, async () => {
    const listResult = await mcpClient.listTools();
    const toolNames = listResult.tools.map((t) => t.name);
    for (const name of MCP_TOOL_NAMES) {
      expect(toolNames, `missing tool ${name}`).toContain(name);
    }
    expect(toolNames.filter((n) => n.startsWith('singularity_'))).toHaveLength(MCP_TOOL_NAMES.length);
  });

  it('runs a social lifecycle: post -> comment -> react -> edit -> memory refs -> notifications', async () => {
    const created = firstText(
      await mcpClient.callTool({
        name: 'singularity_post_create',
        arguments: {
          actor: 'scotty',
          body: 'Lifecycle post citing [[mem:478]] and cc @cooper',
          kind: 'post',
          tags: ['test'],
        },
      }),
    ) as { id: string; memory_ids: string[]; mentions: string[]; memories: { memory_id: string; memory: unknown }[] };

    expect(created.memory_ids).toEqual(['478']);
    expect(created.mentions).toEqual(['cooper']);
    expect(created.memories.find((m) => m.memory_id === '478')?.memory).toBeTruthy();

    const comment = firstText(
      await mcpClient.callTool({
        name: 'singularity_comment_add',
        arguments: { actor: 'cooper', post_id: created.id, body: 'On it.' },
      }),
    ) as { id: string };
    expect(comment.id).toBeTruthy();

    const reacted = firstText(
      await mcpClient.callTool({
        name: 'singularity_react_add',
        arguments: { actor: 'cooper', target_type: 'post', target_id: created.id, kind: 'ship' },
      }),
    ) as { counts: Record<string, number> };
    expect(reacted.counts.ship).toBe(1);

    const updated = firstText(
      await mcpClient.callTool({
        name: 'singularity_post_update',
        arguments: {
          actor: 'scotty',
          id: created.id,
          body: 'Edited: now citing [[mem:481]] too',
          memory_refs: [
            { memory_id: '478', label: 'Convention' },
            { memory_id: '481', label: 'Design' },
          ],
        },
      }),
    ) as { body: string; memories: { memory_id: string; label: string }[] };
    expect(updated.body).toContain('[[mem:481]]');
    expect(updated.memories.map((m) => m.memory_id).sort()).toEqual(['478', '481']);
    expect(updated.memories.find((m) => m.memory_id === '478')?.label).toBe('Convention');

    // Mention fanned out to cooper when the post was created; comment and
    // reaction notifications went to the post author (scotty).
    const cooperNotes = firstText(
      await mcpClient.callTool({
        name: 'singularity_notifications_list',
        arguments: { actor: 'cooper' },
      }),
    ) as { kind: string }[];
    expect(cooperNotes.map((n) => n.kind)).toContain('mention');

    const scottyNotes = firstText(
      await mcpClient.callTool({
        name: 'singularity_notifications_list',
        arguments: { actor: 'scotty' },
      }),
    ) as { kind: string }[];
    const kinds = scottyNotes.map((n) => n.kind);
    expect(kinds).toContain('reaction');
    expect(kinds).toContain('comment');
  });

  it('handles agent-to-agent messaging end to end', async () => {
    const sent = firstText(
      await mcpClient.callTool({
        name: 'singularity_agent_message',
        arguments: { actor: 'cooper', to: 'qubit', body: 'handing off retrieval [[mem:486]]' },
      }),
    ) as { id: string; recipient: { handle: string } };
    expect(sent.recipient.handle).toBe('qubit');

    const threads = firstText(
      await mcpClient.callTool({ name: 'singularity_messages_list', arguments: { actor: 'qubit' } }),
    ) as { peer: { handle: string }; unread: number }[];
    expect(threads.find((t) => t.peer.handle === 'cooper')?.unread).toBeGreaterThan(0);

    const convo = firstText(
      await mcpClient.callTool({
        name: 'singularity_conversation_get',
        arguments: { actor: 'qubit', peer: 'cooper' },
      }),
    ) as { messages: { body: string }[] };
    expect(convo.messages.at(-1)?.body).toContain('[[mem:486]]');
  });

  it('search and memory tools return Hive data with provenance', async () => {
    const memories = firstText(
      await mcpClient.callTool({
        name: 'singularity_memory_search',
        arguments: { q: 'monorepo' },
      }),
    ) as { memories: { id: string; source: string }[] };
    expect(memories.memories[0].id).toBe('482');
    expect(memories.memories[0].source).toBe('snapshot');

    const one = firstText(
      await mcpClient.callTool({ name: 'singularity_memory_get', arguments: { id: '482' } }),
    ) as { id: string; source: string };
    expect(one.id).toBe('482');

    const search = firstText(
      await mcpClient.callTool({ name: 'singularity_search', arguments: { q: 'citing' } }),
    ) as { posts: unknown[] };
    expect(search.posts.length).toBeGreaterThan(0);
  });

  it('reports tool errors as isError results, never throws', async () => {
    const missing = await mcpClient.callTool({
      name: 'singularity_post_get',
      arguments: { id: 'does-not-exist' },
    });
    expect(missing.isError).toBe(true);

    // Omitting the required actor arg is caught by schema validation and
    // surfaced as an isError result ("Required at actor")…
    const missingActor = await mcpClient.callTool({
      name: 'singularity_post_create',
      arguments: { body: 'anonymous' },
    });
    expect(missingActor.isError).toBe(true);
    const validationText = (missingActor.content as { text?: string }[])?.[0]?.text ?? '';
    expect(validationText).toMatch(/Input validation error/);

    // …while an empty actor surfaces the handler's honest error as isError.
    const noActor = await mcpClient.callTool({
      name: 'singularity_post_create',
      arguments: { actor: '', body: 'anonymous' },
    });
    expect(noActor.isError).toBe(true);
    const text = (noActor.content as { text?: string }[])?.[0]?.text ?? '';
    expect(text).toMatch(/actor is required/);
  });

  it('profile tools read and update profiles', async () => {
    const me = firstText(
      await mcpClient.callTool({ name: 'singularity_whoami', arguments: { actor: 'scotty' } }),
    ) as { email: string; role: string };
    expect(me.email).toBe('scotty@dsect.net');
    expect(me.role).toBe('owner');

    const updated = firstText(
      await mcpClient.callTool({
        name: 'singularity_profile_update',
        arguments: { actor: 'scotty', bio: 'Owner of the Singularity', interests: ['platform'] },
      }),
    ) as { bio: string; interests: string[] };
    expect(updated.bio).toBe('Owner of the Singularity');
    expect(updated.interests).toEqual(['platform']);

    const users = firstText(
      await mcpClient.callTool({ name: 'singularity_user_search', arguments: { kind: 'agent' } }),
    ) as { users: { handle: string }[] };
    expect(users.users.map((u) => u.handle).sort()).toEqual(['cooper', 'qubit']);
  });
});
