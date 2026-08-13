# ops/

Operational tooling for AssetEngine hosts (not application source).

| Folder | Purpose |
|--------|---------|
| `deployment/` | Deploy scripts, health check, legacy launch helpers |
| `releases/` | Permanent release history, SemVer policy, [`DEPLOYMENT_MATRIX.md`](./releases/DEPLOYMENT_MATRIX.md) |
| `replication/` | DB replicate / restore / failover scripts (59 ↔ 118) |
| `health/` | Health checks and Docker diagnostics |
| `maintenance/` | One-off DB repair/check scripts (populated in later steps) |
| `sql/` | Curated operational SQL (from Phase 1) |

Application code remains under `web-app/`.

Run scripts from a shell with the **repository root** as the working context unless a script documents otherwise.
