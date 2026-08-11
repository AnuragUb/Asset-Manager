# 02 — Architecture

## High-level view

```text
Browser (Vanilla JS SPA)
  ├── index.html shell + CDN libs (Tabulator, SheetJS, Chart.js, QR)
  ├── main.js (router / bootstrap)
  ├── domain modules (dashboard, projects, inventory, ...)
  └── fetch('/api/...') + httpOnly JWT cookie

Express (server.js)
  ├── REST /api/*
  ├── static frontend (currently SOURCE, not dist)
  ├── services/ (cache, auth tokens, email, encryption, Zoho, Sheets)
  └── utils.js (Knex db + dbService, IDs, Tally helpers)

PostgreSQL (primary)          Redis (cache; memory fallback)
Integrations: Zoho CRM, Google Sheets, SMTP, optional Tally
```

**Style:** Classic client–server monolith. One Node process serves API + UI.

---

## Architectural principles in force

1. **Web app only** — PowerShell/Electron are deprecated.
2. **Domain logic in the backend** — especially asset lifecycle helpers.
3. **Frontend is a modular SPA without a framework** — ES modules + globals.
4. **Postgres via Knex** — not SQLite (despite older docs).
5. **Redis delete-on-write caching** for assets/projects lists.
6. **Case bridge** — DB `lowercase` ↔ UI `PascalCase` via `normalizeResult()`.
7. **Soft deletes** — `is_deleted` widely used.
8. **Inventory is parallel to Assets** — not the same model.

---

## Component breakdown

### Frontend (`web-app/asset-manager-frontend/`)

| Piece | Role |
|-------|------|
| `index.html` | Single shell: all main views and modals |
| `main.js` | Auth restore, nav → view map, load hierarchy/assets |
| `dashboard.js` | Assets hub (largest module) |
| `projects.js` | Project kanban, assign/unassign, orders |
| `inventory.js` | Parallel inventory UI |
| `auth.js` / `rbac.js` | Session + permission UI |
| `hierarchy.js` | Shared tree model for sidebars |
| `servicePortal.js` | ARRI job cards / clients |
| Secondary HTML | `asset-view.html`, `project-view.html`, `public-view.html` |

Communication patterns:

- ES `import` / dynamic `import()`
- REST JSON
- `window.*` globals for inline HTML handlers
- `localStorage` for selected module/category
- Cache-bust query params (`?v=7.00`)

### Backend (`web-app/asset-manager-backend/`)

| Piece | Role |
|-------|------|
| `server.js` | Routes, middleware, most business logic (~11k lines) |
| `utils.js` | Knex init, dual DB, ID generators, Tally, audit helpers |
| `IdGenerator.js` | Asset/project ID schemes |
| `knexfile.js` | Connection profiles (dev/test/prod) |
| `services/*` | Cache, tokens, password, email, encryption, Zoho, Sheets |
| `migrations/*` | Schema evolution |

### Data stores

| Store | Use |
|-------|-----|
| PostgreSQL `asset_manager` | Primary operational data |
| PostgreSQL service DB | In-House / SERVICE category (via `dbService`) |
| Redis | List/detail caching |
| `dynamic.json` / DATA_DIR JSON | Settings (email, tally), dynamic short codes |
| Filesystem `input/`, `export/` | Uploads, OCR, logos |
| Legacy SQLite files | Leftover / optional fallback paths |

---

## Core domain workflows

### Asset lifecycle

```text
In Store
   │ assign
   ▼
Project  (project_assets link; location on site)
   │ unassign
   ▼
Under Inspection  (hidden from available stock)
   │ release-to-store (+ condition/remarks)
   ▼
In Store
```

Optional: sell / retire / scrap.

Implemented primarily by `updateAssetStatus()` in `server.js`, with recursive propagation for sets (`is_set` / children via `parentid`).

### Sets and components

- Kits glued by `parentid`.
- No-QR rows may live in `components` until **`promoteToAsset`** moves them into `assets`.
- DB trigger prevents the same ID existing in both `assets` and `components`.

### Bulk import

1. Frontend `dataProcessor.js` fuzzy-maps Excel columns.
2. Preview / confirm in UI.
3. `POST /api/assets/bulk` (or related create paths) persists.

### Delivery challan (DC)

Select assets → generate challan payload/PDF-oriented record → `delivery_challans` (+ mappings).

### Cache strategy

On many writes: `invalidateAssetsCache()` deletes Redis keys matching `assets:*` / `projects:*`. Next read hits DB.

---

## Deployment architecture

`docker-compose.yml` typically defines:

- `postgres` (5432)
- `redis` (6379)
- `app-prod` → host 8080
- `app-test` → host 9090

Dockerfile: Node 20, installs backend (and frontend) deps, runs the app.

**Current serve mode:** backend forces **source** frontend assets (`forceSource = true`, `useDist = false`) for easier debugging. Dist/minify path exists but is not the live path.

---

## Dual remotes and folders

| Name | Meaning |
|------|---------|
| `origin` | `AnuragUb/Asset-Manager` |
| `official` | `CineomDevTeam/CineEAM` |
| `AssetManager_Dev` / `_Prod` | Local folder split (ops), not necessarily git branches |

Confirm source of truth before push/deploy.

---

## What this architecture is *not*

- Not microservices
- Not React/Vue/Angular
- Not a clean hexagonal layout (yet)
- Not fully JWT-locked (legacy LAN-trust routes remain)

See [08_TECHNICAL_DEBT.md](./08_TECHNICAL_DEBT.md) and [10_NEXT_PHASE.md](./10_NEXT_PHASE.md).
