# 09 — Current State

**As of documentation pass:** August 2026 (session-based understanding of `AssetManager_Dev`)  
**Git tip observed:** `main` @ `70bde35` (“Prepare repository for AI-assisted development”)  
**Remotes:** `origin` → AnuragUb/Asset-Manager; `official` → CineomDevTeam/CineEAM

---

## What is live and healthy

| Area | State |
|------|--------|
| Web app as product | Active |
| Postgres via Knex | Primary store in runtime config |
| Redis caching | Present with memory fallback |
| Asset dashboard + hierarchy | Mature, actively versioned (~v7.00 UI notes) |
| Projects assign / unassign / inspection | Core business path implemented |
| Sets / promote / split-unsplit | Implemented in backend helpers + UI |
| JWT login + RBAC tables | Present; partially applied across routes |
| Inventory UI | Present; backend feature-flagged / test-DB gated |
| Zoho sync | Implemented (tokens/env dependent) |
| ARRI service portal UI | Present (`servicePortal.js`) |
| Docker compose | Postgres + Redis + app-prod/test |
| Playwright | Present but thin |
| Permanent Cursor engineering rules | `.cursor/rules/assetengine-engineering-standards.mdc` |
| This `docs/` set | Created as current-state handbook |

---

## What is mid-migration / inconsistent

| Area | State |
|------|--------|
| Auth coverage | Newer routes JWT; many legacy routes open |
| Docs vs runtime | Docs often still say SQLite |
| Frontend serve path | Dist exists; server forces SOURCE |
| Branch workflow | Documented `dev`/`main` ≠ GitHub reality (`dev` stale) |
| Inventory schema | Preview migrations not universal |
| Service vs ARRI APIs | Overlapping concepts |
| Category dual-DB | Works for some paths; easy to misunderstand |
| Encryption at rest | Service exists; not uniformly obvious on all sensitive fields |

---

## What is deprecated or sediment

| Area | State |
|------|--------|
| PowerShell GUI | Deprecated, still in tree |
| Electron | Deprecated historically |
| QRCoder .NET lib | Unused by Node QR path |
| `web-app/public/` | Old snapshot UI |
| Orphan JS (`arri.js`, `admin.js`, `qr.js`) | Appears unused |
| Root check/fix/repair scripts | Ops archaeology |
| Local `*.db` SQLite files | Leftovers |
| OCR / scanner wiring | Partially commented / inconsistent |

---

## Environment snapshot (intent)

| | Prod intent | Test intent |
|--|-------------|-------------|
| Port | 8080 | 9090 |
| Branch (docs) | `main` | `dev` |
| Compose service | `app-prod` | `app-test` |
| Backup subdir pattern | `backups/8080_prod` | `backups/9090_dev` |

**Verify before acting:** actual host, folder (`AssetManager_Dev` vs `_Prod`), DB name, and remote.

---

## Known broken / mismatched contracts

| Symptom | Cause |
|---------|--------|
| `/api/all-orders` from dashboard | No backend route found |
| `/api/arri/clients` from legacy `arri.js` | Backend exposes `/api/arri/customers` |
| OCR nav may no-op | `setupOcr` import commented in `main.js` |
| “Change not visible” after JS edit | Forgot `?v=` bump |
| Inventory works on test only | Migrations skip non-`asset_manager_test` |

---

## Security posture (current)

- Usable auth exists but **not default** on all routes
- Open signup
- Default secret fallbacks in code
- Token/upload hygiene historically weak
- Debug endpoints reachable without auth

See [07_SECURITY.md](./07_SECURITY.md).

---

## Documentation posture (current)

| Doc | Trust |
|-----|-------|
| `docs/01`–`10` (this set) | Best current handbook |
| `PROCESS_LOGIC.md` (root) | High for lifecycle semantics |
| Root `README.md` + presentation docs | Current after Phase 3 rewrite |
| `docs/runbooks/WORKFLOW.md` | Intent only — verify branches/ports |
| `docs/archive/*` | Archaeology only; not source of truth |
| Backend README API list | Incomplete vs `server.js` |

---

## Team operating constraints (permanent)

1. No large architectural changes without asking  
2. No rewrites of working modules  
3. Preserve functionality  
4. Check API references before removal  
5. Propose DB migrations  
6. Never hardcode secrets  
7. Explain why  
8. Prefer incremental commits  
9. Never modify prod config casually  
10. Prefer maintainability over cleverness  
11. Ask when uncertain  

---

## One-line current state

**A production-capable asset logistics monolith on Postgres/Redis/Express with a large vanilla SPA — feature-rich, lifecycle-strong, auth/docs/hygiene uneven, Inventory/Zoho expanding, ready for disciplined incremental hardening rather than a rewrite.**
