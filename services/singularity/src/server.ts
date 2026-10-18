/**
 * Singularity service entrypoint — Fastify wiring.
 *
 * Layout mirrors services/notekeeper/src/server.ts (docs/MEMORY.md — service
 * shape): central error handler + JSON 404s, CORS for the web app, optional
 * bearer auth on /mcp and /api/*, health in the open, MCP Streamable HTTP
 * at /mcp, REST at /api/v1. Graceful shutdown on SIGINT/SIGTERM.
 *
 * Two product surfaces share this process (docs/MEMORY.md — 2026-10-18 merge):
 *  1. THE SINGULARITY social hub — /api/v1 + /mcp (22 singularity_* tools,
 *     explicit-actor convention à la notekeeper).
 *  2. The universal-hub fleet feed — /api/singularity/* + /mcp/fleet (11 fleet
 *     tools, transport-bound identity). Mounted only when explicitly configured
 *     (SINGULARITY_DEMO=true or full live identity settings); fail-closed
 *     otherwise. See src/fleet/mount.ts and docs/singularity-universal-hub.md.
 */
import fastify, { type FastifyInstance } from 'fastify';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { openDatabase } from './db.js';
import { AuthService } from './auth.js';
import { MemoryProvider } from './memory.js';
import { SingularityService } from './service.js';
import { createMcpServer } from './mcp.js';
import { registerRestRoutes } from './rest.js';
import { seedIfEmpty } from './seed.js';
import { ServiceError, type HealthResponse } from './types.js';
// Fleet-feed sidecar (universal-hub surface).
import {
  ServiceError as FleetServiceError,
  SingularityService as FleetService,
} from './fleet/service.js';
import { registerSingularityTools } from './fleet/mcp.js';
import { mountFleetRoutes, type FleetMountOptions } from './fleet/mount.js';
import { QuantumBackend } from './backend.js';
import type { Actor } from '../../../apps/universal-hub/src/singularity/types.js';

export interface FleetOptions {
  /** Fleet demo mode (seeded Scotty cast; anyone can mutate — never production). */
  demo: boolean;
  dbPath?: string;
  actors?: Actor[];
  proxySecret?: string;
  workers?: Record<string, string>;
  backend?: QuantumBackend;
}

export interface ServerOptions {
  dbPath?: string;
  /** Overrides SINGULARITY_ORG_TOKEN (the universal DSECT org credential). */
  token?: string | null;
  port?: number;
  host?: string;
  logger?: boolean;
  /** Overrides SINGULARITY_TRUST_IDENTITY (tailnet identity headers). */
  trustIdentity?: boolean;
  /** Overrides HIVE_MEMORY_URL (live Hive lookup; falls back to snapshot). */
  hiveMemoryUrl?: string | null;
  seed?: boolean;
  /** Fleet-feed surface (universal-hub). Omit to disable it entirely. */
  fleet?: FleetOptions;
}

export interface ServerInstance {
  app: FastifyInstance;
  service: SingularityService;
  auth: AuthService;
  fleet?: FleetService;
  start: () => Promise<string>;
  close: () => Promise<void>;
}

