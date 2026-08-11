# AssetEngine (CineEAM) — Repository Modernization Plan

**Classification:** Engineering review only  
**Author role:** Lead Software Architect & DevOps Engineer  
**Scope:** `F:\AssetManager\AssetManager_Dev`  
**Date:** 2026-08-11  
**Status:** AWAITING APPROVAL — no automated cleanup, moves, deletes, or commits from this review  

**Explicit constraints honored:** no code rewrites, no file moves/deletes, no commits, no production config changes in this pass.

---

## Executive Summary

AssetEngine is a **production-capable internal logistics platform** (Express + Postgres + Redis + vanilla JS SPA) with strong domain logic (asset lifecycle, projects, sets/kits) and weak repository discipline.

The codebase can support **3–5 years of multi-engineer + multi-AI development**, but only if the repository becomes a **clean source-of-truth package** rather than a **workstation mirror** (uploads, backups, tokens, repair SQL, dual remotes, stale docs).

### Verdict

| Dimension | Verdict |
|-----------|---------|
| Product viability | Strong — keep building on the web app |
| Repo readiness for 2nd engineer | Weak-moderate — onboarding friction high |
| AI readiness | Moderate — new `docs/` helps; tree noise and secrets hurt |
| Commercial / production quality gap | Security perimeter + git hygiene + env contract |

### Strategic intent (next 3–5 years)

1. **Preserve** working domain behavior (lifecycle, projects, inventory direction).  
2. **Harden** auth, secrets, and deploy boundaries.  
3. **Normalize** repo layout so humans and AIs share one map.  
4. **Modularize incrementally** (no rewrite).  
5. **Keep on-prem multi-host model** (59 / 118) until a later explicit cloud decision.

### What this plan does *not* recommend yet

- Cloud migration  
- React/Nest rewrite  
- Microservices  
- Deleting working APIs  
- Big-bang folder moves without a sequenced PR plan  

---

## Repository Health

### Health scores (1–10)

| Category | Score | Explanation |
|----------|------:|-------------|
| **Organization** | **4** | Active product is clear (`web-app/`), but root is polluted with one-off scripts, SQL dumps, debug notes, and legacy GUI. Multiple `package.json` islands. Odd tracked path `web-app/asset-manager-backend/c?/…` backup fragments. |
| **Maintainability** | **3** | `server.js` (~445KB) and `dashboard.js` (~461KB) concentrate risk. Duplicate routes, inconsistent auth, case-translation tax (`normalizeResult`). Changes are fear-driven. |
| **Security** | **3** | Working JWT/RBAC exists but many mutating routes remain open. Tracked `zoho_tokens.txt`, large `input/` artifacts, code default secrets (`JWT_SECRET`, `EXTERNAL_API_KEY`, encryption key fallback), open signup, `secure: false` cookies. |
| **Documentation** | **6** | New `docs/01–10` + `PROCESS_LOGIC.md` are a solid base. Root still has stale SQLite/PowerShell architecture docs and contradictory workflow notes. Not yet single source of truth. |
| **Scalability** | **4** | Fine for single-host / small team LAN scale. Monolith + Redis KEYS invalidation + memory cache fallback + dual DB category routing will not scale cleanly to many instances without work. |
| **Onboarding Experience** | **5** | `docs/` + engineering rules help. Still blocked by secret sprawl, unclear “what is prod,” and monolith intimidation. |
| **AI Readiness** | **5** | AI can navigate with `docs/` and Cursor rules, but tracked binaries/uploads/SQL and huge files waste context; contradictory markdown causes wrong edits. |
| **Git Hygiene** | **3** | `.gitignore` ignores `.env`, `*.sql`, `backups/`, `*.db` — yet many SQL/input/report/token files are **already tracked**. No `.gitattributes`. Stale branches. Dual remotes without policy. ~297 tracked files including 16MB OCR PDF. |
| **Deployment Readiness** | **5** | Docker Compose + Dockerfiles exist; scripts for replication/failover exist. Env matrix (59:9090 / 59:8080 / 118:8080) is operational but under-documented as a formal contract; `forceSource=true` blurs prod vs debug serving. |

