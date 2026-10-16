import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDatabase } from '../src/db.js';
import { seedLists } from '../src/seed.js';
import { NoteKeeperService } from '../src/service.js';
import {
  ConceptFakeEmbeddingProvider,
  DeterministicFakeEmbeddingProvider,
  OllamaEmbeddingProvider,
} from '../src/embeddings.js';

describe('Step 4: Hybrid Semantic Search & Embedding Lifecycle', () => {
  let db: Database.Database;
  let service: NoteKeeperService;
  let conceptProvider: ConceptFakeEmbeddingProvider;

  beforeEach(() => {
    db = openDatabase(':memory:');
    seedLists(db);
    conceptProvider = new ConceptFakeEmbeddingProvider();
    service = new NoteKeeperService(db, conceptProvider);
  });

  afterEach(() => {
    db.close();
  });

  it('async embedding lifecycle: note_add sets pending, runEmbeddingPass embeds and marks done', async () => {
    const item = service.addNote({
      title: 'Async Embedding Architecture',
      body: 'Writes never block on Ollama',
      author: 'cooper',
    });

    expect(item.embedding_status).toBe('pending');

    // Embeddings table is initially empty for this item
    const preEmb = db
      .prepare('SELECT * FROM embeddings WHERE item_id = ?')
      .get(item.id);
    expect(preEmb).toBeUndefined();

    // Run the embedding pass
    const passResult = await service.runEmbeddingPass();
    expect(passResult.processed).toBe(1);
    expect(passResult.succeeded).toBe(1);

    // Item embedding_status is now 'done'
    const updatedItem = service.getNote(item.id);
    expect(updatedItem?.embedding_status).toBe('done');

    // Embeddings table has the row
    const postEmb = db
      .prepare('SELECT * FROM embeddings WHERE item_id = ? AND model_id = ?')
      .get(item.id, conceptProvider.modelId) as { vector: Buffer; embedded_at: string };
    expect(postEmb).toBeDefined();
    expect(postEmb.vector.byteLength).toBe(conceptProvider.dimensions * 4);
  });

  it('re-embed on edit: updating title/body resets status to pending and refreshes embedding row', async () => {
    const item = service.addNote({
      title: 'Original Title',
      body: 'Apple fruit recipe',
      author: 'scotty',
    });

    await service.runEmbeddingPass();
    const initialEmb = db
      .prepare('SELECT * FROM embeddings WHERE item_id = ?')
      .get(item.id) as { vector: Buffer; embedded_at: string };
    expect(initialEmb).toBeDefined();

    // Update body
    service.updateNote({
      id: item.id,
      author: 'scotty',
      body: 'Automobile vehicle maintenance repair',
    });

    // embedding_status reset to 'pending'
    const noteAfterEdit = service.getNote(item.id);
    expect(noteAfterEdit?.embedding_status).toBe('pending');

    // Run embedding pass again
    await service.runEmbeddingPass();

    const refreshedEmb = db
      .prepare('SELECT * FROM embeddings WHERE item_id = ?')
      .get(item.id) as { vector: Buffer; embedded_at: string };

    expect(refreshedEmb).toBeDefined();
    // Vector content changed because text changed
    const v1 = new Float32Array(initialEmb.vector.buffer, initialEmb.vector.byteOffset, initialEmb.vector.byteLength / 4);
    const v2 = new Float32Array(refreshedEmb.vector.buffer, refreshedEmb.vector.byteOffset, refreshedEmb.vector.byteLength / 4);
    expect(v1).not.toEqual(v2);

    const refreshedItem = service.getNote(item.id);
    expect(refreshedItem?.embedding_status).toBe('done');
  });

  it('paraphrase acceptance test (brief §14): finds item sharing ZERO keywords with query', async () => {
    // Add item about automobile repair
    const item = service.addNote({
      title: 'Automobile repair appointment',
      body: 'Scheduled vehicle servicing',
      author: 'scotty',
      list: 'Ideas & Tasks',
    });

    // Add unrelated item
    service.addNote({
      title: 'Apple recipe kitchen',
      body: 'Baking food instructions',
      author: 'scotty',
      list: 'Ideas & Tasks',
    });

    await service.runEmbeddingPass();

    // Search query: "car mechanic"
    // "car" and "mechanic" share ZERO words with "Automobile repair appointment" / "Scheduled vehicle servicing"
    const searchRes = await service.searchNotes({
      query: 'car mechanic',
      list: 'Ideas & Tasks',
    });

    expect(searchRes.degraded).toBe(false);
    expect(searchRes.results.length).toBeGreaterThanOrEqual(1);

    const topResult = searchRes.results[0];
    expect(topResult.item.id).toBe(item.id);
    expect(topResult.item.title).toBe('Automobile repair appointment');
    expect(topResult.match).toBe('semantic');
    expect(topResult.score).toBeGreaterThan(0.5);
  });

  it('hybrid ranking: both > semantic > keyword when scores are close', async () => {
    // 1. Matches both keywords ('automobile', 'repair') and semantic (automobile repair concept)
    const bothItem = service.addNote({
      title: 'Automobile repair shop',
      body: 'Engine servicing',
      author: 'scotty',
    });

    // 2. Pure semantic match: 'vehicle maintenance' vs query 'automobile repair workshop' (zero keyword overlap)
    const semanticItem = service.addNote({
      title: 'Vehicle maintenance servicing',
      body: 'Scheduled checkup',
      author: 'scotty',
    });

    // 3. Pure keyword match: matches keyword 'workshop', zero concept overlap
    const keywordItem = service.addNote({
      title: 'Artist workshop studio',
      body: 'Painting supplies',
      author: 'scotty',
    });

    await service.runEmbeddingPass();

    // Query 'automobile repair workshop'
    const results = await service.searchNotes({ query: 'automobile repair workshop' });
    expect(results.results.length).toBeGreaterThanOrEqual(3);

    const topItem = results.results[0];
    expect(topItem.item.id).toBe(bothItem.id);
    expect(topItem.match).toBe('both');

    const semanticMatch = results.results.find((r) => r.item.id === semanticItem.id);
    expect(semanticMatch).toBeDefined();
    expect(semanticMatch?.match).toBe('semantic');

    const keywordMatch = results.results.find((r) => r.item.id === keywordItem.id);
    expect(keywordMatch).toBeDefined();
    expect(keywordMatch?.match).toBe('keyword');

    // Also assert the rank order: both > semantic > keyword
    const bothRank = results.results.findIndex((r) => r.item.id === bothItem.id);
    const semanticRank = results.results.findIndex((r) => r.item.id === semanticItem.id);
    const keywordRank = results.results.findIndex((r) => r.item.id === keywordItem.id);
    expect(bothRank).toBeLessThan(semanticRank);
    expect(semanticRank).toBeLessThan(keywordRank);
  });

  it('degradation test: provider health=false degrades to keyword-only search with degraded=true and no throw', async () => {
    // Add items
    service.addNote({
      title: 'Quantum Compiler Pipeline',
      body: 'Local build and optimize',
      author: 'cooper',
    });
    service.addNote({
      title: 'Automobile repair',
      body: 'Vehicle servicing',
      author: 'scotty',
    });

    await service.runEmbeddingPass();

    // Simulate provider failure
    conceptProvider.isHealthy = false;

    // Search with keyword
    const searchRes = await service.searchNotes({
      query: 'Compiler',
    });

    expect(searchRes.degraded).toBe(true);
    expect(searchRes.message).toMatch(/unavailable; degraded to keyword search/i);
    expect(searchRes.results).toHaveLength(1);
    expect(searchRes.results[0].item.title).toBe('Quantum Compiler Pipeline');
    expect(searchRes.results[0].match).toBe('keyword');
  });

  it('filters: search filters by list, category, tag, type, and status', async () => {
    const listA = service.createList({ name: 'Alpha', category: 'cat-a' });
    const listB = service.createList({ name: 'Beta', category: 'cat-b' });

    service.addNote({
      title: 'Alpha Note',
      body: 'Shared keyword content',
      list: listA.id,
      type: 'note',
      status: 'open',
      tags: ['alpha'],
      author: 'scotty',
    });

    const betaItem = service.addNote({
      title: 'Beta Task',
      body: 'Shared keyword content',
      list: listB.id,
      type: 'task',
      tags: ['beta'],
      author: 'scotty',
    });
    service.completeNote(betaItem.id, 'scotty');

    await service.runEmbeddingPass();

    // Filter by list
    const filterList = await service.searchNotes({ query: 'keyword', list: 'Alpha' });
    expect(filterList.results).toHaveLength(1);
    expect(filterList.results[0].item.title).toBe('Alpha Note');

    // Filter by category
    const filterCat = await service.searchNotes({ query: 'keyword', category: 'cat-b' });
    expect(filterCat.results).toHaveLength(1);
    expect(filterCat.results[0].item.title).toBe('Beta Task');

    // Filter by tag
    const filterTag = await service.searchNotes({ query: 'keyword', tag: 'alpha' });
    expect(filterTag.results).toHaveLength(1);
    expect(filterTag.results[0].item.title).toBe('Alpha Note');

    // Filter by type
    const filterType = await service.searchNotes({ query: 'keyword', type: 'task' });
    expect(filterType.results).toHaveLength(1);
    expect(filterType.results[0].item.title).toBe('Beta Task');

    // Filter by status
    const filterStatus = await service.searchNotes({ query: 'keyword', status: 'done' });
    expect(filterStatus.results).toHaveLength(1);
    expect(filterStatus.results[0].item.title).toBe('Beta Task');
  });
});

