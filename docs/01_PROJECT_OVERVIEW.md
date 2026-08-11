# 01 — Project Overview

**Product names:** AssetEngine / CineEAM / Asset Manager  
**Workspace:** `AssetManager_Dev`  
**Primary remote:** https://github.com/AnuragUb/Asset-Manager (`origin`)  
**Also present:** `official` → `CineomDevTeam/CineEAM`

---

## What this product is

AssetEngine is an internal operations system for **CINEOM** to manage physical assets (cameras, kits, IT equipment, and related gear) across warehouse and project sites.

It is not a thin CRUD app. It is a **domain-heavy logistics tool** covering:

- Hierarchical catalog (folders → kinds → assets)
- Kit / set composition (`parentid`, components ↔ full assets)
- Project assignment and inward inspection on return
- Quantity / batch splitting
- QR tagging and public/asset detail views
- Delivery challans (DC)
- Employees and quotas
- Warranty tracking
- OCR document processing
- IT network credentials / LAN scanner
- Zoho CRM product/deal sync
- ARRI service / job-card portal
- A newer parallel **Inventory** module (preview / feature-flagged)

---

## Who uses it

| Role / module | Typical use |
|---------------|-------------|
| Warehouse / ops | Stock, sets, QR, assign to projects |
| Project leads | Project kanban, assign/unassign, POs |
| IT | IT assets, network credentials, scanner |
| Service (ARRI) | Job cards, clients, sheets sync |
| Admins | Users, RBAC, settings, audit |

Login supports a **module/category** selection (e.g. IT). Category can route some data to a secondary service database.

---

## What is active vs deprecated

| Active | Deprecated / legacy |
|--------|---------------------|
| Web app (`web-app/`) | PowerShell GUI (`asset_manager.ps1`) |
| Express + Postgres + Redis | Electron (if present historically) |
| Vanilla JS SPA | SQLite as primary store (docs still mention it) |

**Ground rule:** For the foreseeable future, work only on the web app.

---

## Quick start

```bash
cd web-app/asset-manager-backend
npm install
node server.js
# or: npm start
```

Open: `http://localhost:8080` (or `9090` for test, depending on `PORT`).

Requires:

- Node.js (Docker image uses Node 20)
- PostgreSQL (see `docker-compose.yml` / `.env`)
- Redis recommended (in-memory cache fallback exists)

---

## Repository layout (high level)

```text
AssetManager_Dev/
├── web-app/                    ★ Active product
│   ├── asset-manager-backend/  Express API + Knex + services
│   └── asset-manager-frontend/ Vanilla JS SPA
├── scripts/                    Manual DB/ops utilities
├── tests/                      Playwright (thin coverage)
├── docs/                       This documentation set
├── data/, backups/, input/, export/
├── lib/                        Legacy QRCoder (.NET) — unused by web
├── docker-compose.yml, Dockerfile
└── .env                        Local secrets (gitignored)
```

---

## Environments (intent vs reality)

| Intent (docs) | Port | Branch (docs) |
|---------------|------|---------------|
| Production | 8080 | `main` |
| Test / Dev | 9090 | `dev` |

**Reality check:** GitHub `dev` may lag `main`. Local folders may also split as `AssetManager_Dev` / `AssetManager_Prod`. Always confirm **machine, port, database, and git remote** before deploying.

---

## Related docs in this folder

| Doc | Contents |
|-----|----------|
| [02_ARCHITECTURE.md](./02_ARCHITECTURE.md) | System design and module map |
| [03_DATABASE.md](./03_DATABASE.md) | Schema, Knex, migrations |
| [04_FRONTEND.md](./04_FRONTEND.md) | SPA structure and modules |
| [05_BACKEND.md](./05_BACKEND.md) | Express, services, lifecycle |
| [06_API.md](./06_API.md) | REST surface by domain |
| [07_SECURITY.md](./07_SECURITY.md) | Auth, secrets, risks |
| [08_TECHNICAL_DEBT.md](./08_TECHNICAL_DEBT.md) | Known debt |
| [09_CURRENT_STATE.md](./09_CURRENT_STATE.md) | As-is snapshot |
| [10_NEXT_PHASE.md](./10_NEXT_PHASE.md) | Recommended next work |

Also see: root `README.md`, `PROCESS_LOGIC.md`, `docs/README.md`, and `docs/runbooks/WORKFLOW.md`.

---

## Engineering standards

Permanent Cursor rules live in:

`.cursor/rules/assetengine-engineering-standards.mdc`

Core idea: **incremental change, preserve behavior, ask before architecture, never hardcode secrets.**