**Weighted overall: ~4.0 / 10** — operable product, not yet a commercial-grade repository.

---

## Architecture Health

### Strengths

- Clear product boundary: **web app only** (PS/Electron deprecated in intent).  
- Real domain core: `updateAssetStatus`, `promoteToAsset`, project assign/inspect/release.  
- Postgres + Knex migrations exist; Redis caching exists.  
- Frontend modular ES files (even if uneven).  
- Docker path for Postgres/Redis/app ports 8080/9090.  

### Structural risks

| Risk | Impact |
|------|--------|
| Monolithic `server.js` | Every AI/engineer PR collides; hard reviews |
| Auth inconsistency | Security + surprising bugs |
| Inventory preview gated by DB name | Env drift (9090 vs 8080 vs 118) |
| Docs claiming SQLite | Wrong AI/human assumptions |
| Dual remotes (`origin`, `official`) | Wrong push target |
| `forceSource=true` | Prod serves debug assets |
| Lifecycle not isolated | Accidental bypass of status helper |

### Architecture health score: **5 / 10**

Capable system design buried in evolutionary debt — **keep the architecture, professionalize the boundaries**.

---

## Task 1 — Complete Repository Audit (classification)

### Top-level classification

| Path | Category | Notes |
|------|----------|-------|
| `web-app/asset-manager-backend/` (js services, migrations, server) | **Source Code** | Primary backend |
| `web-app/asset-manager-frontend/js`, `*.html`, `static/` (non-upload) | **Source Code** | Primary frontend |
| `web-app/asset-manager-frontend/dist/` | **Build Output** | Generated; gitignored but present on disk; not currently served |
| `web-app/asset-manager-backend/migrations/` | **Source Code** / schema | Keep |
| `web-app/asset-manager-backend/services/` | **Source Code** | Keep |
| `docs/` | **Documentation** | New handbook (currently untracked) |
| Root `*.md` (`README`, `PROCESS_LOGIC`, architecture*, workflow*, guides) | **Documentation** | Mixed fresh/stale |
| `.cursor/rules/` | **Development Tools** | Permanent AI/engineering rules (untracked) |
| `tests/`, `playwright.config.js` | **Development Tools** | Thin but valid |
| `scripts/` | **Development Tools** | Ops/DB utilities — keep curated |
| Root `check_*.js`, `fix_*.js`, `repair_*.js`, `ghost_*.js` | **Development Tools** / clutter | Duplicate of `scripts/` themes |
| `docker-compose*.yml`, `Dockerfile`, `.dockerignore` | **Deployment Assets** | Keep |
| `run-prod.bat`, `run-test.bat`, `health_check.ps1` | **Deployment Assets** | Keep/clarify |
| `replicate_*.ps1`, `restore_*.ps1`, `sync_to_nvme.ps1`, `diagnose_docker.ps1` | **Deployment Assets** / ops | Keep but isolate |
| `REDUNDANCY_SETUP.md`, `SERVER_SETUP_GUIDE.md`, `INFRASTRUCTURE_UPGRADE_PLAN.md` | **Documentation** + deploy | Keep; reconcile with env matrix |
| `.env` | **Secrets / Sensitive** | Present; gitignored — good |
| `web-app/**/zoho_tokens.txt` | **Secrets / Sensitive** | **Tracked — critical** |
| `web-app/**/zoho_resources/` | **Generated Files** / sensitive-adjacent | SDK caches; large JSON tracked |
| `input/` | **Runtime Artifacts** / uploads | **Many files tracked** including 16MB PDF |
| `export/` | **Runtime Artifacts** | Runtime outputs |
| `backups/` | **Runtime Artifacts** / **Database Assets** | gitignored on disk; good |
| `data/` | **Database Assets** / legacy | SQLite/JSON legacy |
| `*.db` on disk / backend | **Database Assets** | gitignore pattern exists; verify untracked |
| Root `*.sql`, `manual_sync.sql`, `restore_temp.sql`, repair SQL | **Database Assets** / dumps | **Tracked despite `*.sql` ignore** (tracked-before-ignore) |
| `web-app/asset-manager-backend/c?/…pg_backup_*.sql` | **Runtime Artifacts** / corruption | Bizarre tracked backup paths |
| `eng.traineddata` | **Generated Files** / model weight | **Tracked (~5MB)** |
| `playwright-report/`, `test-results/` | **Generated Files** | Report partially tracked; should ignore |
| `node_modules/` (all) | **Build Output** / deps | Ignored — good |
| `lib/QRCoder*` | **Legacy Components** | .NET QR; unused by Node `qrcode` |
| `asset_manager.ps1`, `.bat` | **Legacy Components** | Deprecated GUI |
| `web-app/public/` | **Legacy Components** | Old UI snapshot |
| `web-app/nav-raul-drunk-backup.html` | **Temporary Files** / leftover | Backup experiment |
| `export_test.*`, `Untitled-1.txt`, `js_files.txt`, `dist_js_files.txt` | **Temporary Files** | Noise |
| `debug.log`, `sdk_logs.log` | **Temporary Files** | Logs |
| Frontend orphans `arri.js`, `admin.js`, `qr.js` | **Source Code** (likely dead) | Confirm before archive |
| `ASSETENGINE_SESSION_BRIEFING.txt` | **Documentation** | Session dump (untracked) |
| `package.json` (root / web-app / front / back) | **Source Code** / tooling | Multiple roots — policy needed |

