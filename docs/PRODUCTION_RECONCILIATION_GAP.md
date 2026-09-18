# Production Reconciliation Gap

**Audit date:** 2026-08-21  
**Host:** `CINEOM-TESTSRV` (`192.168.6.237`) — live production (`https://api.spvtm.com`, port 8080)  
**Database:** PostgreSQL `asset_manager`  
**Scope:** Schema and relationship inspection only. No migrations, no data changes.

---

## Current capability

Production can store these entities independently:

| Domain | Table(s) | Production counts (2026-08-21) | Zoho link |
|--------|----------|--------------------------------|-----------|
| Zoho Products (reference catalog) | `zoho_catalog` | 202 rows (`zoho_product_id` PK) | Native Zoho CRM Product ID |
| Assets | `assets` | 4 rows; 1 has `zoho_product_id` | Optional string on asset |
| Native inventory | `inventory_folders`, `inventory_kinds`, `inventory_items` | 1 / 2 / 1 | `inventory_items.zoho_product_id` exists; **0 items linked** |
| Projects | `projects` | 2 rows | `zoho_deal_id`, `zoho_project_id_key` exist; **both unused (0)** |
| Clients / Accounts | `clients` | 0 rows | `zoho_account_id` exists; unused |
| Sync audit | `zoho_sync_logs` | 9 rows | Products pull/push only; no Deals rows |
| Quantity / movement | `inventory_quantity_events`, `inventory_quantity_event_lines` | Present | Not tied to Zoho |
| Serials | `assets.srno`, `inventory_items.srno` / `serialno` | Assets: 4 with `srno`; inventory serials unused | Not a Zoho key |
| Location | `assets` location fields; `inventory_items.currentlocation` | Present | Not a Zoho key |
| Rental / operational state | Asset/inventory `status` plus lifecycle event tables | Present | Not synced to Zoho |

Working Zoho data path today:

```text
Zoho CRM Products  --pull-->  zoho_catalog
AssetEngine assets --push-->  Zoho CRM Products  (create observed SUCCESS; later UPDATE failed)
```

There is **no** automated reconciler that compares Zoho Products, catalog, assets, inventory, projects, serials, locations, quantities, ownership, or rental state and produces a match report.

---

## Missing relationships

1. **No foreign key** from `assets.zoho_product_id` → `zoho_catalog.zoho_product_id`.  
   An asset can point at a Zoho ID that is absent from the catalog (or a catalog row can exist with no asset).

2. **No foreign key** from `inventory_items.zoho_product_id` → `zoho_catalog`.  
   Catalog → inventory conversion is a UI action (`Create Inventory` from catalog modal), not a constrained link.

3. **No unique constraint** on `assets.zoho_product_id` or `inventory_items.zoho_product_id`.  
   Two local records can claim the same Zoho Product.

4. **Projects ↔ Deals** columns exist (`zoho_deal_id`, `zoho_project_id_key`) but **no production rows are mapped**. Deal pull is not used by the UI. `clients.zoho_account_id` is unused (zero clients).

5. **Serial numbers** are local identifiers (`srno` / `serialno`). Zoho Products in this integration do not carry serials. There is no table mapping serial → Zoho record.

6. **Quantities** live on `inventory_items.quantity_total` / `quantity_available` and on quantity-event tables. Zoho Product sync stores `unit_price` and product metadata only — not stock, location, or rental.

7. **Ownership / assignment** (`userid` on inventory, employee/project assignment on assets) has no Zoho Contact/Account write path.

8. **Rental / operational status** is AssetEngine lifecycle. Zoho Product records are commercial catalog items, not rental tickets.

9. **Sample catalog pollution:** row `ZP-SAMPLE-0001` is still in production `zoho_catalog`. It is not a Zoho CRM ID. It will never “View in Zoho” correctly.

