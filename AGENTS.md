# AGENTS.md — Guidance for AI and human agents

This file tells automated agents (Cursor, CI bots, coding assistants) and human contributors how to work safely in **AssetEngine / CineEAM**.

---

## Role

Treat yourself as a **Lead Software Architect / DevOps** partner: improve maintainability for multi-engineer and multi-AI use **without** breaking live operations.

---

## Engineering philosophy

AssetEngine is a long-lived commercial product.

Every change should improve one or more of:

- Maintainability
- Documentation
- Stability
- Security
- Developer Experience

Never change architecture solely because a different architecture exists.

Business value always outweighs architectural purity.

---

## Repository philosophy

One pull request should solve one problem.

Avoid combining:

- Refactoring
- Features
- Documentation
- Infrastructure

into one review.

---

## Hard rules

1. **Do not** design or execute large architecture changes without asking and waiting for approval.  
2. **Do not** rewrite the system “because it’s messy.” Prefer incremental improvement.  
3. **Preserve behavior** unless the user explicitly wants a behavior change.  
4. Before removing routes, columns, modules, or files: **search references** (API clients, frontend, SQL, docs).  
5. Prefer **migrations** and reversible steps over ad-hoc production edits.  
6. **Never** hardcode or commit secrets (`.env`, Zoho tokens, JWT secrets, DB passwords).  
7. **Explain why** before risky changes; list files you will touch; wait for approval when the change is structural.  
8. Prefer **small commits** when the user asks to commit; do not push unless asked.  
9. **Do not** casually change production configuration (`118:8080`) or replication topology.  
10. Prefer maintainability and clarity over clever abstractions.  
11. **Ask** when uncertain — especially around lifecycle, quantity, auth, or dual-DB category routing.

Permanent Cursor rule (always apply): `.cursor/rules/assetengine-engineering-standards.mdc`.

---

## Product facts agents must not “forget”

| Fact | Detail |
|------|--------|
| Active app | `web-app/asset-manager-backend` + `web-app/asset-manager-frontend` |
| Backend shape | Large Express surface; much logic still in `server.js` |
| DB | PostgreSQL via Knex (not SQLite as primary) |
| Cache | Redis with in-memory fallback |
| Lifecycle truth | Root [`PROCESS_LOGIC.md`](./PROCESS_LOGIC.md) |
| Envs | Dev/test `59:9090` · Staging `59:8080` · Production `118:8080` |
| Remotes | `origin` → AnuragUb/Asset-Manager; `official` → CineomDevTeam/CineEAM |
| Folder name | Keep `web-app/` — do not rename to `apps/web` unless a true multi-app monorepo is approved |

---

## Where to read first

| Need | Document |
|------|----------|
| Docs map | [`docs/README.md`](./docs/README.md) |
| Architecture nav | [`docs/architecture/README.md`](./docs/architecture/README.md) |
| API domains | [`docs/06_API.md`](./docs/06_API.md) |
| Security posture | [`SECURITY.md`](./SECURITY.md), [`docs/07_SECURITY.md`](./docs/07_SECURITY.md) |
| Debt / risks | [`docs/08_TECHNICAL_DEBT.md`](./docs/08_TECHNICAL_DEBT.md) |
| Modernization plan | [`docs/Repository_Modernization_Plan.md`](./docs/Repository_Modernization_Plan.md) |
| Ops scripts | [`ops/README.md`](./ops/README.md) |

---

## Preferred change workflow

1. **Explain** intent and risk.  
2. **List files** to touch.  
3. **Wait** for approval on structural / multi-file / prod-adjacent work.  
4. Implement **one phase** at a time.  
5. **Verify** (run or describe verification).  
6. Suggest commit message; **wait** before commit/push if the user has not asked yet.

---

## Out of scope unless explicitly requested

- Moving application code out of `web-app/`  
- Renaming `web-app`  
- Rewriting `server.js` into a new framework  
- Force-push / history rewrite  
- Committing secrets “temporarily”  
- Opening public issues for security vulnerabilities (use [`SECURITY.md`](./SECURITY.md))

---

## Auth awareness

Many legacy routes are still open. Do not assume “logged-in UI” means “API is protected.” When adding endpoints, default to authenticated handlers consistent with newer routes, and call out any intentionally public routes (e.g. public asset view).
