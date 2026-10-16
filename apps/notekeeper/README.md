# Quantum Notekeeper App

> **Monorepo Structure Note:**
> - Frontend Application (this package): [`apps/notekeeper/`](.) — Mobile-first React, Vite, TypeScript, plain CSS.
> - Backend Service: [`services/notekeeper/`](../../services/notekeeper/) — Fastify, SQLite, MCP, REST API.

A mobile-first, corporate minimalist note-taking, task management, and schedule review application for Quantum OS.

---

## Design System

Strictly adhering to Brief D8:
- **Surfaces:** Warm-gray/white surfaces (`#faf9f7` background, pure white cards `#ffffff`).
- **Borders & Radii:** 1px soft borders (`#e5e1db`), rounded cards (`12px`), generous whitespace.
- **Typography:** System sans stack (`Inter`, system-ui, -apple-system).
- **Accents:** Solid black primary buttons, brand violet `#7C5CFF` used exclusively as a sparing accent (active bottom tabs, focus rings, semantic "meaning match" search tag).
- **House Style:** No decorative emojis. Clean, inline SVG stroke icons (`stroke="currentColor"`, `fill="none"`).
- **Light Theme Only:** No dark theme or decorative gradients.

---

## Quickstart

### 1. Install Dependencies
```bash
cd apps/notekeeper
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

| Variable | Default | Description |
|---|---|---|
| `VITE_NOTEKEEPER_API` | `http://localhost:8791/api/v1` | Base URL of the Notekeeper REST API. |
| `VITE_NOTEKEEPER_TOKEN` | _(empty)_ | Optional Bearer token if the backend has `NOTEKEEPER_TOKEN` enabled. Sent in the `Authorization: Bearer <token>` header. |

### 3. Development Server
Ensure the backend service is running on `http://localhost:8791`:
```bash
npm run dev
```
The app will open at `http://localhost:5173`.

> **API Communication & Dev Proxy Note:**
> The app talks directly to `VITE_NOTEKEEPER_API` (default `http://localhost:8791/api/v1`). The backend Fastify server includes CORS support for `*` origins, allowing seamless local development across ports 5173 and 8791 without requiring a reverse proxy.

### 4. Production Build & Preview
```bash
# Type check and build static bundle to dist/
npm run build

# Preview production build locally
npm run preview
```

---

## End-to-End Testing (Playwright)

The E2E test suite boots an isolated instance of the Notekeeper service on a temporary SQLite database, populates realistic fixtures via the REST API, and tests user flows:

```bash
# Run all Playwright E2E tests
npm run test:e2e
```

### Scenarios Covered
1. **Lists Home:** 7 seed lists render with "Ideas & Tasks" first (with Inbox badge) and "Mental Health" lock glyph.
2. **Global Capture:** Opening the capture sheet, adding an item, and verifying it appears in the list without page reload.
3. **Task Completion:** Checking off a task removes it from open items and transitions it into the collapsible Done section.
4. **Item Detail & Autosave:** Editing item title and body, explicit "Save", and verifying persistence across full browser reloads.
5. **Hybrid Search:** Querying for keyword and semantic matches, verifying results and "meaning match" indicator badges.
6. **Due Schedule:** Grouping tasks into Overdue, Today, This Week, and Later buckets.
7. **Date-Only Due Regression:** Verifying items with local calendar `due_at` (e.g. `YYYY-MM-DD`) appear in Today without time-shifting into Overdue or displaying an erroneous time component.
