# ops/releases/

Permanent **release history** for AssetEngine — the long-term source of truth for what was cut, what each environment runs, and how to roll back.

Environments are **servers**, not Git branches:

| Environment | Host:Port |
|-------------|-----------|
| Development | `59:9090` |
| Staging | `59:8080` |
| Production | `118:8080` |

---

## Latest status (update when promoting)

| Pointer | Value |
|---------|--------|
| **Latest Release (cut)** | [**v7.1.0**](./v7.1.0.md) — `90376b8` |
| **Latest Development** | **v7.1.0** on `59:9090` (shared bind-mount tip) |
| **Latest Staging** | **v7.1.0** on `59:8080` (same tip as Dev) |
| **Latest Production** | **None for Sprint 1** — `118:8080` not promoted (`❌` on v7.1.0) |
| **Current Sprint** | Sprint 1 **complete** · next product work (e.g. Zoho SDK) only after release hygiene |
| **Deployment Matrix** | [`DEPLOYMENT_MATRIX.md`](./DEPLOYMENT_MATRIX.md) |

---

## Semantic Versioning policy

Format: **`Major.Minor.Patch`** → files named `vMajor.Minor.Patch.md`

### Major (`v8.0.0`)

Increment when the release includes **breaking** or foundational platform shifts, for example:

- Architecture changes that invalidate prior deploy assumptions  
- Breaking API contracts  
- Database redesign / incompatible schema strategy  
- Removal of supported platforms or auth models  

### Minor (`v7.2.0`)

Increment when the release adds **backward-compatible capability**, for example:

- A completed Sprint with new modules  
- New platform capabilities (new Recovery entity, new movement types)  
- Substantial new functionality without breaking existing clients  

### Patch (`v7.1.1`)

Increment for **backward-compatible fixes**, for example:

- Bug fixes  
- Authentication fixes  
- Documentation corrections that accompany a hotfix deploy  
- Hotfixes to Production  

**Do not** invent empty future files (`v7.2.0.md`) until that release is cut. Copy [`_TEMPLATE.md`](./_TEMPLATE.md).

**Note:** Frontend cache-bust strings (`main.js?v=7.09`) are **not** release versions. Record them inside the manifest’s infrastructure section when useful.

---

## Release history (newest first)

| Version | Commit | Date | Title | Production |
|---------|--------|------|-------|------------|
| [v7.1.0](./v7.1.0.md) | `90376b8` | 2026-08-12 | Sprint 1 Platform Foundations | ❌ Not deployed |
| [v7.0.0](./v7.0.0.md) | `17c02e2` | 2026-08-11 | Repository Modernization Baseline | ⬜ / unknown |

---

## Manifest requirements

Every `vX.Y.Z.md` must include:

1. Overview  
2. Scope  
3. Included Features  
4. Bug Fixes  
5. Database  
6. Infrastructure  
7. Smoke Test  
8. Release Checklist  
9. Rollback  
10. Known Issues  
11. Future Work  
12. Deployment status (per environment)

See [`_TEMPLATE.md`](./_TEMPLATE.md).

---

## Git tags (future-ready — not automated yet)

When a release is approved and `main` contains the tip commit:

```bash
git tag -a v7.1.0 -m "Release v7.1.0 — Sprint 1 Platform Foundations"
git push origin v7.1.0
```

| Concept | Role |
|---------|------|
| **Release manifest** (`ops/releases/v7.1.0.md`) | Human/ops SSOT: features, migrations, smoke, env matrix, rollback prose |
| **Git tag** (`v7.1.0`) | Immutable pointer to the exact commit in Git history |
| **Deployment Matrix** | Quick “what is each server running?” table |

Tags must **match** the manifest version and commit. Do not tag until the manifest exists and the checklist is honest.

---

## Future CI/CD (documentation only)

Eventually this system can integrate with:

| Capability | Intended use |
|------------|--------------|
| **GitHub Actions** | On tag push: validate tree, run health checks, publish release notes from the manifest |
| **Docker images** | Build/push `assetengine:v7.1.0` and record digest in the manifest |
| **Google Cloud** | Deploy tagged image to Staging/Production with approval gates |
| **Automated release notes** | Generate GitHub Release body from `ops/releases/vX.Y.Z.md` |
| **Automatic version tags** | Create tags only after human approval of the manifest |
| **Deployment approval** | Require reviewers before Production job; update `DEPLOYMENT_MATRIX.md` as an artifact |

No CI/CD is implemented in this refinement.

---

## Related

- Architecture: [`../../docs/architecture/RELEASE_MANAGEMENT.md`](../../docs/architecture/RELEASE_MANAGEMENT.md)  
- Deploy runbook: [`../../docs/runbooks/DEPLOYMENT_WORKFLOW.md`](../../docs/runbooks/DEPLOYMENT_WORKFLOW.md)  
- Environment report: [`../../docs/architecture/DEPLOYMENT_ENVIRONMENT_REPORT.md`](../../docs/architecture/DEPLOYMENT_ENVIRONMENT_REPORT.md)  
- Deploy scripts: [`../deployment/`](../deployment/)  
