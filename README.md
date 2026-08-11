# AssetEngine / CineEAM

Internal asset operations platform for **CINEOM** — warehouse stock, project assignment, kits/sets, QR tracking, delivery challans, IT assets, Zoho sync, and ARRI service workflows.

> Active product surface: **web application** under `web-app/`.  
> Legacy PowerShell / Electron clients are deprecated and should not receive new feature work.

### Engineering philosophy

AssetEngine is a long-lived commercial product. Every change should improve maintainability, documentation, stability, security, and/or developer experience. Never change architecture solely because a different architecture exists — business value outweighs architectural purity.

One pull request should solve one problem. Do not combine refactoring, features, documentation, and infrastructure in a single review.

---

## Status

| Item | Value |
|------|--------|
| Primary remote | [AnuragUb/Asset-Manager](https://github.com/AnuragUb/Asset-Manager) |
| Stack | Node.js (Express) · PostgreSQL · Redis · Vanilla JS SPA |
| Environments | Dev/test `59:9090` · Staging `59:8080` · Production `118:8080` |
| Repository Version | `8f9e9a2` (`main`) |
| Product Version | v7.00 |
| Current Release detail | [`PROJECT_STATUS.md`](./PROJECT_STATUS.md#current-release) |

---

## Quick start

```bash
cd web-app/asset-manager-backend
npm install
# Configure .env (never commit secrets)
node server.js
```

Open `http://localhost:8080` (or the port set in `.env`).

**Requires:** Node.js 20+, PostgreSQL, Redis (in-memory cache fallback exists if Redis is down).

Docker: see `web-app/asset-manager-backend/docker-compose.yml` and [`docs/runbooks/SERVER_SETUP_GUIDE.md`](./docs/runbooks/SERVER_SETUP_GUIDE.md).

---

## What it does

- Hierarchical catalog (folders → kinds → assets) and kit/set composition  
- Project assign / unassign with inward inspection  
- Quantity / batch split–unsplit and promote-to-asset flows  
- QR tagging and public asset views  
- Delivery challans, employees, warranties, audit logging  
- Inventory module (feature-flagged / environment-gated)  
- Zoho CRM sync and ARRI service / job-card portal  

Domain lifecycle semantics: [`PROCESS_LOGIC.md`](./PROCESS_LOGIC.md).

---

## Repository map

```text
web-app/asset-manager-backend/   Express API, Knex/Postgres, Redis
web-app/asset-manager-frontend/  Vanilla JS SPA (ES modules)
ops/                             Deployment, replication, health, SQL
docs/                            Handbook, runbooks, architecture index
resources/                       Branding / diagrams (optional assets)
PROCESS_LOGIC.md                 Lifecycle / domain truth (kept at root)
```

Operational tooling lives under [`ops/`](./ops/README.md). Application code is not relocated under `ops/`.

---

## Documentation

| Start here | Purpose |
|------------|---------|
| [`docs/README.md`](./docs/README.md) | Documentation index |
| [`docs/architecture/README.md`](./docs/architecture/README.md) | Architecture navigation |
| [`docs/01_PROJECT_OVERVIEW.md`](./docs/01_PROJECT_OVERVIEW.md) | Product overview |
| [`PROJECT_STATUS.md`](./PROJECT_STATUS.md) | Modernization status |
| [`AGENTS.md`](./AGENTS.md) | Guidance for AI / human agents |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | How to contribute |
| [`SECURITY.md`](./SECURITY.md) | Vulnerability reporting |
| [`CHANGELOG.md`](./CHANGELOG.md) | Notable changes |

---

## Contributing & security

- Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) before opening PRs.  
- Report security issues per [`SECURITY.md`](./SECURITY.md) — do not open public issues for secrets or exploit details.  
- Engineering standards for this repo (incremental change, no casual prod config edits) apply to humans and AI agents — see [`AGENTS.md`](./AGENTS.md) and `.cursor/rules/`.

---

## License / ownership

Internal CINEOM software. Distribution and access follow organization policy.
