import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { NoteKeeperService } from './service.js';

export function createMcpServer(service: NoteKeeperService): McpServer {
  const server = new McpServer({
    name: 'quantum-notekeeper',
    version: '0.1.0',
  });

  // 1. note_add
  server.tool(
    'note_add',
    'Add a new note, task, or todo item',
    {
      title: z.string().describe('Item title (required)'),
      author: z.string().describe('Author of the item, e.g. cooper, scotty (required)'),
      body: z.string().optional().describe('Item body in Markdown (optional)'),
      list: z.string().optional().describe('Destination list name or ID (default: Ideas & Tasks inbox)'),
      type: z.enum(['note', 'task', 'todo']).optional().describe("Item type: 'note', 'task', or 'todo' (default: 'note')"),
      tags: z.array(z.string()).optional().describe('Tags for the item (normalized and lowercase)'),
      priority: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().nullable().describe('Priority: 1 (high), 2 (normal), 3 (low), or null'),
      due_at: z.string().optional().nullable().describe('Due date/time in ISO-8601 format'),
      category: z.string().optional().describe('Optional category hint'),
      linked_source: z.string().optional().nullable().describe('Origin source: chat, app, URL, etc.'),
      parent_item_id: z.string().optional().nullable().describe('Parent item ID for nested sub-items'),
    },
    async (args) => {
      try {
        const item = service.addNote({
          title: args.title,
          author: args.author,
          body: args.body,
          list: args.list,
          type: args.type,
          tags: args.tags,
          priority: args.priority,
          due_at: args.due_at,
          category: args.category,
          linked_source: args.linked_source,
          parent_item_id: args.parent_item_id,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ id: item.id, item }),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: err?.message || String(err) }],
        };
      }
    }
  );

  // 2. note_get
  server.tool(
    'note_get',
    'Get an item by ID, optionally including revision history',
    {
      id: z.string().describe('Item ID (UUID)'),
      include_revisions: z.boolean().optional().describe('Whether to include full revision history (default: false)'),
    },
    async ({ id, include_revisions }) => {
      try {
        const item = service.getNote(id, { include_revisions });
        if (!item) {
          const tombstoned = service.getNote(id, { include_deleted: true });
          if (tombstoned) {
            return {
              isError: true,
              content: [{ type: 'text', text: `Item is deleted: "${id}". Use note_restore to restore it.` }],
            };
          }
          return {
            isError: true,
            content: [{ type: 'text', text: `Item not found: "${id}"` }],
          };
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(item) }],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: err?.message || String(err) }],
        };
      }
    }
  );

  // 3. note_update
  server.tool(
    'note_update',
    'Update an existing item fields, tags, status, priority, or move list',
    {
      id: z.string().describe('Item ID (UUID)'),
      author: z.string().describe('Author performing the edit (required)'),
      title: z.string().optional().describe('Updated title'),
      body: z.string().optional().describe('Updated body in Markdown'),
      list: z.string().optional().describe('Move to list name or ID'),
      type: z.enum(['note', 'task', 'todo']).optional().describe('Updated item type'),
      tags: z.array(z.string()).optional().describe('Updated list of tags'),
      priority: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().nullable().describe('Updated priority: 1, 2, 3, or null'),
      due_at: z.string().optional().nullable().describe('Updated due date/time in ISO-8601, or null to clear'),
      status: z.enum(['open', 'done', 'archived']).optional().describe('Updated status'),
      linked_source: z.string().optional().nullable().describe('Updated origin source'),
      parent_item_id: z.string().optional().nullable().describe('Updated parent item ID, or null to clear'),
    },
    async (args) => {
      try {
        // MCP edits always snapshot, coalesce is NEVER true from MCP (per §13b)
        const updated = service.updateNote({
          id: args.id,
          author: args.author,
          title: args.title,
          body: args.body,
          list: args.list,
          type: args.type,
          tags: args.tags,
          priority: args.priority,
          due_at: args.due_at,
          status: args.status,
          linked_source: args.linked_source,
          parent_item_id: args.parent_item_id,
          coalesce: false,
        });

        return {
          content: [{ type: 'text', text: JSON.stringify(updated) }],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: err?.message || String(err) }],
        };
      }
    }
  );

  // 4. note_delete
  server.tool(
    'note_delete',
    'Soft-delete an item (tombstone)',
    {
      id: z.string().describe('Item ID to delete'),
      author: z.string().describe('Author performing the deletion (required)'),
    },
    async ({ id, author }) => {
      try {
        const result = service.deleteNote(id, author);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: err?.message || String(err) }],
        };
      }
    }
  );

  // 5. note_restore
  server.tool(
    'note_restore',
    'Restore a soft-deleted item',
    {
      id: z.string().describe('Item ID to restore'),
      author: z.string().describe('Author performing the restoration (required)'),
    },
    async ({ id, author }) => {
      try {
        const item = service.restoreNote(id, author);
        return {
          content: [{ type: 'text', text: JSON.stringify(item) }],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: err?.message || String(err) }],
        };
      }
    }
  );

  // 6. note_complete
  server.tool(
    'note_complete',
    'Complete a task or todo item',
    {
      id: z.string().describe('Item ID to complete (task/todo only)'),
      author: z.string().describe('Author completing the item (required)'),
    },
    async ({ id, author }) => {
      try {
        const item = service.completeNote(id, author);
        return {
          content: [{ type: 'text', text: JSON.stringify(item) }],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: err?.message || String(err) }],
        };
      }
    }
  );

  // 7. note_reopen
  server.tool(
    'note_reopen',
    'Reopen a completed task or todo item',
    {
      id: z.string().describe('Item ID to reopen (task/todo only)'),
      author: z.string().describe('Author reopening the item (required)'),
    },
    async ({ id, author }) => {
      try {
        const item = service.reopenNote(id, author);
        return {
          content: [{ type: 'text', text: JSON.stringify(item) }],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: err?.message || String(err) }],
        };
      }
    }
  );

  // 8. list_create
  server.tool(
    'list_create',
    'Create a new list',
    {
      name: z.string().describe('List name (required)'),
      category: z.string().describe('List category (required)'),
      parent_list_id: z.string().optional().nullable().describe('Parent list ID for hierarchy'),
      private: z.boolean().optional().describe('Whether the list is private (default: false)'),
      author: z.string().optional().describe('Author creating the list'),
    },
    async (args) => {
      try {
        const list = service.createList({
          name: args.name,
          category: args.category,
          parent_list_id: args.parent_list_id,
          private: args.private,
          author: args.author,
        });

        return {
          content: [{ type: 'text', text: JSON.stringify(list) }],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: err?.message || String(err) }],
        };
      }
    }
  );

  // 9. list_get
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
          content: [{ type: 'text', text: 'Error: Must provide either "id" or "name" to list_get' }],
        };
      }

      const result = service.getList(target);
      if (!result) {
        return {
          isError: true,
          content: [{ type: 'text', text: `List not found with id or name: "${target}"` }],
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    }
  );

  // 10. list_items
  server.tool(
    'list_items',
    'List items within a list, with filtering, sorting, and pagination',
    {
      list: z.string().describe('List name or ID (required)'),
      status: z.enum(['open', 'done', 'archived']).optional().describe('Filter by status: open, done, archived'),
      type: z.enum(['note', 'task', 'todo']).optional().describe('Filter by type: note, task, todo'),
      include_subitems: z.boolean().optional().describe('Whether to include nested sub-items (default: true)'),
      limit: z.number().optional().describe('Pagination limit (default: 50, max: 200)'),
      offset: z.number().optional().describe('Pagination offset (default: 0)'),
    },
    async (args) => {
      try {
        const result = service.listItems({
          list: args.list,
          status: args.status,
          type: args.type,
          include_subitems: args.include_subitems,
          limit: args.limit,
          offset: args.offset,
        });

        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: err?.message || String(err) }],
        };
      }
    }
  );

  // 11. list_move_item
  server.tool(
    'list_move_item',
    'Move an item to a different list',
    {
      item_id: z.string().describe('Item ID to move (required)'),
      to_list: z.string().describe('Destination list name or ID (required)'),
      author: z.string().describe('Author performing the move (required)'),
    },
    async ({ item_id, to_list, author }) => {
      try {
        const item = service.moveItem(item_id, to_list, author);
        return {
          content: [{ type: 'text', text: JSON.stringify(item) }],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: err?.message || String(err) }],
        };
      }
    }
  );

  // 12. note_search
  server.tool(
    'note_search',
    'Search notes and tasks using keyword and filters (hybrid ranking)',
    {
      query: z.string().describe('Search query text'),
      list: z.string().optional().describe('Filter by list name or ID'),
      category: z.string().optional().describe('Filter by list category'),
      tag: z.string().optional().describe('Filter by tag'),
      type: z.enum(['note', 'task', 'todo']).optional().describe('Filter by type: note, task, todo'),
      status: z.enum(['open', 'done', 'archived']).optional().describe('Filter by status: open, done, archived'),
      due_before: z.string().optional().describe('Due before ISO date'),
      due_after: z.string().optional().describe('Due after ISO date'),
      limit: z.number().optional().describe('Pagination limit (default: 50, max: 200)'),
      offset: z.number().optional().describe('Pagination offset (default: 0)'),
    },
    async (args) => {
      try {
        const result = await service.searchNotes({
          query: args.query,
          list: args.list,
          category: args.category,
          tag: args.tag,
          type: args.type,
          status: args.status,
          due_before: args.due_before,
          due_after: args.due_after,
          limit: args.limit,
          offset: args.offset,
        });

        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: err?.message || String(err) }],
        };
      }
    }
  );

  return server;
}

