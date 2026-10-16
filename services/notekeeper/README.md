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
- `GET /api/v1/items/:id/links` & `POST /api/v1/items/:id/links` — Placeholder routes returning `501 { error: 'links arrive in step 5' }`.

### HTTP Status Code Semantics
- `200 OK` / `201 Created` on success.
- `400 Bad Request` for invalid inputs, missing required fields, or attempting task operations on notes.
- `401 Unauthorized` when `NOTEKEEPER_TOKEN` is set and `Authorization: Bearer <token>` is missing/invalid.
- `404 Not Found` when a requested item or list is missing or tombstoned.
- `501 Not Implemented` for link operations (Step 5).
- Stack traces are never leaked in API responses.

---

## MCP Toolset (`/mcp`) (Step 2)

All items, lists, and search operations are also exposed over the MCP Streamable HTTP transport at `/mcp`:

### Items
- `note_add` — `{ title, author, body?, list?, type?, tags?, priority?, due_at?, category?, linked_source?, parent_item_id? }` → `{ id, item }`
- `note_get` — `{ id, include_revisions? }` → full item (with optional revision history)
- `note_update` — `{ id, author, title?, body?, list?, type?, tags?, priority?, due_at?, status?, linked_source?, parent_item_id? }` → updated item
- `note_delete` — `{ id, author }` → soft delete tombstone `{ id, deleted_at }`
- `note_restore` — `{ id, author }` → restores tombstoned item
- `note_complete` — `{ id, author }` → marks task/todo as done (`status: 'done'`, sets `completed_at`)
- `note_reopen` — `{ id, author }` → reopens completed task/todo (`status: 'open'`, clears `completed_at`)
- `note_search` — `{ query, list?, category?, tag?, type?, status?, due_before?, due_after?, limit?, offset? }` → search results

### Lists
- `list_create` — `{ name, category, parent_list_id?, private?, author? }` → created list
- `list_get` — `{ id?, name? }` → `{ list, counts: { open, done, archived, total } }`
- `list_items` — `{ list, status?, type?, include_subitems?, limit?, offset? }` → `{ items, total, limit, offset }`
- `list_move_item` — `{ item_id, to_list, author }` → updated item in destination list

---

## Audit & Revisions (§13b.2)
Every mutation writes an audit revision snapshot with a `kind` column (`'create' | 'edit' | 'complete' | 'reopen' | 'delete' | 'restore' | 'move'`). The service layer supports an edit coalescing policy for client autosave within 5-minute windows by the same author (activated via `autosave: true` in REST). MCP agent mutations always snapshot immutably (`coalesce: false`).
