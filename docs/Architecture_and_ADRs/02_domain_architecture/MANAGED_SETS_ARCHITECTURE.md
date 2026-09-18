# Managed Sets / Kits — Architecture Design

**Status:** Design only. Phase 1 not approved until the Final Schema Review below is signed off.  
**Date:** 2026-08-25  
**Environment inspected:** production `192.168.6.237:8080` (`asset-manager-prod`, database `asset_manager`)  
**Constraint:** Do **not** apply `20260824120000_create_managed_sets_tables.js`. Do **not** migrate or rewrite `assets.is_set` / `assets.parentid` data.

This document is the Phase 0 source of truth for Set/Kit work. If it conflicts with `docs/SET_ARCHITECTURE_AUDIT.md` or the draft `kitSetService.js` exclusive `ASSET` vs `INVENTORY` types, **this document wins**. If it conflicts with **FINAL SCHEMA REVIEW**, **that review wins**. **Archive deactivates currently active component rows** (`is_active = false`) while **keeping** the rows — that rule overrides any older “leave is_active true on archive” wording.

---

## 1. Current architecture

AssetEngine already has three related but **different** “containment” ideas:

| Concept | Storage | Purpose |
|---------|---------|---------|
| **Legacy Set / kit flag** | `assets.is_set = 1` (same pattern on `inventory_items.is_set`) | Marks a row as a kit **container** in the Assets or Inventory grid |
| **Tree membership** | `assets.parentid` → `assets.id` (`ON DELETE SET NULL`); same for `inventory_items.parentid` | One parent per child. Used for kits **and** sub-assets / splits |
| **Accessories** | `components.parentid` → `assets.id` (`ON DELETE CASCADE`) | No-QR accessories; promotion to `assets` is a separate lifecycle (`PROCESS_LOGIC.md`) |
| **Quantity tree** | `quantity_parent_id` / `quantity_root_id` | Batch/qty tracking, not kit BOM |
| **Managed Set (draft, not installed)** | Proposed `sets` + `set_components` | Orchestration layer; tables **do not exist** on production |

Assets and Inventory remain **separate tables**. There is no first-class Set identity today. Zoho mapping lives on the **member record**: `assets.zoho_product_id` / `inventory_items.zoho_product_id`.

Runtime today:

- SPA: Assets, Inventory, **Sets** nav (`#sets-view`, `js/kitSets.js`).
- API: `GET /api/managed-sets` is registered (after Node reload). **POST create returns 503** because `sets` is missing.
- Legacy kit tools: `POST /api/assets/make-set`, `POST /api/assets/break-set`, Inventory create/update that writes `is_set` + child `parentid`.

---

## 2. Current legacy Set behavior

### How Sets are created

`POST /api/assets/make-set` (`server.js`):

- Optionally creates a **new container asset** (`is_set = 1`, QR-tracked) or uses an existing parent.
- Can **split** quantity-tracked / batch parents into a new “Set Head” row (`is_set = 1`, `quantity_parent_id` on the original).
- Writes **child** `assets.parentid` to the container.
- Copies project hint from `project_assets` on the head asset.
- Pricing: `set_price_mode` (default `SUM_OF_CHILDREN`).

Inventory kits: `is_set` on `inventory_items` plus child `parentid` (one parent). No dedicated make-set route of the same richness as assets.

Break: `POST /api/assets/break-set` clears child `parentid` (or promotes accessories). **Does not** delete children. Status cascade for Sets uses **recursive `parentid`**, not `is_set` (`PROCESS_LOGIC.md`).

### How they are displayed

- Assets/Inventory cards: SET badge from `is_set` / `IsSet`.
- Hierarchy / parent-child from `parentid`.
- Dashboard and Projects **Make Set** modals.
- New Sets portal lists **legacy** rows via `listSets()` as `id: "legacy:{assetId}"` by querying `assets.is_set = 1`.

### `parentid` vs `is_set` (production 2026-08-25)

| Asset | `is_set` | `parentid` | Children | Meaning |
|-------|----------|------------|----------|---------|
| `HAR-MUM-0826-IEIZP5-U` EVM 16 GB DDR4 | 1 | null | 0 | Flagged Set, **empty kit** |
| `HAR-MUM-0726-55QOFA-R` Trimble Bullet 720 | 0 | null | 1 (MacBook) | **Not** a Set; parent of a sub-asset |
| `APP-MUM-0526-MMKBX9-W` MacBook Air | 0 | Trimble id | 0 | Child / sub-asset |

**Nested Sets** (`is_set` child of `is_set` parent): **0** rows.

Inventory: 1 active item, `is_set = 0`.

### Nested Sets

Possible in schema, unused in production. Target Managed Sets **v1: no nested Sets** (a component is Asset or Inventory, not another Set). Revisit only if operators need kits-of-kits.

### APIs that depend on these fields

Heavy: `updateAssetStatus` recursion, `GET /api/assets`, delete guards (cannot delete parent with children), make-set / break-set, project assignment, dashboard/projects/inventory/hierarchy UIs.

**Invariant:** `is_set` and `parentid` stay. Managed Sets must **not** require rewriting them.

---

## 3. Problems with the current Set model

1. **Overloaded `parentid`.** Sub-asset trees and kits share one column. Trimble→MacBook is not a Camera Kit.
2. **Set is an Asset (or Inventory item).** Operators manage kits inside the same grids as serialized hardware. A kit is not its own lifecycle (draft/archive independent of asset status).
3. **No mixed BOM.** Cannot attach Camera **Asset** + Lens **Inventory × 2** on one object without fake assets or dual parents.
4. **Quantity kits need extra rows or splits.** Make-set can fragment batch stock into new asset IDs. “BNC × 3” is not a first-class line against one inventory SKU.
5. **One parent only.** An asset cannot belong to two kits; inventory child cannot sit in two inventory parents. Orchestration (catalog kit vs deployed kit) is blocked.
6. **Zoho is the parent Product.** Push uses `syncAssetToZoho(parentId)`. Description lists children **with serials** (`zohoService.buildAssetDescription`). Composition changes have no `CHANGES_PENDING` on a Set entity.
7. **Empty `is_set=1` rows** (production EVM) look like kits but have no members.
8. **Draft Managed Set API** (`ASSET` xor `INVENTORY` components) **cannot represent the product examples** (mixed kits). Applying the current migration would lock that mistake into schema via `set_type`.

---

## 4. Proposed Managed Set architecture

A **Set** is an orchestration object with its own identity and lifecycle.