### Unknown / needs human confirmation

| Item | Question |
|------|----------|
| Canonical git remote | `origin` (AnuragUb) vs `official` (CineomDevTeam)? |
| Canonical prod host | Confirm 118:8080 vs any other |
| Whether `AssetManager_Prod` folder shares this git or is a copy | Affects deploy SOP |
| Which SQL dumps are still needed for forensics | Archive vs discard after backup to secure storage |

---

## Security Findings (Task 6)

### Critical

| Finding | Evidence | Remediation (plan only) |
|---------|----------|-------------------------|
| Zoho OAuth token files tracked | `git ls-files` → `web-app/zoho_tokens.txt`, `web-app/asset-manager-backend/zoho_tokens.txt` | Rotate Zoho tokens; remove from git tracking; add ignore; purge history if repo is/was shared |
| Secrets on disk in `.env` | Exists; contains DB + Zoho + encryption key material | Keep gitignored; store prod secrets outside repo; rotate if ever copied into chat/backups |
| Default JWT secret in code | `JWT_SECRET || 'change-this-secret-in-production'` | Fail closed in production when unset; rotate |
| Default external API key | `EXTERNAL_API_KEY || 'AM-EXTERNAL-API-KEY-2026'` | Same |
| Default encryption key fallback | `encryptionService.js` hardcoded fallback | Same |
| Open mutating APIs | DC, employees, OCR, settings, some ARRI, bulk/split paths | Auth-by-default program; public allowlist |
| Open signup | `POST /api/signup` | Disable or admin-invite only |
| Debug endpoints unauthenticated | `/api/debug/*` | Dev-only guard |

### High

| Finding | Remediation |
|---------|-------------|
| Tracked uploads (`input/**`) | Stop tracking; keep local/runtime only; use secure file store if needed |
| Tracked SQL dumps / embedded backup paths | Remove from index; store in secure backup location |
| Cookie `secure: false` | Tie to HTTPS / env |
| Plaintext password login still accepted | Migrate remaining users; then bcrypt-only |
| Network credentials API may store plaintext device passwords | Enforce encrypt-on-write via encryptionService |
| 100mb JSON limit | Lower default; special-case OCR uploads |
| Dual token file locations | Single secure path outside repo or OS secret store |

### Medium

| Finding | Remediation |
|---------|-------------|
| No rate limiting on auth | Add basic rate limit |
| Playwright report tracked | Ignore + untrack |
| `eng.traineddata` tracked | Ignore + install/download step documented |
| Logging may be overly verbose around auth | Redact |

