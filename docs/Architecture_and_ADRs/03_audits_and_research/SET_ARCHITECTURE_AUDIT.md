# Set / Kit Architecture Audit and Target Design

**Date:** 2026-08-24  
**Host:** production `192.168.6.237:8080` (`asset-manager-prod`)  
**Scope:** Forensic audit of the existing Set model; additive Set management layer. No OAuth / token / `node_modules` changes.

---

## 1. Current Set architecture

Sets are **not** a first-class table. A Set is an `assets` (or `inventory_items`) row with `is_set = 1`. Membership is `parentid` on child rows pointing at the parent.

That flag and `parentid` are **not** equivalent:

| Production row | `is_set` | `parentid` | Meaning |
|----------------|----------|------------|---------|
| `HAR-MUM-0726-55QOFA-R` Trimble Bullet 720 | 0 | null | Has Zoho Product id; **parent of a MacBook** |
| `APP-MUM-0526-MMKBX9-W` Apple MacBook Air 24 | 0 | `HAR-MUM-0726-55QOFA-R` | Child / sub-asset, **not** a Set |
| `HAR-MUM-0826-IEIZP5-U` EVM 16 GB DDR4 | 1 | null | Flagged as Set, **no children** |

`parentid` is also used for split/sub-assets and quantity trees (`quantity_parent_id` / `quantity_root_id`). Treating every parent as a Kit would mis-classify Trimble+MacBook as a kit.

There is **no** `sets` table today.

---

## 2. Current DB schema relevant to Sets

### `assets` (production `\d assets`)

- `id` PK  
- `parentid` → `assets.id` **ON DELETE SET NULL**  
- `is_set` integer default 0  
- `set_price_mode` default `SUM_OF_CHILDREN`  
- `quantity_*` columns (qty tracking mixed onto the same row as serialized assets)  
- `zoho_product_id`  
- `linked_po_item_id` → `project_order_items`  
- `boughtagainstpo` text  
- `is_deleted` / `deleted_at` soft delete  

### `inventory_items`

- `parentid` → `inventory_items.id` ON DELETE SET NULL  
- `is_set`, `set_price_mode`  
- `quantity_total` / `quantity_available`  
- `srno` / `serialno`  
- `zoho_product_id`  

### Other

- `components.parentid` → assets (ON DELETE CASCADE) — accessories, not kits  
- `asset_hierarchy` — separate hierarchy table  
- `project_assets` — project assignment  
- `zoho_catalog` — CRM product cache  

**Production counts (2026-08-24):** 4 assets (1 `is_set=1`, 1 child via `parentid`); 1 inventory item (no sets).

---

## 3. Asset / Inventory relationship model

- Assets and inventory are **separate tables**.  
- Inventory create/update can **link children** by writing `inventory_items.parentid` (one parent only).  
- Asset make-set writes `assets.parentid` + `is_set` on the parent.  
- An asset can belong to **at most one** parent (`parentid` is a single column). Same for inventory.  
- Nested Sets: possible if a child also has `is_set=1`. Production nested count = **0**.  

Quantity and serialization **are mixed** on `assets` (qty-tracked assets, batch split during make-set). Inventory is quantity-first; serial fields exist but are optional.

---

## 4. Current Set APIs

| Method | Path | Role |
|--------|------|------|
| POST | `/api/assets/make-set` | Create/promote asset Set; attach children; optional qty split |
| POST | `/api/assets/break-set` | Clear child `parentid` (or promote component) |
| POST/PUT | `/api/inventory/items` | `is_set` + child `parentid` link/unlink |
| DELETE | `/api/assets/:id` | Soft-delete parent **blocked** if active `parentid` children |
| POST | `/api/zoho/sync-asset/:id` | Push **asset** (including kits) as Zoho Product |

No dedicated Set CRUD, search, archive, or mixed asset+inventory membership.

---

## 5. Current Set UI

- Dashboard **Make Set 📦** (`#btnMakeSet`, `#makeSetModal`) — selected assets → `/api/assets/make-set`.  
- Projects workspace has a parallel Make Set modal.  
- Cards use `IsSet` / `is_set` for a SET badge; children via `ParentId`.  
- No standalone Sets workspace. Sets appear in the Assets (and Inventory) grids.  
- Asset view shows parent/child. Context menus use the same flags.

