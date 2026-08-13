# AssetEngine Deployment Environment Report

**Generated:** 2026-08-13 (investigation only — no deploy, no Production changes, no environment sync)  
**Investigation host:** `ITSupport-PC` (`192.168.6.59`)  
**Primary Git remote (product):** `origin` → https://github.com/AnuragUb/Asset-Manager  
**Secondary remote:** `official` → https://github.com/CineomDevTeam/CineEAM  
**Local tip inspected:** `90376b8` (`main`) — Sprint 1 complete tip  

**Critical naming note:** On host `59`, Docker container `asset-manager-prod` serves **Staging** on port **8080**. It is **not** Production server `118:8080`.

---

## Investigation answer: Do 9090 and 8080 share a working directory?

**Yes.** On `192.168.6.59`, both containers bind-mount the **same** host path:

| Container | Host port | Bind mount |
|-----------|-----------|------------|
| `asset-manager-test` | `9090` | `F:\AssetManager\AssetManager_Dev` → `/app` |
| `asset-manager-prod` | `8080` | `F:\AssetManager\AssetManager_Dev` → `/app` |

They are **not** separate Git repositories. There is **one** Git working tree for both Dev and Staging code.

They **do** use **separate PostgreSQL databases** on the shared `asset-manager-db` container:

| Environment | `DB_NAME` |
|-------------|-----------|
| Dev `9090` | `asset_manager_test` |
| Staging `8080` | `asset_manager` |

Redis is shared (`asset-manager-cache`).

---

## Environment Report — Development (`59:9090`)

| Field | Value |
|-------|--------|
| **Repository path** | `F:\AssetManager\AssetManager_Dev` |
| **Git branch** | `main` |
| **Current commit** | `90376b8` — `refactor(platform): consolidate lifecycle architecture` |
| **vs `origin/main`** | Local **ahead by 11 commits** (Sprint 1 not pushed to GitHub at investigation time) |
| **Docker Compose path** | `F:\AssetManager\AssetManager_Dev\docker-compose.yml` (service `app-test`) |
| **Backend path** | `web-app/asset-manager-backend` (container cwd `/app/web-app/asset-manager-backend`) |
| **Frontend path** | `web-app/asset-manager-frontend` |
| **Database** | PostgreSQL 15 (`asset-manager-db`) · DB `asset_manager_test` |
| **Redis** | Redis 7 (`asset-manager-cache`) · shared with Staging |
| **Node version** | `v20.20.2` (container) |
| **Container names** | App: `asset-manager-test` · DB: `asset-manager-db` · Redis: `asset-manager-cache` |
| **Bind mounts** | Repo root → `/app`; `input` → `/app/input`; anonymous volumes for backend/frontend `node_modules` |
| **Environment file** | Host `.env` present at repo root (keys include `DB_*`, `REDIS_*`, `PORT`, `NODE_ENV`, `ZOHO_*`, encryption key). Compose also injects service env. |
| **Port** | Host `9090` → container `9090` |
| **Working tree status** | Dirty at investigation (uncommitted auth rules + Sprint 1 retrospective) |
| **Uncommitted changes** | Modified: `AGENTS.md`, `.cursor/rules/assetengine-engineering-standards.mdc`; Untracked: `.cursor/rules/authentication-test-data.mdc`, `docs/architecture/SPRINT_1_RETROSPECTIVE.md` |
| **Migration status** | `31` rows in `knex_migrations` (latest: `20260812120000_assets_soft_delete_recovery.js`) |
| **App version marker** | Frontend `main.js?v=7.09` |
| **Health spot-check** | `GET /` → 200 |

---

## Environment Report — Staging (`59:8080`)

