# Documentation index

Single entry point for AssetEngine / CineEAM documentation.

**Domain truth (root):** [`../PROCESS_LOGIC.md`](../PROCESS_LOGIC.md)  
**Project status:** [`../PROJECT_STATUS.md`](../PROJECT_STATUS.md)  
**GitHub landing:** [`../README.md`](../README.md)

---

## Current handbook (`docs/01`–`10`)

| Doc | Topic |
|-----|--------|
| [01 — Project overview](./01_PROJECT_OVERVIEW.md) | What the product is, who uses it, quick start |
| [02 — Architecture](./02_ARCHITECTURE.md) | Runtime shape, layers, major modules |
| [03 — Database](./03_DATABASE.md) | Postgres / Knex model notes |
| [04 — Frontend](./04_FRONTEND.md) | SPA structure and modules |
| [05 — Backend](./05_BACKEND.md) | Express surface, `server.js` realities |
| [06 — API](./06_API.md) | REST catalog by domain |
| [07 — Security](./07_SECURITY.md) | Auth gaps, secrets, hardening notes |
| [08 — Technical debt](./08_TECHNICAL_DEBT.md) | Debt register |
| [09 — Current state](./09_CURRENT_STATE.md) | Live vs mid-migration vs sediment |
| [10 — Next phase](./10_NEXT_PHASE.md) | Recommended next engineering work |

---

## Navigation hubs

| Hub | Purpose |
|-----|---------|
| [Architecture navigation](./architecture/README.md) | How to read architecture docs + maps |
| [Runbooks](./runbooks/README.md) | Setup, redundancy, testing, workflow |
| [Archive](./archive/README.md) | Historical docs (not source of truth) |
| [Repository modernization plan](./Repository_Modernization_Plan.md) | Phased repo cleanup plan |

---

## Root engineering docs

| File | Purpose |
|------|---------|
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | How to contribute |
| [`../SECURITY.md`](../SECURITY.md) | Vulnerability reporting |
| [`../CHANGELOG.md`](../CHANGELOG.md) | Notable changes |
| [`../AGENTS.md`](../AGENTS.md) | AI / agent operating rules |
| [`../ops/README.md`](../ops/README.md) | Operational tooling map |

---

## Reading order (new engineer)

1. [`../README.md`](../README.md)  
2. [`01_PROJECT_OVERVIEW.md`](./01_PROJECT_OVERVIEW.md)  
3. [`../PROCESS_LOGIC.md`](../PROCESS_LOGIC.md)  
4. [`architecture/README.md`](./architecture/README.md) → `02`, `03`, `05`, `06`  
5. [`09_CURRENT_STATE.md`](./09_CURRENT_STATE.md) + [`07_SECURITY.md`](./07_SECURITY.md)  
6. [`../AGENTS.md`](../AGENTS.md) before making structural changes  

---

## Conventions

- Prefer **this handbook** over anything in `archive/`.  
- Prefer **`PROCESS_LOGIC.md`** for lifecycle semantics over older architecture PDFs/notes.  
- Environment ports: **59:9090** (dev/test), **59:8080** (staging), **118:8080** (production).