// Live Ollama test: runs when OLLAMA_LIVE=1 is set
describe.skipIf(!process.env.OLLAMA_LIVE)('Live Ollama nomic-embed-text embedding tests', () => {
  it('embeds and finds a paraphrase pair using live Ollama nomic-embed-text', async () => {
    const db = openDatabase(':memory:');
    seedLists(db);
    const ollama = new OllamaEmbeddingProvider();
    const service = new NoteKeeperService(db, ollama);

    const isLive = await ollama.health();
    expect(isLive).toBe(true);

    const item = service.addNote({
      title: 'Automobile repair appointment',
      body: 'Vehicle brake servicing and fluid replacement',
      author: 'scotty',
    });

    const pass = await service.runEmbeddingPass();
    expect(pass.succeeded).toBe(1);

    // Query with non-overlapping vocabulary
    const searchRes = await service.searchNotes({
      query: 'car mechanic',
    });

    expect(searchRes.degraded).toBe(false);
    expect(searchRes.results.length).toBeGreaterThan(0);

    const found = searchRes.results.find((r) => r.item.id === item.id);
    expect(found).toBeDefined();
    expect(found?.match).toBe('semantic');
    console.log(`[live ollama] Paraphrase search result: query='car mechanic', item='${found?.item.title}', score=${found?.score}, match=${found?.match}`);

    db.close();
  });
});
