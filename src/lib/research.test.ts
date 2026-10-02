/**
 * Research store tests: projects/documents CRUD against a mocked
 * localStorage. Everything is local-only — the contract under test is
 * exactly that.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createDocument,
  createProject,
  deleteDocument,
  deleteProject,
  exportProjectMarkdown,
  getProject,
  listProjects,
  updateDocument,
  updateProject,
  STORE_KEY,
} from './research';

function makeStorage() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      store = {};
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  };
}

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', {
    value: makeStorage(),
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  window.localStorage.clear();
});

describe('projects', () => {
  it('starts empty', () => {
    expect(listProjects()).toEqual([]);
  });

  it('creates and retrieves projects', () => {
    const p = createProject('CIRCE', 'Nanoparticle platform');
    expect(p.title).toBe('CIRCE');
    expect(listProjects()).toHaveLength(1);
    expect(getProject(p.id)?.title).toBe('CIRCE');
  });

  it('updates title and summary', () => {
    const p = createProject('Old');
    updateProject(p.id, { title: 'New', summary: 'S' });
    expect(getProject(p.id)?.title).toBe('New');
    expect(getProject(p.id)?.summary).toBe('S');
  });

  it('deletes projects', () => {
    const p = createProject('Gone');
    expect(deleteProject(p.id)).toBe(true);
    expect(listProjects()).toHaveLength(0);
    expect(deleteProject('nope')).toBe(false);
  });

  it('falls back to a title for blank input', () => {
    expect(createProject('   ').title).toBe('Untitled project');
  });

  it('survives a corrupt store', () => {
    window.localStorage.setItem(STORE_KEY, '{not json');
    expect(listProjects()).toEqual([]);
    window.localStorage.setItem(STORE_KEY, JSON.stringify([{ nope: 1 }]));
    expect(listProjects()).toEqual([]);
  });
});

describe('documents', () => {
  it('creates, updates, and deletes documents inside a project', () => {
    const p = createProject('P');
    const d = createDocument(p.id, 'Spec', '# intro')!;
    expect(getProject(p.id)?.documents).toHaveLength(1);
    updateDocument(p.id, d.id, { body: '# intro\n\nmore' });
    expect(getProject(p.id)?.documents[0].body).toContain('more');
    expect(deleteDocument(p.id, d.id)).toBe(true);
    expect(getProject(p.id)?.documents).toHaveLength(0);
  });

  it('returns null for unknown projects', () => {
    expect(createDocument('nope', 'T')).toBeNull();
    expect(updateDocument('nope', 'nope', { body: 'x' })).toBeNull();
    expect(deleteDocument('nope', 'nope')).toBe(false);
  });
});

describe('exportProjectMarkdown', () => {
  it('renders a single markdown doc with the local-only marker', () => {
    const p = createProject('CIRCE', 'A platform');
    createDocument(p.id, 'Design', 'Details here.');
    const md = exportProjectMarkdown(getProject(p.id)!);
    expect(md).toContain('# CIRCE');
    expect(md).toContain('## Design');
    expect(md).toContain('Details here.');
    expect(md).toContain('On this device only');
  });
});