```text
Set  (identity, status, Zoho Product mapping, optional PO / Project links)
  └── SetComponent[]  (BOM lines)
        ├── ASSET line     → existing assets.id     (qty = 1 per line)
        └── INVENTORY line → existing inventory_items.id  (qty ≥ 1)
```

Principles:

- **Do not** clone Assets or Inventory into Set-owned copies.
- **Do not** write `parentid` / `is_set` when adding Managed Set members (legacy tools keep doing that for legacy kits).
- **Do not** store serial numbers on Set tables; resolve from `assets` at read time for operators only.
- **Do not** treat Managed Set membership as a replacement for warehouse location/status; those stay on Asset/Inventory rows.
- Archive a Set **deactivates** its currently active component rows (`is_active = false`) but **keeps** the rows. Members (Asset/Inventory records) remain.

Mental model: **catalog / dispatch kit definition + live membership**, not another asset tree.

---

## 5. Set entity model

Required (v1):

| Field | Role |
|-------|------|
| `id` | Stable PK (`SET-…` style, same family as asset IDs) |
| `set_code` | Human-facing code; unique per company; may equal `id` at create, later a shorter sequence |
| `name` | Display name (Zoho Product name source) |
| `description` | Internal notes; **not** automatically the Zoho description |
| `composition` | `MIXED` \| `ASSET` \| `INVENTORY` — **filter/intent**, not a hard ban if we allow MIXED (see §10) |
| `status` | `DRAFT` \| `ACTIVE` \| `ARCHIVED` |
| `company_id` | Align with `assets.company_id` (nullable until multi-tenant is strict) |
| `zoho_product_id` | CRM Products module id (string; same BigInt-as-string pattern as assets) |
| `zoho_sync_status` | `NOT_SYNCED` \| `SYNCED` \| `CHANGES_PENDING` \| `SYNC_FAILED` |
| `created_at` / `updated_at` / `archived_at` | Lifecycle timestamps |
| `created_by` / `updated_by` | Username / user_id |

Optional v1 (recommended so later phases do not rewrite the table):

| Field | Role |
|-------|------|
| `source_po_id` | FK `project_orders.id` nullable |
| `source_po_item_id` | FK `project_order_items.id` nullable |
| `source_po_reference` | Free-text fallback when PO is not in AssetEngine |
| `legacy_asset_id` | Nullable pointer to a **legacy container asset** if we wrap (compatibility C); **no backfill by default** |

Not required v1: category/kind FK (can reuse text `category` later), nested `parent_set_id`, serial fields, hashed serials.

---

## 6. Set component model

Each line is a **BOM membership**, not a stock document.

| Field | Role |
|-------|------|
| `id` | PK (`CMP-…`) |
| `set_id` | FK → `managed_sets.id` **ON DELETE RESTRICT** (cannot drop a Set that still has component rows; archive instead) |
| `component_type` | `ASSET` \| `INVENTORY` |
| `asset_id` | Nullable; set iff ASSET |
| `inventory_item_id` | Nullable; set iff INVENTORY |
| `quantity` | `NUMERIC` (not float). ASSET: always `1`. INVENTORY: `> 0` |
| `sort_order` | Integer for UI / Zoho description order |
| `label` | Cached display name (refresh from source on add/update; source of truth remains Asset/Inventory `itemname`) |
| `created_at` / `updated_at` | Line audit |

**Check constraints:**

- Exactly one of `asset_id` / `inventory_item_id` matches `component_type`.
- ASSET ⇒ `quantity = 1`.

**Uniqueness:**

- One ASSET in at most one Set with `is_active = true`. Archiving deactivates those lines, so the Asset may join another ACTIVE Set. Inactive rows remain as membership history.
- One `(set_id, inventory_item_id)` pair (qty is updated in place).

No `srno` / `serialno` columns.

---

## 7. Asset component handling

- Reference `assets.id` only.
- UI search: existing Assets APIs (paginate; do not load thousands into the wizard).
- Quantity: **one line per serialized (or individually tracked) asset**, qty 1. If operators need “2 × Camera Body”, they add two asset IDs (two physical units).
- Set portal may **show** serial from `assets.srno` / `serialno` for identification **inside AssetEngine**. That display uses existing Asset fields; no new hash/unhash work.
- Removing a component does **not** change asset status, `parentid`, or `is_set`.
- Conflict: if the same asset is a **legacy** `parentid` child of another kit, v1 **warns** in UI; does not auto-clear `parentid`.

---

## 8. Inventory component handling

- Reference `inventory_items.id` only. No duplicate SKU rows for “× 3”.
- Quantity on the line is **kit intent** (how many of this SKU the kit calls for).
- v1 **does not** decrement `quantity_available` on add (avoids silent stock corruption). Phase 3+ may add optional **reservation** against inventory events, explicitly.
- Over-allocation (`sum of line qty across ACTIVE Sets > quantity_available`) is a **reconciliation warning**, not a create blocker, unless product later requires hard reservation.

---

## 9. Quantity handling

| Member | Model |
|--------|--------|
| Serialized Asset | Line qty = 1; N physical units = N lines |
| Qty-tracked Asset (rare on kits) | Prefer **not** putting qty-tracked assets on BOM as qty>1; split/identify units first, or treat as INVENTORY-like only with an explicit later type. v1: reject ASSET qty ≠ 1 |
| Inventory | Line qty = decimal-capable `NUMERIC(14,4)` to match inventory precision |

Make-set’s **batch split** remains a **legacy Assets** behavior. Managed Sets must not require splitting stock to express “3 connectors”.

---

## 10. Asset-only / Inventory-only / Mixed Set recommendation

| Option | Implication |
|--------|-------------|
| **A. Asset-only** | Matches make-set. Cannot build Camera + consumables. **Reject as sole model.** |
| **B. Inventory-only** | Quantity-friendly. Cannot attach serialized camera bodies. **Reject as sole model.** |
| **C. Mixed** | Matches stated product examples. One Zoho Product, one portal, one lifecycle. Search UX is slightly harder (two pickers). Uniqueness rules differ by line type. |

**Recommendation: Mixed is the default and the only composition that should be first-class in schema.**

`composition = ASSET` or `INVENTORY` may exist as **UI filters / templates** (“this kit is expected to be assets only”) but **must not** reject the other type at the API if `composition = MIXED` (and MIXED should be the create default).

The draft `kitSetService.addComponent` that errors when `set_type !==` component type **must be changed before any migration is applied**, or Mixed kits will be impossible without a breaking migration.

