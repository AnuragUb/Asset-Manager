# Architecture navigation

How to find architecture truth in this repository without relying on archived SQLite-era notes.

---

## Source of truth (use these)

| Concern | Go here |
|---------|---------|
| Product purpose & layout | [`../01_PROJECT_OVERVIEW.md`](../01_PROJECT_OVERVIEW.md) |
| System architecture | [`../02_ARCHITECTURE.md`](../02_ARCHITECTURE.md) |
| Data model | [`../03_DATABASE.md`](../03_DATABASE.md) |
| Frontend modules | [`../04_FRONTEND.md`](../04_FRONTEND.md) |
| Backend / Express | [`../05_BACKEND.md`](../05_BACKEND.md) |
| HTTP API by domain | [`../06_API.md`](../06_API.md) |
| Security posture | [`../07_SECURITY.md`](../07_SECURITY.md), [`../../SECURITY.md`](../../SECURITY.md) |
| Asset lifecycle / quantity / sets | [`../../PROCESS_LOGIC.md`](../../PROCESS_LOGIC.md) |
| Ops topology & scripts | [`../../ops/README.md`](../../ops/README.md), [`../runbooks/`](../runbooks/) |

---

## Runtime sketch

```text
Browser (Vanilla JS SPA)
    │
    ▼
Express (web-app/asset-manager-backend)
    │
    ├── PostgreSQL (Knex)
    ├── Redis (cache; memory fallback)
    ├── Zoho / ARRI integrations (env credentials)
    └── Static / SOURCE frontend serve
```

Environments: **59:9090** (dev/test) · **59:8080** (staging) · **118:8080** (production).

---

## Code entry points

| Area | Path |
|------|------|
| HTTP server / most routes | `web-app/asset-manager-backend/server.js` |
| Backend package / Docker | `web-app/asset-manager-backend/` |
| Frontend SPA | `web-app/asset-manager-frontend/` |
| Ops (not app) | `ops/` |

Do **not** treat `docs/archive/*` or deprecated PowerShell/Electron trees as the live architecture.

---

## Domain maps (deep links)

| Domain | Start |
|--------|-------|
| Hierarchy / dashboard | Frontend `dashboard.js` + API assets/folders/kinds — see `04`, `06` |
| Lifecycle / promote / quantity | `PROCESS_LOGIC.md` + backend helpers around status updates |
| Inventory audit events | [`inventory-event-system.md`](./inventory-event-system.md) |
| Event System (developer guide) | [`EVENT_SYSTEM_GUIDE.md`](./EVENT_SYSTEM_GUIDE.md) |
| Projects / inspection | `06` project routes + frontend project modules |
| Inventory (gated) | `04` inventory + `09` current state |
| Auth / RBAC | `07` + login/JWT middleware in backend |
| Zoho | Backend Zoho modules + env tokens (never commit) |
| ARRI / service portal | Frontend `servicePortal.js` + related API |

---

## Historical material

Older diagrams and proposals live in [`../archive/`](../archive/README.md). Useful for archaeology only. If they conflict with `02`–`06` or `PROCESS_LOGIC.md`, **trust the handbook and process logic**.

---

## Changing architecture

1. Read [`../../AGENTS.md`](../../AGENTS.md).  
2. Propose the change; list files; wait for approval.  
3. Update `02`–`06` (and `PROCESS_LOGIC.md` if lifecycle semantics change) in the same effort when behavior changes.
