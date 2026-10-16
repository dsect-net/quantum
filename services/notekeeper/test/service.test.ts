import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDatabase } from '../src/db.js';
import { seedLists } from '../src/seed.js';
import { NoteKeeperService } from '../src/service.js';

describe('NoteKeeperService', () => {
  let db: Database.Database;
  let service: NoteKeeperService;

  beforeEach(() => {
    db = openDatabase(':memory:');
    seedLists(db);
    service = new NoteKeeperService(db);
  });

  afterEach(() => {
    db.close();
  });

  it('getList finds a list by exact name', () => {
    const result = service.getList('Ideas & Tasks');
    expect(result).not.toBeNull();
    expect(result?.list.name).toBe('Ideas & Tasks');
    expect(result?.list.category).toBe('inbox');
    expect(result?.counts).toEqual({
      open: 0,
      done: 0,
      archived: 0,
      total: 0,
    });
  });

  it('getList finds a list by UUID id', () => {
    const lists = service.getAllLists();
    expect(lists.length).toBe(7);

    const targetList = lists[0];
    const result = service.getList(targetList.id);
    expect(result).not.toBeNull();
    expect(result?.list.id).toBe(targetList.id);
    expect(result?.list.name).toBe(targetList.name);
  });

  it('getList calculates status counts correctly across open, done, and archived items', () => {
    const inbox = service.getList('Ideas & Tasks')!.list;

    const insertItem = db.prepare(`
      INSERT INTO items (id, list_id, type, title, author, status, created_at, updated_at)
      VALUES (?, ?, 'task', ?, 'cooper', ?, datetime('now'), datetime('now'))
    `);

    // 2 open, 1 done, 1 archived
    insertItem.run('item-1', inbox.id, 'Task 1', 'open');
    insertItem.run('item-2', inbox.id, 'Task 2', 'open');
    insertItem.run('item-3', inbox.id, 'Task 3', 'done');
    insertItem.run('item-4', inbox.id, 'Task 4', 'archived');

    const result = service.getList(inbox.id);
    expect(result).not.toBeNull();
    expect(result?.counts).toEqual({
      open: 2,
      done: 1,
      archived: 1,
      total: 4,
    });
  });

  it('getList excludes soft-deleted items from counts', () => {
    const inbox = service.getList('Ideas & Tasks')!.list;

    const insertItem = db.prepare(`
      INSERT INTO items (id, list_id, type, title, author, status, deleted_at, created_at, updated_at)
      VALUES (?, ?, 'note', ?, 'scotty', ?, ?, datetime('now'), datetime('now'))
    `);

    insertItem.run('active-1', inbox.id, 'Active note', 'open', null);
    insertItem.run('deleted-1', inbox.id, 'Deleted note', 'open', new Date().toISOString());

    const result = service.getList(inbox.id);
    expect(result?.counts.open).toBe(1);
    expect(result?.counts.total).toBe(1);
  });

  it('getList returns null when list does not exist', () => {
    expect(service.getList('Nonexistent List')).toBeNull();
    expect(service.getList('00000000-0000-0000-0000-000000000000')).toBeNull();
    expect(service.getList('')).toBeNull();
    expect(service.getList('   ')).toBeNull();
  });

  it('getListsCount returns active lists count', () => {
    expect(service.getListsCount()).toBe(7);

    // Archive one list
    db.prepare("UPDATE lists SET archived_at = datetime('now') WHERE name = 'Finance'").run();
    expect(service.getListsCount()).toBe(6);
  });
});
