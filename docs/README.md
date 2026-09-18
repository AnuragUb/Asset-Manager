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
| [Architecture & ADRs](./Architecture_and_ADRs/README.md) | **Collected** architecture docs, ADRs, audits, and research |
| [Architecture navigation (pointer)](./architecture/README.md) | Redirects to Architecture & ADRs |
| [Runbooks](./runbooks/README.md) | Setup, redundancy, testing, workflow |
| [Archive](./archive/README.md) | Historical docs (not source of truth) |
| [Repository modernization plan](./Repository_Modernization_Plan.md) | Phased repo cleanup plan |

## In-progress design

| Doc | Purpose |
|-----|---------|
| [DC document design](./DC_DOCUMENT_DESIGN.md) | Delivery Challan HTML/CSS design language + field mapping |
| [Managed Sets / Kits](./Architecture_and_ADRs/02_domain_architecture/MANAGED_SETS_ARCHITECTURE.md) | First-class Set model (Phase 0). **Do not** apply `20260824120000_create_managed_sets_tables.js` until this design is approved and the migration is revised. |
| [Auth infrastructure](./AUTH_INFRASTRUCTURE_IMPLEMENTATION.md) | Signup, login, Remember Me, logout, password reset, cookie/session policy |
| [Sourced vs Adopted lifecycle (ADR)](./Architecture_and_ADRs/01_adrs/LIFECYCLE_SOURCED_ADOPTED_ADR.md) | Sourced (PO → RN → stock) vs Adopted (Physical Intake then PO + RN). Awaiting Adoption, Receipt Note calendar windows, Asset pie / Inventory donut. **Not implemented.** |
| [Frontend stack — React deferred (ADR)](./Architecture_and_ADRs/01_adrs/FRONTEND_REACT_ADR.md) | Vanilla SPA now; React later for UI logic after the product is stable. Express stays the server. **Does not authorize a rewrite.** |
| [Zoho Books integration research](./Architecture_and_ADRs/03_audits_and_research/ZOHO_BOOKS_INTEGRATION_ARCHITECTURE_RESEARCH.md) | Books companion architecture (research only; not implemented) |

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
4. [`Architecture_and_ADRs/README.md`](./Architecture_and_ADRs/README.md) → `02`, `03`, `05`, `06`  
5. [`09_CURRENT_STATE.md`](./09_CURRENT_STATE.md) + [`07_SECURITY.md`](./07_SECURITY.md)  
6. [`../AGENTS.md`](../AGENTS.md) before making structural changes  

---

## Conventions

- Prefer **this handbook** over anything in `archive/`.  
- Prefer **`PROCESS_LOGIC.md`** for lifecycle semantics over older architecture PDFs/notes.  
- Environment ports: **59:9090** (dev/test), **59:8080** (staging), **118:8080** (production).
