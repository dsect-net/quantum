/**
 * REST face of the Singularity service — thin adapters over SingularityService
 * (docs/MEMORY.md — one business layer, two faces). Routes under /api/v1;
 * contract tests compare these payloads with the MCP twins.
 *
 * Actor resolution (auth.ts): session bearer → org token (+ X-DSECT-Actor)
 * → trusted tailnet headers. In open dev mode (no org token) the actor falls
 * back to the X-DSECT-Actor header, then the seeded admin — attributed in the
 * audit log either way.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthService, SessionUser } from './auth.js';
import type { SingularityService } from './service.js';
import { ServiceError, type PostKind, type User } from './types.js';

/** Static tool catalog for the developer-mode MCP screen + docs/SINGULARITY-MCP.md. */
export const MCP_TOOL_NAMES = [
  'singularity_whoami',
  'singularity_profile_get',
  'singularity_profile_update',
  'singularity_user_search',
  'singularity_post_create',
  'singularity_post_get',
  'singularity_post_update',
  'singularity_post_delete',
  'singularity_browse',
  'singularity_search',
  'singularity_comment_add',
  'singularity_comment_list',
  'singularity_comment_delete',
  'singularity_react_add',
  'singularity_react_remove',
  'singularity_memory_search',
  'singularity_memory_get',
  'singularity_agent_message',
  'singularity_messages_list',
  'singularity_conversation_get',
  'singularity_notifications_list',
  'singularity_notifications_read',
] as const;

