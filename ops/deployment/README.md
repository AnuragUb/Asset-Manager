# ops/deployment/

Deployment and launch helpers for AssetEngine.

## Release promotion (preferred)

| Script | Purpose |
|--------|---------|
| `deploy-dev.ps1` | Pull `origin/main`, restart Dev container (`9090`) |
| `deploy-staging.ps1` | Pull `origin/main`, restart Staging container (`8080` on host 59) |
| `deploy-production.ps1` | Production promote — **requires** `-ConfirmProduction` |
| `release-health-check.ps1` | PASS / WARNING / FAIL health report |
| `_DeployCommon.ps1` | Shared helpers (not invoked directly) |

Documentation: [`docs/runbooks/DEPLOYMENT_WORKFLOW.md`](../../docs/runbooks/DEPLOYMENT_WORKFLOW.md)  
Environment investigation: [`docs/architecture/DEPLOYMENT_ENVIRONMENT_REPORT.md`](../../docs/architecture/DEPLOYMENT_ENVIRONMENT_REPORT.md)  
Release manifests: [`../releases/`](../releases/)

**Rules**

- Environments are servers (`59:9090` / `59:8080` / `118:8080`), **not** Git branch names.
- Scripts abort on a dirty working tree (will not overwrite local work).
- Do not deploy Production without explicit approval and `-ConfirmProduction`.
- On host `59`, Dev and Staging share one bind-mounted Git tree — see the environment report.

## Legacy helpers

| Script | Purpose |
|--------|---------|
| `run-test.bat` | Starts backend with `PORT=9090` and test data dirs (non-Docker) |
| `run-prod.bat` | Reminder note for production folder/port 8080 |