| Field | Value |
|-------|--------|
| **Repository path** | **Same as Dev:** `F:\AssetManager\AssetManager_Dev` |
| **Git branch** | **Same:** `main` @ `90376b8` |
| **Current commit** | **Same code commit as Dev** (shared bind mount) |
| **Docker Compose path** | Same `docker-compose.yml` (service `app-prod` — **misnamed** relative to product matrix) |
| **Backend / Frontend paths** | Same bind-mounted tree |
| **Database** | Same Postgres container · DB **`asset_manager`** (distinct data) |
| **Redis** | Shared `asset-manager-cache` |
| **Node version** | `v20.20.2` |
| **Container names** | App: `asset-manager-prod` · shared DB/Redis |
| **Bind mounts** | Identical pattern to Dev (same host path) |
| **Environment file** | Same host `.env` + compose overrides (`NODE_ENV=production`, `PORT=8080`, `DB_NAME=asset_manager`) |
| **Port** | Host `8080` → container `8080` |
| **Working tree status** | Same dirty tree as Dev |
| **Uncommitted changes** | Same as Dev |
| **Migration status** | `31` rows — Sprint 1 migrations present (`users.email`, soft-delete/`domain_events`) |
| **App version marker** | Same `v=7.09` files (shared disk) |
| **Health spot-check** | `GET /` → 200 |
| **`NODE_ENV`** | `production` (label only — this is Staging on `59`) |

---

## Environment Report — Production (`118:8080`)

| Field | Value |
|-------|--------|
| **Reachability from investigation host** | **Not reachable** — TCP probes to `192.168.6.118`, `192.168.1.118`, and hostname `118` on ports `8080` / `22` / `5432` all failed |
| **Repository path (intended / local mirror)** | Folder exists: `F:\AssetManager\AssetManager_Prod` (**no `.git` directory**) |
| **Git branch / commit** | **Unknown on live 118** (unreachable). Local Prod folder is **not** a Git clone |
| **Docker Compose path (in Prod folder)** | `F:\AssetManager\AssetManager_Prod\docker-compose.yml` (separate compose; containers named `asset-manager-app-prod`, `asset-manager-db-prod`, etc. in that file) |
| **Repo-root `docker-compose.prod.yml`** | Exists under Dev repo as a production-oriented template (does **not** bind-mount full source — image-oriented) |
| **Backend / Frontend** | Present under `AssetManager_Prod\web-app\...` |
| **Frontend version marker (local Prod folder)** | `main.js?v=6.03` — **far behind** Dev/Staging `v7.09` |
| **Database / Redis / Node / containers on 118** | **Not verified** this session |
| **Migration status on 118** | **Unknown** |
| **Working tree / uncommitted** | N/A for live host; local Prod folder is a separate tree without Git |

**Conclusion for Production:** Cannot certify synchronization or migration state until someone with access to host `118` runs the health/deploy scripts there (or restores network reachability).

---

## Compare Environments

### Code

| Aspect | Dev `9090` | Staging `8080` | Production `118` |
|--------|------------|----------------|------------------|
| Source tree | `AssetManager_Dev` | **Same tree** | Separate `AssetManager_Prod` (no Git); live 118 unknown |
| Sprint 1 tip `90376b8` | Present on disk | Present on disk | Local Prod folder appears ~`v6.03` era; live unknown |
| GitHub `origin/main` | Behind local by 11 commits | Same | Cannot pull Sprint 1 until push |

### Configuration

| Aspect | Dev | Staging | Production |
|--------|-----|---------|------------|
| `PORT` | 9090 | 8080 | 8080 (intended) |
| `NODE_ENV` | `test` | `production` | intended `production` |
| `DB_NAME` | `asset_manager_test` | `asset_manager` | intended separate prod DB |
| Compose | Shared `docker-compose.yml` | Shared | Separate prod compose / `docker-compose.prod.yml` pattern |

### Database

| Aspect | Dev | Staging | Production |
|--------|-----|---------|------------|
| Instance | Shared Postgres container | Shared Postgres container | Unknown on 118 |
| Logical DB | `asset_manager_test` | `asset_manager` | Unknown |
| Migration count | 31 | 31 | Unknown |
| Sprint 1 migrations | Applied | Applied | Unknown |

### Docker

| Aspect | Dev / Staging on 59 | Production |
|--------|---------------------|------------|
| Model | Bind-mount live source (instant code share) | Prod compose tends toward **image build** (less live-edit) |
| Risk | Restarting either app reloads same files; dirty tree affects both | Unknown on 118 |

### Dependencies

| Aspect | Finding |
|--------|---------|
| Node | `20.20.2` in both 59 app containers |
| `node_modules` | Per-container anonymous volumes (not host `node_modules`) |

