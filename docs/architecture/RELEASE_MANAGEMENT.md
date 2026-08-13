# Release Management — AssetEngine

**Status:** Permanent architecture documentation  
**SSOT for release files:** [`ops/releases/`](../../ops/releases/)  
**Quick env view:** [`ops/releases/DEPLOYMENT_MATRIX.md`](../../ops/releases/DEPLOYMENT_MATRIX.md)  
**Operational steps:** [`../runbooks/DEPLOYMENT_WORKFLOW.md`](../runbooks/DEPLOYMENT_WORKFLOW.md)

This document explains **how AssetEngine releases work** for Developers, Architects, Operations, Management, and future AI assistants. It does not implement CI/CD.

---

## Release philosophy

1. **One tip, many environments.** Git `main` (and eventually a matching tag) is the product; environments are **servers**.  
2. **Manifests are permanent history.** Every cut release lives forever under `ops/releases/vX.Y.Z.md`.  
3. **Honesty over ceremony.** Smoke and checklist boxes must reflect reality — especially Production.  
4. **Promote, don’t fork.** Do not invent branches named after ports (`59:9090`). Promote the same commit Dev → Staging → Production.  
5. **Business value first.** A release exists to ship capability safely, not to satisfy an abstract process.

---

## Promotion pipeline

```text
GitHub (origin/main + future tag vX.Y.Z)
        │
        ▼
Development  59:9090   (validate, migrate, smoke)
        │
        ▼
Staging      59:8080   (same commit; separate DB; smoke)
        │
        ▼
Production   118:8080  (only after push, access, approval, verified smoke)
```

| Stage | Role |
|-------|------|
| **GitHub** | Source of truth for what *can* be pulled onto Production |
| **Development** | First runnable validation of the tip |
| **Staging** | Pre-production DB and config confidence |
| **Production** | Customer-facing; never mark ✅ without host verification |

On host `59`, Dev and Staging currently **share one Git working tree** (bind-mount). Code tip is therefore coupled; databases are not. See [`DEPLOYMENT_ENVIRONMENT_REPORT.md`](./DEPLOYMENT_ENVIRONMENT_REPORT.md).

---

## Versioning

AssetEngine uses **Semantic Versioning**: `Major.Minor.Patch` → `v7.1.0`.

| Segment | When it changes |
|---------|-----------------|
| **Major** | Architecture shifts, breaking APIs, database redesign |
| **Minor** | New Sprint, modules, substantial new functionality |
| **Patch** | Bug fixes, auth fixes, doc-coupled hotfixes |

Full policy: [`ops/releases/README.md`](../../ops/releases/README.md).

Frontend cache-bust strings (`?v=7.09`) are **not** SemVer releases; record them inside the manifest infrastructure section when useful.

---

## Release Manifest

Each `ops/releases/vX.Y.Z.md` is the official record of that cut. Required sections:

Overview · Scope · Included Features · Bug Fixes · Database · Infrastructure · Smoke Test · Release Checklist · Rollback · Known Issues · Future Work · Deployment status.

Template: [`ops/releases/_TEMPLATE.md`](../../ops/releases/_TEMPLATE.md).

**Do not** create empty future versions. Copy the template only when cutting a real release.

---

## Deployment Matrix

[`ops/releases/DEPLOYMENT_MATRIX.md`](../../ops/releases/DEPLOYMENT_MATRIX.md) is the fastest view of:

Version · Commit · Dev · Staging · Production · Date · Rollback commit · Status.

Update the matrix whenever an environment is promoted or rolled back, in the same change set as the manifest status row.

---

## Rollback

Every manifest must name:

- Previous release  
- Rollback commit  
- Procedure  
- Expected downtime  

Prefer **forward fixes** for schema. Down-migrating Production requires explicit DBA / architect approval. After any rollback, update the matrix and the manifest.

---

## Relationship to Git tags (future)

| Artifact | Purpose |
|----------|---------|
| Manifest `v7.1.0.md` | Human/ops history: features, migrations, smoke, env status |
| Tag `v7.1.0` | Immutable Git pointer to the tip commit |
| Matrix row | At-a-glance environment state |

```bash
git tag -a v7.1.0 -m "Release v7.1.0"
git push origin v7.1.0
```

Tags are **not automated yet**. Create only when the manifest exists and the checklist is honest.

---

## Future CI/CD (not implemented)

When automation arrives, it should **consume** this system, not replace it:

- GitHub Actions on tag → validate, health checks, publish notes from the manifest  
- Docker images tagged `assetengine:vX.Y.Z` with digests recorded in the manifest  
- Google Cloud deploys gated by human approval  
- Automated GitHub Release notes generated from `ops/releases/vX.Y.Z.md`  
- Deployment Matrix updated as a pipeline artifact after promote  

See also the Future CI/CD section in [`ops/releases/README.md`](../../ops/releases/README.md).

---

## Audience map

| Audience | Primary docs |
|----------|----------------|
| Developers | Manifest Included Features + architecture domain docs |
| Architects | This file + Sprint retrospectives + domain architecture |
| Operations | Matrix + Rollback + `DEPLOYMENT_WORKFLOW.md` + `ops/deployment/` |
| Management | Overview / Scope / Smoke / Production status on latest release |
| AI assistants | `ops/releases/README.md` pointers + this file + AGENTS.md env table |

---

## Current pointers (maintain when promoting)

| Pointer | As of Sprint 1 close |
|---------|----------------------|
| Latest cut | **v7.1.0** (`90376b8`) |
| Dev / Staging | Running v7.1.0 tip (shared mount) |
| Production | **Not** on v7.1.0 |
| Previous baseline | **v7.0.0** (`17c02e2`) |

Always re-check [`ops/releases/README.md`](../../ops/releases/README.md) and the matrix for live status.
