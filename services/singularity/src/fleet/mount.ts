/**
 * Fleet-feed REST surface (the universal-hub API) — mounted inside the merged
 * Singularity process at /api/singularity/*.
 *
 * This is a faithful port of the routes/auth/error contract from the original
 * fleet service (see docs/memory/singularity.md and docs/singularity-universal-hub.md)
 * so apps/universal-hub keeps working unchanged:
 *  - strict same-origin browser writes (no permissive CORS),
 *  - identity is server-derived only: worker Bearer keys, or the trusted
 *    identity proxy (x-singularity-proxy-key + tailscale-user-login) — never
 *    a request body field,
 *  - errors respond as { error: <message> } with the fleet status codes.
 *
 * Registered in an encapsulated Fastify scope so none of these semantics leak
 * onto the social REST surface (/api/v1) or MCP.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ServiceError as FleetServiceError, SingularityService as FleetService } from './service.js';
import type { Actor } from '../../../../apps/universal-hub/src/singularity/types.js';

export interface FleetMountOptions {
  service: FleetService;
  /** Trusted identity-proxy secret (live mode). */
  proxySecret?: string;
  /** Worker-key → directory actor id map (live mode, agent callers). */
  workers?: Record<string, string>;
  /** Directory actors (live mode); demo mode uses the seeded cast. */
  actors?: Actor[];
}

const equal = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function mountFleetRoutes(app: FastifyInstance, options: FleetMountOptions): void {
  const { service, proxySecret = '', workers = {}, actors = [] } = options;
  const identities = new WeakMap<FastifyRequest, string>();

  app.register(async (fleet) => {
    // Fleet error contract: { error: message }, ZodError → 400, ServiceError →
    // its status. (Scoped to this plugin; /api/v1 keeps the social shape.)
    fleet.setErrorHandler((e, _req, reply) => {
      const code = e instanceof z.ZodError ? 400 : (e as FleetServiceError).statusCode ?? 500;
      reply
        .code(code)
        .send({ error: code >= 500 ? 'Quantum service unavailable' : e instanceof Error ? e.message : 'Invalid request' });
    });

    fleet.addHook('onRequest', async (req, reply) => {
      // Same-origin browser writes only. No permissive CORS; the ingress proxy
      // strips spoofable headers in production (see fleet README).
      const origin = req.headers.origin;
      if (origin) {
        let originHost: string | undefined;
        try {
          originHost = new URL(origin).host;
        } catch {
          return reply.code(403).send({ error: 'Cross-origin request refused' });
        }
        if (originHost !== req.headers.host) {
          return reply.code(403).send({ error: 'Cross-origin request refused' });
        }
      }
      if (service.demo) {
        identities.set(req, 'actor-scotty');
        return;
      }
      const bearer = req.headers.authorization?.replace(/^Bearer /, '');
      let id: string | undefined;
      if (bearer) {
        id = Object.entries(workers).find(([key]) => equal(key, bearer))?.[1];
      }
      const proxy = req.headers['x-singularity-proxy-key'];
      if (!id && typeof proxy === 'string' && proxySecret && equal(proxy, proxySecret)) {
        const email = req.headers['tailscale-user-login'];
        id = actors.find((a) => a.email === email)?.id;
      }
      if (!id) {
        return reply.code(401).send({ error: 'Sign in through the Quantum identity gateway' });
      }
      service.actor(id); // must exist in the organization directory
      identities.set(req, id);
    });

    fleet.get('/api/singularity/session', (req) => ({ actor: service.actor(identities.get(req)!), demo: service.demo }));

    fleet.get('/api/singularity/snapshot', async (req) => ({
      ...(await service.snapshot()),
      demo: service.demo,
      deliveries: service.deliveries(),
    }));

    fleet.post('/api/singularity/posts', async (req) => {
      const { body } = z.object({ body: z.string().min(1).max(2000) }).strict().parse(req.body);
      await service.snapshot();
      const post = service.publish(identities.get(req)!, body);
      await service.deliver();
      return post;
    });

    fleet.post('/api/singularity/comments', async (req) => {
      const { body, postId } = z
        .object({ body: z.string().min(1).max(2000), postId: z.string() })
        .strict()
        .parse(req.body);
      await service.snapshot();
      const comment = service.publish(identities.get(req)!, body, postId);
      await service.deliver();
      return comment;
    });

    fleet.post('/api/singularity/reactions', (req) => {
      const p = z
        .object({ postId: z.string(), kind: z.enum(['acknowledge', 'useful', 'question']) })
        .strict()
        .parse(req.body);
      return service.react(identities.get(req)!, p.postId, p.kind);
    });

    fleet.patch('/api/singularity/profile', (req) => service.profile(identities.get(req)!, req.body));

    fleet.post('/api/singularity/ack', (req) =>
      service.ack(identities.get(req)!, z.object({ id: z.string() }).parse(req.body).id),
    );
  });
}