**Nested Sets:** not in v1.

---

## 11. Set lifecycle

```text
DRAFT  --add/remove lines, rename-->  DRAFT
DRAFT  --activate (optional explicit)-->  ACTIVE
ACTIVE --edits--> ACTIVE (if Zoho mapped: zoho_sync_status = CHANGES_PENDING)
ACTIVE --archive--> ARCHIVED  (all currently active component rows: is_active=false; rows kept; Asset/Inventory records and their history unchanged)
ARCHIVED --restore--> ACTIVE  (reactivate last archived BOM only; 409 if those Assets are already active on another Set)
DRAFT + zero lines --hard delete--> gone (optional; prefer archive)
```

- **Archive** ≠ Recovery Center soft-delete of Assets. Do not cascade `is_deleted` to members.
- **Hard delete:** not the normal path. `ON DELETE RESTRICT` if any component rows exist (including inactive). Archive instead.
- Status of member Assets (`In Store` / `Project`) is **independent** unless a later Project phase defines “assign Set to project” as an explicit cascade (opt-in).

---

## 12. Legacy Set compatibility strategy

**Recommend A for the compatibility period:** keep legacy Sets working and unmodified; Managed Sets are a separate system. This is **not** a promise to retain `is_set` / `parentid` forever. Revisit migration only after Managed Sets are proven. Optionally **C later** (wrapper row with `legacy_asset_id`) — no auto-insert.

| Approach | Verdict |
|----------|---------|
| **A. Parallel during compatibility period** | **Chosen until proven.** Zero risk to make-set, status cascade, production rows. Portal lists both, labeled **Legacy** vs **Managed**. Legacy edit stays Make Set / Break Set. |
| B. Gradual migrate | Rewrites `parentid` / `is_set`; high risk; empty `is_set` vs Trimble parent confusion. **Not until** operators request it and we have a reversible backfill. |
| C. Wrapper records | Create `sets` row pointing at legacy container; components **read-only** from `parentid`. Useful later; **do not auto-insert** wrappers. |
| D. Dual-write parentid | Reproduces the old model. **Forbidden.** |

List API may continue unioning `assets.is_set = 1` as `legacy:{id}` so production’s EVM row remains visible. Do **not** union every `parentid` parent (would mis-label Trimble as a Set).

---

## 13. Database schema proposal

**Do not execute.** Replace (do not apply as-is) `20260824120000_create_managed_sets_tables.js` after approval.

### Gaps in the current migration

- `set_type` ASSET\|INVENTORY only — **blocks Mixed**.
- `float` quantity — imprecise; use `NUMERIC`.
- No `sort_order`, `updated_by`, `company_id`.
- No XOR check on asset vs inventory FKs.
- No unique `(set_id, inventory_item_id)`.
- `set_id` **ON DELETE RESTRICT**. Member FKs **ON DELETE RESTRICT**. Never CASCADE into `assets` / `inventory_items`.
- No PO/project FKs (string `source_po_reference` only).
- No history table (acceptable v1 if we add `set_events` in Phase 7).
- `down()` drops both tables — fine if empty.

### Proposed tables (v1)

**`sets`** — columns in §5; indexes on `(status)`, `(zoho_product_id)`, `(company_id)`, `(source_po_id)`, unique `(company_id, set_code)` (if `company_id` null, unique `set_code` globally).

**`managed_set_components`** — columns in §6; indexes `(set_id, sort_order)`; partial unique `asset_id` WHERE `is_active`; unique `(set_id, inventory_item_id)` WHERE `is_active`. Archiving deactivates lines (rows kept).

**`set_project_links`** (nullable Phase 1 stub or Phase 6): `(set_id, project_id)` unique. Allows Set→Project without using `project_assets` for the Set header.

Do **not** add `set_components` serial columns. Do **not** alter `assets` / `inventory_items`.

---

## 14. API proposal

Existing (keep names; fix semantics when implementing Phase 1):

| Method | Path | Today | Target |
|--------|------|-------|--------|
| GET | `/api/managed-sets` | JWT; unions managed+legacy; no pagination | JWT; query `q`, `status`, `composition`, `source`; **paginate** (`page`,`limit`) |
| GET | `/api/managed-sets/:id` | Legacy prefix `legacy:` | Same; join member names; **no serials in `zoho_preview`** |
| POST | `/api/managed-sets` | 503; ASSET\|INVENTORY | 201 DRAFT; default `composition=MIXED` |
| PUT | `/api/managed-sets/:id` | Exists; UI unused | Keep for name/description/PO refs; 409 on legacy |
| POST | `/api/managed-sets/:id/components` | Type-locked | Mixed; qty rules §9; 409 if asset taken |
| DELETE | `.../components/:componentId` | Unlink only | **Deactivate** (`is_active=false`); **never** `DELETE` the row; never delete Asset/Inventory |
| POST | `.../archive` \| `.../restore` | 409 on legacy | Archive: deactivate currently active lines, then `ARCHIVED`. Restore: reactivate last active BOM only |

**Add when UI needs them (not before schema):**

- `PATCH .../components/:id` — quantity / sort_order (inventory qty).
- `GET /api/managed-sets/:id/members` — hydrated Asset/Inventory summaries. **Current** members: `is_active = true` only (same rule as `managedSet`). Optional query to include inactive history lines.
- `DELETE /api/managed-sets/:id` — DRAFT only, or omit (archive-only).

**Do not** add Zoho push routes until Phase 4. Legacy “Push” may keep calling `POST /api/zoho/sync-asset/:id` **only** for `legacy_asset_id`.

**Do not** change `/api/assets/make-set` or `/api/zoho/sync-asset/:id` behavior in Set phases 0–3.

Auth: reads JWT (any logged-in role that can see Assets); writes `superuser` / `admin` / `manager` as today.

---

## 15. UI workflow proposal

**Placement:** Keep primary nav **Sets / Kits** (not buried only under System). Copy must say **Kit / Set management**, not “another asset folder”. Make Set on the Assets dashboard remains **legacy**.

**Create (target, not current `prompt()` UI):**

1. Name, optional code, optional PO reference.
2. Composition default Mixed.
3. Two search panes: Assets (existing list/search API), Inventory (existing items API).
4. Add Asset → line qty 1. Add Inventory → qty stepper.
5. Review BOM (no serials in the “Zoho preview” panel).
6. Save DRAFT. Activate later or on first successful Zoho push.

**List:** Separate badges Legacy vs Managed. Empty legacy kits visible but not editable in portal.

