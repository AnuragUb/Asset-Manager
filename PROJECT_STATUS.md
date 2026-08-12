# Project Status — AssetEngine / CineEAM

**Last updated:** August 2026 (Sprint 1 in progress)  
**Primary branch:** `main`  
**Primary remote:** `origin` → https://github.com/AnuragUb/Asset-Manager

This file tracks **repository modernization** and engineering readiness — not every product UI version bump.

---

## Current Release

| Field | Value | Notes |
|-------|--------|--------|
| **Repository Version** | `142ecb9` (`main`) | Global Recovery Center |
| **Product Version** | **v7.06** (main + recovery-center) | Sprint 1 Recovery Center |
| **Last Successful Deployment** | Dev/Staging on `59` (Recovery Center) | Production `118:8080` not deployed |
| **Last Database Migration** | `20260812120000_assets_soft_delete_recovery` | `deleted_by` + `domain_events` |
| **Current Sprint** | **AssetEngine Sprint 1 — Stabilization & UX** | Issue 1–5 ✅ (+ Recovery Center) · next Issue 6 pending |

Update this table when shipping or cutting a release. Prefer real deploy/migration confirmation over guessing.

### Sprint 1 issue gate

After every completed issue: update `SPRINT_1_PROGRESS.md`, this file, and `CHANGELOG.md` → smoke-test Dev then Staging → **only then** commit.

---

## Environment matrix

| Role | Host intent |
|------|-------------|
| Dev / test | `59:9090` |
| Staging | `59:8080` |
| Production | `118:8080` |

---

## Modernization phases

| Phase | Goal | Status |
|-------|------|--------|
| **1** | Repository hygiene (gitignore, SQL under `ops/sql`, keep uploads out of git) | **Done** (`567f440`) |
| **2.1** | Ops organization (`ops/deployment`, `replication`, `health`, `sql`) | **Done locally** (`8256d27`) — push when approved |
| **2.x** | Further ops/archive moves (maintenance scripts, `archive/` for legacy GUI) | **Deferred** |
| **3** | Repository presentation (README, contributing, security, docs index) | **Done** |
| **4+** | Auth perimeter, lifecycle clarity, inventory gating, debt reduction | **Planned** — see `docs/10_NEXT_PHASE.md` |

Do **not** rename `web-app/` as part of modernization unless a multi-app monorepo is explicitly approved.

**Repository modernization foundation is complete.** Further repository restructuring is out of scope unless explicitly requested. Future work should focus on features, security hardening, documentation updates, and technical debt reduction.

---

## Product health (summary)

| Area | State |
|------|--------|
| Web app | Active, primary product |
| Postgres + Redis | Runtime standard |
| Auth / RBAC | Present; incomplete route coverage |
| Inventory | UI present; backend feature / env gated |
| Zoho / ARRI | Implemented; credential dependent |
| Playwright | Present; thin |
| Docs handbook | `docs/01`–`10` current-state set |

Detail: [`docs/09_CURRENT_STATE.md`](./docs/09_CURRENT_STATE.md).

---

## Documentation layout (after Phase 3)

| Path | Role |
|------|------|
| `README.md` | GitHub landing |
| `CONTRIBUTING.md` / `SECURITY.md` / `CHANGELOG.md` / `AGENTS.md` | Community & agent entry points |
| `PROCESS_LOGIC.md` | Domain lifecycle truth (**stays at repo root**) |
| `docs/README.md` | Documentation index |
| `docs/architecture/` | Architecture navigation |
| `docs/01`–`10` | Current handbook |
| `docs/runbooks/` | Setup, redundancy, testing, workflow |
| `docs/archive/` | Historical / stale architecture notes |
| `ops/` | Operational scripts (not app code) |
| `resources/` | Branding / diagrams placeholder |

---

## Open risks (engineering)

1. Incomplete API authentication on legacy routes  
2. Monolithic `server.js` change risk  
3. Stale workflow docs historically contradicted GitHub branch reality (runbook relocated; content still needs reconciliation)  
4. Inventory / dual-DB category paths easy to misuse  
5. Secrets and token files must stay gitignored and rotated if ever leaked  
6. Gmail SMTP credentials require production configuration (password-reset mail) — Medium / Known  

See [`docs/08_TECHNICAL_DEBT.md`](./docs/08_TECHNICAL_DEBT.md).

---

## Next recommended engineering focus

Repository restructuring is **complete** unless explicitly requested again.

1. Features that deliver business value  
2. Security hardening (auth perimeter on mutate routes — proposal before large change)  
3. Documentation updates as behavior changes  
4. Technical debt reduction (incremental)  

Align `docs/runbooks/WORKFLOW.md` with real branches and ports when convenient.

Source plan (historical): [`docs/Repository_Modernization_Plan.md`](./docs/Repository_Modernization_Plan.md).
