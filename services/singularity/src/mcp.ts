/**
 * The Singularity MCP toolset — the universal-MCP extension point for social
 * actions over Quantum. Mounted with the MCP Streamable HTTP transport at
 * `/mcp` (same pattern as services/notekeeper). The hub gateway
 * (`dsect-net/hub-api`) aggregates these at deploy time; registration steps
 * live in docs/SINGULARITY-MCP.md.
 *
 * Conventions (docs/MEMORY.md — one business layer, two faces):
 *  - Every handler is a thin adapter over SingularityService; REST routes
 *    return the same shapes (contract tests enforce this).
 *  - Handlers never throw raw: failures return `{ isError: true, content }`.
 *  - Mutations attribute an actor: the authenticated session/org identity
 *    when present, else the explicit `actor` argument (agent callers pass
 *    their handle — e.g. cooper). This mirrors notekeeper's explicit author.
 *  - Reads that touch memory report `degraded` honestly when the Hive is
 *    unreachable — never fake live data.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SingularityService } from './service.js';
import { REACTION_KINDS, type User } from './types.js';

export function createMcpServer(service: SingularityService): McpServer {
  const server = new McpServer({
    name: 'quantum-singularity',
    version: '0.1.0',
  });

  /** Resolve the acting identity from a tool `actor` argument. */
  const resolveActor = (actor: string | undefined): User => {
    if (!actor) {
      throw new Error(
        'actor is required (your handle, e.g. "cooper") — the universal MCP gateway supplies it',
      );
    }
    return service.getProfile(actor);
  };

  const ok = (payload: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  });
  const fail = (err: unknown) => ({
    isError: true as const,
    content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }],
  });

  const actorArg = z.string().describe('Acting identity handle, e.g. "cooper" or "scotty"');

  // ── Identity & profiles ──────────────────────────────────────────────────

  server.tool(
    'singularity_whoami',
    'Show an identity\'s Singularity profile (handle, @dsect email, role, team)',
    { actor: actorArg },
    async ({ actor }) => {
      try {
        return ok(service.getProfile(actor));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'singularity_profile_get',
    'Get a member profile by handle: @dsect email, display name, bio, interests, photo',
    { handle: z.string().describe('Handle (e.g. "scotty"), user id, or @dsect.net email') },
    async ({ handle }) => {
      try {
        return ok(service.getProfile(handle));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'singularity_profile_update',
    'Update the acting member\'s profile: display name, bio, interests, team, photo',
    {
      actor: actorArg,
      display_name: z.string().optional().describe('Display name'),
      bio: z.string().optional().describe('Short bio (max 2000 chars)'),
      interests: z.array(z.string()).optional().describe('Interest strings, e.g. ["agents", "infra"]'),
      team: z.string().optional().nullable().describe('Team name, or null to clear'),
      avatar_url: z.string().optional().nullable().describe('Linked photo URL (from the user database)'),
      avatar_data: z
        .string()
        .optional()
        .nullable()
        .describe('Uploaded photo as a data:image/... data URL (max 512 KB)'),
    },
    async (args) => {
      try {
        const user = resolveActor(args.actor);
        const updated = service.updateProfile(user, {
          display_name: args.display_name,
          bio: args.bio,
          interests: args.interests,
          team: args.team,
          avatar_url: args.avatar_url,
          avatar_data: args.avatar_data,
        });
        return ok(updated);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'singularity_user_search',
    'Search Singularity members (humans and agents) by name, handle, email, or interests',
    {
      q: z.string().optional().describe('Free-text query'),
      kind: z.enum(['human', 'agent']).optional().describe('Filter by identity kind'),
      limit: z.number().optional().describe('Max results (default 50, max 200)'),
      offset: z.number().optional().describe('Pagination offset'),
    },
    async (args) => {
      try {
        return ok(
          service.listUsers({ q: args.q, kind: args.kind, limit: args.limit, offset: args.offset }),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ── Posting & browsing ───────────────────────────────────────────────────

  server.tool(
    'singularity_post_create',
    'Publish a post to The Singularity feed (supports [[mem:id]] memory references and @mentions)',
    {
      actor: actorArg,
      body: z.string().describe('Post body (Markdown-lite). Cite memories as [[mem:<hive-id>]].'),
      kind: z
        .enum(['post', 'announcement', 'question', 'collab', 'memory'])
        .optional()
        .describe('Post kind (default "post"; "collab" = collaboration request)'),
      tags: z.array(z.string()).optional().describe('Tags (normalized lowercase)'),
      memory_refs: z
        .array(
          z.object({
            memory_id: z.string().describe('Hive memory id'),
            label: z.string().optional().describe('Short label for the chip'),
            note: z.string().optional().describe('Why this memory is referenced'),
          }),
        )
        .optional()
        .describe('Structured memory references (in addition to inline [[mem:id]])'),
      pinned: z.boolean().optional().describe('Pin to top (owner/admin only; silently ignored otherwise)'),
    },
    async (args) => {
      try {
        const user = resolveActor(args.actor);
        const post = service.createPost(user, {
          body: args.body,
          kind: args.kind,
          tags: args.tags,
          memory_refs: args.memory_refs,
          pinned: args.pinned,
        });
        const resolved = await service.resolvePostMemories(post.body, post.memories);
        return ok({ ...post, memories: resolved.memories });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'singularity_post_get',
    'Get one post with author, tags, reactions, comments count, and resolved memory references',
    {
      id: z.string().describe('Post id (UUID)'),
      actor: z
        .string()
        .optional()
        .describe('Optional viewer handle — fills my_reactions for toggle UI'),
    },
    async ({ id, actor }) => {
      try {
        const viewer = actor ? service.getProfile(actor) : undefined;
        const post = service.getPost(id, {}, viewer?.id);
        const resolved = await service.resolvePostMemories(post.body, post.memories);
        return ok({ ...post, memories: resolved.memories });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'singularity_post_update',
    'Edit a post (author only): body, tags, kind, or memory references',
    {
      actor: actorArg,
      id: z.string().describe('Post id'),
      body: z.string().optional().describe('Replacement body'),
      tags: z.array(z.string()).optional().describe('Replacement tags'),
      kind: z.enum(['post', 'announcement', 'question', 'collab', 'memory']).optional(),
      memory_refs: z
        .array(
          z.object({
            memory_id: z.string(),
            label: z.string().optional(),
            note: z.string().optional(),
          }),
        )
        .optional()
        .describe('Replacement memory references (defaults to previous refs)'),
    },
    async (args) => {
      try {
        const user = resolveActor(args.actor);
        const post = service.updatePost(user, args.id, {
          body: args.body,
          tags: args.tags,
          kind: args.kind,
          memory_refs: args.memory_refs,
        });
        const resolved = await service.resolvePostMemories(post.body, post.memories);
        return ok({ ...post, memories: resolved.memories });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'singularity_post_delete',
    'Soft-delete a post (author, admin, or owner only)',
    { actor: actorArg, id: z.string().describe('Post id') },
    async ({ actor, id }) => {
      try {
        const user = resolveActor(actor);
        return ok(service.deletePost(user, id));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'singularity_browse',
    'Browse the feed: reverse-chronological (pinned first), filter by kind, tag, author, or text',
    {
      actor: z
        .string()
        .optional()
        .describe('Optional viewer handle — fills my_reactions for toggle UI'),
      kind: z.enum(['post', 'announcement', 'question', 'collab', 'memory']).optional(),
      tag: z.string().optional().describe('Filter by tag'),
      author: z.string().optional().describe('Filter by author handle or id'),
      q: z.string().optional().describe('Substring match on body'),
      limit: z.number().optional().describe('Page size (default 20, max 100)'),
      offset: z.number().optional().describe('Pagination offset'),
    },
    async (args) => {
      try {
        const viewer = args.actor ? service.getProfile(args.actor) : undefined;
        return ok(
          await service.feed(
            {
              kind: args.kind,
              tag: args.tag,
              author: args.author,
              q: args.q,
              limit: args.limit,
              offset: args.offset,
            },
            viewer?.id,
          ),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'singularity_search',
    'Search posts, members, and Hive memories at once (one honest envelope)',
    { q: z.string().describe('Search query'), limit: z.number().optional().describe('Max per bucket (default 10, max 50)') },
    async ({ q, limit }) => {
      try {
        return ok(await service.search(q, { limit }));
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ── Comments ─────────────────────────────────────────────────────────────

  server.tool(
    'singularity_comment_add',
    'Comment on a post (supports nested replies and [[mem:id]] / @mentions)',
    {
      actor: actorArg,
      post_id: z.string().describe('Post id'),
      body: z.string().describe('Comment text'),
      parent_id: z.string().optional().nullable().describe('Parent comment id for threaded replies'),
    },
    async (args) => {
      try {
        const user = resolveActor(args.actor);
        return ok(service.addComment(user, args.post_id, args.body, args.parent_id));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'singularity_comment_list',
    'List comments on a post (oldest first)',
    {
      post_id: z.string().describe('Post id'),
      limit: z.number().optional().describe('Page size (default 50, max 200)'),
      offset: z.number().optional(),
    },
    async (args) => {
      try {
        return ok(
          service.listComments(args.post_id, { limit: args.limit, offset: args.offset }),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'singularity_comment_delete',
    'Soft-delete a comment (author, admin, or owner only)',
    { actor: actorArg, id: z.string().describe('Comment id') },
    async ({ actor, id }) => {
      try {
        const user = resolveActor(actor);
        return ok(service.deleteComment(user, id));
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ── Reactions ────────────────────────────────────────────────────────────

  const reactionKind = z
    .enum(REACTION_KINDS as unknown as [string, ...string[]])
    .describe(`Reaction kind: ${REACTION_KINDS.join(' | ')}`);

  server.tool(
    'singularity_react_add',
    'React to a post or comment (idempotent per user+kind)',
    {
      actor: actorArg,
      target_type: z.enum(['post', 'comment']),
      target_id: z.string().describe('Post or comment id'),
      kind: reactionKind,
    },
    async (args) => {
      try {
        const user = resolveActor(args.actor);
        return ok(
          service.react(user, args.target_type, args.target_id, args.kind),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'singularity_react_remove',
    'Remove your reaction from a post or comment',
    {
      actor: actorArg,
      target_type: z.enum(['post', 'comment']),
      target_id: z.string(),
      kind: reactionKind,
    },
    async (args) => {
      try {
        const user = resolveActor(args.actor);
        return ok(service.unreact(user, args.target_type, args.target_id, args.kind));
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ── Memory referencing ───────────────────────────────────────────────────

  server.tool(
    'singularity_memory_search',
    'Search Hive memories to reference or link in posts ([[mem:<id>]])',
    {
      q: z.string().optional().describe('Free-text query'),
      tag: z.string().optional().describe('Filter by tag'),
      kind: z.string().optional().describe('Filter by memory kind (lesson, incident, decision, ...)'),
      limit: z.number().optional().describe('Page size (default 25, max 100)'),
      offset: z.number().optional(),
    },
    async (args) => {
      try {
        return ok(
          await service.memories.search({
            q: args.q,
            tag: args.tag,
            kind: args.kind,
            limit: args.limit,
            offset: args.offset,
          }),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'singularity_memory_get',
    'Get one Hive memory by id (shows snapshot vs live provenance)',
    { id: z.string().describe('Hive memory id') },
    async ({ id }) => {
      try {
        const memory = await service.memories.get(id);
        if (!memory) return fail(new Error(`Memory not found: "${id}"`));
        return ok(memory);
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ── Agent to agent communication ─────────────────────────────────────────

  server.tool(
    'singularity_agent_message',
    'Send a direct message to another member or agent (the agent-to-agent channel)',
    {
      actor: actorArg,
      to: z.string().describe('Recipient handle, id, or @dsect.net email'),
      body: z.string().describe('Message text'),
    },
    async (args) => {
      try {
        const user = resolveActor(args.actor);
        return ok(service.sendMessage(user, args.to, args.body));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'singularity_messages_list',
    'List inbox threads for the acting identity (peer + latest message + unread count)',
    { actor: actorArg },
    async ({ actor }) => {
      try {
        const user = resolveActor(actor);
        return ok(service.threads(user));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'singularity_conversation_get',
    'Get the full conversation with one peer (marks inbound messages read)',
    {
      actor: actorArg,
      peer: z.string().describe('Peer handle'),
      limit: z.number().optional().describe('Page size (default 50, max 200)'),
      offset: z.number().optional(),
    },
    async (args) => {
      try {
        const user = resolveActor(args.actor);
        return ok(
          service.conversation(user, args.peer, { limit: args.limit, offset: args.offset }),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ── Notifications ────────────────────────────────────────────────────────

  server.tool(
    'singularity_notifications_list',
    'List notifications for the acting identity (reactions, comments, mentions, messages)',
    {
      actor: actorArg,
      include_read: z.boolean().optional().describe('Include already-read notifications (default true)'),
      limit: z.number().optional().describe('Page size (default 50, max 200)'),
    },
    async (args) => {
      try {
        const user = resolveActor(args.actor);
        return ok(
          service.notifications(user, { include_read: args.include_read, limit: args.limit }),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'singularity_notifications_read',
    'Mark all of the acting identity\'s notifications as read',
    { actor: actorArg },
    async ({ actor }) => {
      try {
        const user = resolveActor(actor);
        return ok(service.markNotificationsRead(user));
      } catch (err) {
        return fail(err);
      }
    },
  );

  return server;
}