**Detail:** BOM table, open Asset/Inventory record in existing viewers, archive/restore, View in Zoho when `zoho_product_id` present.

Current `kitSets.js` is a **spike**; Phase 2 replaces prompts with this wizard.

---

## 16. Zoho integration design (do not implement)

**Direction:** Managed Set → **one Zoho Product** (`sets.zoho_product_id`). Not a new CRM module in v1.

| Topic | Design |
|-------|--------|
| Payload | `Product_Name` = Set name; Description = BOM **without serials**: `itemname × qty` plus make/model if useful; include `set_code` |
| Assets vs Inventory | Same description list; prefix `Asset` / `Inventory` |
| Qty | Description text; no CRM qty field unless product confirms a custom field |
| Store id | `sets.zoho_product_id` varchar (same as assets) |
| Rename | Product name update; `CHANGES_PENDING` until push |
| Component change | `CHANGES_PENDING`; next push overwrites description |
| Archive | Do **not** delete CRM Product; optional Product status/inactive if CRM supports it later |
| View in Zoho | Existing product UI URL builder + `zoho_product_id` |
| Legacy | Unchanged `syncAssetToZoho`; still may include serials until a **separate** change request |

Managed Set push must **not** call `syncAssetToZoho` (wrong entity; serials; `parentid` children). New service method in Phase 4 only.

---

## 17. PO integration considerations

Today: `assets.linked_po_item_id` → `project_order_items`; `boughtagainstpo` text; `project_orders.ponumber`.

Set v1: nullable `source_po_id` / `source_po_item_id` + text `source_po_reference`.

Phase 5: fulfill a PO line by creating/linking a Set; do not require every member to share the same `linked_po_item_id`. Receiving can still attach PO to **member** Assets as today.

---

## 18. Project integration considerations

Today: `project_assets (projectid, assetid)` only. Inventory is not on that table.

Set → Project: **`set_project_links`**, not “Set is an asset.” Assigning a Set to a project **must not** silently insert `project_assets` for all members in v1. Phase 6: explicit “Deploy kit to project” that assigns member **Assets** (and later inventory movements) with the same lifecycle rules as `updateAssetStatus`.

A Set can exist in warehouse (no project) while members are mixed — reconciliation (Phase 7) flags that.

---

## 19. Future reconciliation design

Three layers (not implemented):

1. **Intended:** `set_components` qty + references.  
2. **Actual (AssetEngine):** member Asset status/location/project; inventory `quantity_available` vs summed kit demand.  
3. **Zoho:** Product description / fields vs last push (`zoho_sync_status`, timestamp).

Do **not** use `parentid` as intended BOM for Managed Sets.

Optional later: `set_events` / snapshots (`intended_json`, `actual_json`, `at`). Physical scan-to-kit is out of scope until audit exists.

---

## 20. Audit / history considerations

v1: `created_by` / `updated_by` / timestamps on header and lines.  
Phase 7: append-only `set_events` (`SET_CREATED`, `COMPONENT_ADDED`, `QTY_CHANGED`, `ARCHIVED`, `ZOHO_PUSHED`, …) with actor and payload JSON. Do not overload `logAssetHistory` for Set headers.

---

## 21. Performance considerations

- Paginate Set list and component pickers; never `SELECT *` all assets into the wizard.
- `listSets`: one query for `sets` + grouped component counts; **separate** cheap query for legacy `is_set=1` (tiny today; index already on `parentid`, add `is_set` index only if volume grows).
- Hydrate members with `WHERE id IN (…)` not N+1.
- Unique/indexes as in §13.
- Redis: optional cache of Set list later; not required for v1 (production Set count will stay small vs assets).

---

## 22. Migration strategy

1. **Now:** no DDL.  
2. **After this doc is approved:** write a **new** Knex migration (new timestamp) that implements §13. Leave `20260824120000_…` unused or replace it in git **before** any environment runs it (it has **not** been applied; `knex_migrations` has no managed-sets name).  
3. Additive `CREATE TABLE` only. No `UPDATE assets`. No backfill.  
4. Deploy code that 503s create until migrate, then enable writes.  
5. Keep make-set. Keep listing legacy.

---

## 23. Rollback strategy

- **Before data:** `down()` drop `set_components`, `set_project_links`, `sets`.  
- **After data:** archive-only; do not drop. Feature-flag the nav.  
- Frontend: hide Sets portal; legacy Make Set remains.  
- Zoho: Products created in Phase 4 remain in CRM; clearing `zoho_product_id` is a data decision, not automatic on rollback.  
- Never roll back by deleting Assets/Inventory.

---

## 24. Risks

- Dual mental models (legacy vs managed) until operators stop using Make Set.  
- Mixed kits + inventory qty without reservation → over-promise stock.  
- Accidental apply of the **old** migration (`set_type` ASSET/INVENTORY only).  
- Status cascade still follows `parentid`, not Managed membership — deploying a “kit” via Set portal will **not** move children until Phase 6.  
- Exclusive asset-in-one-Set vs legacy `parentid` child of a non-set parent (Trimble).  
- Zoho description length limits for large BOMs.  
- `company_id` nulls vs unique `set_code`.

---

## 25. Recommended implementation phases

### PHASE 0 — Architecture / design (this document)

- **Files:** `docs/MANAGED_SETS_ARCHITECTURE.md` (this file).  
- **DB / API:** none.  
- **Risks:** none operational.  
- **Tests:** review against production counts (4 assets, 1 `is_set`, 1 `parentid` child, 0 nested, 0 inventory sets, tables absent).

### PHASE 1 — Database + backend (after approval)

- **Files:** new Knex migration; `kitSetService.js` (Mixed, qty, uniqueness, 503 removal); `server.js` routes (pagination, PATCH qty).  
- **DB:** create `sets`, `set_components`, optional `set_project_links` empty.  
- **API:** fix create/add-component; keep JWT.  
- **Risks:** applying the **wrong** old migration.  
- **Tests:** create Mixed kit; add asset qty 1; add inventory qty 3; reject asset qty 2; archive releases asset; legacy GET still works; **no** asset row mutation; POST still 401 without JWT.

### PHASE 2 — Set management UI

- **Files:** `kitSets.js`, `index.html` `#sets-view`, `main.js` nav only as needed.  
- **DB:** none.  
- **API:** consume PUT/PATCH.  
- **Risks:** operators confuse Make Set vs portal.  
- **Tests:** wizard end-to-end on 237 after migrate; Assets/Inventory/Zoho catalog still load.

