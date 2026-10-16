# Quantum Notekeeper Service

Local-first notes, tasks, and todo service for Quantum OS. Exposes both an MCP toolset for AI agents (chiefly Cooper) and an HTTP REST API for the Quantum Notekeeper web application.

## Overview

- **Storage:** SQLite with WAL mode, foreign keys enabled, and automatic migrations via `schema_version`.
- **Search:** SQLite FTS5 with trigger-based real-time synchronization over item titles and bodies.
- **Agent Surface:** Model Context Protocol (MCP) Streamable HTTP transport mounted at `/mcp`.
- **Application Surface:** REST API (arriving in Step 3).
- **Service Layer:** Unified business logic in `src/service.ts` consumed by both MCP and REST adapters.

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
# Run unit and integration tests
npm test

# Run end-to-end smoke test against a temporary database and live MCP client
npm run smoke
```

## MCP Toolset (Step 2)

All items and lists operations are exposed over the MCP Streamable HTTP transport at `/mcp`:

### Items
- `note_add` — `{ title, author, body?, list?, type?, tags?, priority?, due_at?, category?, linked_source?, parent_item_id? }` → `{ id, item }`
- `note_get` — `{ id, include_revisions? }` → full item (with optional revision history)
- `note_update` — `{ id, author, title?, body?, list?, type?, tags?, priority?, due_at?, status?, linked_source?, parent_item_id? }` → updated item
- `note_delete` — `{ id, author }` → soft delete tombstone `{ id, deleted_at }`
- `note_restore` — `{ id, author }` → restores tombstoned item
- `note_complete` — `{ id, author }` → marks task/todo as done (`status: 'done'`, sets `completed_at`)
- `note_reopen` — `{ id, author }` → reopens completed task/todo (`status: 'open'`, clears `completed_at`)

### Lists
- `list_create` — `{ name, category, parent_list_id?, private?, author? }` → created list
- `list_get` — `{ id?, name? }` → `{ list, counts: { open, done, archived, total } }`
- `list_items` — `{ list, status?, type?, include_subitems?, limit?, offset? }` → `{ items, total, limit, offset }`
- `list_move_item` — `{ item_id, to_list, author }` → updated item in destination list

### Audit & Revisions (§13b.2)
Every mutation writes an audit revision snapshot with a `kind` column (`'create' | 'edit' | 'complete' | 'reopen' | 'delete' | 'restore' | 'move'`). The service layer supports an edit coalescing policy for client autosave within 5-minute windows by the same author.
