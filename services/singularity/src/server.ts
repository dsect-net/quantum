/**
 * Singularity service entrypoint — Fastify wiring.
 *
 * Layout mirrors services/notekeeper/src/server.ts (docs/MEMORY.md — service
 * shape): central error handler + JSON 404s, CORS for the web app, optional
 * bearer auth on /mcp and /api/*, health in the open, MCP Streamable HTTP
 * at /mcp, REST at /api/v1. Graceful shutdown on SIGINT/SIGTERM.
 */
import fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { openDatabase } from './db.js';
import { AuthService } from './auth.js';
import { MemoryProvider } from './memory.js';
import { SingularityService } from './service.js';
import { createMcpServer } from './mcp.js';
import { registerRestRoutes } from './rest.js';
import { seedIfEmpty } from './seed.js';
import { ServiceError, type HealthResponse } from './types.js';

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
}

export interface ServerInstance {
  app: FastifyInstance;
  service: SingularityService;
  auth: AuthService;
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

  const mcpServer = createMcpServer(service);
  const mcpTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await mcpServer.connect(mcpTransport);

  const app = fastify({ logger: options.logger ?? false });

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
  app.addHook('onRequest', async (req, reply) => {
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
  // and health stay open.
  app.addHook('onRequest', async (req, reply) => {
    if (!auth.authRequired) return;

    const path = req.url.split('?')[0];
    const open =
      path === '/health' ||
      path === '/api/v1/auth/login' ||
      path === '/api/v1/auth/register';
    const protectedPath = path === '/mcp' || path.startsWith('/mcp/') || path.startsWith('/api/');
    if (open || !protectedPath) return;

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
  app.get('/health', async (): Promise<HealthResponse> => {
    const count = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;
    return {
      status: 'ok',
      schema_version: service.getSchemaVersion(),
      users: count(`SELECT COUNT(*) AS n FROM users`),
      posts: count(`SELECT COUNT(*) AS n FROM posts WHERE deleted_at IS NULL`),
      memories: count(`SELECT COUNT(*) AS n FROM memories`),
      memory_source: memories.hasLive ? 'live' : 'snapshot',
    };
  });

  registerRestRoutes(app, service, auth);

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

  const port = options.port ?? (process.env.PORT ? parseInt(process.env.PORT, 10) : 8792);
  const host = options.host ?? process.env.HOST ?? '0.0.0.0';

  return {
    app,
    service,
    auth,
    start: async () => app.listen({ port, host }),
    close: async () => {
      await app.close();
      db.close();
    },
  };
}

// Auto-start when executed directly (node dist/server.js / tsx src/server.ts).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  createServer({ logger: true })
    .then(async (server) => {
      const address = await server.start();
      console.log(`The Singularity service running at ${address}`);
      console.log(`  REST:  ${address}/api/v1`);
      console.log(`  MCP:   ${address}/mcp (universal MCP toolset: singularity_*)`);
      console.log(`  Auth:  ${server.auth.authRequired ? 'enforced (DSECT org credentials)' : 'open (local dev)'}`);

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
