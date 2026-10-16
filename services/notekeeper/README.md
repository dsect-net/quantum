# Quantum Notekeeper Service

> **Monorepo Structure Note:**
> - Backend Service (this package): [`services/notekeeper/`](.) — Fastify, SQLite, FTS5, Ollama semantic search, MCP Streamable HTTP transport, REST API.
> - Frontend Application: [`apps/notekeeper/`](../../apps/notekeeper/) — Mobile-first React, Vite, TypeScript, plain CSS corporate minimalist light theme.

Local-first notes, tasks, and todo service for Quantum OS. Exposes both a Model Context Protocol (MCP) toolset for AI agents (chiefly Cooper) and an HTTP REST API for the Quantum Notekeeper web application.

---

## Quickstart

### 1. Prerequisites
- Node.js 20+
- npm 9+
- (Optional, for semantic search) Local [Ollama](https://ollama.com/) instance running with `nomic-embed-text` installed:
  ```bash
  ollama pull nomic-embed-text
  ```

### 2. Install & Configure
From a clean clone:
```bash
cd services/notekeeper
npm install

# Copy environment configuration
cp .env.example .env
```

### 3. Build & Run
```bash
# Build TypeScript to dist/
npm run build

# Start production server
npm start

# Or development mode with auto-reload (tsx)
npm run dev
```
The service will start on `http://0.0.0.0:8791` (or your configured `PORT`).

Verify health:
```bash
curl http://localhost:8791/health
# {"status":"ok","schema_version":2,"lists":7}
```

### 4. Running Tests
```bash
# Run unit, service, and contract tests (vitest)
npm test

# Run standalone end-to-end smoke test against a fresh temp DB
npm run smoke
```

---

## Environment Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `NOTEKEEPER_DB` | string | `./data/notekeeper.db` | File path to the SQLite database. Parent directories are created automatically. Set to `:memory:` in tests. |
| `NOTEKEEPER_TOKEN` | string | _(none)_ | Optional shared Bearer token. When set, all requests to `/mcp` and `/api/*` require `Authorization: Bearer <token>`. When unset, auth is disabled for local dev. |
| `PORT` | number | `8791` | Port to listen on. |
| `HOST` | string | `0.0.0.0` | Network interface to bind to. |
| `OLLAMA_HOST` | string | `http://127.0.0.1:11434` | Base URL for the local Ollama embeddings instance. |
| `EMBED_MODEL` | string | `nomic-embed-text` | Ollama embedding model name (`OLLAMA_EMBED_MODEL` accepted as an alias). |
| `NOTEKEEPER_EMBED_INTERVAL_MS` | number | `60000` | Frequency in ms of background async embedding batch passes. Set to `0` to disable timer. |

---

## API Surface: Reality vs. Brief

The service exposes two interfaces over the same underlying business logic layer ([`src/service.ts`](src/service.ts)):

### 1. REST API (`/api/v1`)
All endpoints speak JSON. When `NOTEKEEPER_TOKEN` is set, requests require `Authorization: Bearer <token>`.

- `GET /health` — Service health, current `schema_version`, and list count. (Public, no auth).
- `GET /api/v1/lists` — All active lists with `open_count` and full counts breakdown `{ open, done, archived, total }`.
- `POST /api/v1/lists` — Create a list (`{ name, category, parent_list_id?, private?, author? }`).
- `GET /api/v1/lists/:id` — Get list by ID or name with count breakdown.
- `GET /api/v1/lists/:id/items` — Query list items (`?status=&type=&include_subitems=&limit=&offset=`).
- `POST /api/v1/items` — Create an item (`{ title, body?, list?, type?, tags?, priority?, due_at?, category?, linked_source?, parent_item_id?, author? }`).
- `GET /api/v1/items/:id` — Get item by ID (`?include_revisions=true` embeds full revision history). Returns 404 if soft-deleted or missing.
- `PATCH /api/v1/items/:id` — Update item fields. Accepts `autosave: true` to enable the 5-minute revision coalesce window.
- `DELETE /api/v1/items/:id` — Soft-delete item (sets `deleted_at`, returns `{ id, deleted_at }`).
- `POST /api/v1/items/:id/restore` — Restores a soft-deleted item.
- `POST /api/v1/items/:id/complete` — Mark task/todo done (sets `status: 'done'`, records `completed_at`).
- `POST /api/v1/items/:id/reopen` — Reopens task/todo (sets `status: 'open'`, clears `completed_at`).
- `POST /api/v1/items/:id/move` — Move item to another list (`{ to_list, author? }`).
- `GET /api/v1/deleted` — *[Extension to Brief §9]* Returns soft-deleted items with pagination to power the web app's Deleted Items recovery view.
- `GET /api/v1/search` — Hybrid search (`?q=&list=&category=&tag=&type=&status=&due_before=&due_after=&limit=&offset=`). Returns `{ results: [{ item, match: 'both'|'semantic'|'keyword' }], total, degraded?: boolean, degraded_reason?: string }`.
- `GET /api/v1/items/:id/links` — Returns resolved incoming and outgoing backlinks `{ outgoing: [...], incoming: [...] }`.
- `POST /api/v1/items/:id/links` — Create link (`{ to_item_id?, external_url?, relation: 'spawned'|'blocks'|'related'|'reference', author? }`). Idempotent duplicate calls return the existing link row.

### 2. MCP Toolset (`/mcp`)
Mounted using the MCP Streamable HTTP transport at `/mcp` and `/mcp/*`:
- `note_add` — Add a new note, task, or todo.
- `note_get` — Fetch item by ID, optionally including revision history (`include_revisions: boolean`).
- `note_update` — Update item fields, priority, tags, status, or parent.
- `note_delete` — Soft-delete item with tombstone record.
- `note_restore` — Restore soft-deleted item.
- `note_complete` — Complete task/todo.
- `note_reopen` — Reopen completed task/todo.
- `note_search` — Hybrid FTS5 + vector search with metadata filters.
- `list_create` — Create a new list.
- `list_get` — Get list by ID or name with status counts.
- `list_items` — Paginated list items with filtering and subitem support.
- `list_move_item` — Move item to another list.
- `note_link` — Link two items or link an item to an external URL.
- `note_links` — Retrieve incoming and outgoing links with resolved target metadata.

---

## Database, WAL Mode & Backups

Notekeeper uses SQLite (`better-sqlite3`) configured with:
- `PRAGMA journal_mode = WAL;` (Write-Ahead Logging)
- `PRAGMA foreign_keys = ON;`
- `PRAGMA synchronous = NORMAL;`

### Backup Procedure
Because WAL mode separates writes into a write-ahead log, simply copying `notekeeper.db` while transactions are active may produce an incomplete backup.

**Safe Online Backup (No Downtime):**
1. Trigger a checkpoint to flush the WAL log into the main DB file:
   ```bash
   sqlite3 ./data/notekeeper.db "PRAGMA wal_checkpoint(TRUNCATE);"
   ```
2. Copy `./data/notekeeper.db` to your backup target.

**Alternative File Copy Backup:**
Copy all three database files together:
- `notekeeper.db` (main database file)
- `notekeeper.db-wal` (write-ahead log, if present)
- `notekeeper.db-shm` (shared-memory index, if present)

**SQLite CLI Backup API:**
```bash
sqlite3 ./data/notekeeper.db ".backup ./data/notekeeper-backup-$(date +%Y%m%d%H%M%S).db"
```

---

## Semantic Search & Embedding Model Lifecycle

### Async Ingestion (§13b.1)
Writes (`note_add`, `note_update`) never block on Ollama or network latency. New or edited items have `items.embedding_status = 'pending'`. A background worker batches pending items, generates vectors via Ollama, stores them in `embeddings`, and sets `embedding_status = 'done'`.

### Hybrid Ranking Rule
1. **Keyword Scoring:** Inverted BM25 from SQLite FTS5 normalized to $[0, 1)$:
   $$\text{keywordScore} = \frac{\max(0, -\text{bm25})}{1 + \max(0, -\text{bm25})}$$
2. **Semantic Scoring:** Vector cosine similarity thresholded at `0.50`:
   $$\text{semanticScore} = \max(0, \cos(\mathbf{q}, \mathbf{d}))$$
3. **Combined Fusion:**
   - Both: $\text{score} = \text{semanticScore} \times 1.2 + \text{keywordScore} \times 0.8 + 0.3$
   - Semantic only: $\text{score} = \text{semanticScore} \times 1.2$
   - Keyword only: $\text{score} = \text{keywordScore} \times 0.8$

### Changing the Embedding Model
- The `embeddings` table uses a compound primary key: `(item_id, model_id)`.
- If `EMBED_MODEL` is changed (e.g. from `nomic-embed-text` to another model):
  1. Historical vectors for the old model remain safely in SQLite under their `model_id`.
  2. On startup and during background passes, the service searches for items missing vectors for the *active* `model_id` (`LEFT JOIN embeddings ... WHERE embeddings.item_id IS NULL`).
  3. The backfill process automatically embeds all active items under the new model without manual intervention.

---

## Authentication & Security Boundaries

- **Single Shared Bearer Token:** Controlled by `NOTEKEEPER_TOKEN`. When configured, all non-health HTTP endpoints (`/mcp` and `/api/*`) require `Authorization: Bearer <token>`.
- **Limits:** The authentication layer verifies that the caller possesses the token. It does not perform public-key cryptography or per-user permission segregation.
- **Author Identity:** All audit log and mutation attribution is tracked via the explicit `author` parameter (`cooper`, `scotty`, etc.).

---

## Design Decisions Collected Across Chunks

1. **REST Author Defaulting (Chunk 3):** Web app requests rarely prompt for author identity. For REST mutations, when `author` is omitted, it defaults to `'scotty'`. MCP tool mutations continue to require explicit `author`.
2. **Autosave Coalescing (Chunk 3 & Brief §13b.2):** The web app autosaves draft typing with `autosave: true`. If the previous revision on that item was an edit by the same author within the last 5 minutes, Notekeeper coalesces the snapshot instead of creating thousands of micro-revisions. Explicit "Save" button clicks pass `autosave: false` to force a clean snapshot.
3. **Date-Only Local Calendar Semantics (Chunk 6b):** Date-only strings (`YYYY-MM-DD`) are preserved in SQLite as date-only and interpreted as local calendar dates by client and server, preventing UTC midnight conversion from shifting dates back into the prior local day.
4. **Link Idempotency (Chunk 5):** Calling `note_link` or `POST /items/:id/links` with identical endpoints and relation returns the existing row rather than failing or duplicating.
5. **Truthful Deleted Links (Chunk 5):** Linking to or from a currently deleted item is rejected. However, if an item was linked while live and one end is later soft-deleted, queries for backlinks retain the link marked with `deleted: true`.
6. **Graceful Degradation (Chunk 4):** If Ollama is offline, search queries fall back to keyword-only search with `{ degraded: true, degraded_reason: '...' }` rather than failing the request.
7. **Deleted Items Endpoint (Chunk 6):** Added `GET /api/v1/deleted` to retrieve tombstoned items for Screen 1's Deleted Items drawer.