### PHASE 3 — Component assignment UX

- **Files:** pickers calling existing `/api/assets`, `/api/inventory/items` with search.  
- **DB:** none beyond Phase 1.  
- **Risks:** loading full catalogs.  
- **Tests:** search + pagination; unlink does not delete members.

### PHASE 4 — Zoho Set → Product

- **Files:** new methods in `zohoService.js` **without** changing `syncAssetToZoho` semantics.  
- **DB:** fill `zoho_product_id` / sync status.  
- **Risks:** serials leaking if someone reuses `buildAssetDescription`.  
- **Tests:** push one Managed Set; description has qty, no S/N; asset Product sync still works; OAuth untouched.

### PHASE 5 — PO

- **Files:** Set form PO picker; `source_po_id` writes.  
- **DB:** use columns from Phase 1.  
- **Risks:** linking wrong PO line.  
- **Tests:** Set with and without PO; member `linked_po_item_id` unchanged unless user uses existing asset PO tools.

### PHASE 6 — Project

- **Files:** `set_project_links`; optional deploy action using existing `updateAssetStatus`.  
- **DB:** link table.  
- **Risks:** accidental cascade to all members.  
- **Tests:** link without cascade; opt-in deploy documented.

### PHASE 7 — Reconciliation / audit

- **Files:** `set_events`; report UI.  
- **DB:** events table.  
- **Risks:** noisy events.  
- **Tests:** intended vs available qty; Zoho `CHANGES_PENDING` vs last push.

---

# FINAL SCHEMA REVIEW — PENDING IMPLEMENTATION

**Reviewed:** 2026-08-25 against production `asset_manager` on 192.168.6.237.  
**This section is the decision record for writing the production migration later.** Nothing in this section has been applied.

Legend:

| Label | Meaning |
|-------|---------|
| **APPROVED** | Include in Phase 1 schema/API contract (after you sign off) |
| **RECOMMENDED** | Include in the same first migration if you accept it; otherwise a later ALTER |
| **DEFERRED** | Do not create columns/tables in Phase 1 |
| **NOT REQUIRED** | Do not add |

### Membership vs Asset / Inventory history (**APPROVED** correction)

A Managed Set is only a relationship/container. Assets and Inventory remain independent first-class records.

| Rule | Verdict |
|------|---------|
| Asset `asset_history` / `audit_log` / `quantity_events` | **Independent.** Set membership does not write, rewrite, or delete them. |
| Inventory `inventory_quantity_events` / lines | **Independent.** Same. |
| Archive Set | **APPROVED:** `status = ARCHIVED`, `archived_at` set. Every **currently active** component for that Set: `is_active = false`. **Rows remain.** Do **not** `DELETE` lines. Do **not** delete or rewrite Asset/Inventory/PO/Project/serials or their history. Assets then match `managedSet: null` and may join another ACTIVE Set. |
| Remove from Set | **APPROVED:** `managed_set_components.is_active = false`. **Do not** `DELETE` the component row. **Do not** delete the Asset/Inventory. |
| Hard-delete Set | **NOT** the normal path. **RESTRICT** if any component rows exist (active or inactive). Archive instead. |
| `set_id` FK | **ON DELETE RESTRICT** (not CASCADE). |
| FKs to `assets` / `inventory_items` | **ON DELETE RESTRICT**. Never CASCADE into those tables. |
| Legacy `is_set` / `parentid` | Untouched. |
| Dedicated Set history table | **NOT REQUIRED** (still Phase 7). Inactive component rows are the v1 membership trail. |

`logAssetHistory` remains asset-scoped. `kitSetService` (when implemented) must not call it for Set add/remove.

**Current membership (`managedSet`):** Asset and Inventory APIs must expose current Managed Set only from rows with `is_active = true`. After archive or remove, that field is `null`. Do not treat inactive rows as current membership.

**Phase 1 (`kitSetService.js`) — do not implement yet:** never `DELETE FROM managed_set_components`. Remove = `UPDATE ... SET is_active = false`. Archive = `UPDATE ... SET is_active = false WHERE set_id = ? AND is_active = true`, then set Set `status`/`archived_at`. Restore must not blindly reactivate every inactive row (prior removes stay inactive).

---

### Q1 — Set entity (`managed_sets`)

**APPROVED table name:** `managed_sets` (not generic `sets` — clearer, avoids colliding with the draft migration’s `sets`).

| Field | Verdict | Why |
|-------|---------|-----|
| `id` | **APPROVED** | Internal PK. Same string-id family as assets (`SET-…`). |
| `set_code` | **APPROVED** | Human-readable number/code for UI, Zoho description, search. Unique. May equal `id` at create. |
| `name` | **APPROVED** | Operator and Zoho Product name source. |
| `description` | **APPROVED** | Internal notes. Not the Zoho BOM text (that is generated from components). |
| `status` | **APPROVED** | `DRAFT` \| `ACTIVE` \| `ARCHIVED`. Own lifecycle, not asset status. |
| `type` / `set_type` / `composition` stored | **NOT REQUIRED** as source of truth | See Q2. |
| `zoho_product_id` | **APPROVED** nullable | Same varchar strategy as `assets.zoho_product_id`. Unused until Phase 4; storing it now avoids a second migration. |
| `zoho_sync_status` | **RECOMMENDED** | `NOT_SYNCED` \| `SYNCED` \| `CHANGES_PENDING` \| `SYNC_FAILED`. Cheap; needed as soon as mapping exists. Default `NOT_SYNCED`. |
| `created_by` | **APPROVED** | Who created the Set. |
| `updated_by` | **APPROVED** | Who last changed header (or last component mutation if we touch header `updated_at`). |
| `created_at` | **APPROVED** | |
| `updated_at` | **APPROVED** | |
| `archived_at` | **APPROVED** nullable | Set when `status = ARCHIVED`; null otherwise. |

**NOT REQUIRED on `managed_sets` in Phase 1:** `company_id` (production `assets.company_id` is unused: 0 rows populated), `legacy_asset_id`, `source_po_id`, `source_po_item_id`, `source_po_reference`, `project_id`, `category`, serial fields.

Empty DRAFT Sets are valid (name + status only).

---

### Q2 — Set type (ASSET / INVENTORY / MIXED)

**APPROVED product support:** all three compositions, with **MIXED** as the product model (Camera Body asset + inventory lines).

**APPROVED implementation:** **calculate** composition from **currently active** components (`is_active = true` only). Do **not** store `set_type`. An archived Set’s live composition is `EMPTY`; historical mix is readable from inactive rows.

