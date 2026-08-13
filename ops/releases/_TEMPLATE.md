# Release vX.Y.Z — \<Title\>

## Overview

| Field | Value |
|-------|--------|
| **Release Name** | |
| **Release Version** | `vX.Y.Z` |
| **Release Date** | YYYY-MM-DD |
| **Git Commit (full)** | |
| **Git Commit (short)** | |
| **Git Tag** | `vX.Y.Z` (create when approved — future) |
| **Git Branch** | `main` |
| **Author** | |
| **Approved By** | |

---

## Scope

**Purpose**

**Business reason**

**Engineering reason**

---

## Included Features

| Feature | Sprint / Issue | Architecture docs |
|---------|----------------|-------------------|
| | | |

---

## Bug Fixes

| Fix | Sprint / Issue | Notes |
|-----|----------------|-------|
| | | |

---

## Database

| Field | Value |
|-------|--------|
| **Migration tip** | |
| **Migration count** | |
| **Schema version** | (tip migration name / count) |
| **Rollback required?** | No / Yes — explain |

| Migration file | Notes |
|----------------|--------|
| | |

---

## Infrastructure

| Field | Value |
|-------|--------|
| **Docker image / tag** | N/A or `assetengine:vX.Y.Z` |
| **Docker Compose** | e.g. `docker-compose.yml` |
| **Node version** | |
| **PostgreSQL version** | |
| **Redis version** | |
| **Frontend cache marker** | `main.js?v=` |

---

## Smoke Test

| Environment | Host | Result | Notes |
|-------------|------|--------|-------|
| Development | `59:9090` | PASS / FAIL | |
| Staging | `59:8080` | PASS / FAIL | |
| Production | `118:8080` | PASS / FAIL / NOT RUN | |

Detailed checks (optional table): home, auth, Recovery Center, inventory, events, lifecycle, `release-health-check.ps1`.

---

## Release Checklist

- [ ] GitHub pushed (`origin/main` contains tip)  
- [ ] Documentation updated  
- [ ] Migration applied (Dev)  
- [ ] Migration applied (Staging)  
- [ ] Migration applied (Production) — when promoting  
- [ ] Smoke tested  
- [ ] Recovery Center tested  
- [ ] Authentication tested  
- [ ] Inventory tested  
- [ ] Events tested  
- [ ] Lifecycle tested  
- [ ] Rollback procedure verified (or dry-run documented)  
- [ ] Deployment Matrix updated  
- [ ] Git tag created (when process requires)  

---

## Rollback

| Field | Value |
|-------|--------|
| **Previous release** | `vX.Y.Z` |
| **Rollback commit** | |
| **Expected downtime** | |

**Procedure**

1.  
2.  
3. Run `ops/deployment/release-health-check.ps1`  
4. Update Deployment Matrix  

---

## Known Issues

-  

**Deferred / technical debt**

-  

---

## Future Work

| Field | Value |
|-------|--------|
| **Expected next Sprint** | |
| **Next release goals** | |

---

## Deployment status

| Environment | Status | Commit verified | Date | Notes |
|-------------|--------|-----------------|------|--------|
| Development `59:9090` | ⬜ | | | |
| Staging `59:8080` | ⬜ | | | |
| Production `118:8080` | ⬜ | | | |

Legend: ✅ Deployed & verified · ⚠️ Partial · ❌ Not deployed · ⬜ Pending
