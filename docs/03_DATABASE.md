# 03 — Database

## Technology

| Item | Value |
|------|-------|
| Engine | **PostgreSQL** (primary) |
| Access | **Knex** (`knexfile.js` + `utils.js`) |
| Migrations | `web-app/asset-manager-backend/migrations/` |
| Config | `.env` → `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_PORT`, `DB_CLIENT` |
| Cache | Redis (not a system of record) |

**Docs drift:** Older markdown still says SQLite / `better-sqlite3`. Trust Knex + `.env` + running code.

Legacy SQLite files may still exist on disk (`database_v2.db`, `data/test/`, etc.) for migration/fallback history. Do not treat them as the live schema unless explicitly operating a fallback.

---

## Dual database connections

In `utils.js`:

| Instance | When used |
|----------|-----------|
| `db` | Default / most modules |
| `dbService` | Category **In-House** or **SERVICE** (`getDbForCategory`) |

Service DB name defaults from `DB_SERVICE_NAME` or `asset_manager_service` / `*_test`.

---

## Core tables (conceptual)

### Assets domain

| Table | Purpose |
|-------|---------|
| `assets` | Primary tracked items (status, hierarchy, IT fields, qty, warranty, soft delete, Zoho/HSN/set flags over time) |
| `components` | No-QR / pre-promotion children |
| `asset_kinds` | Category/kind nodes |
| `folders` | Folder nodes in hierarchy |
| `asset_it_details` | IT-specific fields (may overlap columns on assets) |
| `asset_history` | Structured lifecycle history |
| `audit_log` | General audit trail |

**Hard rule:** A Postgres trigger prevents the same `id` existing in both `assets` and `components`. Promotion is an atomic move (`promoteToAsset`).

### Projects / logistics

| Table | Purpose |
|-------|---------|
| `projects` | Project master |
| `project_assets` | Assignment map (projectid + assetid) |
| `project_orders` | Purchase orders |
| `project_order_items` | PO lines |
| `temporary_assets` | Non-permanent project gear |
| `delivery_challans` | DC headers |
| `dc_item_mappings` | DC ↔ asset lines |
| `dc_remark_templates` | DC remark templates |

### Identity / RBAC

| Table | Purpose |
|-------|---------|
| `users` | Credentials, role, company/project links |
| `companies` | Tenant/company records |
| `roles` / `permissions` / `role_permissions` | RBAC |
| `auth_tokens` | Remember-me token hashes |
| `password_resets` | Reset token hashes |

### Quantity

| Table | Purpose |
|-------|---------|
| `quantity_events` | Event headers |
| `quantity_event_lines` | Per-asset deltas |

### Inventory (preview)

| Table | Purpose |
|-------|---------|
| `inventory_folders` | Inventory tree folders |
| `inventory_kinds` | Inventory kinds |
| `inventory_items` | Inventory stock items |
| (+ components / qty event variants) | Preview expansions |

**Important:** Several inventory migrations **skip unless** `current_database() = 'asset_manager_test'`. Do not assume prod has these tables without verifying.

### Zoho / ARRI / other

| Table | Purpose |
|-------|---------|
| `zoho_catalog` | Synced Zoho products |
| `zoho_sync_logs` | Sync audit |
| Zoho mapping fields on assets | e.g. `zoho_product_id` |
| `arri_clients` / `arri_job_cards` | Service portal |
| `employees` | Employee directory |
| `network_credentials` / `network_contacts` | IT network module |
| `company_templates` | Document/company templates |
| `hsn_codes` | HSN lookup |

Exact columns evolve via migrations — always check the migration files and live DB.

---

## Key asset fields (mental model)

| Concern | Typical columns |
|---------|-----------------|
| Identity | `id`, `itemname`, `itemdescription` |
| Status / location | `status`, `currentlocation`, `previouslocation` |
| Catalog | `type`, `category`, `make`, `model`, `srno` / `serialno` |
| Hierarchy | `parentid`, `is_set` (added later) |
| Assignment | via `project_assets`; `assignedto` |
| Quantity | `quantity_*`, `is_batch`, `is_quantity_tracked` |
| IT | mac/ip/vlan/port fields and/or `asset_it_details` |
| Soft delete | `is_deleted`, `deleted_at` |
| Integrations | `zoho_product_id`, `hsn_code`, `linked_po_item_id` |

Statuses used in product logic (app-enforced strings):

- `In Store`
- `Project`
- `Under Inspection`
- (+ retirement/sold/scrap variants)

---

## Migrations

Location: `web-app/asset-manager-backend/migrations/`

Approximate timeline:

1. Initial broad schema  
2. Auth tables  
3. Company on assets  
4. Set logic / retirement / condition + HSN  
5. Cross-table duplicate trigger  
6. Weight, ARRI tables  
7. Schema mismatch repair  
8. Zoho tokens/catalog/sync + asset mapping fields  
9. FK hardening waves (9090-oriented)  
10. Components / company template expansions  
11. Inventory preview family (test-DB gated)  
12. Sample Zoho catalog seed (preview)

**Rule:** Always propose a Knex migration for schema changes. Do not “fix prod by hand” as the primary approach.

---

## Case / naming contract

| Layer | Convention |
|-------|------------|
| PostgreSQL (typical) | lowercase column names |
| Frontend expectations | PascalCase / mixed (`ItemName`, `ParentID`) |
| Bridge | `normalizeResult()` in `server.js` |

Adding a column requires:

1. Migration  
2. Mapping in `normalizeResult` (if needed)  
3. Frontend field usage  

Missing any layer causes blank UI or silent drops.

---

## Non-table persistence

| Store | Contents |
|-------|----------|
| Redis | Cached asset/kind/employee lists |
| `dynamic.json` / DATA_DIR | Email settings, tally settings, dynamic short codes |
| Filesystem | Icons, uploads, OCR history JSON, logos, Zoho SDK resources |
| `zoho_tokens.txt` | OAuth tokens (sensitive — must not be committed) |

---

## Operational notes

- Automated `pg_dump` backups may write under `backups/8080_prod` or `backups/9090_dev`.
- Many root/`scripts/` utilities inspect or repair schema — ops tools, not runtime.
- Soft-delete filters (`is_deleted = 0 OR NULL`) must be preserved in new queries.
