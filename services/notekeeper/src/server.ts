import fastify, { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { openDatabase } from './db.js';
import { seedIfEmpty } from './seed.js';
import { NoteKeeperService } from './service.js';
import { createMcpServer } from './mcp.js';
import { HealthResponse } from './types.js';

export interface ServerOptions {
  dbPath?: string;
  token?: string;
  port?: number;
  host?: string;
  logger?: boolean;
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

  const service = new NoteKeeperService(db);
  const mcpServer = createMcpServer(service);

  const mcpTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await mcpServer.connect(mcpTransport);

  const app = fastify({
    logger: options.logger ?? false,
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

  // MCP Streamable HTTP transport endpoints
  const handleMcp = async (req: any, reply: any) => {
    reply.hijack();
    await mcpTransport.handleRequest(req.raw, reply.raw, req.body);
  };

  app.all('/mcp', handleMcp);
  app.all('/mcp/*', handleMcp);

  const port = options.port ?? (process.env.PORT ? parseInt(process.env.PORT, 10) : 8791);
  const host = options.host ?? (process.env.HOST || '0.0.0.0');

  return {
    app,
    service,
    start: async () => {
      const address = await app.listen({ port, host });
      return address;
    },
    close: async () => {
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
    })
    .catch((err) => {
      console.error('Fatal error starting Notekeeper service:', err);
      process.exit(1);
    });
}
