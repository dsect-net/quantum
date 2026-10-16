# Quantum Notekeeper Service

Local-first notes, tasks, and todo service for Quantum OS. Exposes both an MCP toolset for AI agents (chiefly Cooper) and an HTTP REST API for the Quantum Notekeeper web application.

## Overview

- **Storage:** SQLite with WAL mode and foreign keys enabled.
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

## Current Capabilities (Step 1)

- Automatic database migrations tracking schema versions in `schema_version`.
- Idempotent seeding of the 7 initial lists per Brief §8:
  - **Ideas & Tasks** (inbox, sort order 0)
  - **Quantum**
  - **Mental Health** (`private: 1`, `sync_excluded: 1`)
  - **Creative**
  - **Business**
  - **Home & Family**
  - **Finance**
- Fastify health endpoint at `GET /health` returning `{ status: 'ok', schema_version, lists }`.
- MCP Server Streamable HTTP transport mounted at `/mcp` implementing `list_get`.
