import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { NoteKeeperService } from './service.js';

export function createMcpServer(service: NoteKeeperService): McpServer {
  const server = new McpServer({
    name: 'quantum-notekeeper',
    version: '0.1.0',
  });

  server.tool(
    'list_get',
    'Get a list by id or name, including item counts by status',
    {
      id: z.string().optional().describe('List ID (UUID) or name'),
      name: z.string().optional().describe('List name'),
    },
    async ({ id, name }) => {
      const target = (name ?? id)?.trim();
      if (!target) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'Error: Must provide either "id" or "name" to list_get',
            },
          ],
        };
      }

      const result = service.getList(target);
      if (!result) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `List not found with id or name: "${target}"`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result),
          },
        ],
      };
    }
  );

  return server;
}