### Do not do in remediation without approval

- Rewriting auth system  
- Deleting Zoho integration  
- Changing production `.env` on 118 without change window  

---

## Cleanup Plan (Task 3)

> Actions are **recommendations only**. Nothing has been moved/deleted.

| Target | Action | Why |
|--------|--------|-----|
| `web-app/asset-manager-backend/**` (source) | **KEEP** | Product core |
| `web-app/asset-manager-frontend/js,html,static` | **KEEP** | Product core |
| `web-app/asset-manager-frontend/dist` | **IGNORE** | Build output; already ignore pattern — ensure never re-tracked |
| `docs/` | **KEEP** | Emerging source of truth |
| Root stale architecture markdown | **MOVE** → `docs/archive/` or consolidate | Reduce contradiction with `docs/01–10` |
| `PROCESS_LOGIC.md` | **KEEP** (or **MOVE** → `docs/`) | High-value domain truth |
| `WORKFLOW.md` | **KEEP** then **REWRITE** content (later) | Currently misleading vs GitHub |
| `README.md` | **KEEP** then refresh | Entry point for humans/AIs |
| `scripts/` | **KEEP** + curate README index | Valid ops toolkit |
| Root `check_*/fix_*/repair_*/ghost_*` | **MOVE** → `scripts/legacy/` or `tools/one-offs/` | Deduplicate root |
| `tests/` + playwright config | **KEEP** | Expand later |
| `playwright-report/`, `test-results/` | **IGNORE** (+ untrack) | Generated |
| `input/`, `export/` | **IGNORE** (+ untrack uploads) | Runtime artifacts |
| `backups/` | **IGNORE** (already) + ensure not tracked via weird paths | Runtime DB dumps |
| `data/` | **ARCHIVE** or ignore policy | Legacy SQLite/JSON |
| `lib/QRCoder*` | **ARCHIVE** | Legacy unused |
| `asset_manager.ps1/.bat` | **ARCHIVE** | Deprecated GUI |
| `web-app/public/` | **ARCHIVE** | Old snapshot |
| `nav-raul-drunk-backup.html` | **DELETE** (after confirm) or **ARCHIVE** | Temp leftover |
| `zoho_tokens.txt` (all) | **IGNORE** + untrack + rotate | Secrets |
| `zoho_resources/` | **IGNORE** generated SDK cache (or document regenerate) | Bloat |
| `eng.traineddata` | **IGNORE** + document fetch | Binary weight |
| Root/tracked `*.sql` | **IGNORE** already; **untrack** + secure off-repo store | Dumps ≠ source |
| `export_test.*`, `Untitled-1.txt`, `*_files.txt` | **DELETE** or **ARCHIVE** | Noise |
| `.env` | **IGNORE** (keep) | Secrets |
| `.env.example` | **KEEP** (create later) | Safe template |
| Docker/compose/Dockerfiles | **KEEP** | Deploy |
| Replication/restore PS1 | **MOVE** → `deploy/ops/` or `ops/` | Discoverability |
| `.cursor/rules` | **KEEP** | AI/engineering standards |
| `ASSETENGINE_SESSION_BRIEFING.txt` | **MOVE** → `docs/archive/` or keep private | Session dump; avoid secret creep |
| Dual `package.json` at `web-app/` | **RENAME/clarify** or remove stale | Confusion |
| Backend `c?/...` tracked backups | **DELETE from git index** | Accidental path corruption |

---

## Folder Restructure (Task 4)

### Design principles (for *this* project)

- One obvious product root: `web-app/` can remain, or promote to `apps/` — **minimal rename churn preferred**.  
- Separate **source**, **ops**, **docs**, **artifacts**.  
- Do not force monorepo fashion (Nx/Turborepo) yet — cost > benefit today.  
- Preserve runnable paths (`server.js` location) until a dedicated migration PR.

### Proposed target structure (evolutionary)

