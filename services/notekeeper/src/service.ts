import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { getCurrentSchemaVersion } from './db.js';
import {
  Item,
  ItemStatus,
  ItemType,
  ItemWithTags,
  List,
  ListCounts,
  ListCreateInput,
  ListGetResult,
  ListItemsOptions,
  ListItemsResult,
  NoteAddInput,
  NoteUpdateInput,
  Revision,
  RevisionKind,
} from './types.js';

export class NoteKeeperService {
  constructor(private db: Database.Database) {}

  getDb(): Database.Database {
    return this.db;
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

    const statusRows = this.db
      .prepare(
        `SELECT status, COUNT(*) as count 
         FROM items 
         WHERE list_id = ? AND deleted_at IS NULL 
         GROUP BY status`
      )
      .all(list.id) as Array<{ status: string; count: number }>;

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

  private getItemTags(itemId: string): string[] {
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
}