### Secrets / env

| Aspect | Finding |
|--------|---------|
| Host `.env` | Present on Dev tree; Zoho + DB keys present (values not published here) |
| Compose defaults | Includes default JWT/encryption placeholders — **must not** be treated as Production-grade secrets |
| Production secrets | Not inspected (unreachable / do not invent) |

---

## Release philosophy (binding)

- **Git branches** represent development history (`main`, feature branches).  
- **Servers / ports** represent **deployment environments**.  
- **Never** create Git branches named `59:9090`, `59:8080`, or `118:8080`.  
- All environments should eventually run the **same `main`**, at **different points in time**, promoted deliberately.

Legacy `docs/runbooks/WORKFLOW.md` still describes a `dev`/`main` port mapping that is **stale** relative to this matrix — prefer [`DEPLOYMENT_WORKFLOW.md`](../runbooks/DEPLOYMENT_WORKFLOW.md).

---

## Release Readiness Report

### 1. Is `59:9090` ready?

**Conditionally yes for continued Dev work.** App responds; Sprint 1 code is on disk; migrations applied to `asset_manager_test`.

**Blockers / caveats:**

- Working tree is **dirty** (must commit or stash before formal deploy scripts run).  
- Sprint 1 commits are **not on GitHub `origin/main`** yet (11 commits ahead).  
- Shares code mount with Staging — “deploy Dev” and “deploy Staging” are not isolated code checkouts.

### 2. Is `59:8080` synchronized?

**Code: synchronized with Dev by construction** (same bind mount).  
**Data: not the same** (different DB).  
**Migrations: aligned at 31** including Sprint 1.

**Caveat:** Container name `asset-manager-prod` is misleading; treat as Staging.

### 3. Is `118:8080` synchronized?

**No evidence of synchronization.** Host unreachable from this investigation; local `AssetManager_Prod` mirror lacks Git and shows old UI cache-bust (`v6.03`).

### 4. Can Production safely pull from GitHub today?

**No — not for Sprint 1.**

Reasons:

1. `origin/main` does **not** contain Sprint 1 tip (`90376b8`); local is 11 commits ahead.  
2. Production host was unreachable — pull/restart not verified.  
3. Production folder is not a clean Git clone under investigation.  
4. Migrations / secrets / Zoho config on 118 are unknown.  

Pulling **today’s** GitHub `main` would install **pre–Sprint 1** code, not the Sprint 1 platform work.

### 5. What blockers exist?

| Priority | Blocker |
|----------|---------|
| P0 | Sprint 1 not pushed to `origin/main` |
| P0 | No verified access path to Production `118` from this host |
| P0 | Dirty local working tree before any formal promote |
| P1 | Dev/Staging share one code mount — promotion model must account for dual-impact restarts |
| P1 | Production secrets / SMTP / Zoho must be validated before go-live |
| P1 | Misleading container/compose naming (`app-prod` on Staging) |
| P2 | Stale runbook `WORKFLOW.md` (branch-per-port narrative) |
| P2 | Local `AssetManager_Prod` without Git complicates official promote-from-GitHub story |

### 6. What should be completed before Zoho SDK work begins?

1. **Commit** remaining docs/rules (retrospective, auth rules) or explicitly stash — clean tree.  
2. **Push** Sprint 1 `main` to GitHub `origin` (after review).  
3. **Adopt** the new deployment scripts + [`DEPLOYMENT_WORKFLOW.md`](../runbooks/DEPLOYMENT_WORKFLOW.md).  
4. **Run** `release-health-check.ps1` against `9090` and `8080`; fix FAIL items.  
5. **Decide** Production Git layout on `118` (clone `Asset-Manager`, track `main`, no bind-mount surprises).  
6. **Do not start Zoho SDK** until Dev/Staging health is green and Production access + backup/rollback plan exists — Zoho work will otherwise land on an undefined promote path.

---

## Explicit non-actions this session

- Did **not** deploy  
- Did **not** modify Production  
- Did **not** synchronize environments  
- Did **not** push to GitHub  
- Awaiting approval before any promote/sync
