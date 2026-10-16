# Quantum Notekeeper Service

Local-first notes, tasks, and todo service for Quantum OS. Exposes both an MCP toolset for AI agents (chiefly Cooper) and an HTTP REST API for the Quantum Notekeeper web application.

## Overview

- **Storage:** SQLite with WAL mode, foreign keys enabled, and automatic migrations via `schema_version`.
- **Search:** SQLite FTS5 with trigger-based real-time synchronization over item titles and bodies.
- **Agent Surface:** Model Context Protocol (MCP) Streamable HTTP transport mounted at `/mcp`.
- **Application Surface:** REST API mounted at `/api/v1`.
- **Service Layer:** Unified business logic in `src/service.ts` consumed by both MCP and REST adapters (D3).

## Getting Started

### 1. Install Dependencies

```bash
cd services/notekeeper
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` (or pass variables via your environment):

```bash
cp .env.example .env
```

Available environment variables:
- `NOTEKEEPER_DB`: Path to the SQLite database file (default: `./data/notekeeper.db`).
- `NOTEKEEPER_TOKEN`: Optional Bearer authentication token for `/mcp` and `/api/*`. If unset, requests are permitted without authentication (intended for local development).
- `PORT`: Port to listen on (default: `8791`).
- `OLLAMA_HOST`: Local Ollama instance URL for semantic embeddings (default: `http://127.0.0.1:11434`, used in Step 4).
- `OLLAMA_EMBED_MODEL`: Embedding model (default: `nomic-embed-text`, used in Step 4).

### 3. Build & Run

```bash
# Build TypeScript
npm run build

# Start production server
npm start

# Development mode with hot reload
npm run dev
```

### 4. Running Tests & Smoke Check

```bash
# Run unit, service, and contract tests
npm test

# Run end-to-end smoke test against a temporary database and live MCP client
npm run smoke
```

---

## REST API Surface (`/api/v1`) (Step 3)

The REST API mirrors the MCP toolset over standard HTTP JSON endpoints.

### Author Default Convention
REST mutations accept an optional `author` string in the request body. Because the web app is Scotty's primary door to the system, when `author` is omitted from any REST mutation (`POST /items`, `PATCH /items/:id`, `DELETE`, `restore`, `complete`, `reopen`, `move`), it **automatically defaults to `'scotty'`**.

### Endpoints
- `GET /api/v1/lists` — Returns all active lists with open item counts (`open_count`) and breakdown (`counts`).
- `POST /api/v1/lists` — Create a new list (`{ name, category, parent_list_id?, private?, author? }`).
- `GET /api/v1/lists/:id` — Get list by ID or name with item counts by status (`{ list, counts }`).
- `GET /api/v1/lists/:id/items` — Paginated list items (`?status=&type=&include_subitems=&limit=&offset=`).
- `POST /api/v1/items` — Create a new item (`{ title, body?, list?, type?, tags?, priority?, due_at?, category?, linked_source?, parent_item_id?, author? }`).
- `GET /api/v1/items/:id` — Get full item (`?include_revisions=true` includes revision history). Returns `404` if missing or soft-deleted.
- `PATCH /api/v1/items/:id` — Update item fields. If body carries `autosave: true`, activates the 5-minute edit coalescing window for client autosaving; otherwise snapshots unconditionally.
- `DELETE /api/v1/items/:id` — Soft-delete item (returns `200` with `{ id, deleted_at }`).
- `POST /api/v1/items/:id/restore` — Restores tombstoned item.
- `POST /api/v1/items/:id/complete` — Marks task/todo as done (`status: 'done'`, sets `completed_at`). Rejects notes with `400`.
- `POST /api/v1/items/:id/reopen` — Reopens task/todo (`status: 'open'`, clears `completed_at`). Rejects notes with `400`.
- `POST /api/v1/items/:id/move` — Moves item to another list (`{ to_list, author? }`).
- `GET /api/v1/search` — Keyword search with filter query parameters (`?q=&list=&category=&tag=&type=&status=&due_before=&due_after=&limit=&offset=`). Returns `{ results: [{ item, match: 'keyword' }], total, degraded: true }`.
- `GET /api/v1/items/:id/links` — Returns all outgoing and incoming backlinks (`{ outgoing: [...], incoming: [...] }`) with resolved title, type, and deleted status for the other end.
- `POST /api/v1/items/:id/links` — Create a link (`{ to_item_id?, external_url?, relation, author? }`). Author defaults to `'scotty'`. Duplicate calls return the existing link row.

### HTTP Status Code Semantics
- `200 OK` / `201 Created` on success.
- `400 Bad Request` for invalid inputs, missing required fields, invalid link relations or mutually exclusive targets, or attempting task operations on notes.
- `401 Unauthorized` when `NOTEKEEPER_TOKEN` is set and `Authorization: Bearer <token>` is missing/invalid.
- `404 Not Found` when a requested item or list is missing or tombstoned.
- Stack traces are never leaked in API responses.

---

## MCP Toolset (`/mcp`) (Step 2, 4, 5)

All items, lists, search, and link operations are exposed over the MCP Streamable HTTP transport at `/mcp`:

### Items
- `note_add` — `{ title, author, body?, list?, type?, tags?, priority?, due_at?, category?, linked_source?, parent_item_id? }` → `{ id, item }`
- `note_get` — `{ id, include_revisions? }` → full item (with optional revision history)
- `note_update` — `{ id, author, title?, body?, list?, type?, tags?, priority?, due_at?, status?, linked_source?, parent_item_id? }` → updated item
- `note_delete` — `{ id, author }` → soft delete tombstone `{ id, deleted_at }`
- `note_restore` — `{ id, author }` → restores tombstoned item
- `note_complete` — `{ id, author }` → marks task/todo as done (`status: 'done'`, sets `completed_at`)
- `note_reopen` — `{ id, author }` → reopens completed task/todo (`status: 'open'`, clears `completed_at`)
- `note_search` — `{ query, list?, category?, tag?, type?, status?, due_before?, due_after?, limit?, offset? }` → hybrid search results

### Lists
- `list_create` — `{ name, category, parent_list_id?, private?, author? }` → created list
- `list_get` — `{ id?, name? }` → `{ list, counts: { open, done, archived, total } }`
- `list_items` — `{ list, status?, type?, include_subitems?, limit?, offset? }` → `{ items, total, limit, offset }`
- `list_move_item` — `{ item_id, to_list, author }` → updated item in destination list

### Links (Step 5)
- `note_link` — `{ from_item_id, to_item_id?, external_url?, relation, author }` → `item_links` row
- `note_links` — `{ item_id }` → `{ outgoing: [...], incoming: [...] }` (backlinks with resolved other end)

---

## Hybrid Semantic Search & Embedding Lifecycle (§11 Step 4)

Search uses a hybrid combination of SQLite FTS5 (BM25 keyword) and vector embeddings (cosine similarity) powered by local Ollama (`nomic-embed-text`, 768 dimensions).

### Scoring Rule
1. **Keyword Scoring**: SQLite FTS5 returns negative BM25 ranks (`bm25(items_fts)`). We invert and normalize to `[0, 1)`:
   $$\text{keywordScore} = \frac{\max(0, -\text{bm25})}{1 + \max(0, -\text{bm25})}$$
2. **Semantic Scoring**: Cosine similarity between query embedding and item embedding:
   $$\text{semanticScore} = \max(0, \cos(\mathbf{q}, \mathbf{d}))$$
   Items with cosine similarity below `0.50` are filtered out from semantic candidacy.
3. **Combined Ranking**:
   - `match: 'both'`: $\text{combinedScore} = \text{semanticScore} \times 1.2 + \text{keywordScore} \times 0.8 + 0.3$
   - `match: 'semantic'`: $\text{combinedScore} = \text{semanticScore} \times 1.2$
   - `match: 'keyword'`: $\text{combinedScore} = \text{keywordScore} \times 0.8$
   This guarantees that items matching both channels rank highest, and semantic matches rank slightly above pure keyword matches when confidence is high.

### Async Embedding Lifecycle (§13b.1)
- Write operations (`note_add`, `note_update`) never block on Ollama; they set `items.embedding_status = 'pending'`.
- A background pass (`service.runEmbeddingPass()`) queries pending items, batches them to Ollama, writes `embeddings`, and updates `embedding_status = 'done'`.
- Runs on server boot (backfilling any un-embedded items) and periodically via an unref'd timer (configured by `NOTEKEEPER_EMBED_INTERVAL_MS`).
- If Ollama is unreachable, `embedding_status` transitions to `'failed'` and logs a warning without throwing. Search requests gracefully degrade to keyword-only results with `degraded: true` and an explanatory note.

## Item Links & Backlinks (§11 Step 5)

Items can be linked to other items (internal links) or URLs (external links) using four explicit relations:
- `'spawned'` — child task or idea spawned from this item
- `'blocks'` — dependency blocking this item or target
- `'related'` — general contextual association
- `'reference'` — link to documentation, specs, issues, or external resources

### Validation & Behavior
- **Mutually Exclusive Targets**: Exactly one of `to_item_id` or `external_url` must be provided.
- **Idempotency**: Duplicate calls for the same `(from_item_id, target, relation)` return the existing `item_links` row instead of creating duplicate records.
- **Backlink Resolution**: `note_links` and `GET /api/v1/items/:id/links` return `{ outgoing, incoming }`. The other end is resolved with `id`, `title`, and `type`, avoiding extra fetches.
- **Truthful History & Soft Deletes**: Creating a link involving a tombstoned (soft-deleted) item is rejected with an error. If an item was linked while live and its target/source is soft-deleted later, the link remains present in `outgoing` and `incoming`, marked with `deleted: true` on that end.

---

## Audit & Revisions (§13b.2)
Every mutation writes an audit revision snapshot with a `kind` column (`'create' | 'edit' | 'complete' | 'reopen' | 'delete' | 'restore' | 'move'`). The service layer supports an edit coalescing policy for client autosave within 5-minute windows by the same author (activated via `autosave: true` in REST). MCP agent mutations always snapshot immutably (`coalesce: false`).