| Components | Calculated composition |
|------------|------------------------|
| none | `EMPTY` |
| only `ASSET` lines | `ASSET` |
| only `INVENTORY` lines | `INVENTORY` |
| both | `MIXED` |

**Why not stored type:** empty DRAFT has no type; exclusive stored `ASSET` is what the draft service already gets wrong; filters can `HAVING` / compute in the API.

**NOT REQUIRED:** `composition_hint` / template column.

**API:** `GET` may return `composition` as a computed field. `POST` must **not** require `set_type`. `kitSetService` must **not** reject an inventory line on an “asset set”.

---

### Q3 — Component model (`managed_set_components`)

**APPROVED table name:** `managed_set_components`.

**APPROVED columns:**

| Field | Verdict | Why |
|-------|---------|-----|
| `id` | **APPROVED** | Line PK. |
| `set_id` | **APPROVED** | FK → `managed_sets.id`. |
| `component_type` | **APPROVED** | `ASSET` \| `INVENTORY`. Discriminator for CHECK + application. |
| `asset_id` | **APPROVED** nullable | FK → `assets.id` when type ASSET. |
| `inventory_item_id` | **APPROVED** nullable | FK → `inventory_items.id` when type INVENTORY. |
| `quantity` | **APPROVED** | See Q5. |
| `sort_order` | **APPROVED** | Stable BOM / Zoho description order. Default 0; application assigns on insert. |
| `created_at` / `updated_at` | **APPROVED** | Line-level change time (qty updates). |
| `is_active` | **APPROVED** | Default `true`. **Current membership** is `is_active = true` only. Remove from Set **or** archive Set (for currently active lines) ⇒ `false`; **row kept**. |

**NOT REQUIRED:** `label` (stale cache; join `itemname` at read), `nested_set_id`, serial columns.

Matches production: two tables (`assets`, `inventory_items`), varchar PKs, no shared supertype.

---

### Q4 — Exactly one reference

**APPROVED:** PostgreSQL `CHECK` on `managed_set_components`:

```text
(
  (component_type = 'ASSET'
    AND asset_id IS NOT NULL
    AND inventory_item_id IS NULL)
  OR
  (component_type = 'INVENTORY'
    AND inventory_item_id IS NOT NULL
    AND asset_id IS NULL)
)
```

**APPROVED:** FKs:

- `asset_id` → `assets(id)` **ON DELETE RESTRICT**
- `inventory_item_id` → `inventory_items(id)` **ON DELETE RESTRICT**

RESTRICT is safer than SET NULL (would violate CHECK) or CASCADE (would destroy kit lines when deleting stock, or worse cascade into assets). Operators remove the component first, then delete the record (or Recovery Center soft-delete: FKs still see the row).

Application still validates existence of non-deleted records; CHECK does not know `is_deleted`.

---

### Q5 — Quantity

Production inventory (`MIS-MUM-0826-H4XVLL-W`): `quantity_unit = Nos`, `quantity_precision = 0`, `is_quantity_tracked = 1`, totals stored as `double precision` but values are whole numbers. Assets on kits are individual IDs.

**APPROVED:** `quantity INTEGER NOT NULL` with `CHECK (quantity > 0)`.

| Line type | Extra rule |
|-----------|------------|
| ASSET | `CHECK (component_type <> 'ASSET' OR quantity = 1)` |
| INVENTORY | integer count (1, 2, 3, …) |

**NOT REQUIRED in v1:** `NUMERIC` / fractional qty. Inventory *can* be fractional in schema (`real`/`double`), but live data and “Nos” do not require it. If fractional kits appear later, ALTER to `NUMERIC`.

**NOT REQUIRED:** decrementing `inventory_items.quantity_*` from this column.

---

### Q6 — Same Asset in multiple Sets

A serialized Asset is one physical object. Two ACTIVE kits both claiming Camera #001 is an operational lie (assignment, DC, Zoho, location).

**APPROVED:** **Prevent** the same `asset_id` from appearing on more than one **active** component (`is_active = true`) at a time. Partial unique index is unchanged: `UNIQUE (asset_id) WHERE asset_id IS NOT NULL AND is_active`.

**APPROVED:** Setting `is_active = false` (remove from an ACTIVE Set, **or** archive of that Set) **releases** uniqueness; the **row is kept**.

**APPROVED:** Archiving a Set **must** set `is_active = false` on every **currently active** component of that Set. Rows remain. The Asset is then eligible for another ACTIVE Managed Set. APIs that expose current membership (`managedSet`) treat inactive lines as **not** in a Set (`managedSet: null`).

Restore of an archived Set **fails (409)** if reactivating its former BOM would violate the partial unique (an Asset already `is_active` on another Set). Restore must reactivate only the lines that formed the last active BOM (the ones deactivated by archive), not lines that were already inactive from earlier removes.

**NOT REQUIRED:** allowing the same Asset on two ACTIVE Sets.

Legacy `parentid` is a separate tree; v1 does **not** auto-block an Asset that is a legacy child. **RECOMMENDED** later: API warning only (DEFERRED enforcement).

---

### Q7 — Inventory in multiple Sets

HDMI × 3 on Set A and × 4 on Set B against available 20.

**APPROVED for v1:** **A — intended composition only.** Lines do not reserve or decrement stock.

**DEFERRED:** **D** — optional reservation / allocation against `inventory_quantity_events` (existing inventory event system).

**NOT REQUIRED in v1:** B (reserve) or C (decrement).

Reconciliation (Q19) compares intended sum vs `quantity_available` without writing stock.

---

### Q8 — Set containing Set

**APPROVED: v1 does not allow nested Sets.** No `parent_set_id`, no `component_type = SET`.

Reasons: circular graphs, Zoho one-Product flattening, inventory rollups, reconciliation, unused in production (0 nested legacy sets).

**DEFERRED:** kits-of-kits after v1 is proven. If added: `component_type = SET` + `nested_set_id` + cycle trigger — new migration.

---

### Q9 — Asset lifecycle vs membership

**APPROVED:** membership is **informational / orchestration**, not ownership, not reservation, not allocation.

| Asset event | Set behavior |
|-------------|--------------|
| Assign / project / transfer / checkout / return | Unchanged. Set does not cascade status. |
| Retired / sold / disposed | Line remains unless removed; UI shows member state from `assets`. |
| Soft-delete (`is_deleted`) | Line remains; portal shows deleted/unavailable. FK still valid. |
| Hard-delete | **RESTRICT** — remove component first. |

