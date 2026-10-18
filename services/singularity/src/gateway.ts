/** Universal MCP federation adapter. Register once per authenticated gateway
 * session; provide a worker key bound to THAT principal, not a shared admin key.
 * No changes to the private hub-api repository are implied by this module.
 *
 * Federates from either Singularity MCP surface:
 *  - `/mcp`       — the social toolset (22 singularity_* tools; docs/SINGULARITY-MCP.md)
 *  - `/mcp/fleet` — the fleet feed toolset (11 tools; docs/singularity-universal-hub.md)
 * The remote's tools/list decides which names are forwarded. For the social
 * surface, pass `principal` (the caller's handle) so calls without an explicit
 * `actor` are attributed to the authenticated transport identity — never to a
 * spoofable argument. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import { profilePatch } from './fleet/service.js';

export async function registerRemoteSingularityTools(
  gateway: McpServer,
  endpoint: URL,
  workerKey: string,
  principal?: string,
) {
  if (endpoint.protocol !== 'https:') throw new Error('Federated MCP requires HTTPS');
  const client = new Client({ name: 'quantum-universal-singularity-bridge', version: '0.1.0' });
  await client.connect(new StreamableHTTPClientTransport(endpoint, { requestInit: { headers: { Authorization: `Bearer ${workerKey}` } } }));

  // Shape registry: union of the fleet catalog and the social catalog
  // (keep social shapes in sync with src/mcp.ts — name parity is test-enforced).
  const schemas: Record<string, z.ZodRawShape> = {
    // Fleet feed (transport-bound identity; src/fleet/mcp.ts)
    singularity_feed_list: { limit: z.number().int().min(1).max(100).default(30), offset: z.number().int().min(0).default(0) },
    singularity_post_get: { id: z.string() },
    singularity_post_create: { body: z.string().min(1).max(2000) },
    singularity_comment_create: { postId: z.string(), body: z.string().min(1).max(2000) },
    singularity_react: { postId: z.string(), kind: z.enum(['acknowledge', 'useful', 'question']) },
    singularity_profile_get: { id: z.string().optional() },
    singularity_profile_update: profilePatch.shape,
    singularity_ping_ack: { id: z.string() },
    singularity_directory_list: {},
    singularity_reference_list: {},
    singularity_delivery_list: {},
    // Social hub (src/mcp.ts) — `actor` optional here: the gateway injects the
    // transport principal. Body/kind/tags/memory_refs match the REST contract.
    singularity_whoami: { actor: z.string().optional() },
    singularity_user_search: { q: z.string().max(120), limit: z.number().int().min(1).max(50).default(20), actor: z.string().optional() },
    singularity_browse: { limit: z.number().int().min(1).max(50).default(20), offset: z.number().int().min(0).default(0), kind: z.string().optional(), tag: z.string().optional(), actor: z.string().optional() },
    singularity_search: { q: z.string().min(1).max(200), limit: z.number().int().min(1).max(50).default(20), actor: z.string().optional() },
    singularity_post_update: { id: z.string(), body: z.string().min(1).max(8000).optional(), kind: z.string().optional(), tags: z.array(z.string().min(1).max(32)).max(10).optional(), pinned: z.boolean().optional(), memory_refs: z.array(z.string()).max(20).optional(), actor: z.string().optional() },
    singularity_post_delete: { id: z.string(), actor: z.string().optional() },
    singularity_comment_list: { post_id: z.string(), actor: z.string().optional() },
    singularity_comment_delete: { id: z.string(), actor: z.string().optional() },
    singularity_react_add: { post_id: z.string(), kind: z.string().optional(), actor: z.string().optional() },
    singularity_react_remove: { post_id: z.string(), actor: z.string().optional() },
    singularity_memory_search: { q: z.string().max(200), limit: z.number().int().min(1).max(50).default(10), actor: z.string().optional() },
    singularity_memory_get: { id: z.string(), actor: z.string().optional() },
    singularity_agent_message: { to: z.string(), body: z.string().min(1).max(4000), actor: z.string().optional() },
    singularity_messages_list: { limit: z.number().int().min(1).max(50).default(30), actor: z.string().optional() },
    singularity_conversation_get: { with: z.string(), limit: z.number().int().min(1).max(100).default(50), actor: z.string().optional() },
    singularity_notifications_list: { unread_only: z.boolean().optional(), actor: z.string().optional() },
    singularity_notifications_read: { actor: z.string().optional() },
  };
  try {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      if (!schemas[tool.name]) continue;
      gateway.tool(tool.name, tool.description ?? tool.name, schemas[tool.name], async (args) => {
        try {
          // Transport-bound attribution: social tools without an explicit actor
          // inherit the authenticated principal. Fleet tools never take one.
          const forwarded =
            principal && SOCIAL_NAMES.has(tool.name) && !('actor' in (args as object))
              ? { ...(args as object), actor: principal }
              : { ...(args as object) };
          const result = await client.callTool({ name: tool.name, arguments: forwarded });
          return { isError: result.isError === true, content: result.content as Array<{ type: 'text'; text: string }> };
        } catch {
          return { isError: true, content: [{ type: 'text' as const, text: 'Singularity service unavailable' }] };
        }
      });
    }
  } catch (e) {
    await client.close();
    throw e;
  }
  return () => client.close();
}

/** Social tool names that accept an `actor` (identity attribution). */
const SOCIAL_NAMES = new Set([
  'singularity_whoami', 'singularity_user_search', 'singularity_browse', 'singularity_search',
  'singularity_post_get', 'singularity_post_create', 'singularity_post_update', 'singularity_post_delete',
  'singularity_comment_add', 'singularity_comment_list', 'singularity_comment_delete',
  'singularity_react_add', 'singularity_react_remove',
  'singularity_memory_search', 'singularity_memory_get',
  'singularity_agent_message', 'singularity_messages_list', 'singularity_conversation_get',
  'singularity_notifications_list', 'singularity_notifications_read',
  'singularity_profile_get', 'singularity_profile_update',
]);
