import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDatabase } from '../src/db.js';
import { seedLists } from '../src/seed.js';
import { NoteKeeperService } from '../src/service.js';

describe('NoteKeeperService CRUD & Revisions', () => {
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

  describe('List operations', () => {
    it('creates a new list with sort_order and private flags', () => {
      const list = service.createList({
        name: 'Personal Journal',
        category: 'personal',
        private: true,
      });

      expect(list.id).toBeDefined();
      expect(list.name).toBe('Personal Journal');
      expect(list.category).toBe('personal');
      expect(list.private).toBe(1);
      expect(list.sync_excluded).toBe(1); // D6: private implies sync_excluded
      expect(list.sort_order).toBe(7); // seed had 0..6
    });

    it('rejects creating list with missing name or category', () => {
      expect(() => service.createList({ name: '', category: 'cat' })).toThrow(/name is required/i);
      expect(() => service.createList({ name: 'Valid', category: '' })).toThrow(/category is required/i);
    });

    it('rejects creating list with invalid parent_list_id', () => {
      expect(() =>
        service.createList({
          name: 'Child',
          category: 'cat',
          parent_list_id: 'non-existent-id',
        })
      ).toThrow(/Parent list not found/i);
    });
  });

  describe('Item Add & FTS sync', () => {
    it('adds a note with default list (Ideas & Tasks) and type (note)', () => {
      const item = service.addNote({
        title: 'Fresh Thought',
        body: 'Just capture it',
        author: 'scotty',
      });

      expect(item.id).toBeDefined();
      expect(item.title).toBe('Fresh Thought');
      expect(item.body).toBe('Just capture it');
      expect(item.type).toBe('note');
      expect(item.status).toBe('open');
      expect(item.author).toBe('scotty');
      expect(item.embedding_status).toBe('pending');

      const inbox = service.getList('Ideas & Tasks')!.list;
      expect(item.list_id).toBe(inbox.id);

      // Verify FTS table updated via trigger
      const fts = db
        .prepare("SELECT * FROM items_fts WHERE items_fts MATCH 'Fresh'")
        .all() as any[];
      expect(fts.length).toBe(1);
      expect(fts[0].title).toBe('Fresh Thought');

      // Verify initial revision recorded with kind 'create'
      const revisions = db
        .prepare('SELECT * FROM revisions WHERE item_id = ?')
        .all(item.id) as any[];
      expect(revisions.length).toBe(1);
      expect(revisions[0].kind).toBe('create');
      expect(revisions[0].author).toBe('scotty');
      const snapshot = JSON.parse(revisions[0].snapshot);
      expect(snapshot.title).toBe('Fresh Thought');
    });

    it('normalizes, deduplicates, and lowercases tags', () => {
      const item = service.addNote({
        title: 'Tagged Item',
        author: 'cooper',
        tags: ['Quantum', '  QUANTUM ', 'Fleet', 'fleet', 'ai'],
      });

      expect(item.tags).toEqual(['ai', 'fleet', 'quantum']);
    });

    it('validates due_at format', () => {
      expect(() =>
        service.addNote({
          title: 'Bad Date',
          author: 'cooper',
          due_at: 'not-a-date',
        })
      ).toThrow(/Invalid due_at date format/i);

      const valid = service.addNote({
        title: 'Good Date',
        author: 'cooper',
        due_at: '2026-10-31T12:00:00Z',
      });
      expect(valid.due_at).toBe('2026-10-31T12:00:00.000Z');
    });

    it('validates invalid priority, type, or missing author', () => {
      expect(() =>
        service.addNote({ title: 'T', author: '' })
      ).toThrow(/Author is required/i);

      expect(() =>
        service.addNote({ title: '', author: 'cooper' })
      ).toThrow(/Title is required/i);

      expect(() =>
        service.addNote({ title: 'T', author: 'cooper', type: 'invalid' as any })
      ).toThrow(/Invalid item type/i);

      expect(() =>
        service.addNote({ title: 'T', author: 'cooper', priority: 5 as any })
      ).toThrow(/Invalid priority/i);
    });

    it('validates sub-item parent exists and is in the same list', () => {
      const parent = service.addNote({
        title: 'Parent Task',
        author: 'cooper',
        list: 'Quantum',
      });

      // Valid sub-item
      const child = service.addNote({
        title: 'Child Task',
        author: 'cooper',
        list: 'Quantum',
        parent_item_id: parent.id,
      });
      expect(child.parent_item_id).toBe(parent.id);

      // Parent in different list
      expect(() =>
        service.addNote({
          title: 'Cross list child',
          author: 'cooper',
          list: 'Ideas & Tasks',
          parent_item_id: parent.id,
        })
      ).toThrow(/Parent item is in a different list/i);

      // Nonexistent parent
      expect(() =>
        service.addNote({
          title: 'Ghost child',
          author: 'cooper',
          parent_item_id: 'nonexistent-uuid',
        })
      ).toThrow(/Parent item not found/i);
    });
  });

  describe('Full Mutation Round-Trip: Update, Complete, Reopen, Delete, Restore', () => {
    it('supports full lifecycle with correct revisions and snapshots', () => {
      // 1. Add item
      const item = service.addNote({
        title: 'Ship Notekeeper v1',
        body: 'Initial plan',
        type: 'task',
        priority: 2,
        author: 'cooper',
        tags: ['v1'],
      });

      // 2. Get note with revisions
      const fetched = service.getNote(item.id, { include_revisions: true });
      expect(fetched).not.toBeNull();
      expect(fetched?.title).toBe('Ship Notekeeper v1');
      expect(fetched?.revisions).toHaveLength(1);
      expect(fetched?.revisions![0].kind).toBe('create');

      // 3. Update fields (title, priority, tags)
      const updated = service.updateNote({
        id: item.id,
        author: 'scotty',
        title: 'Ship Quantum Notekeeper v1',
        body: 'Detailed plan with MCP',
        priority: 1,
        tags: ['v1', 'release'],
      });
      expect(updated.title).toBe('Ship Quantum Notekeeper v1');
      expect(updated.priority).toBe(1);
      expect(updated.tags).toEqual(['release', 'v1']);
      expect(updated.embedding_status).toBe('pending'); // Reset on content change

      // 4. Complete task
      const completed = service.completeNote(item.id, 'scotty');
      expect(completed.status).toBe('done');
      expect(completed.completed_at).not.toBeNull();

      // 5. Reopen task
      const reopened = service.reopenNote(item.id, 'cooper');
      expect(reopened.status).toBe('open');
      expect(reopened.completed_at).toBeNull();

      // 6. Delete task (soft delete)
      const del = service.deleteNote(item.id, 'cooper');
      expect(del.id).toBe(item.id);
      expect(del.deleted_at).toBeDefined();

      // Normal getNote fails
      expect(service.getNote(item.id)).toBeNull();

      // 7. Restore task
      const restored = service.restoreNote(item.id, 'scotty');
      expect(restored.deleted_at).toBeNull();
      expect(restored.status).toBe('open');

      // 8. Move item to another list
      const moved = service.moveItem(item.id, 'Creative', 'scotty');
      const creativeList = service.getList('Creative')!.list;
      expect(moved.list_id).toBe(creativeList.id);

      // Verify revision chain: create -> edit -> complete -> reopen -> delete -> restore -> move
      const finalNote = service.getNote(item.id, { include_revisions: true });
      expect(finalNote?.revisions).toHaveLength(7);
      const kinds = finalNote?.revisions?.map((r) => r.kind);
      expect(kinds).toEqual(['move', 'restore', 'delete', 'reopen', 'complete', 'edit', 'create']);
    });

    it('rejects complete and reopen on notes (only allowed on task/todo)', () => {
      const note = service.addNote({
        title: 'Just a note',
        type: 'note',
        author: 'scotty',
      });

      expect(() => service.completeNote(note.id, 'scotty')).toThrow(
        /Cannot complete item of type 'note'/i
      );
      expect(() => service.reopenNote(note.id, 'scotty')).toThrow(
        /Cannot reopen item of type 'note'/i
      );
    });
  });

  describe('Revision Coalesce Policy (§13b.2)', () => {
    it('coalesces edits when coalesce=true, same author, <5m, and no intervening event', () => {
      const note = service.addNote({
        title: 'Original Title',
        body: 'First draft',
        author: 'scotty',
      });

      // Edit 1 (no coalesce, or first edit)
      service.updateNote({
        id: note.id,
        author: 'scotty',
        body: 'Draft paragraph 1',
      });

      let revs = service.getNote(note.id, { include_revisions: true })!.revisions!;
      expect(revs).toHaveLength(2); // create + edit

      // Edit 2 with coalesce=true, same author, immediate
      service.updateNote({
        id: note.id,
        author: 'scotty',
        body: 'Draft paragraph 1 + 2',
        coalesce: true,
      });

      revs = service.getNote(note.id, { include_revisions: true })!.revisions!;
      expect(revs).toHaveLength(2); // Still 2: edit coalesced!

      // Snapshot updated with previous state
      const latestEditRev = revs[0];
      expect(latestEditRev.kind).toBe('edit');
      const snap = JSON.parse(latestEditRev.snapshot);
      expect(snap.body).toBe('Draft paragraph 1');
    });

    it('does NOT coalesce when author changes', () => {
      const note = service.addNote({
        title: 'Original',
        author: 'scotty',
      });

      service.updateNote({
        id: note.id,
        author: 'scotty',
        body: 'Edit by Scotty',
      });

      // Edit by Cooper with coalesce=true
      service.updateNote({
        id: note.id,
        author: 'cooper',
        body: 'Edit by Cooper',
        coalesce: true,
      });

      const revs = service.getNote(note.id, { include_revisions: true })!.revisions!;
      expect(revs).toHaveLength(3); // Does NOT coalesce: different author
    });

    it('does NOT coalesce when intervening complete event occurs', () => {
      const task = service.addNote({
        title: 'Task',
        type: 'task',
        author: 'scotty',
      });

      service.updateNote({
        id: task.id,
        author: 'scotty',
        title: 'Task v2',
      });

      // Complete breaks coalesce window
      service.completeNote(task.id, 'scotty');

      // Next edit with coalesce=true cannot coalesce because latest is 'complete', not 'edit'
      service.updateNote({
        id: task.id,
        author: 'scotty',
        title: 'Task v3',
        coalesce: true,
      });

      const revs = service.getNote(task.id, { include_revisions: true })!.revisions!;
      expect(revs).toHaveLength(4); // create, edit, complete, edit
    });

    it('does NOT coalesce when older than 5 minutes', () => {
      const note = service.addNote({
        title: 'Old note',
        author: 'scotty',
      });

      service.updateNote({
        id: note.id,
        author: 'scotty',
        title: 'Old edit',
      });

      // Artificially age the latest revision to 6 minutes ago
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      db.prepare("UPDATE revisions SET created_at = ? WHERE kind = 'edit'").run(sixMinutesAgo);

      // Now edit with coalesce=true
      service.updateNote({
        id: note.id,
        author: 'scotty',
        title: 'New edit after 6m',
        coalesce: true,
      });

      const revs = service.getNote(note.id, { include_revisions: true })!.revisions!;
      expect(revs).toHaveLength(3); // Did NOT coalesce because >5m
    });
  });

  describe('listItems query, sorting, and pagination', () => {
    it('filters by status, type, and pagination', () => {
      const inbox = service.getList('Ideas & Tasks')!.list;

      for (let i = 1; i <= 5; i++) {
        service.addNote({
          title: `Item ${i}`,
          type: i % 2 === 0 ? 'task' : 'note',
          author: 'cooper',
          list: inbox.id,
        });
      }

      // Complete item 2
      const all = service.listItems({ list: inbox.id });
      expect(all.total).toBe(5);
      expect(all.items).toHaveLength(5);

      const task2 = all.items.find((it) => it.title === 'Item 2')!;
      service.completeNote(task2.id, 'cooper');

      // Filter by status=open
      const openOnly = service.listItems({ list: inbox.id, status: 'open' });
      expect(openOnly.total).toBe(4);

      // Filter by type=note
      const notesOnly = service.listItems({ list: inbox.id, type: 'note' });
      expect(notesOnly.total).toBe(3);

      // Pagination
      const page1 = service.listItems({ list: inbox.id, limit: 2, offset: 0 });
      expect(page1.items).toHaveLength(2);
      expect(page1.total).toBe(5);
      expect(page1.limit).toBe(2);
      expect(page1.offset).toBe(0);

      const page2 = service.listItems({ list: inbox.id, limit: 2, offset: 2 });
      expect(page2.items).toHaveLength(2);
      expect(page2.offset).toBe(2);
    });

    it('sorts by due soon -> priority (1 first, nulls last) -> updated_at desc', () => {
      const inbox = service.getList('Ideas & Tasks')!.list;

      const i1 = service.addNote({
        title: 'No due date, no priority',
        author: 'scotty',
        list: inbox.id,
      });

      const i2 = service.addNote({
        title: 'Priority 3, no due date',
        priority: 3,
        author: 'scotty',
        list: inbox.id,
      });

      const i3 = service.addNote({
        title: 'Priority 1, no due date',
        priority: 1,
        author: 'scotty',
        list: inbox.id,
      });

      const i4 = service.addNote({
        title: 'Due tomorrow',
        due_at: '2026-10-16T10:00:00Z',
        author: 'scotty',
        list: inbox.id,
      });

      const i5 = service.addNote({
        title: 'Due next week',
        due_at: '2026-10-23T10:00:00Z',
        author: 'scotty',
        list: inbox.id,
      });

      const res = service.listItems({ list: inbox.id });
      const titles = res.items.map((it) => it.title);

      // Expected order:
      // 1. Due tomorrow (soonest due date)
      // 2. Due next week (later due date)
      // 3. Priority 1 (high priority, no due date)
      // 4. Priority 3 (low priority, no due date)
      // 5. No due date, no priority (null priority, no due date)
      expect(titles).toEqual([
        'Due tomorrow',
        'Due next week',
        'Priority 1, no due date',
        'Priority 3, no due date',
        'No due date, no priority',
      ]);
    });

    it('excludes sub-items when include_subitems=false', () => {
      const inbox = service.getList('Ideas & Tasks')!.list;
      const parent = service.addNote({
        title: 'Parent',
        author: 'scotty',
        list: inbox.id,
      });
      service.addNote({
        title: 'Child',
        author: 'scotty',
        list: inbox.id,
        parent_item_id: parent.id,
      });

      const all = service.listItems({ list: inbox.id, include_subitems: true });
      expect(all.total).toBe(2);

      const topOnly = service.listItems({ list: inbox.id, include_subitems: false });
      expect(topOnly.total).toBe(1);
      expect(topOnly.items[0].title).toBe('Parent');
    });
  });

  describe('Item Links & Backlinks (§11 Step 5)', () => {
    it('creates internal link and resolves outgoing and incoming backlinks', () => {
      const itemA = service.addNote({
        title: 'Task Alpha',
        type: 'task',
        author: 'scotty',
      });
      const itemB = service.addNote({
        title: 'Note Beta',
        type: 'note',
        author: 'scotty',
      });

      const link = service.addLink({
        from_item_id: itemA.id,
        to_item_id: itemB.id,
        relation: 'spawned',
        author: 'scotty',
      });

      expect(link.id).toBeDefined();
      expect(link.from_item_id).toBe(itemA.id);
      expect(link.to_item_id).toBe(itemB.id);
      expect(link.relation).toBe('spawned');

      // Check outgoing on itemA
      const linksA = service.getItemLinks(itemA.id);
      expect(linksA.outgoing).toHaveLength(1);
      expect(linksA.incoming).toHaveLength(0);
      expect(linksA.outgoing[0].id).toBe(link.id);
      expect(linksA.outgoing[0].target?.id).toBe(itemB.id);
      expect(linksA.outgoing[0].target?.title).toBe('Note Beta');
      expect(linksA.outgoing[0].target?.type).toBe('note');
      expect(linksA.outgoing[0].target?.deleted).toBe(false);

      // Check incoming on itemB (backlink)
      const linksB = service.getItemLinks(itemB.id);
      expect(linksB.incoming).toHaveLength(1);
      expect(linksB.outgoing).toHaveLength(0);
      expect(linksB.incoming[0].id).toBe(link.id);
      expect(linksB.incoming[0].source.id).toBe(itemA.id);
      expect(linksB.incoming[0].source.title).toBe('Task Alpha');
      expect(linksB.incoming[0].source.type).toBe('task');
      expect(linksB.incoming[0].source.deleted).toBe(false);
    });

    it('creates external link with URL and resolves relation and URL', () => {
      const item = service.addNote({
        title: 'Quantum Issue Research',
        author: 'scotty',
      });

      const link = service.addLink({
        from_item_id: item.id,
        external_url: 'https://github.com/dsect-net/quantum/issues/42',
        relation: 'reference',
        author: 'cooper',
      });

      expect(link.id).toBeDefined();
      expect(link.from_item_id).toBe(item.id);
      expect(link.to_item_id).toBeNull();
      expect(link.external_url).toBe('https://github.com/dsect-net/quantum/issues/42');
      expect(link.relation).toBe('reference');

      const links = service.getItemLinks(item.id);
      expect(links.outgoing).toHaveLength(1);
      expect(links.outgoing[0].external_url).toBe('https://github.com/dsect-net/quantum/issues/42');
      expect(links.outgoing[0].relation).toBe('reference');
      expect(links.outgoing[0].target).toBeNull();
    });

    it('duplicate identical link returns existing row without creating duplicate', () => {
      const itemA = service.addNote({ title: 'A', author: 'scotty' });
      const itemB = service.addNote({ title: 'B', author: 'scotty' });

      const link1 = service.addLink({
        from_item_id: itemA.id,
        to_item_id: itemB.id,
        relation: 'related',
        author: 'scotty',
      });

      const link2 = service.addLink({
        from_item_id: itemA.id,
        to_item_id: itemB.id,
        relation: 'related',
        author: 'cooper',
      });

      expect(link2.id).toBe(link1.id);
      expect(service.getItemLinks(itemA.id).outgoing).toHaveLength(1);

      // External duplicate test
      const ext1 = service.addLink({
        from_item_id: itemA.id,
        external_url: 'https://dsect.net',
        relation: 'reference',
      });
      const ext2 = service.addLink({
        from_item_id: itemA.id,
        external_url: 'https://dsect.net',
        relation: 'reference',
      });
      expect(ext2.id).toBe(ext1.id);
      expect(service.getItemLinks(itemA.id).outgoing).toHaveLength(2);
    });

    it('validates targets and relations, rejecting invalid configurations', () => {
      const itemA = service.addNote({ title: 'A', author: 'scotty' });
      const itemB = service.addNote({ title: 'B', author: 'scotty' });

      // Both targets provided
      expect(() =>
        service.addLink({
          from_item_id: itemA.id,
          to_item_id: itemB.id,
          external_url: 'https://example.com',
          relation: 'related',
        })
      ).toThrow(/Provide either to_item_id or external_url, not both/i);

      // Neither target provided
      expect(() =>
        service.addLink({
          from_item_id: itemA.id,
          relation: 'related',
        })
      ).toThrow(/Either to_item_id or external_url must be provided/i);

      // Invalid relation
      expect(() =>
        service.addLink({
          from_item_id: itemA.id,
          to_item_id: itemB.id,
          relation: 'invalid-rel' as any,
        })
      ).toThrow(/Invalid link relation/i);

      // Self-link
      expect(() =>
        service.addLink({
          from_item_id: itemA.id,
          to_item_id: itemA.id,
          relation: 'related',
        })
      ).toThrow(/Cannot link an item to itself/i);
    });

    it('rejects creating links involving soft-deleted items', () => {
      const itemA = service.addNote({ title: 'Live A', author: 'scotty' });
      const itemB = service.addNote({ title: 'Live B', author: 'scotty' });
      const itemDeleted = service.addNote({ title: 'Deleted C', author: 'scotty' });
      service.deleteNote(itemDeleted.id, 'scotty');

      // from_item is deleted
      expect(() =>
        service.addLink({
          from_item_id: itemDeleted.id,
          to_item_id: itemA.id,
          relation: 'related',
        })
      ).toThrow(/Source item not found or has been deleted/i);

      // to_item is deleted
      expect(() =>
        service.addLink({
          from_item_id: itemA.id,
          to_item_id: itemDeleted.id,
          relation: 'related',
        })
      ).toThrow(/Target item not found or has been deleted/i);

      // getItemLinks on deleted item
      expect(() => service.getItemLinks(itemDeleted.id)).toThrow(/Item not found or has been deleted/i);
    });

    it('marks deleted: true on the resolved end when the other end is soft-deleted later', () => {
      const itemA = service.addNote({ title: 'Item A', author: 'scotty' });
      const itemB = service.addNote({ title: 'Item B', author: 'scotty' });

      service.addLink({
        from_item_id: itemA.id,
        to_item_id: itemB.id,
        relation: 'blocks',
        author: 'scotty',
      });

      // Soft delete B
      service.deleteNote(itemB.id, 'scotty');

      // Calling getItemLinks on live item A still returns the link, with target marked deleted: true
      const linksA = service.getItemLinks(itemA.id);
      expect(linksA.outgoing).toHaveLength(1);
      expect(linksA.outgoing[0].target?.id).toBe(itemB.id);
      expect(linksA.outgoing[0].target?.deleted).toBe(true);
      expect(linksA.outgoing[0].deleted).toBe(true);

      // Restore B, soft-delete A
      service.restoreNote(itemB.id, 'scotty');
      service.deleteNote(itemA.id, 'scotty');

      // Calling getItemLinks on live item B still returns the link, with source marked deleted: true
      const linksB = service.getItemLinks(itemB.id);
      expect(linksB.incoming).toHaveLength(1);
      expect(linksB.incoming[0].source.id).toBe(itemA.id);
      expect(linksB.incoming[0].source.deleted).toBe(true);
      expect(linksB.incoming[0].deleted).toBe(true);
    });
  });
});
