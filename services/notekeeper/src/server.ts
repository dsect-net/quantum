import fastify, { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { openDatabase } from './db.js';
import { seedIfEmpty } from './seed.js';
import { NoteKeeperService } from './service.js';
import { createMcpServer } from './mcp.js';
import { registerRestRoutes } from './rest.js';
import { EmbeddingProvider } from './embeddings.js';
import { HealthResponse } from './types.js';

export interface ServerOptions {
  dbPath?: string;
  token?: string;
  port?: number;
  host?: string;
  logger?: boolean;
  embeddingProvider?: EmbeddingProvider;
}

export interface ServerInstance {
  app: FastifyInstance;
  service: NoteKeeperService;
  start: () => Promise<string>;
  close: () => Promise<void>;
}

export async function createServer(options: ServerOptions = {}): Promise<ServerInstance> {
  const db = openDatabase(options.dbPath);
  seedIfEmpty(db);

  const service = new NoteKeeperService(db, options.embeddingProvider);
  const mcpServer = createMcpServer(service);

  const mcpTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await mcpServer.connect(mcpTransport);

  const app = fastify({
    logger: options.logger ?? false,
  });

  // Support empty JSON bodies gracefully on POST/DELETE without error
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body: string, done) => {
    if (!body || body.trim() === '') {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(body));
    } catch (err: any) {
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  // Central error handler: ensures malformed JSON body produces 400 JSON response
  app.setErrorHandler((error: any, _req, reply) => {
    if (error.statusCode === 400 || error instanceof SyntaxError || (error as any).status === 400) {
      reply.status(400).send({
        error: 'Bad Request',
        message: error.message || 'Malformed or invalid JSON body',
      });
      return;
    }
    const statusCode = error.statusCode || 500;
    reply.status(statusCode).send({
      error: error.name || 'Internal Server Error',
      message: error.message || 'An unexpected error occurred',
    });
  });

  // Central 404 handler: ensures unknown routes produce 404 JSON response
  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({
      error: 'Not Found',
      message: `Route ${req.method} ${req.url} not found`,
    });
  });

  // CORS support for web app dev origin
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      reply.status(204).send();
      return reply;
    }
  });

  // Auth placeholder per brief §5: if token is set, require Bearer token on /mcp and /api/*
  app.addHook('onRequest', async (req, reply) => {
    const configuredToken = options.token ?? process.env.NOTEKEEPER_TOKEN;
    if (!configuredToken) {
      return; // allow without auth in local dev
    }

    const pathWithoutQuery = req.url.split('?')[0];
    const requiresAuth =
      pathWithoutQuery === '/mcp' ||
      pathWithoutQuery.startsWith('/mcp/') ||
      pathWithoutQuery.startsWith('/api/');

    if (!requiresAuth) {
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      reply.status(401).send({ error: 'Unauthorized: missing Bearer token' });
      return reply;
    }

    const providedToken = authHeader.slice(7).trim();
    if (providedToken !== configuredToken) {
      reply.status(401).send({ error: 'Unauthorized: invalid Bearer token' });
      return reply;
    }
  });

  // Health endpoint: returns status, schema_version, and lists count
  app.get('/health', async (_req, _reply): Promise<HealthResponse> => {
    return {
      status: 'ok',
      schema_version: service.getSchemaVersion(),
      lists: service.getListsCount(),
    };
  });

  // REST API routes under /api/v1
  registerRestRoutes(app, service);

  // MCP Streamable HTTP transport endpoints
  const handleMcp = async (req: any, reply: any) => {
    reply.hijack();
    await mcpTransport.handleRequest(req.raw, reply.raw, req.body);
  };

  app.all('/mcp', handleMcp);
  app.all('/mcp/*', handleMcp);

  const port = options.port ?? (process.env.PORT ? parseInt(process.env.PORT, 10) : 8791);
  const host = options.host ?? (process.env.HOST || '0.0.0.0');

  // Background embedding pass timer & startup backfill (§13b.1)
  const intervalMs =
    process.env.NOTEKEEPER_EMBED_INTERVAL_MS !== undefined
      ? parseInt(process.env.NOTEKEEPER_EMBED_INTERVAL_MS, 10)
      : 60000;

  let embedTimer: NodeJS.Timeout | null = null;
  let backfillTimer: NodeJS.Timeout | null = null;

  if (intervalMs > 0) {
    embedTimer = setInterval(() => {
      service.runEmbeddingPass().catch((err) => {
        app.log.warn({ err }, 'Background embedding pass failed');
      });
    }, intervalMs);
    embedTimer.unref();

    backfillTimer = setTimeout(() => {
      service.runEmbeddingPass().catch((err) => {
        app.log.warn({ err }, 'Startup embedding backfill failed');
      });
    }, 50);
    backfillTimer.unref();
  }

  return {
    app,
    service,
    start: async () => {
      const address = await app.listen({ port, host });
      return address;
    },
    close: async () => {
      if (embedTimer) clearInterval(embedTimer);
      if (backfillTimer) clearTimeout(backfillTimer);
      await app.close();
      db.close();
    },
  };
}

// Auto-start if executed directly
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  createServer({ logger: true })
    .then(async (server) => {
      const address = await server.start();
      console.log(`Quantum Notekeeper service running at ${address}`);

      const shutdown = async (signal: string) => {
        console.log(`Received ${signal}, shutting down gracefully...`);
        try {
          await server.close();
          console.log('Notekeeper service closed cleanly');
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
      console.error('Fatal error starting Notekeeper service:', err);
      process.exit(1);
    });
}