Managed Set **must not** write `parentid` / `is_set` / `updateAssetStatus`.

---

### Q10 — Inventory lifecycle vs membership

**APPROVED:** same — **informational**. Intended qty is independent of `quantity_available`.

| Inventory event | Set behavior |
|-----------------|--------------|
| Stock ↓ / out of stock | Set unchanged; reconciliation can flag expected vs available. |
| Stock ↑ | Unchanged. |
| Discontinued (status) | Unchanged; UI shows status. |
| Soft-delete | Line remains. |
| Hard-delete | **RESTRICT**. |

No reservation/decrement in Phase 1–3.

---

### Q11 — PO relationship

Today PO lives on **members**: `assets.linked_po_item_id` → `project_order_items`, `boughtagainstpo` text; orders on `project_orders`.

A Set can be “from PO-1234” while members have mixed or empty PO links. A header `po_id` would be **incomplete** if only some lines came from that PO.

**APPROVED for Phase 1:** **no PO columns** on `managed_sets`.

**DEFERRED:** nullable `source_po_id` / text reference when Phase 5 starts — additive ALTER.

Component-level PO stays on Asset/Inventory records.

---

### Q12 — Project relationship

Today: `project_assets (projectid, assetid)` only; inventory is not on that table. Assignments **change over time**.

A single `managed_sets.project_id` cannot represent history or “kit in warehouse, members on site”.

**APPROVED for Phase 1:** **no `project_id`** on `managed_sets`.

**DEFERRED:** `managed_set_project_links (set_id, project_id, assigned_at, unassigned_at)` — many-to-one-at-a-time via partial unique on active link, or history rows.

**NOT REQUIRED:** putting the Set itself into `project_assets`.

---

### Q13 — Zoho Product

**APPROVED:** `managed_sets.zoho_product_id` `varchar` nullable — same as `assets.zoho_product_id` (CRM ids stored as decimal strings; SDK BigInt at push time).

**APPROVED:** partial **UNIQUE** where `zoho_product_id IS NOT NULL` (one Product ↔ one Managed Set). Assets today have **no** unique on `zoho_product_id`; we should be stricter for Sets.

| Event | Design (Phase 4, not now) |
|-------|---------------------------|
| Disconnect | Null the column; status `NOT_SYNCED`. |
| Reconnect / new Product | New id. |
| CRM Product deleted | Push fails; `SYNC_FAILED`; do not auto-clear without operator. |
| Archive Set | Keep id; do not delete CRM Product. |
| Rename / BOM change | `CHANGES_PENDING` until push. |

Do not share this id with a member Asset’s `zoho_product_id` (two Products if both synced).

---

### Q14 — Set history

Production already has `asset_history`, `audit_log`, `domain_events`, inventory/quantity events, `zoho_sync_logs`. None of these are a Set BOM timeline.

**NOT REQUIRED in v1:** `managed_set_history` / `managed_set_events`.

**APPROVED v1:** `created_by` / `updated_by` / timestamps on header and lines (qty change updates `updated_at` / `updated_by` on header).

**DEFERRED:** append-only Set events in Phase 7. Do **not** overload `logAssetHistory` (asset-scoped). Do **not** write inventory quantity events when Set membership changes.

---

### Q15 — Deletion

| Action | **APPROVED** behavior |
|--------|------------------------|
| “Delete” Set | **Archive:** `status=ARCHIVED`, `archived_at` set, **all currently active** components `is_active=false`, **rows retained**. Assets/Inventory/PO/Project/serials and their history untouched. |
| Hard-delete Set | **Prevented** while any `managed_set_components` rows exist (`ON DELETE RESTRICT`). Empty header-only DRAFT may be deleted later if ever needed. Not the normal lifecycle. |
| Remove component | **`is_active = false`**. **Never** `DELETE FROM managed_set_components`. Do **not** delete Asset/Inventory. |
| Delete Asset in a Set | **RESTRICT** (hard). Soft-delete Asset allowed; membership row remains. |
| Delete Inventory item in a Set | **RESTRICT** (hard). Soft-delete item allowed. |

---

### Q16 — Legacy compatibility

**APPROVED:** compatibility period, parallel systems.

- Do not modify/delete/backfill `is_set` / `parentid`.
- `POST /api/assets/make-set` and Inventory parent linking **unchanged**.
- Portal may **list** `assets.is_set = 1` as `legacy:{id}` read-only.
- Do **not** treat `parentid` parents as Managed or legacy Sets (Trimble).
- Do **not** dual-write Managed membership onto `parentid`.

**DEFERRED future migration (not designed as DDL now):** after Managed Sets are proven, optional wrap (`legacy_asset_id`) or operator-driven move of members onto `managed_set_components`, then stop creating new `is_set` kits. Dropping `is_set` is a **later** product decision.

---

### Q17 — Database constraints (design only — do not execute)

**`managed_sets`**

- PK `id`
- UNIQUE `set_code`
- CHECK `status IN ('DRAFT','ACTIVE','ARCHIVED')`
- CHECK `archived_at IS NULL OR status = 'ARCHIVED'`
- Partial UNIQUE `zoho_product_id` WHERE NOT NULL
- Index `(status)`, `(updated_at DESC)`

**`managed_set_components`**

- PK `id`
- FK `set_id` → `managed_sets(id)` **ON DELETE RESTRICT**
- FK `asset_id` → `assets(id)` **ON DELETE RESTRICT**
- FK `inventory_item_id` → `inventory_items(id)` **ON DELETE RESTRICT**
- CHECK XOR type vs ids (Q4)
- CHECK `quantity > 0`
- CHECK ASSET ⇒ `quantity = 1`
- UNIQUE `(set_id, inventory_item_id)` WHERE `inventory_item_id IS NOT NULL AND is_active` (same SKU once per active Set)
- Partial UNIQUE `asset_id` WHERE `asset_id IS NOT NULL AND is_active`
- Index `(set_id, sort_order)`
- CHECK `component_type IN ('ASSET','INVENTORY')`
- CHECK `is_active IN (true, false)` / boolean

---

### Q18 — Migration `20260824120000_create_managed_sets_tables.js`

