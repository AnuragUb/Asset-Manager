# --- PostgreSQL Redundancy & Streaming Replication Setup ---

This guide explains the current server-role relationship and the future path to stronger redundancy.

## 0. Current Environment Relationship

These roles are now the reference model for this project:

- `59:9090` = gold-standard test environment and schema reference
- `118:8080` = primary live production server for real users
- `59:8080` = local disaster-recovery / backup production environment

Target operating model:

- New schema decisions are validated first on `59:9090`
- Production-safe schema parity is then applied to `118:8080`
- `59:8080` is kept aligned as the disaster-recovery mirror of the accepted production-safe state

Important distinction:

- `59:9090` is the **strict structural gold standard**
- `118:8080` and `59:8080` are currently maintained in **safe parity**
- Safe parity means production-safe foreign keys and cleanup are enforced, while intentionally risky mismatches may remain until code semantics are fixed

Current parity status after the July 2026 alignment work:

- `118.asset_manager`
  - Safe-parity alignment applied
  - Production-safe FK set added
  - Intentional exception: `audit_log.assetid -> assets.id` is **not enforced** because live audit rows store non-asset IDs too
  - Structural difference: `layout_markers` is not present in this database
- `59:8080` / local `asset_manager`
  - Safe-parity alignment applied
  - All `27` FK preflight checks currently pass cleanly
  - Includes `layout_markers` enforcement because the local DB has that table and its data was cleaned successfully

Operational rule going forward:

- Use `web-app/asset-manager-backend/scripts/audit_fk_preflight.js` before any production or DR schema rollout
- Do not assume `9090` changes can be copied blindly into `118` or `59:8080` without preflight + cleanup

---

This guide also explains how to set up **Real-Time Streaming Replication** between your two servers to ensure zero data loss failsafe protection.

## 1. Primary Server Setup (.118)

Update your `docker-compose.yml` to include replication configuration.

### A. Update `docker-compose.yml`
Add a command to the `postgres` service to enable replication:
```yaml
  postgres:
    image: postgres:15-alpine
    container_name: asset-manager-db
    command: |
      postgres 
      -c wal_level=replica 
      -c max_wal_senders=10 
      -c max_replication_slots=10 
      -c hot_standby=on
    # ... rest of config
```

### B. Allow the Secondary Server
Inside the `.118` server, we need to allow the `.59` server to connect for replication.
Run this inside the `.118` database container:
```bash
docker exec -it asset-manager-db psql -U postgres -c "CREATE ROLE replication_user WITH REPLICATION LOGIN PASSWORD 'rep_password';"
```

Add this line to `pg_hba.conf` inside the container (or map it as a volume):
`host replication replication_user 192.168.6.59/32 md5`

---

## 2. Standby Server Setup (.59)

The standby server will stay in "Read-Only" mode, constantly receiving updates from .118.

### A. Prepare the Standby
On the `.59` server, you must stop the database and perform a base backup from the primary.

1. Stop containers: `docker stop asset-manager-db`
2. Clear current data: `rm -rf C:\Users\Admin\AssetManager\postgres_data\*` (Careful! Backup first)
3. Run Base Backup:
```powershell
docker run --rm -it -v postgres_data:/var/lib/postgresql/data postgres:15-alpine pg_basebackup -h 192.168.6.118 -D /var/lib/postgresql/data -U replication_user -P -v -R --wal-method=stream
```

### B. Update `docker-compose.yml` on .59
Ensure the `hot_standby` is on so users can still read data if needed.

---

## 3. Disaster Recovery (Failover)

If the `.118` server goes down:

1. Go to the `.59` server.
2. Run the promotion command:
```powershell
docker exec -it asset-manager-db pg_ctl promote
```
3. Update your DNS or Load Balancer to point users to `192.168.6.59:8080`.
4. The `.59` server is now the **Primary Master** with the latest data.

---

## 4. Current Automated "Cold" Redundancy
Until the above streaming is configured, we have the daily scripts:
- `ops/replication/replicate_db.ps1` (Sender)
- `ops/replication/restore_replication.ps1` (Receiver)

This provides a **24-hour safety net**, while the Streaming Replication provides **Second-by-Second safety**.