---

## 6. Current Zoho mapping

- Mapping key: `assets.zoho_product_id` (and inventory `zoho_product_id`).  
- Kit push = push the **parent asset**, not a Set entity.  
- Children are **not** pushed as their own Products by make-set.  
- `buildAssetDescription()` lists children with **serial numbers** (`S/N:`). That violates the new “no serials in Zoho description” policy.  
- Code uses `.where('parentid', …)` while production column is `parentid` — kit description may miss children (separate defect; not changed in this pass).  
- Product UPDATE uses `Record.setId(toZohoRecordBigInt(zoho_product_id))` (already fixed).  
- Composition changes do **not** set a “changes pending” flag; next push overwrites Product fields/description.

---

## 7. Serial-number behavior

- Stored on assets as `srno` / `serialno`.  
- Included in current Zoho kit description.  
- **Target:** serials stay in AssetEngine only.

---

## 8. Quantity behavior

- Asset make-set can split qty-tracked parents/children into new asset rows.  
- Inventory sets do not model “BNC × 3” without linking rows or using `quantity_total` on a single item.  
- No Set-level component quantity independent of stock rows.

---

## 9. Dependencies on `is_set` / `parentid`

Heavy usage in `server.js` (status cascade, GET assets, inventory link, make-set, break-set, delete guards, project assignment, search). Frontend: `dashboard.js`, `inventory.js`, `projects.js`, `asset-view.js`, `hierarchy.js`.

**Must keep** existing columns and APIs. New Set tables are **additive**.

---

## 10. Proposed target architecture

First-class **management layer**:

- `sets` — kit header (type ASSET | INVENTORY, lifecycle, Zoho ids, PO reference).  
- `set_components` — references existing `assets.id` or `inventory_items.id` plus **quantity**.  

Does **not** rewrite `parentid` / `is_set`. Legacy Sets remain visible via a compatibility read.

**Nested Sets (v1):** **not supported.** Existing nested usage is zero; mixed asset/inventory kits do not need nesting yet. Nested `set_id` on components can be added later.

**Membership:** one serialized asset in at most one non-archived Set. Inventory lines are quantity against an existing stock item (no N dummy rows).

**Zoho (P3, not implemented):** reuse `syncAssetToZoho` patterns / Products module; description = quantity composition **without serials**; `sets.zoho_product_id` is the Product id. Placeholder UI only in this pass.

---

## 11. Proposed DB changes (additive)

See migration `20260824120000_create_managed_sets_tables.js`.

Rollback: `DROP TABLE set_components; DROP TABLE sets;`

No drops of `is_set` / `parentid`. No backfill in v1.

---

## 12. Proposed API changes

New `/api/managed-sets*` (see implementation). Existing `/api/assets/make-set` **unchanged**.

---

## 13. Proposed UI changes

- Primary nav: Assets, Inventory, **Sets**, Projects, Warranty.  
- Employees → hamburger **System** menu (same `nav-employees` / `employee-view`).  
- Sets workspace: list/cards, create wizard, detail, component qty, Zoho preview + disabled/placeholder push for new Sets.

---

## 14–15. Migration / compatibility

1. Create tables (this pass).  
2. Keep make-set / parentid.  
3. List API unions `sets` rows + legacy `assets.is_set = 1`.  
4. Backfill mapping **later**, after operators confirm (not executed now).

---

## 16. Risks

- Dual models until backfill (legacy vs managed).  
- `parentid` overloaded (sub-asset vs kit).  
- Zoho description still serializes on **legacy** asset push until P3.  
- Employees still needed for assignment dropdowns (`loadEmployees` on boot).

---

## 17. Rollback

- Revert frontend nav + `sets-view`.  
- Stop using `/api/managed-sets`.  
- `down()` drops new tables only.  
- Legacy Sets untouched.

### Priority

| Pri | Item | This pass |
|-----|------|-----------|
| P0 | Audit + Employees → System + Sets nav | Yes |
| P1 | `sets` / `set_components` + APIs + qty + asset pick | Yes |
| P2 | Set workspace UI | Yes |
| P3 | Zoho Set sync (no serials) | **No** — preview only |
| P4 | PO module | **No** — `source_po_reference` column only |