| Item | Classification | Why |
|------|----------------|-----|
| Additive CREATE only / no touch of `is_set` | **KEEP** | Safe vs legacy. |
| `down()` drop new tables | **KEEP** | Empty rollback. |
| Table `sets` | **REMOVE** → **ADD** `managed_sets` | Domain name; unused so rename is free. |
| Table `set_components` | **REMOVE** → **ADD** `managed_set_components` | Same. |
| `set_type` NOT NULL ASSET\|INVENTORY | **REMOVE** | Blocks MIXED; redundant with components. |
| `status` DRAFT/ACTIVE/ARCHIVED | **KEEP** | |
| `zoho_product_id` | **KEEP** | varchar nullable. **ADD** partial unique. |
| `zoho_sync_status` | **KEEP** (as **RECOMMENDED**) | Default `NOT_SYNCED`. |
| `source_po_reference` | **REMOVE** from v1 | Q11 DEFERRED. |
| `legacy_asset_id` | **REMOVE** from v1 | Q16 DEFERRED wrap. |
| `created_by` | **KEEP** | **ADD** `updated_by`. |
| timestamps / `archived_at` | **KEEP** | |
| Indexes type/status/zoho | **MODIFY** | Drop type index; keep status/zoho. |
| `float` quantity | **MODIFY** → `integer` | Q5. |
| `label` | **REMOVE** | Join names. |
| Missing XOR CHECK | **ADD** | Q4. |
| Missing FKs to assets/inventory | **ADD** RESTRICT | Q4. |
| Missing `sort_order` | **ADD** | |
| Missing `is_active` + partial uniques | **ADD** | Q6–Q7. |
| `set_code` unique | **KEEP** | |
| `id` = `set_code` at insert | **KEEP** as app default | |

**Do not apply this file.** Write a **new** timestamped migration after approval.

---

### Q19 — Future reconciliation

**APPROVED:** schema is sufficient.

- **Current (expected live kit):** `managed_set_components` WHERE `is_active = true`.
- **Historical membership:** same table, `is_active = false` (remove or archive). Do not `DELETE` those rows.
- **Actual Assets:** join `assets` on `asset_id` (status, location, `project_assets`, `is_deleted`).
- **Actual Inventory:** join `quantity_available` vs intended `quantity` (and vs sum of intended qty across active Sets).
- **Zoho:** `zoho_product_id` + `zoho_sync_status` vs last `zoho_sync_logs`.

No extra table required for v1. **DEFERRED:** snapshot JSON in Phase 7.

---

### Q20 — Final recommendation

#### A. Approved Set model

`managed_sets`: `id`, `set_code`, `name`, `description`, `status`, `zoho_product_id`, `created_by`, `updated_by`, `created_at`, `updated_at`, `archived_at`.  
**RECOMMENDED:** `zoho_sync_status`.  
Composition **computed**. No stored `set_type`. No PO/project/company/legacy columns in Phase 1.

#### B. Approved Set Component model

`managed_set_components`: `id`, `set_id`, `component_type`, `asset_id`, `inventory_item_id`, `quantity`, `sort_order`, `is_active`, `created_at`, `updated_at`. XOR CHECK. All FKs **ON DELETE RESTRICT** (Set header, Asset, Inventory).

#### C. Quantity model

INTEGER `> 0`; ASSET must be `1`; INVENTORY integer counts. No stock writes.

#### D. Asset membership rules

At most one **active** (`is_active=true`) Set membership per Asset. **Archive** and **remove** both set `is_active=false` and **keep the row**; the Asset may then join another ACTIVE Set (`managedSet: null` until then). Informational membership. No Asset/Inventory history writes. RESTRICT on hard-delete of Asset, Inventory, or Set-with-components.

#### E. Inventory membership rules

Same SKU once per active Set; qty on the line. Same SKU **may** appear on **different** Sets (intended composition). No reserve/decrement.

#### F. Nested Set decision

**Not in v1.**

#### G. PO relationship decision

**None on Set in Phase 1.** PO stays on component records. ALTER later if needed.

#### H. Project relationship decision

**No `project_id` on Set.** Join table **DEFERRED** (history-friendly).

#### I. Zoho mapping decision

Nullable unique `zoho_product_id` on `managed_sets`. Phase 4 push is a new path, not `syncAssetToZoho`. Archive does not delete CRM Product.

#### J. Legacy compatibility decision

Parallel **compatibility period**. No backfill. No dual-write. Revisit `is_set`/`parentid` only after Managed Sets are proven — **not** a forever dual-model.

#### K. Audit/history decision

Header/line actors + timestamps in v1. **No** history table until Phase 7.

#### L. Deletion/archive decision

Archive Sets (normal): deactivate currently active component rows (`is_active=false`), **keep the rows**. Remove members the same way — **never** `DELETE` component rows. Hard-delete Set **RESTRICT** if any component rows exist. Never CASCADE into Assets/Inventory. Never delete Asset/Inventory because of Set membership. Never write Asset/Inventory history for Set membership changes.

#### M. Required database constraints

See Q17.

#### N. Migration changes required

Do **not** run `20260824120000_…`. Replace with a new migration matching A–M (table names, drop `set_type`, integer qty, CHECKs, FKs, `is_active`, no PO/legacy/label).

---

**Decisions that need your explicit approval before Phase 1 DDL**

1. Table names `managed_sets` / `managed_set_components`.  
2. Computed composition (no stored type).  
3. Integer quantity only.  
4. One active Set per Asset (`is_active` + partial unique).  
5. Inventory = intended BOM only.  
6. No nested Sets.  
7. No PO/project columns in first migration.  
8. Include **RECOMMENDED** `zoho_sync_status` in that migration.  
9. Compatibility period (not permanent dual schema).

---

## Appendix A — Current draft vs this design


| Draft (`kitSetService` + `20260824120000_…`) | Final schema review |
|-----------------------------------------------|---------------------|
| Tables `sets` / `set_components` | `managed_sets` / `managed_set_components` |
| Stored `set_type` ASSET **or** INVENTORY | **Computed** ASSET / INVENTORY / MIXED / EMPTY |
| `float` quantity, `label`, `source_po_reference`, `legacy_asset_id` | Integer qty; no label/PO/legacy in Phase 1 |
| No XOR CHECK / member FKs / `is_active` | CHECK + RESTRICT FKs + active uniqueness |
| Union legacy `is_set` | Keep as **compatibility period** list-only |
| Push legacy via `sync-asset` | Keep for legacy only |

## Appendix B — Production facts (2026-08-25)

- `sets` / `set_components` / `set_history`: **absent**  
- `knex_migrations`: **no** `20260824120000_create_managed_sets_tables.js`  
- Applied related: `20260527120000_add_set_logic_to_assets.js` (`is_set` on assets)  
- Legacy APIs remain source of truth for physical kit trees