```text
AssetManager_Dev/                 # or rename repo root to AssetEngine later
├── README.md                     # single entry
├── LICENSE
├── CONTRIBUTING.md
├── SECURITY.md
├── CHANGELOG.md
├── .env.example                  # names only
├── .gitignore                    # tightened
├── .gitattributes
├── .dockerignore
├── docker-compose.yml
├── docker-compose.prod.yml
├── Dockerfile
│
├── apps/
│   └── web/                      # optional rename of web-app (Phase 2+)
│       ├── backend/              # today’s asset-manager-backend
│       │   ├── src/              # future: split server.js (later)
│       │   ├── migrations/
│       │   ├── services/
│       │   └── package.json
│       └── frontend/             # today’s asset-manager-frontend
│           ├── js/
│           ├── static/
│           ├── index.html
│           └── package.json
│
├── docs/                         # single documentation home
│   ├── 01_PROJECT_OVERVIEW.md … 10_NEXT_PHASE.md
│   ├── Repository_Modernization_Plan.md  # this document (or stay root)
│   ├── runbooks/                 # 59/118 deploy, failover
│   ├── adr/                      # architecture decision records
│   └── archive/                  # stale historical md
│
├── ops/                          # human/ops automation
│   ├── scripts/                  # curated DB tools from scripts/ + root one-offs
│   ├── replication/              # replicate_*.ps1, restore_*.ps1
│   └── health/                   # health_check.ps1
│
├── tests/                        # e2e + future api tests
│   └── playwright/
│
├── tools/                        # optional codegen/lint helpers later
│
├── archive/                      # immutable legacy (PS GUI, QRCoder, old public/)
│
└── .cursor/rules/                # AI + team standards
```

### Near-term structure (Week 1–4, lower risk)

**Do not rename `web-app` immediately.** First:

```text
docs/           # canonical docs (already started)
ops/scripts/    # move one-offs here in a dedicated PR
ops/replication/
archive/legacy/ # PS, QRCoder, old public
artifacts/      # local-only: input, export, backups (gitignored)
```

Keep `web-app/asset-manager-backend|frontend` paths stable until imports/Docker/docs all updated in one approved PR.

---

## Git Improvements (Task 5)

### Current `.gitignore` gaps / failures

Already ignores: `node_modules`, `dist`, `*.db`, `.env`, `backups/`, `*.sql`, some logs.  

**Still tracked anyway (ignore does not untrack):**

- `input/**` uploads + OCR PDF  
- `zoho_tokens.txt`  
- `eng.traineddata`  
- `manual_sync.sql`, `restore_temp.sql`, repair SQL  
- `playwright-report/**`  
- bizarre `c?/…pg_backup_*.sql` paths  
- `lib/QRCoder.nupkg` (zip-like binary)  

**Missing ignore rules to add (later PR):**

```text
input/
export/
playwright-report/
test-results/
**/zoho_tokens.txt
**/zoho_resources/
*.traineddata
.env.local
.env.*.local
sdk_logs.log
debug.log
*.qr.png
```

Also ignore runtime DB files under backend if any escape `*.db`.

### `.gitattributes` (missing)

Recommend later:

- Enforce LF for `*.js`, `*.md`, `*.yml`  
- Mark binary types (`*.png`, `*.pdf`, `*.traineddata`, `*.nupkg`)  
- Optionally export-ignore for archive  

### Branch structure

| Branch | Observation | Recommendation |
|--------|-------------|----------------|
| `main` | Current tip; appears primary | Protect; PR-only |
| `dev` (origin) | Months behind | Either revive as integration branch or delete after policy |
| `fix-sync` | Same as main tip | Merge/delete after confirm |
| `Broken-State` | Ancient | Archive/delete |
| `official/*` | Second remote | Document which remote is canonical |

**Proposed long-term branching**

- `main` — production candidate (118)  
- `staging` — 59:8080  
- `develop` — 59:9090 (if 3-env model kept)  
- `feature/*` — short-lived  

Or simpler 2-branch: `main` (prod) + `develop` (59 both ports via tags/config) — decide explicitly.

