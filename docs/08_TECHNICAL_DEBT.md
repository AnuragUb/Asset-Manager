# 08 — Technical Debt

## Summary

AssetEngine is a **battle-evolved monolith**: strong domain ideas, uneven modernization from a SQLite/LAN-trust past into Postgres/JWT/Redis/Zoho. Debt is concentrated in structure, consistency, and hygiene — not in lack of features.

---

## Architecture & structure

| Debt | Why it hurts |
|------|----------------|
| God-file `server.js` (~11k lines) | Hard to review, test, own; high merge conflict risk |
| God-module `dashboard.js` (~472KB) | Same on the frontend; DC/bulk/sets mixed with home UI |
| No clear domain router/service split | New features keep piling into the same files |
| Dual persistence eras | Postgres + leftover SQLite + JSON settings + Redis |
| Case translation forever | `normalizeResult` tax on every field |

---

## Correctness & domain

| Debt | Why it hurts |
|------|----------------|
| Lifecycle logic embedded in route handlers | Easy to bypass `updateAssetStatus` and desync kits |
| Stringly-typed status/dates | App-enforced enums; easy to invent illegal values |
| Soft-delete filter omissions | “Ghost” assets in UI |
| Inventory vs assets ambiguity | Preview tables gated to test DB; UI always on |
| Quantity vs set vs batch edge cases | Split/unsplit/promote interactions are subtle |

---

## Auth & API consistency

| Debt | Why it hurts |
|------|----------------|
| Half JWT, half open | Security holes + unclear contract for new engineers |
| Duplicate route registrations | Surprising effective middleware |
| Multiple user-admin APIs | `/api/users*`, `/api/tenant/users*`, `/api/rbac*` overlap |
| Service vs ARRI dual surfaces | Two APIs for similar job-card concepts |
| Frontend calls missing APIs | e.g. `/api/all-orders` |
| **Gmail SMTP credentials require production configuration** | Password-reset mail fails with BadCredentials when `dynamic.json` SMTP is misconfigured or uses non-production Gmail app passwords; Dev/Staging fall back to `devResetLink` only |

### Authentication — SMTP (tracked)

| Field | Value |
|-------|--------|
| Area | Authentication |
| Item | Gmail SMTP credentials require production configuration |
| Priority | Medium |
| Status | Known |
| Notes | Observed during Sprint 1 Issue 1 verification on `59:9090` / `59:8080`. Reset workflow is repaired; outbound mail still depends on valid SMTP in `web-app/asset-manager-backend/dynamic.json` (or successor secret store). Do not commit real credentials. |

---

## Frontend debt

| Debt | Why it hurts |
|------|----------------|
| `window.*` + HTML string handlers | Refactors break silently |
| `?v=` cache busting discipline | “Fix didn’t deploy” class bugs |
| Commented imports (OCR) vs live nav | Dead/half-dead features |
| Orphan modules (`arri.js`, `admin.js`, `qr.js`) | Confusion about source of truth |
| `forceSource=true` | Dist/minify pipeline unused; F12 “protection” aspirational |
| No shared API client | Inconsistent error/401 handling |

---

## Data & migrations

| Debt | Why it hurts |
|------|----------------|
| Environment-specific migrations | Inventory only on `asset_manager_test` |
| FK waves labeled for 9090 | Prod/test schema drift risk |
| Repair migrations mixed with product migrations | Hard to reason about greenfield apply |
| Ops SQL dumps / manual repairs in tree | Noise; accidental apply risk |

---

## Docs & process

| Debt | Why it hurts |
|------|----------------|
| README/architecture still mention SQLite/PowerShell | Wrong mental model |
| `WORKFLOW.md` `dev` branch stale on GitHub | Wrong deploy assumptions |
| Dual remotes + Dev/Prod folders | “What is production?” ambiguity |
| Thin automated tests | Fear-driven changes |

---

## Repository hygiene

| Debt | Why it hurts |
|------|----------------|
| Tracked uploads / OCR PDFs / model weights | Clone size + leak risk |
| Token files / Zoho resources in tree | Secret exposure |
| Dozens of root `check_*` / `fix_*` scripts | Unclear curated tooling |
| Deprecated PS/Electron/QRCoder binaries | Noise |
| Nested/stale `package.json` islands | Wrong install root |

---

## What is *not* the priority to “pay down” first

- Full rewrite in Nest/React
- Microservices
- Perfect obfuscation
- Aesthetic renames across 11k-line files without tests

Pay debt in the order of **security → lifecycle correctness → safe change ability → structure → hygiene**. See [10_NEXT_PHASE.md](./10_NEXT_PHASE.md).

---

## Engineering constraints while paying debt

From permanent rules:

- Never large architectural changes without asking
- Never rewrite working modules
- Always preserve functionality
- Prefer incremental commits
- Prefer maintainability over cleverness
