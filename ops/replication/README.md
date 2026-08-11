# ops/replication/

Database replication and failover scripts for the on-prem 59 / 118 topology.

| Script | Typical host | Purpose |
|--------|--------------|---------|
| `replicate_db.ps1` | .118 | Dump and push replication snapshot |
| `replicate_118_to_59.ps1` | .118 | Alternate 118→59 replication helper |
| `restore_replication.ps1` | .59 | Apply latest replication snapshot |
| `restore_failover.ps1` | failover machine | Restore from NVMe backup set |

Scripts that previously used `$PSScriptRoot\backups\...` now resolve **`backups/` at the repository root**.

See also root `REDUNDANCY_SETUP.md`.