### Large / binary files that should never live in Git

| Item | Approx | Action |
|------|--------|--------|
| `input/ocr_pro_*.pdf` | ~16MB | Untrack |
| `eng.traineddata` | ~5MB | Untrack |
| Logos duplicated in `input/` | ~700KB×N | Untrack |
| Zoho resource JSON | ~1MB | Untrack/ignore |
| QRCoder nupkg/xml | large | Archive off-git or Git LFS only if truly needed (prefer archive) |
| SQL dumps | 200KB–500KB+ | Secure backup store, not git |

### Backup strategy (git is not a backup)

| Data | Where it should live |
|------|----------------------|
| Postgres | `pg_dump` to `backups/` on host + off-box copy (NAS/`sync_to_nvme`) |
| `.env` / tokens | Password manager / secured host path — never git |
| Uploads | Host volume / NAS |
| Repo source | GitHub remotes |

---

## Documentation Improvements (Task 7)

### What exists

| Doc | Role | Health |
|-----|------|--------|
| `docs/01–10` | Modern handbook | Good start; untracked until approved commit |
| `PROCESS_LOGIC.md` | Lifecycle truth | High value |
| `README.md` | Entry | Stale (PS customization, incomplete stack) |
| `WORKFLOW.md` | Branch/port | Contradicts GitHub `dev` reality |
| `ARCHITECTURE_OVERVIEW.md`, `system-architecture.md` | Maps | Useful but SQLite-era claims |
| `ARCHITECTURE_PROPOSAL.md`, `INFRASTRUCTURE_UPGRADE_PLAN.md` | Planning | May conflict with `docs/10` |
| `DATABASE_AUDIT_9090.md`, debug-*.md | Incident notes | Archive |
| `TESTING_GUIDE.md`, `SERVER_SETUP_GUIDE.md`, `REDUNDANCY_SETUP.md` | Ops | Keep; move under `docs/runbooks/` |
| Backend README | API list | Incomplete vs `server.js` |
| `ASSETENGINE_SESSION_BRIEFING.txt` | Session dump | Archive; don’t treat as norm |

### Missing documents (recommend creating later)

| Doc | Why |
|-----|-----|
| `.env.example` | Safe onboarding without secrets |
| `docs/runbooks/ENVIRONMENTS.md` | 59:9090 / 59:8080 / 118:8080 contract |
| `docs/runbooks/FAILOVER.md` | From redundancy scripts |
| `docs/PUBLIC_API_ALLOWLIST.md` | Security program |
| `ADR` folder | Record decisions (inventory promote vs quarantine, canonical remote) |
| `CONTRIBUTING.md` | Second engineer + AI workflow |
| Root `SECURITY.md` | Vulnerability reporting + secret policy |

### Duplicates / contradictions

| Conflict | Resolution direction |
|----------|---------------------|
| SQLite vs Postgres | Postgres wins; archive or banner old docs |
| `WORKFLOW.md` ports/branches vs real GitHub + 59/118 matrix | Rewrite workflow to match ops reality |
| Backend README API vs `docs/06_API.md` | Make `docs/06` canonical; trim backend README |
| `docs/10_NEXT_PHASE` vs this modernization plan | This plan = repo/devops track; `10` = product hardening track — cross-link |
| Dual product names | Standardize **AssetEngine (CineEAM)** in README |

### Documentation principles for AI era

1. **One handbook tree:** `docs/`  
2. **Root README = pointer + quick start only**  
3. **Archive, don’t delete history notes**  
4. **Every env fact in one runbook**  
5. **Banner stale files:** `> STALE — see docs/…`  

---

## Engineering Standards Recommendations (Task 8)

> Explain only — do **not** generate these files yet.

