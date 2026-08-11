# ops/health/

Host and container health tooling.

| Script | Purpose |
|--------|---------|
| `health_check.ps1` | Heartbeat monitor against primary server |
| `diagnose_docker.ps1` | Docker / port conflict diagnostics |

Example (from repo root):

```powershell
./ops/health/diagnose_docker.ps1
```
