import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { NoteKeeperService } from './service.js';

export function registerRestRoutes(app: FastifyInstance, service: NoteKeeperService): void {
  app.register(
    async (api) => {
      // Helper for clean error responses without stack traces
      const handleError = (reply: FastifyReply, err: any, notFoundPredicate?: boolean) => {
        const message = err?.message || String(err);
        if (
          notFoundPredicate ||
          message.startsWith('Item not found') ||
          message.startsWith('List not found') ||
          message.startsWith('Destination list not found') ||
          message.startsWith('Parent list not found') ||
          message.includes('is deleted')
        ) {
          return reply.status(404).send({ error: message });
        }
        return reply.status(400).send({ error: message });
      };

      // 1. GET /lists -> all active lists with open counts
      api.get('/lists', async (_req, reply) => {
        try {
          const lists = service.getActiveListsWithCounts();
          return reply.status(200).send(lists);
        } catch (err) {
          return handleError(reply, err);
        }
      });

      // 2. POST /lists -> create list
      api.post('/lists', async (req: FastifyRequest, reply) => {
        try {
          const body = (req.body as any) || {};
          const list = service.createList({
            name: body.name,
            category: body.category,
            parent_list_id: body.parent_list_id,
            private: body.private,
            author: body.author || 'scotty',
          });
          return reply.status(201).send(list);
        } catch (err) {
          return handleError(reply, err);
        }
      });

      // 3. GET /lists/:id -> list + counts by status
      api.get('/lists/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
        try {
          const result = service.getList(req.params.id);
          if (!result) {
            return reply.status(404).send({ error: `List not found: "${req.params.id}"` });
          }
          return reply.status(200).send(result);
        } catch (err) {
          return handleError(reply, err);
        }
      });

      // 4. GET /lists/:id/items -> list_items semantics
      api.get(
        '/lists/:id/items',
        async (
          req: FastifyRequest<{
            Params: { id: string };
            Querystring: {
              status?: any;
              type?: any;
              include_subitems?: string;
              limit?: string;
              offset?: string;
            };
          }>,
          reply
        ) => {
          try {
            const list = service.resolveList(req.params.id);
            if (!list) {
              return reply.status(404).send({ error: `List not found: "${req.params.id}"` });
            }

            const includeSubitems =
              req.query.include_subitems === undefined
                ? true
                : req.query.include_subitems === 'true' || req.query.include_subitems === '1';

            const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
            const offset = req.query.offset ? parseInt(req.query.offset, 10) : undefined;

            const result = service.listItems({
              list: list.id,
              status: req.query.status,
              type: req.query.type,
              include_subitems: includeSubitems,
              limit,
              offset,
            });

            return reply.status(200).send(result);
          } catch (err) {
            return handleError(reply, err);
          }
        }
      );

      // 5. POST /items -> note_add equivalent
      api.post('/items', async (req: FastifyRequest, reply) => {
        try {
          const body = (req.body as any) || {};
          const author = body.author || 'scotty'; // REST author defaults to 'scotty'
          const item = service.addNote({
            title: body.title,
            body: body.body,
            list: body.list,
            type: body.type,
            tags: body.tags,
            priority: body.priority,
            due_at: body.due_at,
            category: body.category,
            linked_source: body.linked_source,
            parent_item_id: body.parent_item_id,
            author,
          });
          return reply.status(201).send({ id: item.id, item });
        } catch (err) {
          return handleError(reply, err);
        }
      });

      // 6. GET /items/:id -> full item
      api.get(
        '/items/:id',
        async (
          req: FastifyRequest<{ Params: { id: string }; Querystring: { include_revisions?: string } }>,
          reply
        ) => {
          try {
            const includeRevisions = req.query.include_revisions === 'true' || req.query.include_revisions === '1';
            const item = service.getNote(req.params.id, { include_revisions: includeRevisions });
            if (!item) {
              return reply.status(404).send({ error: `Item not found or deleted: "${req.params.id}"` });
            }
            return reply.status(200).send(item);
          } catch (err) {
            return handleError(reply, err);
          }
        }
      );

      // 7. PATCH /items/:id -> note_update equivalent (autosave: true passes coalesce)
      api.patch('/items/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
        try {
          const body = (req.body as any) || {};
          const author = body.author || 'scotty';
          const coalesce = body.autosave === true;

          const updated = service.updateNote({
            id: req.params.id,
            author,
            title: body.title,
            body: body.body,
            list: body.list,
            type: body.type,
            tags: body.tags,
            priority: body.priority,
            due_at: body.due_at,
            status: body.status,
            linked_source: body.linked_source,
            parent_item_id: body.parent_item_id,
            coalesce,
          });

          return reply.status(200).send(updated);
        } catch (err) {
          return handleError(reply, err);
        }
      });

      // 8. DELETE /items/:id -> soft delete
      api.delete('/items/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
        try {
          const body = (req.body as any) || {};
          const author = body.author || 'scotty';
          const result = service.deleteNote(req.params.id, author);
          return reply.status(200).send(result);
        } catch (err) {
          return handleError(reply, err);
        }
      });

      // 9. POST /items/:id/restore -> restore tombstone
      api.post('/items/:id/restore', async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
        try {
          const body = (req.body as any) || {};
          const author = body.author || 'scotty';
          const restored = service.restoreNote(req.params.id, author);
          return reply.status(200).send(restored);
        } catch (err) {
          return handleError(reply, err);
        }
      });

      // 10. POST /items/:id/complete -> complete task/todo
      api.post('/items/:id/complete', async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
        try {
          const body = (req.body as any) || {};
          const author = body.author || 'scotty';
          const completed = service.completeNote(req.params.id, author);
          return reply.status(200).send(completed);
        } catch (err) {
          return handleError(reply, err);
        }
      });

      // 11. POST /items/:id/reopen -> reopen task/todo
      api.post('/items/:id/reopen', async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
        try {
          const body = (req.body as any) || {};
          const author = body.author || 'scotty';
          const reopened = service.reopenNote(req.params.id, author);
          return reply.status(200).send(reopened);
        } catch (err) {
          return handleError(reply, err);
        }
      });

      // 12. POST /items/:id/move -> move to another list
      api.post('/items/:id/move', async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
        try {
          const body = (req.body as any) || {};
          if (!body.to_list) {
            return reply.status(400).send({ error: 'to_list is required' });
          }
          const author = body.author || 'scotty';
          const moved = service.moveItem(req.params.id, body.to_list, author);
          return reply.status(200).send(moved);
        } catch (err) {
          return handleError(reply, err);
        }
      });

      // 13. GET /search -> keyword search through service layer
      api.get(
        '/search',
        async (
          req: FastifyRequest<{
            Querystring: {
              q?: string;
              list?: string;
              category?: string;
              tag?: string;
              type?: any;
              status?: any;
              due_before?: string;
              due_after?: string;
              limit?: string;
              offset?: string;
            };
          }>,
          reply
        ) => {
          try {
            const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
            const offset = req.query.offset ? parseInt(req.query.offset, 10) : undefined;

            const searchResult = service.searchNotes({
              query: req.query.q || '',
              list: req.query.list,
              category: req.query.category,
              tag: req.query.tag,
              type: req.query.type,
              status: req.query.status,
              due_before: req.query.due_before,
              due_after: req.query.due_after,
              limit,
              offset,
            });

            return reply.status(200).send(searchResult);
          } catch (err) {
            return handleError(reply, err);
          }
        }
      );

      // 14. Links placeholders (Step 5)
      api.get('/items/:id/links', async (_req, reply) => {
        return reply.status(501).send({ error: 'links arrive in step 5' });
      });

      api.post('/items/:id/links', async (_req, reply) => {
        return reply.status(501).send({ error: 'links arrive in step 5' });
      });
    },
    { prefix: '/api/v1' }
  );
}
