# AssetEngine Deployment Workflow

**Environments are servers, not Git branches.**

| Environment | Host:Port | Role |
|-------------|-----------|------|
| Development | `59:9090` | Day-to-day build & smoke |
| Staging | `59:8080` | Pre-production regression |
| Production | `118:8080` | Live |

Primary branch: **`main`** (GitHub `AnuragUb/Asset-Manager`).

Never create branches named `59:9090`, `59:8080`, or `118:8080`.

Full discovery evidence: [`../architecture/DEPLOYMENT_ENVIRONMENT_REPORT.md`](../architecture/DEPLOYMENT_ENVIRONMENT_REPORT.md).

---

## Release philosophy

```text
GitHub (main)
    ↓
Development 59:9090  →  Smoke Test
    ↓
Staging 59:8080      →  Regression Test
    ↓
Production 118:8080  →  Release Complete
```

- Git branches represent **development**.  
- Servers represent **deployment**.  
- Promote the **same codebase** through environments at different points in time.  
- Do not maintain long-lived environment branches.

---

## Current host reality (59)

On `192.168.6.59`, Dev and Staging containers **bind-mount the same folder** (`F:\AssetManager\AssetManager_Dev`).

Implications:

- `git pull` once updates **code for both** `9090` and `8080`.  
- Databases remain separate (`asset_manager_test` vs `asset_manager`).  
- Restart the correct container(s) after pull.  
- A dirty working tree blocks **both** formal Dev and Staging deploys.

Production must use its **own** Git checkout on host `118` (or an approved path). Do not treat `AssetManager_Prod` without `.git` as the long-term source of truth.

---

## Development workflow

1. Work on `main` or a short-lived feature branch merged to `main`.  
2. Keep the Dev container (`asset-manager-test`) running against the Dev DB.  
3. Smoke with dedicated account **`devadmin`** — never overwrite `admin` ([auth rule](../../.cursor/rules/authentication-test-data.mdc)).  
4. Commit with clean intent; update `CHANGELOG` / status docs when shipping a milestone.  
5. Push `main` to GitHub when ready to make the tip available for promotion.

---

## Promotion workflow

### Dev refresh (`deploy-dev.ps1`)

1. Abort if working tree dirty.  
2. `fetch` / `checkout main` / `pull origin main`.  
3. Install backend deps if needed.  
4. Restart `asset-manager-test`.  
5. Health-check port `9090`.  
6. Print commit, version marker, migration tip.

### Staging refresh (`deploy-staging.ps1`)

Same Git steps on the shared Dev tree (document the shared-mount fact), restart `asset-manager-prod` (Staging container), health-check `8080`, run migrations against Staging DB only when explicitly approved.

### Production promote (`deploy-production.ps1`)

1. Requires `-ConfirmProduction` switch.  
2. Operates on Production repo path (default `F:\AssetManager\AssetManager_Prod` or override).  
3. Aborts if path has no `.git` or tree dirty.  
4. Pull `main`, install, rebuild/restart Production compose as configured.  
5. Never runs against Dev bind-mount unless operator overrides with eyes open.  

**Do not run Production deploy until GitHub `main` contains the intended release tip and backups exist.**

---

## Rollback workflow

1. Identify last known good commit hash (from health-check output or GitHub).  
2. On the affected server checkout:  
   `git fetch origin`  
   `git checkout <good-sha>` (detached) **or** revert merge commit on `main` and re-promote.  
3. Restart app container(s).  
4. If a migration must be rolled back, use the specific Knex down migration **only** with DBA approval — prefer forward fixes when possible.  
5. Re-run `release-health-check.ps1`.  
6. Record the incident in `CHANGELOG.md`.

Preferred long-term: rollback by **re-deploying a previous `main` commit**, not by maintaining environment branches.

---

## Emergency hotfix workflow

