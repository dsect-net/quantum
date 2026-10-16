import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { getCurrentSchemaVersion } from './db.js';
import {
  cosineSimilarity,
  EmbeddingProvider,
  OllamaEmbeddingProvider,
} from './embeddings.js';
import {
  AddLinkInput,
  IncomingLinkItem,
  Item,
  ItemLink,
  ItemLinksResult,
  ItemStatus,
  ItemType,
  ItemWithTags,
  LinkRelation,
  List,
  ListCounts,
  ListCreateInput,
  ListGetResult,
  ListItemsOptions,
  ListItemsResult,
  ListWithCounts,
  NoteAddInput,
  NoteUpdateInput,
  OutgoingLinkItem,
  ResolvedLinkEnd,
  Revision,
  RevisionKind,
  SearchMatchItem,
  SearchOptions,
  SearchResult,
} from './types.js';

export class NoteKeeperService {
  private embeddingProvider: EmbeddingProvider;

  constructor(
    private db: Database.Database,
    embeddingProvider?: EmbeddingProvider
  ) {
    this.embeddingProvider = embeddingProvider || new OllamaEmbeddingProvider();
  }

  getDb(): Database.Database {
    return this.db;
  }

  getEmbeddingProvider(): EmbeddingProvider {
    return this.embeddingProvider;
  }

  setEmbeddingProvider(provider: EmbeddingProvider): void {
    this.embeddingProvider = provider;
  }

  getSchemaVersion(): number {
    return getCurrentSchemaVersion(this.db);
  }

  getListsCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM lists WHERE archived_at IS NULL').get() as {
      count: number;
    };
    return row?.count ?? 0;
  }

  getAllLists(): List[] {
    return this.db
      .prepare('SELECT * FROM lists WHERE archived_at IS NULL ORDER BY sort_order ASC, created_at ASC')
      .all() as List[];
  }

  getListCounts(listId: string): ListCounts {
    const statusRows = this.db
      .prepare(
        `SELECT status, COUNT(*) as count 
         FROM items 
         WHERE list_id = ? AND deleted_at IS NULL 
         GROUP BY status`
      )
      .all(listId) as Array<{ status: string; count: number }>;

    const counts: ListCounts = {
      open: 0,
      done: 0,
      archived: 0,
      total: 0,
    };

    for (const row of statusRows) {
      if (row.status === 'open') counts.open = row.count;
      else if (row.status === 'done') counts.done = row.count;
      else if (row.status === 'archived') counts.archived = row.count;
    }
    counts.total = counts.open + counts.done + counts.archived;
    return counts;
  }

  getActiveListsWithCounts(): ListWithCounts[] {
    const lists = this.getAllLists();
    return lists.map((list) => {
      const counts = this.getListCounts(list.id);
      return {
        ...list,
        open_count: counts.open,
        counts,
      };
    });
  }

  resolveList(idOrName: string): List | null {
    if (!idOrName || typeof idOrName !== 'string') {
      return null;
    }
    const trimmed = idOrName.trim();
    if (!trimmed) {
      return null;
    }

    const list = this.db
      .prepare(
        `SELECT * FROM lists 
         WHERE (id = ? OR name = ?) AND archived_at IS NULL 
         ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END 
         LIMIT 1`
      )
      .get(trimmed, trimmed, trimmed) as List | undefined;

    return list ?? null;
  }

  getList(idOrName: string): ListGetResult | null {
    const list = this.resolveList(idOrName);
    if (!list) {
      return null;
    }

    const counts = this.getListCounts(list.id);
    return {
      list,
      counts,
    };
  }

  createList(input: ListCreateInput): List {
    if (!input.name || typeof input.name !== 'string' || !input.name.trim()) {
      throw new Error('List name is required');
    }
    if (!input.category || typeof input.category !== 'string' || !input.category.trim()) {
      throw new Error('List category is required');
    }

    const name = input.name.trim();
    const category = input.category.trim();

    if (input.parent_list_id) {
      const parent = this.db
        .prepare('SELECT id FROM lists WHERE id = ? AND archived_at IS NULL')
        .get(input.parent_list_id);
      if (!parent) {
        throw new Error(`Parent list not found: ${input.parent_list_id}`);
      }
    }

    const maxOrderRow = this.db
      .prepare('SELECT COALESCE(MAX(sort_order), -1) as max_order FROM lists')
      .get() as { max_order: number };
    const sortOrder = maxOrderRow.max_order + 1;

    const isPrivate = input.private ? 1 : 0;
    const syncExcluded = isPrivate === 1 ? 1 : 0; // D6: private lists stay private
    const now = new Date().toISOString();
    const id = randomUUID();

    this.db
      .prepare(
        `INSERT INTO lists (id, name, category, parent_list_id, sort_order, private, sync_excluded, archived_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
      )
      .run(id, name, category, input.parent_list_id ?? null, sortOrder, isPrivate, syncExcluded, now, now);

    return this.db.prepare('SELECT * FROM lists WHERE id = ?').get(id) as List;
  }

  normalizeTags(tags?: string[]): string[] {
    if (!tags || !Array.isArray(tags)) return [];
    const normalized = new Set<string>();
    for (const tag of tags) {
      if (typeof tag === 'string') {
        const clean = tag.trim().toLowerCase();
        if (clean) {
          normalized.add(clean);
        }
      }
    }
    return Array.from(normalized).sort();
  }

  getItemTags(itemId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT t.name FROM tags t 
         JOIN item_tags it ON t.id = it.tag_id 
         WHERE it.item_id = ? 
         ORDER BY t.name ASC`
      )
      .all(itemId) as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }

  private syncItemTags(itemId: string, tags: string[]): void {
    this.db.prepare('DELETE FROM item_tags WHERE item_id = ?').run(itemId);

    const upsertTag = this.db.prepare(`
      INSERT INTO tags (id, name) VALUES (?, ?)
      ON CONFLICT(name) DO NOTHING
    `);
    const findTag = this.db.prepare('SELECT id FROM tags WHERE name = ?');
    const linkTag = this.db.prepare(`
      INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)
    `);

    for (const tag of tags) {
      upsertTag.run(randomUUID(), tag);
      const tagRow = findTag.get(tag) as { id: string };
      if (tagRow) {
        linkTag.run(itemId, tagRow.id);
      }
    }
  }

  private writeRevision(
    itemId: string,
    snapshot: any,
    author: string,
    kind: RevisionKind,
    coalesce = false
  ): void {
    const now = new Date().toISOString();

    if (coalesce && kind === 'edit') {
      const latest = this.db
        .prepare('SELECT * FROM revisions WHERE item_id = ? ORDER BY rowid DESC LIMIT 1')
        .get(itemId) as Revision | undefined;

      if (
        latest &&
        latest.kind === 'edit' &&
        latest.author === author &&
        Date.now() - new Date(latest.created_at).getTime() < 5 * 60 * 1000
      ) {
        // Coalesce: replace that revision's snapshot with the new prior-state snapshot and refresh created_at
        this.db
          .prepare('UPDATE revisions SET snapshot = ?, created_at = ? WHERE id = ?')
          .run(JSON.stringify(snapshot), now, latest.id);
        return;
      }
    }

    this.db
      .prepare(
        'INSERT INTO revisions (id, item_id, snapshot, author, created_at, kind) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(randomUUID(), itemId, JSON.stringify(snapshot), author, now, kind);
  }

  addNote(input: NoteAddInput): ItemWithTags {
    if (!input.author || typeof input.author !== 'string' || !input.author.trim()) {
      throw new Error('Author is required');
    }
    if (!input.title || typeof input.title !== 'string' || !input.title.trim()) {
      throw new Error('Title is required');
    }

    const type: ItemType = input.type ?? 'note';
    if (!['note', 'task', 'todo'].includes(type)) {
      throw new Error(`Invalid item type: ${input.type}. Must be 'note', 'task', or 'todo'`);
    }

    if (input.priority !== undefined && input.priority !== null) {
      if (![1, 2, 3].includes(input.priority)) {
        throw new Error(`Invalid priority: ${input.priority}. Must be 1 (high), 2 (normal), 3 (low), or null`);
      }
    }

    let dueAt: string | null = null;
    if (input.due_at !== undefined && input.due_at !== null && input.due_at.trim() !== '') {
      const parsed = Date.parse(input.due_at);
      if (isNaN(parsed)) {
        throw new Error(`Invalid due_at date format: ${input.due_at}`);
      }
      dueAt = new Date(parsed).toISOString();
    }

    const listTarget = input.list?.trim() || 'Ideas & Tasks';
    const list = this.resolveList(listTarget);
    if (!list) {
      throw new Error(`List not found: "${listTarget}"`);
    }

    if (input.parent_item_id) {
      const parent = this.db
        .prepare('SELECT id, list_id, deleted_at FROM items WHERE id = ?')
        .get(input.parent_item_id) as Item | undefined;
      if (!parent || parent.deleted_at !== null) {
        throw new Error(`Parent item not found or deleted: ${input.parent_item_id}`);
      }
      if (parent.list_id !== list.id) {
        throw new Error(`Parent item is in a different list (${parent.list_id} vs ${list.id})`);
      }
    }

    const now = new Date().toISOString();
    const id = randomUUID();
    const author = input.author.trim();
    const title = input.title.trim();
    const body = input.body ?? '';
    const tags = this.normalizeTags(input.tags);

    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO items (
            id, list_id, parent_item_id, type, title, body, author, status,
            priority, due_at, linked_source, embedding_status, created_at, updated_at, completed_at, deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, 'pending', ?, ?, NULL, NULL)`
        )
        .run(
          id,
          list.id,
          input.parent_item_id ?? null,
          type,
          title,
          body,
          author,
          input.priority ?? null,
          dueAt,
          input.linked_source ?? null,
          now,
          now
        );

      if (tags.length > 0) {
        this.syncItemTags(id, tags);
      }

      const createdItem = this.db.prepare('SELECT * FROM items WHERE id = ?').get(id) as Item;
      const snapshot = { ...createdItem, tags };
      this.writeRevision(id, snapshot, author, 'create', false);

      return {
        ...createdItem,
        tags,
      };
    });

    return transaction();
  }

  getNote(
    id: string,
    options?: { include_revisions?: boolean; include_deleted?: boolean }
  ): ItemWithTags | null {
    if (!id || typeof id !== 'string') return null;

    const item = this.db.prepare('SELECT * FROM items WHERE id = ?').get(id) as Item | undefined;
    if (!item) {
      return null;
    }

    if (!options?.include_deleted && item.deleted_at !== null) {
      return null;
    }

    const tags = this.getItemTags(id);
    const result: ItemWithTags = {
      ...item,
      tags,
    };

    if (options?.include_revisions) {
      result.revisions = this.db
        .prepare('SELECT * FROM revisions WHERE item_id = ? ORDER BY rowid DESC')
        .all(id) as Revision[];
    }

    return result;
  }

  updateNote(input: NoteUpdateInput): ItemWithTags {
    if (!input.author || typeof input.author !== 'string' || !input.author.trim()) {
      throw new Error('Author is required');
    }
    const current = this.getNote(input.id);
    if (!current) {
      throw new Error(`Item not found or deleted: ${input.id}`);
    }

    const priorSnapshot = { ...current };
    delete (priorSnapshot as any).revisions;

    let targetListId = current.list_id;
    if (input.list !== undefined && input.list.trim() !== '') {
      const destList = this.resolveList(input.list);
      if (!destList) {
        throw new Error(`Destination list not found: "${input.list}"`);
      }
      targetListId = destList.id;
    }

    if (input.type !== undefined && !['note', 'task', 'todo'].includes(input.type)) {
      throw new Error(`Invalid item type: ${input.type}`);
    }

    if (input.priority !== undefined && input.priority !== null && ![1, 2, 3].includes(input.priority)) {
      throw new Error(`Invalid priority: ${input.priority}`);
    }

    if (input.status !== undefined && !['open', 'done', 'archived'].includes(input.status)) {
      throw new Error(`Invalid status: ${input.status}`);
    }

    let dueAt = current.due_at;
    if (input.due_at !== undefined) {
      if (input.due_at === null || input.due_at.trim() === '') {
        dueAt = null;
      } else {
        const parsed = Date.parse(input.due_at);
        if (isNaN(parsed)) {
          throw new Error(`Invalid due_at date format: ${input.due_at}`);
        }
        dueAt = new Date(parsed).toISOString();
      }
    }

    let parentItemId = current.parent_item_id;
    if (input.parent_item_id !== undefined) {
      if (input.parent_item_id === null || input.parent_item_id.trim() === '') {
        parentItemId = null;
      } else {
        const parent = this.db
          .prepare('SELECT id, list_id, deleted_at FROM items WHERE id = ?')
          .get(input.parent_item_id) as Item | undefined;
        if (!parent || parent.deleted_at !== null) {
          throw new Error(`Parent item not found or deleted: ${input.parent_item_id}`);
        }
        if (parent.list_id !== targetListId) {
          throw new Error(`Parent item is in a different list (${parent.list_id} vs ${targetListId})`);
        }
        parentItemId = input.parent_item_id;
      }
    }

    // Material change to title or body triggers re-embedding
    const newTitle = input.title !== undefined ? input.title.trim() : current.title;
    if (!newTitle) {
      throw new Error('Title cannot be empty');
    }
    const newBody = input.body !== undefined ? input.body : current.body;
    const contentChanged = newTitle !== current.title || newBody !== current.body;
    const embeddingStatus = contentChanged ? 'pending' : current.embedding_status;

    let newStatus = input.status !== undefined ? input.status : current.status;
    let completedAt = current.completed_at;
    if (input.status !== undefined && input.status !== current.status) {
      if (input.status === 'done' && !completedAt) {
        completedAt = new Date().toISOString();
      } else if (input.status === 'open') {
        completedAt = null;
      }
    }

    const now = new Date().toISOString();
    const author = input.author.trim();

    const transaction = this.db.transaction(() => {
      // Write revision BEFORE applying change
      this.writeRevision(input.id, priorSnapshot, author, 'edit', input.coalesce ?? false);

      this.db
        .prepare(
          `UPDATE items SET
            list_id = ?,
            parent_item_id = ?,
            type = ?,
            title = ?,
            body = ?,
            author = ?,
            status = ?,
            priority = ?,
            due_at = ?,
            linked_source = ?,
            embedding_status = ?,
            updated_at = ?,
            completed_at = ?
          WHERE id = ?`
        )
        .run(
          targetListId,
          parentItemId,
          input.type ?? current.type,
          newTitle,
          newBody,
          author,
          newStatus,
          input.priority !== undefined ? input.priority : current.priority,
          dueAt,
          input.linked_source !== undefined ? input.linked_source : current.linked_source,
          embeddingStatus,
          now,
          completedAt,
          input.id
        );

      if (input.tags !== undefined) {
        const newTags = this.normalizeTags(input.tags);
        this.syncItemTags(input.id, newTags);
      }
    });

    transaction();
    return this.getNote(input.id)!;
  }

  deleteNote(id: string, author: string): { id: string; deleted_at: string } {
    if (!author || typeof author !== 'string' || !author.trim()) {
      throw new Error('Author is required');
    }
    const current = this.getNote(id);
    if (!current) {
      throw new Error(`Item not found or already deleted: ${id}`);
    }

    const priorSnapshot = { ...current };
    delete (priorSnapshot as any).revisions;
    const now = new Date().toISOString();

    const transaction = this.db.transaction(() => {
      this.writeRevision(id, priorSnapshot, author.trim(), 'delete', false);
      this.db
        .prepare('UPDATE items SET deleted_at = ?, updated_at = ? WHERE id = ?')
        .run(now, now, id);
    });

    transaction();
    return { id, deleted_at: now };
  }

  restoreNote(id: string, author: string): ItemWithTags {
    if (!author || typeof author !== 'string' || !author.trim()) {
      throw new Error('Author is required');
    }
    const current = this.getNote(id, { include_deleted: true });
    if (!current) {
      throw new Error(`Item not found: ${id}`);
    }
    if (current.deleted_at === null) {
      throw new Error(`Item is not deleted: ${id}`);
    }

    const priorSnapshot = { ...current };
    delete (priorSnapshot as any).revisions;
    const now = new Date().toISOString();

    const transaction = this.db.transaction(() => {
      this.writeRevision(id, priorSnapshot, author.trim(), 'restore', false);
      this.db
        .prepare('UPDATE items SET deleted_at = NULL, updated_at = ? WHERE id = ?')
        .run(now, id);
    });

    transaction();
    return this.getNote(id)!;
  }

  completeNote(id: string, author: string): ItemWithTags {
    if (!author || typeof author !== 'string' || !author.trim()) {
      throw new Error('Author is required');
    }
    const current = this.getNote(id);
    if (!current) {
      throw new Error(`Item not found or deleted: ${id}`);
    }
    if (current.type === 'note') {
      throw new Error("Cannot complete item of type 'note'. Only 'task' and 'todo' can be completed.");
    }

    const priorSnapshot = { ...current };
    delete (priorSnapshot as any).revisions;
    const now = new Date().toISOString();

    const transaction = this.db.transaction(() => {
      this.writeRevision(id, priorSnapshot, author.trim(), 'complete', false);
      this.db
        .prepare('UPDATE items SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?')
        .run('done', now, now, id);
    });

    transaction();
    return this.getNote(id)!;
  }

  reopenNote(id: string, author: string): ItemWithTags {
    if (!author || typeof author !== 'string' || !author.trim()) {
      throw new Error('Author is required');
    }
    const current = this.getNote(id);
    if (!current) {
      throw new Error(`Item not found or deleted: ${id}`);
    }
    if (current.type === 'note') {
      throw new Error("Cannot reopen item of type 'note'. Only 'task' and 'todo' can be reopened.");
    }

    const priorSnapshot = { ...current };
    delete (priorSnapshot as any).revisions;
    const now = new Date().toISOString();

    const transaction = this.db.transaction(() => {
      this.writeRevision(id, priorSnapshot, author.trim(), 'reopen', false);
      this.db
        .prepare('UPDATE items SET status = ?, completed_at = NULL, updated_at = ? WHERE id = ?')
        .run('open', now, id);
    });

    transaction();
    return this.getNote(id)!;
  }

  moveItem(itemId: string, toList: string, author: string): ItemWithTags {
    if (!author || typeof author !== 'string' || !author.trim()) {
      throw new Error('Author is required');
    }
    const current = this.getNote(itemId);
    if (!current) {
      throw new Error(`Item not found or deleted: ${itemId}`);
    }

    const destList = this.resolveList(toList);
    if (!destList) {
      throw new Error(`Destination list not found: "${toList}"`);
    }

    const priorSnapshot = { ...current };
    delete (priorSnapshot as any).revisions;
    const now = new Date().toISOString();

    const transaction = this.db.transaction(() => {
      this.writeRevision(itemId, priorSnapshot, author.trim(), 'move', false);
      this.db
        .prepare(
          `UPDATE items SET
            list_id = ?,
            parent_item_id = CASE WHEN list_id = ? THEN parent_item_id ELSE NULL END,
            updated_at = ?
          WHERE id = ?`
        )
        .run(destList.id, destList.id, now, itemId);
    });

    transaction();
    return this.getNote(itemId)!;
  }

  listItems(options: ListItemsOptions): ListItemsResult {
    const list = this.resolveList(options.list);
    if (!list) {
      throw new Error(`List not found: "${options.list}"`);
    }

    const whereClauses: string[] = ['list_id = ?', 'deleted_at IS NULL'];
    const params: any[] = [list.id];

    if (options.status) {
      if (!['open', 'done', 'archived'].includes(options.status)) {
        throw new Error(`Invalid status filter: ${options.status}`);
      }
      whereClauses.push('status = ?');
      params.push(options.status);
    }

    if (options.type) {
      if (!['note', 'task', 'todo'].includes(options.type)) {
        throw new Error(`Invalid type filter: ${options.type}`);
      }
      whereClauses.push('type = ?');
      params.push(options.type);
    }

    if (options.include_subitems === false) {
      whereClauses.push('parent_item_id IS NULL');
    }

    const whereSql = whereClauses.join(' AND ');

    const totalRow = this.db
      .prepare(`SELECT COUNT(*) as total FROM items WHERE ${whereSql}`)
      .get(...params) as { total: number };
    const total = totalRow.total;

    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const offset = Math.max(options.offset ?? 0, 0);

    // Sort order: due soon -> priority (1 first, nulls last) -> updated_at desc
    const querySql = `
      SELECT * FROM items 
      WHERE ${whereSql}
      ORDER BY 
        CASE WHEN due_at IS NULL THEN 1 ELSE 0 END ASC, 
        due_at ASC, 
        CASE WHEN priority IS NULL THEN 1 ELSE 0 END ASC, 
        priority ASC, 
        updated_at DESC
      LIMIT ? OFFSET ?
    `;

    const itemRows = this.db.prepare(querySql).all(...params, limit, offset) as Item[];

    const items: ItemWithTags[] = itemRows.map((item) => ({
      ...item,
      tags: this.getItemTags(item.id),
    }));

    return {
      items,
      total,
      limit,
      offset,
    };
  }

  /**
   * Background embedding pass (§13b.1):
   * Processes items with status 'pending' (or un-embedded items for the current model),
   * embeds title + body, upserts embeddings row, and marks status 'done'.
   * On error sets status 'failed' to be retried in a later pass.
   */
  async runEmbeddingPass(batchSize = 50): Promise<{ processed: number; succeeded: number; failed: number }> {
    const modelId = this.embeddingProvider.modelId;

    // Find items that need embedding for this model
    const candidateRows = this.db
      .prepare(
        `SELECT items.id, items.title, items.body, items.embedding_status
         FROM items
         LEFT JOIN embeddings ON items.id = embeddings.item_id AND embeddings.model_id = ?
         WHERE items.deleted_at IS NULL AND (items.embedding_status IN ('pending', 'failed') OR embeddings.item_id IS NULL)
         LIMIT ?`
      )
      .all(modelId, batchSize) as Array<{
        id: string;
        title: string;
        body: string;
        embedding_status: string;
      }>;

    if (candidateRows.length === 0) {
      return { processed: 0, succeeded: 0, failed: 0 };
    }

    let succeeded = 0;
    let failed = 0;

    const upsertStmt = this.db.prepare(`
      INSERT INTO embeddings (item_id, model_id, vector, embedded_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(item_id, model_id) DO UPDATE SET
        vector = excluded.vector,
        embedded_at = excluded.embedded_at
    `);

    const setStatusStmt = this.db.prepare(`
      UPDATE items SET embedding_status = ?, updated_at = updated_at WHERE id = ?
    `);

    for (const row of candidateRows) {
      const textToEmbed = `${row.title}\n${row.body}`.trim();
      try {
        const [vec] = await this.embeddingProvider.embed([textToEmbed]);
        if (!vec || vec.length === 0) {
          throw new Error('Empty vector returned from embedding provider');
        }

        const now = new Date().toISOString();
        const vectorBuffer = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);

        this.db.transaction(() => {
          upsertStmt.run(row.id, modelId, vectorBuffer, now);
          setStatusStmt.run('done', row.id);
        })();

        succeeded++;
      } catch (err) {
        failed++;
        try {
          setStatusStmt.run('failed', row.id);
        } catch {
          // ignore
        }
      }
    }

    return {
      processed: candidateRows.length,
      succeeded,
      failed,
    };
  }

  /**
   * Hybrid search: FTS5 keyword candidates + embedding cosine-similarity candidates.
   * Merges matches, ranks semantic matches above pure keyword matches when scores are close,
   * and degrades gracefully to keyword-only when the embedding provider is unreachable.
   */
  async searchNotes(options: SearchOptions): Promise<SearchResult> {
    const rawQuery = (options.query || '').trim();
    const whereClauses: string[] = ['items.deleted_at IS NULL'];
    const params: any[] = [];
    const joins: string[] = [];

    if (options.list) {
      const list = this.resolveList(options.list);
      if (list) {
        whereClauses.push('items.list_id = ?');
        params.push(list.id);
      } else {
        return {
          results: [],
          total: 0,
          limit: options.limit ?? 50,
          offset: options.offset ?? 0,
          degraded: true,
          message: `List not found: ${options.list}`,
        };
      }
    }

    if (options.category) {
      joins.push('JOIN lists ON items.list_id = lists.id');
      whereClauses.push('lists.category = ?');
      params.push(options.category);
    }

    if (options.tag) {
      const cleanTag = options.tag.trim().toLowerCase();
      joins.push('JOIN item_tags it ON items.id = it.item_id');
      joins.push('JOIN tags t ON it.tag_id = t.id');
      whereClauses.push('t.name = ?');
      params.push(cleanTag);
    }

    if (options.type) {
      whereClauses.push('items.type = ?');
      params.push(options.type);
    }

    if (options.status) {
      whereClauses.push('items.status = ?');
      params.push(options.status);
    }

    if (options.due_before) {
      whereClauses.push('items.due_at IS NOT NULL AND items.due_at <= ?');
      params.push(new Date(options.due_before).toISOString());
    }

    if (options.due_after) {
      whereClauses.push('items.due_at IS NOT NULL AND items.due_at >= ?');
      params.push(new Date(options.due_after).toISOString());
    }

    const joinSql = joins.join(' ');
    const baseWhereSql = whereClauses.join(' AND ');

    // Check embedding provider health
    let isProviderHealthy = false;
    try {
      isProviderHealthy = await this.embeddingProvider.health();
    } catch {
      isProviderHealthy = false;
    }

    // Map of itemId -> { item, keywordScore, semanticScore, bm25Rank }
    const candidateMap = new Map<
      string,
      {
        item: Item;
        keywordScore: number;
        semanticScore: number;
      }
    >();

    // 1. Keyword candidates via FTS5
    if (rawQuery) {
      const tokens = rawQuery
        .replace(/[^a-zA-Z0-9_\s]/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);

      if (tokens.length > 0) {
        const ftsQuery = tokens.map((t) => `"${t}"*`).join(' OR ');
        const ftsSql = `
          SELECT items.*, bm25(items_fts) as rank
          FROM items
          JOIN items_fts ON items.rowid = items_fts.rowid
          ${joinSql}
          WHERE ${baseWhereSql} AND items_fts MATCH ?
          ORDER BY bm25(items_fts) ASC
          LIMIT 100
        `;

        try {
          const ftsRows = this.db.prepare(ftsSql).all(...params, ftsQuery) as Array<Item & { rank: number }>;
          for (const row of ftsRows) {
            // bm25 rank is negative (lower = better). Normalize to positive 0..1
            const normalizedRank = Math.max(0, -row.rank);
            const keywordScore = normalizedRank / (1.0 + normalizedRank);
            candidateMap.set(row.id, {
              item: row,
              keywordScore,
              semanticScore: 0,
            });
          }
        } catch {
          // FTS match failed (syntax or table issue)
        }
      }
    }

    // 2. Semantic candidates via vector cosine similarity
    let semanticSucceeded = false;
    if (isProviderHealthy && rawQuery) {
      try {
        const [queryVec] = await this.embeddingProvider.embed([rawQuery]);
        if (queryVec && queryVec.length > 0) {
          // Fetch candidate embeddings for current model in scope
          const embSql = `
            SELECT items.*, embeddings.vector
            FROM items
            JOIN embeddings ON items.id = embeddings.item_id AND embeddings.model_id = ?
            ${joinSql}
            WHERE ${baseWhereSql}
          `;

          const embRows = this.db.prepare(embSql).all(this.embeddingProvider.modelId, ...params) as Array<
            Item & { vector: Buffer }
          >;

          for (const row of embRows) {
            const itemVec = new Float32Array(
              row.vector.buffer,
              row.vector.byteOffset,
              row.vector.byteLength / 4
            );
            const sim = cosineSimilarity(queryVec, itemVec);

            // Consider semantic match if cosine similarity is >= 0.50
            if (sim >= 0.50) {
              const existing = candidateMap.get(row.id);
              if (existing) {
                existing.semanticScore = sim;
              } else {
                candidateMap.set(row.id, {
                  item: row,
                  keywordScore: 0,
                  semanticScore: sim,
                });
              }
            }
          }
          semanticSucceeded = true;
        }
      } catch {
        semanticSucceeded = false;
      }
    }

    // If query is empty, return latest active items
    if (!rawQuery) {
      const selectSql = `
        SELECT DISTINCT items.* FROM items 
        ${joinSql} 
        WHERE ${baseWhereSql} 
        ORDER BY items.updated_at DESC 
        LIMIT ? OFFSET ?
      `;
      const countSql = `SELECT COUNT(DISTINCT items.id) as total FROM items ${joinSql} WHERE ${baseWhereSql}`;
      const totalRow = this.db.prepare(countSql).get(...params) as { total: number };
      const total = totalRow?.total ?? 0;

      const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
      const offset = Math.max(options.offset ?? 0, 0);

      const rows = this.db.prepare(selectSql).all(...params, limit, offset) as Item[];
      const results: SearchMatchItem[] = rows.map((item) => ({
        item: {
          ...item,
          tags: this.getItemTags(item.id),
        },
        match: 'keyword',
        score: 0,
      }));

      return {
        results,
        total,
        limit,
        offset,
        degraded: !isProviderHealthy,
        message: !isProviderHealthy ? 'Embedding provider is unavailable; degraded to keyword search' : undefined,
      };
    }

    // Combine and rank candidates
    const scoredCandidates: Array<{
      item: Item;
      match: 'keyword' | 'semantic' | 'both';
      combinedScore: number;
    }> = [];

    for (const cand of candidateMap.values()) {
      const hasKeyword = cand.keywordScore > 0;
      const hasSemantic = cand.semanticScore >= 0.50;

      let match: 'keyword' | 'semantic' | 'both' = 'keyword';
      let combinedScore = 0;

      if (hasKeyword && hasSemantic) {
        match = 'both';
        // Matched both: weighted combination + synergy bonus
        combinedScore = cand.semanticScore * 1.2 + cand.keywordScore * 0.8 + 0.3;
      } else if (hasSemantic) {
        match = 'semantic';
        // Semantic matches weighted higher than pure keyword matches when scores are close
        combinedScore = cand.semanticScore * 1.2;
      } else {
        match = 'keyword';
        combinedScore = cand.keywordScore * 0.8;
      }

      scoredCandidates.push({
        item: cand.item,
        match,
        combinedScore,
      });
    }

    // Sort by combined score descending, then updated_at descending
    scoredCandidates.sort((a, b) => {
      if (Math.abs(b.combinedScore - a.combinedScore) > 0.0001) {
        return b.combinedScore - a.combinedScore;
      }
      return new Date(b.item.updated_at).getTime() - new Date(a.item.updated_at).getTime();
    });

    const total = scoredCandidates.length;
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const offset = Math.max(options.offset ?? 0, 0);

    const paginated = scoredCandidates.slice(offset, offset + limit);
    const results: SearchMatchItem[] = paginated.map((c) => ({
      item: {
        ...c.item,
        tags: this.getItemTags(c.item.id),
      },
      match: c.match,
      score: Math.round(c.combinedScore * 1000) / 1000,
    }));

    const isDegraded = !isProviderHealthy || !semanticSucceeded;

    return {
      results,
      total,
      limit,
      offset,
      degraded: isDegraded,
      message: isDegraded ? 'Embedding provider is unavailable; degraded to keyword search' : undefined,
    };
  }

  /**
   * Add a link between an item and another item or an external URL (§11 Step 5).
   * Validates both ends, duplicate idempotency, and relation types.
   */
  addLink(input: AddLinkInput): ItemLink {
    if (!input.from_item_id) {
      throw new Error('from_item_id is required');
    }

    // 1. Verify from_item exists and is not deleted
    const fromItem = this.getNote(input.from_item_id);
    if (!fromItem) {
      throw new Error('Source item not found or has been deleted');
    }

    // 2. Validate target: exactly one of to_item_id or external_url
    const hasToItem = Boolean(input.to_item_id && input.to_item_id.trim());
    const hasUrl = Boolean(input.external_url && input.external_url.trim());

    if (hasToItem && hasUrl) {
      throw new Error('Provide either to_item_id or external_url, not both');
    }
    if (!hasToItem && !hasUrl) {
      throw new Error('Either to_item_id or external_url must be provided');
    }

    // 3. Validate relation
    const validRelations: LinkRelation[] = ['spawned', 'blocks', 'related', 'reference'];
    if (!validRelations.includes(input.relation)) {
      throw new Error(`Invalid link relation: '${input.relation}'. Must be one of: ${validRelations.join(', ')}`);
    }

    let toItemId: string | null = null;
    let externalUrl: string | null = null;

    if (hasToItem) {
      toItemId = input.to_item_id!.trim();
      if (toItemId === input.from_item_id) {
        throw new Error('Cannot link an item to itself');
      }
      const toItem = this.getNote(toItemId);
      if (!toItem) {
        throw new Error('Target item not found or has been deleted');
      }
    } else {
      externalUrl = input.external_url!.trim();
    }

    // 4. Duplicate identical links (same from/to/relation) -> return existing row
    if (toItemId) {
      const existing = this.db
        .prepare(
          `SELECT * FROM item_links 
           WHERE from_item_id = ? AND to_item_id = ? AND relation = ?`
        )
        .get(input.from_item_id, toItemId, input.relation) as ItemLink | undefined;

      if (existing) {
        return existing;
      }
    } else if (externalUrl) {
      const existing = this.db
        .prepare(
          `SELECT * FROM item_links 
           WHERE from_item_id = ? AND external_url = ? AND relation = ?`
        )
        .get(input.from_item_id, externalUrl, input.relation) as ItemLink | undefined;

      if (existing) {
        return existing;
      }
    }

    // 5. Insert new link
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO item_links (id, from_item_id, to_item_id, external_url, relation, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.from_item_id, toItemId, externalUrl, input.relation, createdAt);

    return {
      id,
      from_item_id: input.from_item_id,
      to_item_id: toItemId,
      external_url: externalUrl,
      relation: input.relation,
      created_at: createdAt,
    };
  }

  /**
   * Get all outgoing and incoming links (backlinks) for an item (§11 Step 5).
   * Resolves the other end (title and type for items; URL for external).
   * If the other end was later soft-deleted, it is still included with deleted: true.
   */
  getItemLinks(itemId: string): ItemLinksResult {
    const item = this.getNote(itemId);
    if (!item) {
      throw new Error('Item not found or has been deleted');
    }

    // Outgoing links (from_item_id = itemId)
    const outgoingRows = this.db
      .prepare(
        `SELECT l.*, i.title as target_title, i.type as target_type, i.deleted_at as target_deleted_at
         FROM item_links l
         LEFT JOIN items i ON l.to_item_id = i.id
         WHERE l.from_item_id = ?
         ORDER BY l.created_at ASC`
      )
      .all(itemId) as Array<{
        id: string;
        from_item_id: string;
        to_item_id: string | null;
        external_url: string | null;
        relation: LinkRelation;
        created_at: string;
        target_title: string | null;
        target_type: ItemType | null;
        target_deleted_at: string | null;
      }>;

    const outgoing: OutgoingLinkItem[] = outgoingRows.map((row) => {
      let target: ResolvedLinkEnd | null = null;
      let isDeleted = false;

      if (row.to_item_id) {
        isDeleted = row.target_deleted_at !== null;
        target = {
          id: row.to_item_id,
          title: row.target_title ?? '[Deleted Item]',
          type: row.target_type ?? 'note',
          deleted: isDeleted,
        };
      }

      return {
        id: row.id,
        from_item_id: row.from_item_id,
        to_item_id: row.to_item_id,
        external_url: row.external_url,
        relation: row.relation,
        created_at: row.created_at,
        target,
        item: target,
        to_item: target,
        deleted: isDeleted,
      };
    });

    // Incoming links (to_item_id = itemId)
    const incomingRows = this.db
      .prepare(
        `SELECT l.*, i.title as source_title, i.type as source_type, i.deleted_at as source_deleted_at
         FROM item_links l
         JOIN items i ON l.from_item_id = i.id
         WHERE l.to_item_id = ?
         ORDER BY l.created_at ASC`
      )
      .all(itemId) as Array<{
        id: string;
        from_item_id: string;
        to_item_id: string;
        external_url: string | null;
        relation: LinkRelation;
        created_at: string;
        source_title: string | null;
        source_type: ItemType | null;
        source_deleted_at: string | null;
      }>;

    const incoming: IncomingLinkItem[] = incomingRows.map((row) => {
      const isDeleted = row.source_deleted_at !== null;
      const source: ResolvedLinkEnd = {
        id: row.from_item_id,
        title: row.source_title ?? '[Deleted Item]',
        type: row.source_type ?? 'note',
        deleted: isDeleted,
      };

      return {
        id: row.id,
        from_item_id: row.from_item_id,
        to_item_id: row.to_item_id,
        external_url: row.external_url,
        relation: row.relation,
        created_at: row.created_at,
        source,
        item: source,
        from_item: source,
        deleted: isDeleted,
      };
    });

    return {
      outgoing,
      incoming,
    };
  }

  /**
   * Get soft-deleted items for the Deleted view (§10 Screen 1).
   */
  getDeletedItems(limit = 50, offset = 0): { items: ItemWithTags[]; total: number } {
    const totalRow = this.db
      .prepare('SELECT COUNT(*) as count FROM items WHERE deleted_at IS NOT NULL')
      .get() as { count: number };
    const items = this.db
      .prepare(
        'SELECT * FROM items WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT ? OFFSET ?'
      )
      .all(limit, offset) as Item[];
    return {
      items: items.map((it) => ({ ...it, tags: this.getItemTags(it.id) })),
      total: totalRow.count,
    };
  }
}

