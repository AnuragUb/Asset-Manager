# Deployment Matrix

**Purpose:** Fast answer to “What is each environment running?”

**Update rule:** When you promote or roll back an environment, update **this table** and the matching `ops/releases/vX.Y.Z.md` deployment section in the same change set.

Environments are servers (`59:9090` / `59:8080` / `118:8080`), not Git branches.

Legend: ✅ Deployed & verified · ⚠️ Partial / caveats · ❌ Not deployed · ⬜ Pending / unknown

---

## Current matrix

| Version | Git Commit | Development `59:9090` | Staging `59:8080` | Production `118:8080` | Deployment date (Dev/Staging) | Rollback commit | Status |
|---------|------------|----------------------|-------------------|----------------------|-------------------------------|-----------------|--------|
| [v7.1.0](./v7.1.0.md) | `90376b8` | ✅ | ✅ | ❌ | 2026-08-12+ (bind-mount tip) | `17c02e2` | **Awaiting Production** — GitHub push + `118` access required |
| [v7.0.0](./v7.0.0.md) | `17c02e2` | ✅ (superseded) | ✅ (superseded) | ⬜ | 2026-08-11 | N/A | Baseline; superseded by v7.1.0 on Dev/Staging |

---

## Notes

1. On host `59`, Dev and Staging **share one Git working tree** (`F:\AssetManager\AssetManager_Dev`). A single tip commit therefore appears on both `9090` and `8080` code paths; databases remain separate.  
2. Production must not be marked ✅ until verified on `118:8080` with the listed commit (and migrations).  
3. At matrix authoring time, local `main` was **ahead of `origin/main`** by Sprint 1 commits — Production cannot pull v7.1.0 from GitHub until push.  
4. Full narrative: manifests + [`../../docs/architecture/RELEASE_MANAGEMENT.md`](../../docs/architecture/RELEASE_MANAGEMENT.md).

---

## How to update after a promote

```text
1. Verify commit on target host (git rev-parse HEAD)
2. Run release-health-check.ps1
3. Set ✅ / ⚠️ / ❌ in this matrix
4. Mirror status into ops/releases/vX.Y.Z.md
5. Commit the doc update with the promote (or immediately after)
```