export async function createServer(options: ServerOptions = {}): Promise<ServerInstance> {
  const db = openDatabase(options.dbPath);

  const auth = new AuthService(db, {
    orgToken: options.token ?? undefined,
    trustIdentity: options.trustIdentity ?? undefined,
  });
  const memories = new MemoryProvider(db, options.hiveMemoryUrl ?? undefined);
  const service = new SingularityService(db, auth, memories);

  if (options.seed !== false) seedIfEmpty(db, auth, service);

  // ---- Fleet-feed sidecar (optional, fail-closed) --------------------------
  let fleetService: FleetService | undefined;
  if (options.fleet) {
    const fleetDb = options.fleet.dbPath ?? (options.fleet.demo ? ':memory:' : 'data/singularity.db');
    if (fleetDb !== ':memory:') mkdirSync(dirname(fleetDb), { recursive: true });
    if (!options.fleet.demo && (!options.fleet.proxySecret || !options.fleet.actors?.length || !options.fleet.backend)) {
      throw new Error('Live fleet mode requires a trusted identity proxy, directory and Quantum backend');
    }
    fleetService = new FleetService(
      fleetDb,
      options.fleet.demo,
      options.fleet.actors ?? [],
      options.fleet.backend,
    );
  }

  // Social MCP: one server, explicit actor args (notekeeper convention).
  const mcpServer = createMcpServer(service);
  const mcpTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await mcpServer.connect(mcpTransport);

  const app = fastify({ logger: options.logger ?? false, bodyLimit: 1024 * 1024 });

  // Empty JSON bodies on POST/PATCH should not 400 (agent callers omit fields).
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body: string, done) => {
    if (!body || body.trim() === '') {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(body));
    } catch (err) {
      (err as Error & { statusCode?: number }).statusCode = 400;
      done(err as Error, undefined);
    }
  });

  // Central error handler — typed ServiceErrors map cleanly; never leak stacks.
  app.setErrorHandler((error: unknown, _req, reply) => {
    if (error instanceof ServiceError) {
      reply.status(error.status).send({ error: error.code, message: error.message });
      return;
    }
    const e = error as Error & { statusCode?: number };
    if (e.statusCode === 400 || e instanceof SyntaxError) {
      reply.status(400).send({ error: 'bad_request', message: e.message || 'Malformed JSON body' });
      return;
    }
    reply.status(e.statusCode || 500).send({
      error: e.name || 'internal_error',
      message: e.message || 'An unexpected error occurred',
    });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({
      error: 'not_found',
      message: `Route ${req.method} ${req.url} not found`,
    });
  });

  // CORS: the web app runs on its own origin in dev and in the Electron shell.
  // The fleet surface (/api/singularity/*) opts OUT — it keeps its strict
  // same-origin-only contract (src/fleet/mount.ts).
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0];
    if (path.startsWith('/api/singularity/')) return;
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-DSECT-Actor');
    if (req.method === 'OPTIONS') {
      reply.status(204).send();
      return reply;
    }
  });

  // Auth gate (docs/MEMORY.md — identity & secrets): when an org credential
  // is configured, every /mcp and /api/* call must present a valid bearer
  // (session token, org token) or trusted tailnet identity. Login/register
  // and health stay open. The fleet surface and /mcp/fleet enforce their own
  // transport-bound identity (worker keys / identity proxy) — skip them here.
  app.addHook('onRequest', async (req, reply) => {
    if (!auth.authRequired) return;

    const path = req.url.split('?')[0];
    const open =
      path === '/health' ||
      path === '/api/v1/auth/login' ||
      path === '/api/v1/auth/register';
    const fleetPath = path.startsWith('/api/singularity/') || path === '/mcp/fleet' || path.startsWith('/mcp/fleet/');
    const protectedPath = path === '/mcp' || path.startsWith('/mcp/') || path.startsWith('/api/');
    if (open || fleetPath || !protectedPath) return;

    try {
      const { user } = auth.resolve(req.headers as Record<string, string | string[] | undefined>);
      if (!user) {
        const presented = String(req.headers.authorization ?? '').startsWith('Bearer ');
        reply.status(401).send({
          error: 'unauthorized',
          message: presented
            ? 'Invalid or expired bearer token'
            : 'Sign in with your DSECT organization credentials',
        });
        return reply;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unauthorized';
      reply.status(401).send({ error: 'unauthorized', message });
      return reply;
    }
  });

  // Health — public. Reports memory provenance honestly (snapshot vs live).
  // `demo` reports the fleet surface mode for universal-hub compatibility.
  app.get('/health', async (): Promise<HealthResponse & { demo?: boolean }> => {
    const count = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;
    return {
      status: 'ok',
      schema_version: service.getSchemaVersion(),
      users: count(`SELECT COUNT(*) AS n FROM users`),
      posts: count(`SELECT COUNT(*) AS n FROM posts WHERE deleted_at IS NULL`),
      memories: count(`SELECT COUNT(*) AS n FROM memories`),
      memory_source: memories.hasLive ? 'live' : 'snapshot',
      ...(fleetService ? { demo: fleetService.demo } : {}),
    };
  });

  registerRestRoutes(app, service, auth);

  // ---- Fleet surface (universal-hub) --------------------------------------
  if (fleetService) {
    const mount: FleetMountOptions = {
      service: fleetService,
      proxySecret: options.fleet!.proxySecret,
      workers: options.fleet!.workers,
      actors: options.fleet!.actors,
    };
    mountFleetRoutes(app, mount);

    // Fleet MCP at /mcp/fleet — same semantics as the fleet service's /mcp:
    // stateless per-request server, identity bound by the transport (worker
    // key / identity proxy), never a tool argument. Keep tools/list clean.
    const equal = (a: string, b: string): boolean => {
      const x = Buffer.from(a);
      const y = Buffer.from(b);
      return x.length === y.length && timingSafeEqual(x, y);
    };
    const resolveFleetIdentity = (req: { headers: Record<string, string | string[] | undefined> }): string | undefined => {
      if (fleetService.demo) return 'actor-scotty';
      const bearer = (req.headers.authorization as string | undefined)?.replace(/^Bearer /, '');
      let id: string | undefined;
      if (bearer) {
        id = Object.entries(options.fleet!.workers ?? {}).find(([key]) => equal(key, bearer))?.[1];
      }
      const proxy = req.headers['x-singularity-proxy-key'];
      if (!id && typeof proxy === 'string' && options.fleet!.proxySecret && equal(proxy, options.fleet!.proxySecret)) {
        const email = req.headers['tailscale-user-login'];
        id = options.fleet!.actors?.find((a) => a.email === email)?.id;
      }
      return id;
    };

    app.post('/mcp/fleet', async (req, reply) => {
      const actorId = resolveFleetIdentity(req as never);
      if (!actorId) {
        reply.status(401).send({ error: 'Sign in through the Quantum identity gateway' });
        return;
      }
      const server = new McpServer({ name: 'quantum-singularity-fleet', version: '0.1.0' });
      registerSingularityTools(server, fleetService, actorId);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport);
      reply.hijack();
      reply.raw.on('close', () => {
        void transport.close();
        void server.close();
      });
      await transport.handleRequest(req.raw, reply.raw, req.body);
    });
  }

  const handleMcp = async (req: unknown, reply: unknown) => {
    const r = req as { raw: unknown; body: unknown };
    const rep = reply as { raw: unknown; hijack: () => void };
    rep.hijack();
    await mcpTransport.handleRequest(
      r.raw as never,
      (rep as unknown as { raw: never }).raw,
      r.body,
    );
  };
  app.all('/mcp', handleMcp);
  app.all('/mcp/*', handleMcp);

  const port = options.port ?? (process.env.PORT ? parseInt(process.env.PORT, 10) : 8795);
  const host = options.host ?? process.env.HOST ?? '0.0.0.0';

  return {
    app,
    service,
    auth,
    fleet: fleetService,
    start: async () => app.listen({ port, host }),
    close: async () => {
      await app.close();
      fleetService?.close();
      db.close();
    },
  };
}