| Artifact | Why needed |
|----------|------------|
| **CONTRIBUTING.md** | Second engineer + AI need: branch rules, how to run, how to PR, “ask before architecture,” migration rules, `?v=` bump ritual |
| **SECURITY.md** | Where to report issues; forbid committing `.env`/tokens; rotation expectations; public contact |
| **CHANGELOG.md** | Commercial discipline; human-readable history beyond git log; release communication for 118 deploys |
| **CODEOWNERS** | Protect `server.js` lifecycle helpers, migrations, docker/ops, auth routes from drive-by AI edits |
| **LICENSE** | Clarify IP for commercial production (company proprietary vs other) — legal requirement before external sharing |
| **GitHub Issue Templates** | Bug vs feature vs security; force env (59/118), port, module |
| **Pull Request Template** | Checklist: auth considered? migration? references grep? docs updated? no secrets? |
| **GitHub Actions** | Minimum: lint/syntax check, Playwright smoke on PR, block commits with `.env`/`zoho_tokens` patterns; later migration dry-run |

These create **social and automated guardrails** so multiple AIs cannot silently violate team norms.

---

## Deployment Improvements (Task 9)

### Current understanding (from stakeholder)

| Environment | Host:Port | Role |
|-------------|-----------|------|
| Development / Test | **59:9090** | Day-to-day engineering validation |
| Staging | **59:8080** | Pre-prod / internal staging |
| Production | **118:8080** | Live commercial operations |

Local folders `AssetManager_Dev` / `AssetManager_Prod` and Docker `app-test`/`app-prod` partially mirror this but naming is inconsistent (`dev` branch ≠ 9090 necessarily).

### Is this model appropriate?

**Yes, for on-prem / LAN commercial use**, with caveats:

| Pros | Cons |
|------|------|
| Physical separation of prod (118) | Config drift between 59 and 118 |
| Staging on same box as test (59) is cost-efficient | Staging/prod parity weaker if DBs/schemas diverge |
| Familiar to current ops (replication scripts exist) | Under-documented; tribal knowledge |
| Avoids premature cloud complexity | Backup/failover must be disciplined |

**Recommendation:** Keep 3-environment on-prem model for the next phase. Improve **contracts**, not topology.

### Recommended improvements (no cloud)

1. **Write `docs/runbooks/ENVIRONMENTS.md`**  
   - Host, port, compose file, branch, DB name, feature flags, who may deploy  
2. **One config shape, three env files** (on hosts, not in git):  
   - `.env.9090`, `.env.8080-staging`, `.env.8080-prod` (names illustrative)  
3. **Schema parity policy**  
   - Migrations apply to all envs; inventory gate-by-DB-name must be resolved (promote or quarantine)  
4. **Serving policy**  
   - Staging/Prod should serve `dist/` (or immutable release tag); `forceSource` only on 9090  
5. **Deploy SOP**  
   - Tag release → deploy 59:8080 → smoke → deploy 118:8080  
6. **Replication/failover**  
   - Keep scripts under `ops/replication/`; quarterly drill; document RPO/RTO  
7. **Health checks**  
   - Standardize `health_check.ps1` against all three endpoints  
8. **Secrets**  
   - Different JWT/Zoho/DB credentials per environment  

### Mapping to git

| Env | Suggested branch/tag |
|-----|----------------------|
| 59:9090 | `develop` HEAD |
| 59:8080 | `main` or `staging` tag candidates |
| 118:8080 | annotated release tags only (`vX.Y.Z`) |

---

## Immediate Actions — Next 1 Week

**Still require explicit approval before execution.**

1. **Approve this plan** (this document).  
2. **Decide canonical remote** (`origin` vs `official`) and write it down.  
3. **Secret incident response (read-only prep):** list all token/.env locations; schedule rotation window for Zoho + JWT + DB if exposure possible.  
4. **Git hygiene PR (minimal):** expand `.gitignore`; `git rm --cached` for tokens, `input/**`, reports, sql dumps, `eng.traineddata` (files remain on disk).  
5. **Track `docs/` + Cursor rules** in git (no behavior change).  
6. **Refresh root `README.md`** to point at `docs/` and Postgres truth (short).  
7. **Draft environment matrix** for 59:9090 / 59:8080 / 118:8080 (doc only).  
8. **Identify top 10 unauthenticated mutating routes** (doc allowlist/denylist only).  