10. **Inventory preview migrations** (`20260730090000_*`) are coded to create tables only when `current_database() = 'asset_manager_test'`. Production DB name is `asset_manager`, yet the tables exist and the migrations are recorded in `knex_migrations`. That means production inventory schema was introduced outside the gated “test-only” story (copy, manual apply, or gate added later). Future gated migrations may silently no-op on production while TEST continues to evolve.

---

## Potential duplicate risks

| Risk | Why |
|------|-----|
| Catalog vs assets | Pull upserts catalog by `zoho_product_id`. Push create writes a new Zoho Product and stores ID on the asset. A later catalog pull can insert the same product as a catalog row while the asset also holds that ID — two local representations, no merge. |
| Catalog vs inventory | Creating inventory from a catalog product copies `zoho_product_id` onto the item. Repeating the action can create additional inventory rows with the same Zoho ID (no uniqueness). |
| Sample + real catalog | `ZP-SAMPLE-0001` plus 200+ real CRM IDs. Operators can convert the sample into inventory. |
| Deal sync (if enabled) | `syncDealsFromZoho` matches `.where('zoho_deal_id', dealId).orWhere('zoho_project_id_key', projectIdKey)`. If `Project_ID` is null, `orWhere` can match **every** project with a null key and overwrite them. Local insert uses `projectIdKey \|\| PROJ-{last6 of dealId}` — colliding local IDs possible. **Do not enable on production.** |
| Product UPDATE push | `record.setId(parent.zoho_product_id)` with a string caused `KEY: id EXPECTED TYPE: BigInt` (2026-08-21 04:24–04:26 UTC). Retrying create vs update can duplicate Zoho Products. |
| Soft-deleted assets | Soft-delete/recovery exists on assets. Catalog and Zoho are not updated when an asset is recovered or deleted. |

---

## Data integrity risks

- **Two product identities:** AssetEngine asset ID vs Zoho Product ID vs catalog PK. Only the catalog PK is authoritative for CRM Products.
- **String vs BigInt IDs:** Catalog stores IDs as `varchar`. SDK create/update expects BigInt for record `id`. UI URLs need decimal strings (current catalog samples look correct, e.g. `1205624000000978029`).
- **Quantities are not Zoho-backed.** Reconciling “how many units exist” from Zoho Products will be wrong; Zoho is not the stock ledger.
- **Locations and rental state are not Zoho-backed.** A “matched” Product does not mean the physical unit is in the expected place or rental status.
- **Inventory feature flag:** `FEATURE_INVENTORY_ENABLED` is unset (treated as enabled). Native inventory APIs are live (`GET /api/inventory/*` 200). Data volume is tiny (1 item). Operators may treat the 202-row Zoho catalog as “inventory.”
- **No deal/project audit trail in `zoho_sync_logs`.** If deal sync is ever invoked, failures may be incomplete relative to product logging.

---

## Recommended future migrations (do not apply now)

All of the following **REQUIRES TEST VALIDATION**. None should run on production until TEST proves them against a copy of production-shaped data.

1. **Optional FK** `assets.zoho_product_id` → `zoho_catalog.zoho_product_id` (nullable, `ON DELETE SET NULL`), after backfill and orphan cleanup.
2. **Optional FK** `inventory_items.zoho_product_id` → `zoho_catalog.zoho_product_id` (nullable).
3. **Partial unique indexes** on non-null `zoho_product_id` for assets and inventory (decide 1:1 vs 1:N explicitly first).
4. **Remove or quarantine** `ZP-SAMPLE-0001` from production catalog after confirming it is unused.
5. **Ungate or split** inventory migrations so production schema evolution is explicit (`asset_manager` vs `asset_manager_test`), instead of silent skips.
6. **Reconciliation views** (read-only): unmatched catalog IDs, assets without catalog rows, duplicate Zoho IDs, sample IDs, projects with empty Zoho keys.
7. **Do not** add bidirectional Deal↔Project sync, quantity push to Zoho, or serial push until Products/catalog/asset identity is stable.

No schema was altered during this audit.