/** Parse fleet-surface options from the environment (their live/demo contract).
 * Returns undefined when neither demo nor a full live configuration is present
 * — the fleet surface then stays unmounted (fail-closed, never a silent demo). */
export function fleetOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): FleetOptions | undefined {
  const demo = env.SINGULARITY_DEMO === 'true';
  const hasLive = Boolean(env.SINGULARITY_DIRECTORY && env.SINGULARITY_PROXY_SECRET && env.QUANTUM_HUB_URL);
  if (!demo && !hasLive) return undefined;
  const directory = z.array(
    z.object({
      id: z.string().min(1),
      handle: z.string().regex(/^[A-Za-z][\w-]*$/),
      name: z.string(),
      role: z.enum(['human', 'agent']),
      title: z.string(),
      email: z.string().email().refine((v) => v.endsWith('@dsect.net')),
      bio: z.string(),
      interests: z.array(z.string()),
      photo: z.string().url().optional(),
    }),
  );
  const actors = env.SINGULARITY_DIRECTORY
    ? directory.parse(JSON.parse(readFileSync(env.SINGULARITY_DIRECTORY, 'utf8')))
    : [];
  return {
    demo,
    dbPath: env.SINGULARITY_DB ?? (demo ? ':memory:' : 'data/singularity.db'),
    actors,
    proxySecret: env.SINGULARITY_PROXY_SECRET,
    workers: JSON.parse(env.SINGULARITY_WORKERS ?? '{}'),
    backend: !demo ? new QuantumBackend(env.QUANTUM_HUB_URL!, env.QUANTUM_MCP_KEY!) : undefined,
  };
}

// Auto-start when executed directly (tsx src/server.ts).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  createServer({ logger: true, fleet: fleetOptionsFromEnv() })
    .then(async (server) => {
      const address = await server.start();
      console.log(`The Singularity service running at ${address}`);
      console.log(`  REST:      ${address}/api/v1`);
      console.log(`  MCP:       ${address}/mcp (social toolset: 22 singularity_* tools)`);
      if (server.fleet) {
        console.log(`  Fleet:     ${address}/api/singularity + ${address}/mcp/fleet (${server.fleet.demo ? 'DEMO — seeded Scotty, mutations allowed' : 'live'})`);
      } else {
        console.log('  Fleet:     disabled (set SINGULARITY_DEMO=true or full live env — see README)');
      }
      console.log(`  Auth:      ${server.auth.authRequired ? 'enforced (DSECT org credentials)' : 'open (local dev)'}`);

      const shutdown = async (signal: string) => {
        console.log(`Received ${signal}, shutting down gracefully...`);
        try {
          await server.close();
          console.log('Singularity service closed cleanly');
          process.exit(0);
        } catch (err) {
          console.error('Error during shutdown:', err);
          process.exit(1);
        }
      };
      process.on('SIGINT', () => shutdown('SIGINT'));
      process.on('SIGTERM', () => shutdown('SIGTERM'));
    })
    .catch((err) => {
      console.error('Fatal error starting Singularity service:', err);
      process.exit(1);
    });
}
