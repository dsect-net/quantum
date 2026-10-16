import Database from 'better-sqlite3';
import { getCurrentSchemaVersion } from './db.js';
import { List, ListCounts, ListGetResult } from './types.js';

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

  getList(idOrName: string): ListGetResult | null {
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
}