**Do not this week:** move `web-app`, split `server.js`, delete legacy PS, cloud design.

---

## Medium-Term Actions — Next Month

1. Auth-by-default for mutating APIs (phased PRs; preserve behavior).  
2. Disable/gate signup; bcrypt-only plan.  
3. Create `.env.example`, `CONTRIBUTING.md`, `SECURITY.md`, PR template.  
4. Resolve Inventory: promote to all envs **or** quarantine UI/API.  
5. Fix duplicate routes (`/api/projects`, `/api/users`, `/api/asset_kinds`).  
6. Serve `dist` on 8080 environments; keep source on 9090.  
7. Curate `ops/scripts` — move root one-offs.  
8. Archive legacy (`lib/QRCoder`, PS GUI, `web-app/public`) into `archive/`.  
9. Add CI: secret scan + Playwright smoke.  
10. Protect `main` with CODEOWNERS on lifecycle/auth/migrations.  
11. Align branching with 59/118 promote path; retire `Broken-State`.  
12. Minimal lifecycle E2E tests (assign → inspect → release).  

---

## Long-Term Actions — Next 6 Months

1. Incremental extraction of `server.js` → domain routers/services **with tests** (approved architecture change).  
2. Peel DC/bulk out of `dashboard.js`.  
3. Stable release train + CHANGELOG + tags for 118.  
4. Permission cache invalidation / session hardening.  
5. Formal DR drills using replication scripts; document results.  
6. Optional monorepo rename (`apps/web`) only if path cost justified.  
7. Performance pass: replace Redis `KEYS` deletes; pagination discipline.  
8. Commercial packaging: LICENSE, support runbooks, backup retention policy.  
9. Revisit cloud **only** as an explicit Phase 2 program (out of scope now).  

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Secret leak via git history | High if repo shared | Critical | Rotate + history purge / private rewrite with legal care |
| Schema drift 59 vs 118 | High | High | Migration policy + inventory decision |
| AI deletes “unused” API | Medium | High | CODEOWNERS + CONTRIBUTING + reference grep rule |
| Auth lockdown breaks LAN workflows | Medium | Medium | Phased enablement + staging on 59:8080 first |
| Big-bang folder move breaks Docker/paths | Medium | High | Defer rename; small moves first |
| Prod serves source JS forever | High | Medium | Env-specific `forceSource` |
| Dual remote push to wrong place | Medium | High | Document canonical remote; remove write access on secondary if needed |
| Lifecycle regression | Medium | Critical | Tests before extractions |
| Treating git as backup | High culturally | Critical | Explicit backup runbook |

---

## Cross-links to existing docs

| Topic | See |
|-------|-----|
| Product overview | `docs/01_PROJECT_OVERVIEW.md` |
| Architecture | `docs/02_ARCHITECTURE.md` |
| Database | `docs/03_DATABASE.md` |
| API map | `docs/06_API.md` |
| Security detail | `docs/07_SECURITY.md` |
| Technical debt | `docs/08_TECHNICAL_DEBT.md` |
| As-is snapshot | `docs/09_CURRENT_STATE.md` |
| Product hardening phases | `docs/10_NEXT_PHASE.md` |
| Engineering rules | `.cursor/rules/assetengine-engineering-standards.mdc` |

This modernization plan is the **repo/DevOps track**. `docs/10_NEXT_PHASE.md` is the **application hardening track**. Execute both, sequenced under approval.

---

## Approval Gate

**No cleanup, moves, deletes, ignores changes, rotations, or commits should proceed until you approve specific items.**

Suggested approval reply format:

1. Canonical remote = ?  
2. Approve Week-1 git hygiene untrack list? (Y/N)  
3. Approve committing `docs/` + rules? (Y/N)  
4. Inventory decision preference: Promote / Quarantine / Defer  
5. Any host/port corrections to 59:9090 / 59:8080 / 118:8080?  

---

*End of Repository Modernization Plan — review only.*