export function registerRestRoutes(
  app: FastifyInstance,
  service: SingularityService,
  auth: AuthService,
): void {
  const handleError = (reply: FastifyReply, err: unknown) => {
    if (err instanceof ServiceError) {
      return reply.status(err.status).send({ error: err.code, message: err.message });
    }
    const message = err instanceof Error ? err.message : String(err);
    // Known precondition-ish failures map to 400/404 without stack traces.
    if (message.startsWith('Post not found') || message.startsWith('Comment not found') ||
        message.startsWith('User not found') || message.startsWith('Memory not found') ||
        message.startsWith('Message not found') || message.startsWith('No Singularity account') ||
        message.startsWith('Parent comment not found')) {
      return reply.status(404).send({ error: 'not_found', message });
    }
    return reply.status(400).send({ error: 'bad_request', message });
  };

  /**
   * Acting identity for a request. When auth is enforced and no identity
   * resolves, this throws 401. In open dev mode it honors X-DSECT-Actor,
   * then falls back to the seeded admin (audit-attributed).
   */
  const actorFor = (req: FastifyRequest): SessionUser | User => {
    const { user } = auth.resolve(req.headers as Record<string, string | string[] | undefined>);
    if (user) return user;
    if (auth.authRequired) {
      throw new ServiceError(401, 'unauthorized', 'Sign in with your DSECT organization credentials');
    }
    const handle = String(req.headers['x-dsect-actor'] ?? '').trim();
    if (handle) return service.getProfile(handle);
    return service.getProfile(process.env.SINGULARITY_ADMIN_EMAIL ?? 'scotty@dsect.net');
  };

  app.register(async (api) => {
    // ── Auth ───────────────────────────────────────────────────────────────

    api.post('/auth/register', async (req, reply) => {
      try {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const user = service.register({
          handle: String(body.handle ?? ''),
          email: String(body.email ?? ''),
          display_name: String(body.display_name ?? ''),
          credential: String(body.credential ?? ''),
          join_code: body.join_code !== undefined ? String(body.join_code) : undefined,
          team: body.team ? String(body.team) : null,
        });
        // Registration issues a session immediately — one-step onboarding.
        const session = auth.login(user.email, String(body.credential ?? ''), String(req.headers['user-agent'] ?? ''));
        return reply.status(201).send({ user: session.user, token: session.token, expires_at: session.expires_at });
      } catch (err) {
        return handleError(reply, err);
      }
    });

    api.post('/auth/login', async (req, reply) => {
      try {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const session = auth.login(
          String(body.email ?? ''),
          String(body.credential ?? ''),
          String(req.headers['user-agent'] ?? ''),
        );
        return reply.status(200).send(session);
      } catch (err) {
        return handleError(reply, err);
      }
    });

    api.post('/auth/logout', async (req, reply) => {
      try {
        const authHeader = String(req.headers.authorization ?? '');
        if (authHeader.startsWith('Bearer ')) auth.logout(authHeader.slice(7).trim());
        return reply.status(200).send({ ok: true });
      } catch (err) {
        return handleError(reply, err);
      }
    });

    api.get('/auth/me', async (req, reply) => {
      try {
        return reply.status(200).send(actorFor(req));
      } catch (err) {
        return handleError(reply, err);
      }
    });

    api.post('/auth/credential', async (req, reply) => {
      try {
        const actor = actorFor(req);
        const body = (req.body ?? {}) as Record<string, unknown>;
        auth.setCredential(actor, String(body.credential ?? ''));
        return reply.status(200).send({
          ok: true,
          note: 'Credential rotated — all existing sessions were revoked. Sign in again.',
        });
      } catch (err) {
        return handleError(reply, err);
      }
    });

    // ── Feed & posts ───────────────────────────────────────────────────────

    api.get(
      '/feed',
      async (
        req: FastifyRequest<{
          Querystring: {
            kind?: PostKind;
            tag?: string;
            author?: string;
            q?: string;
            limit?: string;
            offset?: string;
          };
        }>,
        reply,
      ) => {
        try {
          const actor = actorFor(req); // feed reads are authenticated when auth is on
          const { kind, tag, author, q, limit, offset } = req.query;
          return reply.status(200).send(
            await service.feed(
              {
                kind,
                tag,
                author,
                q,
                limit: limit ? parseInt(limit, 10) : undefined,
                offset: offset ? parseInt(offset, 10) : undefined,
              },
              actor.id,
            ),
          );
        } catch (err) {
          return handleError(reply, err);
        }
      },
    );

    api.post('/posts', async (req, reply) => {
      try {
        const actor = actorFor(req);
        const body = (req.body ?? {}) as Record<string, unknown>;
        const post = service.createPost(actor, {
          body: String(body.body ?? ''),
          kind: body.kind as PostKind | undefined,
          tags: Array.isArray(body.tags) ? body.tags.map(String) : undefined,
          memory_refs: Array.isArray(body.memory_refs)
            ? (body.memory_refs as { memory_id: string; label?: string; note?: string }[])
            : undefined,
          pinned: Boolean(body.pinned),
        });
        // Attach resolved memory payload so the UI can render chips at once.
        const resolved = await service.resolvePostMemories(post.body, post.memories);
        return reply.status(201).send({ ...post, memories: resolved.memories });
      } catch (err) {
        return handleError(reply, err);
      }
    });

    api.get<{ Params: { id: string } }>('/posts/:id', async (req, reply) => {
      try {
        const actor = actorFor(req);
        const post = service.getPost(req.params.id, {}, actor.id);
        const resolved = await service.resolvePostMemories(post.body, post.memories);
        return reply.status(200).send({ ...post, memories: resolved.memories });
      } catch (err) {
        return handleError(reply, err);
      }
    });

    api.patch<{ Params: { id: string } }>('/posts/:id', async (req, reply) => {
      try {
        const actor = actorFor(req);
        const body = (req.body ?? {}) as Record<string, unknown>;
        const post = service.updatePost(actor, req.params.id, {
          body: body.body !== undefined ? String(body.body) : undefined,
          tags: Array.isArray(body.tags) ? body.tags.map(String) : undefined,
          kind: body.kind as PostKind | undefined,
          memory_refs: Array.isArray(body.memory_refs)
            ? (body.memory_refs as { memory_id: string; label?: string; note?: string }[])
            : undefined,
        });
        const resolved = await service.resolvePostMemories(post.body, post.memories);
        return reply.status(200).send({ ...post, memories: resolved.memories });
      } catch (err) {
        return handleError(reply, err);
      }
    });

    api.delete<{ Params: { id: string } }>('/posts/:id', async (req, reply) => {
      try {
        const actor = actorFor(req);
        return reply.status(200).send(service.deletePost(actor, req.params.id));
      } catch (err) {
        return handleError(reply, err);
      }
    });

    // ── Comments ───────────────────────────────────────────────────────────

    api.get<{ Params: { id: string }; Querystring: { limit?: string; offset?: string } }>(
      '/posts/:id/comments',
      async (req, reply) => {
        try {
          actorFor(req);
          return reply.status(200).send(
            service.listComments(req.params.id, {
              limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
              offset: req.query.offset ? parseInt(req.query.offset, 10) : undefined,
            }),
          );
        } catch (err) {
          return handleError(reply, err);
        }
      },
    );

    api.post<{ Params: { id: string } }>('/posts/:id/comments', async (req, reply) => {
      try {
        const actor = actorFor(req);
        const body = (req.body ?? {}) as Record<string, unknown>;
        const comment = service.addComment(
          actor,
          req.params.id,
          String(body.body ?? ''),
          body.parent_id ? String(body.parent_id) : null,
        );
        return reply.status(201).send(comment);
      } catch (err) {
        return handleError(reply, err);
      }
    });

    api.delete<{ Params: { id: string } }>('/comments/:id', async (req, reply) => {
      try {
        const actor = actorFor(req);
        return reply.status(200).send(service.deleteComment(actor, req.params.id));
      } catch (err) {
        return handleError(reply, err);
      }
    });

    // ── Reactions ──────────────────────────────────────────────────────────

    api.post<{ Params: { id: string } }>('/posts/:id/reactions', async (req, reply) => {
      try {
        const actor = actorFor(req);
        const body = (req.body ?? {}) as Record<string, unknown>;
        return reply
          .status(200)
          .send(service.react(actor, 'post', req.params.id, String(body.kind ?? '')));
      } catch (err) {
        return handleError(reply, err);
      }
    });

    api.delete<{ Params: { id: string; kind: string } }>(
      '/posts/:id/reactions/:kind',
      async (req, reply) => {
        try {
          const actor = actorFor(req);
          return reply
            .status(200)
            .send(service.unreact(actor, 'post', req.params.id, req.params.kind));
        } catch (err) {
          return handleError(reply, err);
        }
      },
    );

    api.post<{ Params: { id: string } }>('/comments/:id/reactions', async (req, reply) => {
      try {
        const actor = actorFor(req);
        const body = (req.body ?? {}) as Record<string, unknown>;
        return reply
          .status(200)
          .send(service.react(actor, 'comment', req.params.id, String(body.kind ?? '')));
      } catch (err) {
        return handleError(reply, err);
      }
    });

    api.delete<{ Params: { id: string; kind: string } }>(
      '/comments/:id/reactions/:kind',
      async (req, reply) => {
        try {
          const actor = actorFor(req);
          return reply
            .status(200)
            .send(service.unreact(actor, 'comment', req.params.id, req.params.kind));
        } catch (err) {
          return handleError(reply, err);
        }
      },
    );

    // ── Users & profiles ───────────────────────────────────────────────────

    api.get<{ Querystring: { q?: string; kind?: 'human' | 'agent'; limit?: string; offset?: string } }>(
      '/users',
      async (req, reply) => {
        try {
          actorFor(req);
          return reply.status(200).send(
            service.listUsers({
              q: req.query.q,
              kind: req.query.kind,
              limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
              offset: req.query.offset ? parseInt(req.query.offset, 10) : undefined,
            }),
          );
        } catch (err) {
          return handleError(reply, err);
        }
      },
    );

    api.get<{ Params: { handle: string } }>('/users/:handle', async (req, reply) => {
      try {
        actorFor(req);
        return reply.status(200).send(service.getProfile(req.params.handle));
      } catch (err) {
        return handleError(reply, err);
      }
    });

    api.get<{ Params: { handle: string }; Querystring: { limit?: string; offset?: string } }>(
      '/users/:handle/posts',
      async (req, reply) => {
        try {
          const actor = actorFor(req);
          return reply.status(200).send(
            service.postsBy(
              req.params.handle,
              req.query.limit ? parseInt(req.query.limit, 10) : 20,
              req.query.offset ? parseInt(req.query.offset, 10) : 0,
              actor.id,
            ),
          );
        } catch (err) {
          return handleError(reply, err);
        }
      },
    );

    api.patch('/users/me', async (req, reply) => {
      try {
        const actor = actorFor(req);
        const body = (req.body ?? {}) as Record<string, unknown>;
        return reply.status(200).send(
          service.updateProfile(actor, {
            display_name: body.display_name !== undefined ? String(body.display_name) : undefined,
            bio: body.bio !== undefined ? String(body.bio) : undefined,
            interests: Array.isArray(body.interests) ? body.interests.map(String) : undefined,
            team: body.team !== undefined ? (body.team ? String(body.team) : null) : undefined,
            avatar_url:
              body.avatar_url !== undefined ? (body.avatar_url ? String(body.avatar_url) : null) : undefined,
            avatar_data:
              body.avatar_data !== undefined
                ? (body.avatar_data ? String(body.avatar_data) : null)
                : undefined,
          }),
        );
      } catch (err) {
        return handleError(reply, err);
      }
    });

    api.post('/users/me/avatar', async (req, reply) => {
      try {
        const actor = actorFor(req);
        const body = (req.body ?? {}) as Record<string, unknown>;
        return reply.status(200).send(
          service.setAvatar(actor, {
            avatar_data: body.avatar_data !== undefined ? (body.avatar_data ? String(body.avatar_data) : null) : undefined,
            avatar_url: body.avatar_url !== undefined ? (body.avatar_url ? String(body.avatar_url) : null) : undefined,
          }),
        );
      } catch (err) {
        return handleError(reply, err);
      }
    });

    // ── Memories (Hive) ────────────────────────────────────────────────────

    api.get<{ Querystring: { q?: string; tag?: string; kind?: string; limit?: string; offset?: string } }>(
      '/memories',
      async (req, reply) => {
        try {
          actorFor(req);
          return reply.status(200).send(
            await service.memories.search({
              q: req.query.q,
              tag: req.query.tag,
              kind: req.query.kind,
              limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
              offset: req.query.offset ? parseInt(req.query.offset, 10) : undefined,
            }),
          );
        } catch (err) {
          return handleError(reply, err);
        }
      },
    );

    api.get<{ Params: { id: string } }>('/memories/:id', async (req, reply) => {
      try {
        actorFor(req);
        const memory = await service.memories.get(req.params.id);
        if (!memory) return reply.status(404).send({ error: 'not_found', message: `Memory not found: "${req.params.id}"` });
        return reply.status(200).send(memory);
      } catch (err) {
        return handleError(reply, err);
      }
    });

    // ── Messages (agent to agent) ──────────────────────────────────────────

    api.get('/messages', async (req, reply) => {
      try {
        const actor = actorFor(req);
        return reply.status(200).send(service.threads(actor));
      } catch (err) {
        return handleError(reply, err);
      }
    });

    api.get<{ Params: { handle: string }; Querystring: { limit?: string; offset?: string } }>(
      '/messages/:handle',
      async (req, reply) => {
        try {
          const actor = actorFor(req);
          return reply.status(200).send(
            service.conversation(actor, req.params.handle, {
              limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
              offset: req.query.offset ? parseInt(req.query.offset, 10) : undefined,
            }),
          );
        } catch (err) {
          return handleError(reply, err);
        }
      },
    );

    api.post('/messages', async (req, reply) => {
      try {
        const actor = actorFor(req);
        const body = (req.body ?? {}) as Record<string, unknown>;
        return reply
          .status(201)
          .send(service.sendMessage(actor, String(body.to ?? ''), String(body.body ?? '')));
      } catch (err) {
        return handleError(reply, err);
      }
    });

    // ── Notifications ──────────────────────────────────────────────────────

    api.get<{ Querystring: { include_read?: string; limit?: string } }>(
      '/notifications',
      async (req, reply) => {
        try {
          const actor = actorFor(req);
          return reply.status(200).send(
            service.notifications(actor, {
              include_read: req.query.include_read !== 'false',
              limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
            }),
          );
        } catch (err) {
          return handleError(reply, err);
        }
      },
    );

    api.post('/notifications/read', async (req, reply) => {
      try {
        const actor = actorFor(req);
        return reply.status(200).send(service.markNotificationsRead(actor));
      } catch (err) {
        return handleError(reply, err);
      }
    });

    // ── Search ─────────────────────────────────────────────────────────────

    api.get<{ Querystring: { q?: string; limit?: string } }>('/search', async (req, reply) => {
      try {
        actorFor(req);
        return reply.status(200).send(
          await service.search(req.query.q ?? '', {
            limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
          }),
        );
      } catch (err) {
        return handleError(reply, err);
      }
    });

    // ── Developer mode (docs/MEMORY.md — developer mode is a settings toggle) ──

    api.get('/dev/stats', async (req, reply) => {
      try {
        actorFor(req);
        return reply.status(200).send(service.stats());
      } catch (err) {
        return handleError(reply, err);
      }
    });

    api.get<{ Querystring: { limit?: string; offset?: string } }>('/dev/audit', async (req, reply) => {
      try {
        const actor = actorFor(req);
        if (auth.authRequired && actor.role === 'member') {
          return reply
            .status(403)
            .send({ error: 'forbidden', message: 'Audit trail requires owner or admin role' });
        }
        return reply.status(200).send(
          service.auditLog({
            limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
            offset: req.query.offset ? parseInt(req.query.offset, 10) : undefined,
          }),
        );
      } catch (err) {
        return handleError(reply, err);
      }
    });

    api.get('/dev/selftest', async (req, reply) => {
      try {
        actorFor(req);
        return reply.status(200).send(service.selftest());
      } catch (err) {
        return handleError(reply, err);
      }
    });

    api.get('/dev/mcp-tools', async (req, reply) => {
      try {
        actorFor(req);
        return reply.status(200).send({ tools: [...MCP_TOOL_NAMES] });
      } catch (err) {
        return handleError(reply, err);
      }
    });
  }, { prefix: '/api/v1' });
}