1. Branch from the **Production-running commit** (or from `main` if Production is current).  
2. Minimal fix; smoke on `9090`.  
3. Merge to `main`; push.  
4. Promote Dev → Staging → Production with compressed regression focused on the fix.  
5. Do **not** hotfix only on `118` outside Git.

---

## Release checklist

- [ ] Feature complete and reviewed  
- [ ] Working tree clean on deploy host  
- [ ] `main` contains release tip on GitHub  
- [ ] Migrations reviewed; Staging DB migrated and verified  
- [ ] Smoke on `9090` PASS  
- [ ] Regression on `8080` PASS  
- [ ] `release-health-check.ps1` PASS on Dev and Staging  
- [ ] Production backup / snapshot confirmed  
- [ ] Secrets (JWT, DB, SMTP, Zoho) confirmed for Production  
- [ ] Rollback commit identified  
- [ ] Stakeholders notified  

---

## Deployment checklist (each environment)

- [ ] Script aborted on dirty tree (or tree cleaned intentionally)  
- [ ] `git pull origin main` succeeded  
- [ ] Dependencies installed if `package.json` changed  
- [ ] Correct container restarted  
- [ ] Home page 200  
- [ ] Auth login endpoint reachable  
- [ ] Commit hash displayed matches intended tip  
- [ ] Migration tip matches expectation  
- [ ] Frontend cache-bust / version marker noted  

---

## Recovery procedure

| Failure | Action |
|---------|--------|
| App container unhealthy | `docker logs <container>`; restart; check bind mounts |
| DB unreachable | Check `asset-manager-db` health; verify `DB_NAME` / credentials |
| Redis down | App may degrade to memory fallback — restore `asset-manager-cache` |
| Bad deploy | Rollback to last good commit; restart; health-check |
| Dirty tree blocked deploy | Commit, stash, or discard **intentionally** — never force with `--force` wipe |
| Production unreachable | Fix network/VPN/host access before any promote |

---

## Scripts

| Script | Purpose |
|--------|---------|
| [`ops/deployment/deploy-dev.ps1`](../../ops/deployment/deploy-dev.ps1) | Refresh Dev `9090` from `main` |
| [`ops/deployment/deploy-staging.ps1`](../../ops/deployment/deploy-staging.ps1) | Refresh Staging `8080` from `main` |
| [`ops/deployment/deploy-production.ps1`](../../ops/deployment/deploy-production.ps1) | Production promote (explicit confirm) |
| [`ops/deployment/release-health-check.ps1`](../../ops/deployment/release-health-check.ps1) | PASS / WARNING / FAIL report |

## Release manifests

Every cut release gets a permanent file under [`ops/releases/`](../../ops/releases/):

- Index + SemVer policy: [`ops/releases/README.md`](../../ops/releases/README.md)  
- Environment snapshot: [`ops/releases/DEPLOYMENT_MATRIX.md`](../../ops/releases/DEPLOYMENT_MATRIX.md)  
- [`v7.0.0.md`](../../ops/releases/v7.0.0.md) — modernization baseline  
- [`v7.1.0.md`](../../ops/releases/v7.1.0.md) — Sprint 1 platform foundations  
- Copy [`_TEMPLATE.md`](../../ops/releases/_TEMPLATE.md) only when cutting a real next version  

Update the **manifest** deployment status and the **Deployment Matrix** when each environment is verified.

Architecture: [`RELEASE_MANAGEMENT.md`](../architecture/RELEASE_MANAGEMENT.md).

---

## Related

- [`DEPLOYMENT_ENVIRONMENT_REPORT.md`](../architecture/DEPLOYMENT_ENVIRONMENT_REPORT.md)  
- [`RELEASE_MANAGEMENT.md`](../architecture/RELEASE_MANAGEMENT.md)  
- [`ops/deployment/README.md`](../../ops/deployment/README.md)  
- [`AGENTS.md`](../../AGENTS.md) — never modify Production without explicit ask  
