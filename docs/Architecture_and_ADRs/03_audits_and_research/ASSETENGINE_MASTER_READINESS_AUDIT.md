# AssetEngine — Master Readiness Audit

**Status:** AUDIT / DISCOVERY / PLANNING ONLY (original). **P0 containment implemented 31 Aug 2026** — see `docs/P0_LIFECYCLE_CONTAINMENT_IMPLEMENTATION.md`. This audit’s historical findings are not rewritten. Phase 10 not started. Projects / DC / Rentals not redesigned.

**Date:** 31 August 2026  
**Environment:** production `asset_manager` (read-only census) · source `web-app/asset-manager-backend` + `web-app/asset-manager-frontend`  
**Authoritative architecture:** `docs/ASSETENGINE_CANONICAL_ARCHITECTURE.md` revision 3  
**This file is the only deliverable of this task.**

---

## How to read this document

| Label | Meaning |
|-------|---------|
| **Canonical** | Matches the locked Product → PO → Receipt → physical → Reservation → Set chain. Keep. |
| **Implemented / smoke-proven** | Engine exists, JWT-gated, and passed the 31 Aug 2026 core lifecycle smoke (79/79 on scratch). Not the same as operator-ready. |
| **Contained** | Live route that returns 409/410 instead of mutating. Keep the containment. |
| **Legacy / dangerous** | Still reachable and can write non-canonical state. Must be contained or retired before operator production use of the new lifecycle. |
| **Deferred** | Explicitly out of this release: Projects, DC redesign, Rentals, Customer PO, Work Orders, Vendor master, Subset, Super Set, full disposition. |
| **Stale doc** | Do **not** treat as current truth. Cited only as GAP ID history. |

**Stale documents (do not copy headlines as current state):**

- `docs/ARCHITECTURE_GAP_ANALYSIS.md` (27 Aug, **pre-Phases 1–9**). Its headline “no Product / no reservation / no conservation” is **false today**. GAP IDs remain useful; re-assessed below.
- `docs/PRODUCT_ARCHITECTURE_DECISION.md` still labelled “PROPOSED”. ADR-PRODUCT-001–017 were implemented in Phases 1 and 8.
- Canonical §1 still says production “holds Purchase Orders locally.” Phase 9 **contained** local create/edit; live Zoho PO READ is **blocked by OAuth scope**.
- `docs/RECEIPT_NOTE_PHASE7_PLAN.md` / `docs/PROCUREMENT_PHASE9_PLAN.md` / `docs/ZOHO_PRODUCT_SET_PHASE8_PLAN.md` headers still say “PLAN ONLY.” The **code** for those phases exists.

**Zoho BRD file:** `Cineom_Phase_2_Zoho_Custom_Module_BRD_final_v2.docx` was **not found** in this repository or under `C:\Users\Administrator`. Alignment in Part 35 uses `docs/ZOHO_PRODUCT_SET_PHASE8_PLAN.md`, `docs/ZOHO_PRODUCT_AE_SYNC_AUDIT.md`, `docs/PRODUCTION_ZOHO_MODULE_STATUS.md`, and `docs/PROCUREMENT_PHASE9_PLAN.md`.

**Protected production IDs (never mutate):** `APP-MUM-0526-MMKBX9-W`, `HAR-MUM-0726-55QOFA-R`, `HAR-MUM-0826-IEIZP5-U`, `MIS-MUM-0826-H4XVLL-W`.

---

## EXECUTIVE VERDICT (read this first)

**Core engines: implemented and smoke-proven. Operator production readiness: CONDITIONALLY READY — not ready to hand to operators as the daily lifecycle.**

Phases 1–9 exist as dedicated services, checksum IDs, JWT/role-gated canonical APIs, and a scratch golden-path smoke of **79/79**. Production physical data was **not** written by that smoke (delta 0). The locked chain Product → Zoho Product → Set requirement → Procurement/PO mirror → Receipt Note → accepted stock → Asset/Inventory → Reservation → Set allocation → completeness **works in code**.

It is **not** production-ready for operators because:

1. **Zoho Purchase Order READ is blocked by OAuth scope** (`BLOCKED_BY_SCOPE`). Live `procurement_po` = **0**. The commercial half of the golden path cannot run against production Zoho.
2. **Legacy mutators are still live** beside the engines: `POST /api/assets/make-set` (JWT only, writes `parentid` / `is_set`), `POST /api/assets/split` and `/unsplit`, `POST /api/inventory/items` with `ZohoProductId` (GAP-105 Receipt bypass), `POST /api/assets` (JWT only), catalog-to-inventory picker, Asset view “LEGACY: Push to Zoho CRM”.
3. **UI is still table-oriented**, not lifecycle-oriented. Canonical screens (Products, POs, Receipts, Sets) sit next to Assets / Inventory / Projects / Create DC. There is **no Reservations nav**. Conversion is a side panel on Asset/Inventory, not a first-class step. Products list is capped at **200**. There is **no “Create Product from catalog”** button (API exists).
4. **Dual Set models in production:** 10 `managed_sets` rows; only **1** has `product_id`; **3** `set_requirement` rows. The rest are `LEGACY_MANAGED` / Manual Review.
5. **Auth is route-level, not field-level.** Sales cannot hit canonical mutations (smoke-proven 403). Product PUT still lets manager/admin/superuser edit logistics **and** price **and** name on one payload. `make-set` and `POST /api/assets` are weaker than the new engines.

**Do not start Phase 10. Do not redesign Projects/DC/Rentals. Do not change OAuth scopes from application code.**

### Architectural refinement (1 September 2026) — do not rewrite the 31 Aug findings above

P0 containment of direct Asset/Inventory create remains. The audit’s “Receipt is the only birth point” wording was too absolute.

**Refined rule:** Receipt Notes are the canonical physical-birth path for procurement stock. Physical Intake is the controlled canonical path for legitimate non-procurement stock (opening balance, legacy existing stock, donation, non-PO acquisition, and similar). Both converge on Asset/Inventory, then Reservation → Set allocation.

New service: `services/physicalIntakeService.js` · `POST /api/physical-intakes` · named migration `20260901180000_physical_intake_foundation.js`. Direct `POST /api/assets` and `POST /api/inventory/items` stay contained. See **ADR-INTAKE-001**.

---

# PART 1 — REPOSITORY / APPLICATION INVENTORY

Active application: `web-app/asset-manager-backend` (Express, much logic still in `server.js`) + `web-app/asset-manager-frontend`. PostgreSQL via Knex. Redis with in-memory fallback. No separate controllers/models layer for the new engines — services are called from `server.js`.

## 1.1 Canonical backend services (KEEP)

| File | Purpose | Used by | Status | Risk | Future action |
|------|---------|---------|--------|------|---------------|
| `services/productService.js` | Product CRUD, 1:1 Zoho mapping, publish/refresh, from-catalog, Set commercialize | `/api/products*` | Canonical, smoke-proven | Product PUT is not field-split | Leave engine; add field/auth later |
| `services/reservationService.js` | Reserve / release / transfer; conservation | `/api/reservations*` | Canonical, smoke-proven | No dedicated UI | Leave engine; add UI |
| `services/conversionService.js` | Asset ↔ Inventory conversion; CONV- audit IDs | `/api/conversions*` | Canonical, smoke-proven | CONV- visible in some UI | Leave engine; hide op IDs in UX |
| `services/breakService.js` | Quantity Break / Individualize | `/api/break*` and quantity-mode `/api/assets/split` | Canonical | Legacy split still wraps it then assigns | Keep `/api/break`; contain split |
| `services/legacyBreakContainment.js` | Quarantine / UNRETURNED_CONVERSION | Break + conversion | Canonical containment | — | Keep |
| `services/setService.js` | Canonical Set: requirements, alloc/dealloc/replace, disband, archive, commercialize | `/api/sets*` | Canonical, smoke-proven | `disassemble` / `absorb` return not-implemented | Keep; Subset/Super Set deferred |
| `services/receiptService.js` | Receipt Note create/post/cancel/reverse; physical output | `/api/receipt-notes*` | Canonical, smoke-proven | Live prod has 1 RN, 0 procurement POs | Keep |
| `services/physicalIntakeService.js` | Non-procurement physical birth (1 Sep 2026) | `/api/physical-intakes*` | Canonical | Must stay distinct from Receipt | Keep; do not reopen POST /api/assets |
| `services/receiptProjectionService.js` | Outbox projection to Zoho (designed; not a stock publisher) | `/api/receipt-notes/:id/project-to-zoho` | Canonical stub/outbox | OD-12 = do not publish stock | Keep; do not enable quantity push |
| `services/procurementService.js` | PO mirror, import, refresh, outstanding, eligibility | `/api/procurement/pos*`, `/api/purchase-orders*` | Canonical, fixture-proven | Live Zoho READ blocked | Keep; wait for ops scope |
| `services/zohoProcurementService.js` | Zoho PO adapter | procurementService | Canonical | `BLOCKED_BY_SCOPE` | Keep; **do not** change scopes in code |
| `services/zohoProductFields.js` | Field ownership / publish hash | productService | Canonical | — | Keep |
| `services/zohoService.js` | CRM Products pull/push, catalog, OAuth FileStore | Products + legacy asset push | Mixed | Legacy `sync-asset` still live | Keep pull/publish; contain asset push |

## 1.2 Legacy / dual-use backend (DO NOT rewrite; contain)

| File / area | Purpose | Canonical / Legacy | Status | Risk | Future action |
|-------------|---------|--------------------|--------|------|---------------|
| `server.js` (~12k lines) | Almost all HTTP routes | Mixed | Live | New engines registered here **and** dangerous legacy routes remain | Surgical contain; no rewrite |
| `services/kitSetService.js` | v1 Managed Sets (`managed_sets` without requirements) | Legacy | Live via `/api/managed-sets*` | Dual Set model | Quarantine UI already; retire later |
| `IdGenerator.js` | Checksum family + `generateModernAssetId` + `generateSplitAssetId` | Mixed | Live | Split suffix IDs still exist | Keep checksum family; stop using split suffixes |
| `utils.js` | DB, ID wrappers, helpers | Mixed | Live | — | Leave |
| `inventoryMovementService.js` | Inventory qty events | Canonical-adjacent | Live | Parallel to `quantity_events` | Leave; do not duplicate |
| Email / cache / encryption / password / token / recovery / Google Sheets | Ops | Out of lifecycle | Live | — | Leave alone |

## 1.3 Migrations (relevant)

| Migration | Purpose | Status | Action |
|-----------|---------|--------|--------|
| `20260825120000_create_managed_sets_v2.js` | v1 managed sets | Applied | Leave |
| `20260827120000_create_product_foundation.js` | Phase 1 | Applied | Leave |
| `20260827180000_quantity_physical_identity.js` | Phase 2 | Applied | Leave |
| `20260828120000_reservation_foundation.js` | Phase 3 | Applied | Leave |
| `20260828180000_conversion_foundation.js` | Phase 4 | Applied | Leave |
| `20260828200000_set_engine_foundation.js` | Phase 6 | Applied | Leave |
| `20260828220000_receipt_note_foundation.js` | Phase 7 | Applied | Leave |
| `20260829120000_product_zoho_phase8.js` | Phase 8 | Applied | Leave |
| `20260829180000_procurement_phase9.js` | Phase 9 | Applied | Leave |
| **`20260901180000_physical_intake_foundation.js`** | Physical Intake | Named migrate only | Never `migrate:latest` |
| **`20260824120000_create_managed_sets_tables.js`** | Abandoned `sets` table | **Must stay unapplied** | **Never `migrate:latest` blindly** |

Never run `migrate:latest` on production as a catch-all. Never apply the 24 Aug abandoned file.

## 1.4 Verify / smoke scripts (KEEP as evidence; do not treat as product UI)

`product-phase1-verify.js`, `quantity-phase2-verify.js`, `reservation-phase3-verify.js`, `conversion-phase4-verify.js`, `phase5-break-cutover-verify.js`, `set-phase6-verify.js`, `receipt-phase7-verify.js`, `zoho-product-phase8-verify.js`, `procurement-phase9-verify.js`, `final-lifecycle-smoke.js` (79/79 scratch, 31 Aug). Reports under `scripts/reports/`.

## 1.5 Frontend inventory

| File | Purpose | Canonical / Legacy | Status | Risk | Future action |
|------|---------|--------------------|--------|------|---------------|
| `index.html` | Shell + nav + views | Mixed | Cache `main.js?v=7.25` | Lifecycle screens beside Assets/DC/Projects | IA redesign (later) |
| `js/main.js` | View switch, APP_VIEWS | Mixed | Live | `APP_VIEWS` has Products/POs/Receipts/Sets; **no reservations/conversions views** | Add lifecycle IA |
| `js/products.js` | Product table + detail + link wizard | Canonical, incomplete | List limit 200; link-existing only | Missing from-catalog create button | UX |
| `js/purchase-orders.js` | PO mirror list/import/refresh/receive | Canonical | Empty in prod (0 POs) | Import will fail until scope | Leave; ops first |
| `js/receipts.js` | Receipt Note UI | Canonical | Works against local/fixture PO | Not the centre of operator day | UX |
| `js/kitSets.js` | Canonical Set UI + legacy Manual Review | Canonical + quarantine | Live | Name still `kitSets.js` | Leave engine UI; rename later |
| `js/conversions.js` | Convert / return panels on Asset & Inventory | Canonical, hidden | No nav item | Operators will not find it | Surface in lifecycle IA |
| `js/inventory.js` | Inventory grid + **catalog instantiate** | Legacy physical create | GAP-105 | Catalog → `POST /api/inventory/items` | Contain |
| `js/dashboard.js` | Assets workspace, split, make-set, catalog | Legacy-heavy | Live | Split + make-set still wired | Contain |
| `js/projects.js` | Projects; **Create/Edit PO removed** (Part 1 cleanup); still has make-set + split | Mixed | Banner: POs live in Zoho | Residual make-set/split | Contain remaining mutators |
| `js/asset-view.js` | Public/operator asset page | Legacy | **LEGACY: Push to Zoho CRM** | Loop risk (GAP-101 family) | Contain push |
| `js/lifecycle-model.js` | Asset status model (In Store / Project / …) | Legacy lifecycle | Parallel to new engines | Two “lifecycle” vocabularies | Do not merge casually |
| Hidden nav | Sheet, Consignments, Rentals, Scanner, OCR | Deferred / unused | Hidden | — | Leave |

## 1.6 Auth / integrations

- JWT cookie (`httpOnly`) + `authenticateJWT` + `authorizeRoles('superuser','admin','manager')` on canonical **mutations**.
- Many legacy routes are JWT-only or **unauthenticated** (DC, quotas, some settings). Do not assume “logged-in UI” = “API protected.”
- Zoho: FileStore `zoho_tokens.txt` (gitignored). Scopes: `products.ALL`, `deals.READ`, `settings.fields.READ`, `settings.modules.READ`. **Do not change.**
- No background worker for procurement refresh; operator-triggered import/refresh only.

---

# PART 2 — DATABASE INVENTORY

Live production `asset_manager`, read-only, 31 August 2026. Public schema ~73 tables.

## 2.1 Census (production)

| Table / slice | Count | Notes |
|---------------|------:|-------|
| `product` | 203 | Origins: ZOHO ~200, plus ASSET / ASSETENGINE / SET |
| `product_external_ref` | 203 | Strict 1:1 |
| `zoho_catalog` | 204 | Includes quarantined `ZP-SAMPLE-0001`; GAP-108 page-1 cap |
| `assets` | 4 | Protected IDs in this set |
| `inventory_items` | 2 | |
| `reservation` | 0 | Engine unused in prod |
| `conversion*` | 0 | |
| `managed_sets` | 10 | 6 ACTIVE, 3 ARCHIVED, 1 DISBANDED |
| `set_requirement` | 3 | Only canonical Set(s) |
| `managed_set_components` | 12 | 1 active, 11 inactive |
| `receipt_note` | 1 | Phase 7 leftover / probe — not a live PO mirror receive |
| `procurement_po` | **0** | Golden path commercially empty |
| `project_orders` | 2 | Legacy local POs |
| `asset_history` | 25 | |
| `zoho_sync_logs` | 18 | |
| `quotes` | 0 | Unused |

Canonical Set with Product: `SET-0826-RHDPGL-K` / `PRD-0826-LKJBZ7-A` (Phase 8 close-out). The other nine `managed_sets` have **null** `product_id` and are `LEGACY_MANAGED` when requirement count is 0.

## 2.2 Canonical tables (KEEP)

`product`, `product_external_ref`, `product_name_conflict`, `reservation`, `reservation_event`, `conversion`, `conversion_line`, `conversion_event`, `managed_sets` (v2 engine columns), `set_requirement`, `managed_set_components`, `set_event`, `set_idempotency`, `receipt_note`, `receipt_note_line`, `receipt_event`, `receipt_physical_output`, `receipt_idempotency`, `receipt_projection_outbox`, `procurement_po`, `procurement_po_line`, `procurement_po_external_ref`, `procurement_sync_event`, `quantity_events`, `physical_marking`.

Prompt alias `receipt_line` = live table **`receipt_note_line`**.

## 2.3 Legacy / overloaded / unused

| Object | Role | Duplicate / overload | Future |
|--------|------|----------------------|--------|
| `project_orders` / `project_order_items` | Legacy local PO | Parallel to `procurement_po*` | Do not rewrite; contained create/edit |
| `assets.parentid` | Split lineage **and** legacy Set membership **and** sub-assembly | Canonical §13 forbids this collapse | Stop writing via make-set; do not migrate in this release |
| `assets.is_set` | Legacy set flag | Parallel to `managed_sets` | Stop writing |
| `assets.zoho_product_id` / `inventory_items.zoho_product_id` | Opposite causation (push vs instantiate) | GAP-105 / Product loop | Physical rows should use `product_id` |
| `assets.linked_po_item_id` | Old PO-item link | Receipt now uses `receipt_physical_output` | Leave column; stop new writes where possible |
| `managed_sets.zoho_product_id` | Pre-Phase-8 column | GAP-516 | Unused by commercialize; leave |
| `temp_assets` / `temporary_assets` | Intake before promote | Not conversion (OD-13) | Deferred |
| `quotes` | Empty | — | Leave |
| Abandoned migration `sets` table | Would collide conceptually with `managed_sets` | **Never apply** | |

Overloaded operational columns still in daily use: `assignedto`, `department`, `sentagainstdc`. Out of this release except where they collide with reservation (they still can: assignment vs `reservation` table).

---

# PART 3 — CANONICAL ENTITY MAP

| Entity | Identity | Purpose | Authoritative source | Editable? | Who edits | Lifecycle | Relationships | Legacy equivalents | UI | API |
|--------|----------|---------|----------------------|-----------|-----------|-----------|---------------|--------------------|----|-----|
| **Product** | `PRD-MMYY-XXXXXX-C` immutable | What it is; **no quantity** | AE `product` | Fields per ADR matrix | Logistics vs Sales **intended**; today manager PUT does both | ACTIVE / ARCHIVED | 1:1 `product_external_ref`; Set requirements; PO lines; RN lines | `zoho_catalog` row, `assets.zoho_product_id` | Products view | `/api/products*` |
| **Zoho Product mapping** | External Zoho ID + `PER-…` ref | Commercial twin | Zoho CRM Products; AE mapping table | Link/publish/refresh only | Manager+ | PULL / PUSH | Strict 1:1 | Catalog-only rows | Product detail; Inventory catalog | `/api/products/:id/external-refs`, publish, refresh, from-catalog |
| **Asset** | `TYPE-LOC-MMYY-RAND6-C` | Serialized / identified physical | AE `assets` | Status/assignment legacy UI | JWT (create weaker than engines) | In Store / Project / … | Optional `product_id`; reservation; set alloc; conversion | Temp assets, promoteToAsset | Assets / asset-view | `/api/assets*` |
| **Inventory** | Same modern ID family | Quantity-tracked bulk | AE `inventory_items` | Qty via engines | Manager+ on create | In Store / … | Optional `product_id` | Catalog instantiate | Inventory view | `/api/inventory/items*` |
| **Reservation** | `RSV-MMYY-XXXXXX-C` | Hold available qty/unit | AE `reservation` | Release/transfer | Manager+ | Active / released | Owner SET or other; holding Asset/Inv | `assignedto` | **None dedicated** | `/api/reservations*` |
| **Set** | `SET-MMYY-XXXXXX-C` (legacy rows also `SET-YYYYMMDD-hex`) | Requirement kit + allocations | AE `managed_sets` + requirements | Name/status; **requirements immutable after create** | Manager+ | DRAFT/ACTIVE/ARCHIVED/DISBANDED | Product optional; allocations | `parentid`/`is_set`, kitSet | Sets view | `/api/sets*` |
| **Set Requirement** | `REQ-…` | Immutable Product + qty | `set_requirement` | No | — | Frozen at create | Product | — | Set detail | create Set only |
| **Set Allocation** | `ALC-…` | Mutable physical hold | `managed_set_components` | Alloc/dealloc/replace | Manager+ | active flag | Asset or Inventory + reservation | parentid children | Set detail | `/api/sets/:id/allocations*` |
| **Conversion** | `CONV-…` **audit only** | Asset ↔ Inventory | `conversion*` | Not a holding | Manager+ | Posted | Lines + events | make-permanent is **not** conversion | Panels on Asset/Inv | `/api/conversions*` |
| **Break** | Child modern IDs | Split quantity / individualize | `breakService` + qty events | Irreversible except unsplit **legacy** | Manager+ | — | Parent/child lineage | `/api/quantity/split` 410; `/api/assets/split` live | Assets split UI | `/api/break`, still `/api/assets/split` |
| **Receipt Note** | `RN-…` | Logistics receiving | `receipt_note` | OPEN only | Manager+ | OPEN / POSTED / CANCELLED / REVERSED | PO context; lines; physical output | temp assets, link-po-item | Receipts view | `/api/receipt-notes*` |
| **Receipt Line** | `RNL-…` | Accepted/rejected/damaged vs ordered | `receipt_note_line` | OPEN | Manager+ | — | Product; PO line | — | Receipts | nested in RN |
| **Procurement PO** | `PPO-…` | **Mirror** of Zoho PO | `procurement_po` | Commercial fields **read-only** | Zoho owns mutate; AE import/refresh | CREATED/APPROVED/CANCELLED/… + sync status | Lines; external ref | `project_orders` | Purchase Orders view | `/api/procurement/pos*`, import/refresh |
| **Procurement PO Line** | `POL-…` | Ordered qty + Product | `procurement_po_line` | Read-only in AE | Zoho | Outstanding computed | Product mapping required to receive | `project_order_items` | PO detail | nested |

---

# PART 4 — QUANTITY MODEL AUDIT

**Locked equation (Phase 2 / 3):** for a quantity-tracked holding,

`quantity_total = quantity_available + quantity_reserved + (other represented non-available states the row is allowed to hold)`

Conversion removes quantity from the source holding (it is not “reserved”). Break reduces parent available/total per `breakService` conservation against `quantity_original` on the root.

Smoke-proven: reserve, allocate, break-vs-reserved, `ASSET_RESERVED`, mixed Asset+Inventory, over-complete Set, unreturned conversion block.

## 4.1 Writers classified

| Path | Fields | Class |
|------|--------|--------|
| `reservationService` | available, reserved | **CANONICAL / SAFE** |
| `breakService` | total, available, original/lineage | **CANONICAL / SAFE** |
| `conversionService` | total, available; blocks reserved | **CANONICAL / SAFE** |
| `setService` allocate | via reservation | **CANONICAL / SAFE** |
| `receiptService` post | creates holdings + qty | **CANONICAL / SAFE** |
| `POST /api/quantity/split` | — | **CONTAINED** 410 `LEGACY_QUANTITY_SPLIT_DISABLED` |
| `POST /api/assets/split` quantity mode | delegates to `breakService` then may auto-assign | **DANGEROUS wrapper** |
| `POST /api/assets/split` serial mode | custom insert | **LEGACY / DANGEROUS** |
| `POST /api/assets/unsplit` | reverses split | **LEGACY / DANGEROUS** |
| `POST /api/assets/make-set` | writes qty + `is_set` + `parentid` + `quantity_parent_id` | **DANGEROUS** |
| `POST /api/inventory/items` | client-supplied `quantity_*` | **DANGEROUS** (bypasses Receipt) |
| `POST /api/assets` | client-supplied qty | **DANGEROUS** (JWT only) |
| `promoteToAsset` / make-permanent | copies qty | **LEGACY** (not conversion) |
| Direct Knex in `server.js` assignment/DC | various | **LEGACY**; out of this release except collisions |

No separate `quantity_converted` column; conversion is an event + holding change. Do not add a fourth bucket without a migration ADR.

---

# PART 5 — PHYSICAL IDENTITY AUDIT

| ID | Format | Immutable? | Unique? | User-facing? | Notes |
|----|--------|------------|---------|--------------|-------|
| Asset / Inventory | `TYPE-LOC-MMYY-RAND6-C` (`generateModernAssetId`) | Yes after mint | Yes | **Yes** (QR, lists) | Keep |
| Product | `PRD-MMYY-XXXXXX-C` checksum | Yes | Yes | **Yes** | Keep |
| Reservation | `RSV-…` | Yes | Yes | System + future UI | Keep; show as hold reference |
| Conversion | `CONV-…` | Yes | Yes | **Audit / logger only** | Hide from primary operator chrome |
| Set | `SET-…` checksum (new) | Yes | Yes | **Yes** | Legacy hex dates still in prod |
| Requirement | `REQ-…` | Yes | Yes | Detail only | Keep |
| Allocation | `ALC-…` | Yes | Yes | Detail only | Keep |
| Receipt Note / Line | `RN-` / `RNL-` | Yes | Yes | **Yes** | Keep |
| Procurement PO / Line / Event | `PPO-` / `POL-` / `PSE-` | Yes | Yes | PO yes; PSE no | Keep |
| Mapping ref | `PER-YYYYMMDD-hex` | Yes | Yes | System | Keep |
| Legacy split | `{parentId}-{n}` / timestamp tails | Fragile | Collision risk | Visible | **Stop minting** |

Checksum family: weights `[1,5,7,11,13,17]` mod 36 — do not change.

---

# PART 6 — PRODUCT AUDIT

**Creation:** `POST /api/products` (origin `ASSETENGINE`); `POST /api/products/from-catalog` (origin `ZOHO`); Set commercialize (origin `SET`); Phase 1 backfill origin `ZOHO`/`ASSET`.

**Pull does not create Product.** Catalog pull → `zoho_catalog` only. Explicit link/create required. **Do not change this rule.**

**Field ownership (ADR matrix, still the target):**

| Field | Owner | Sales see | Sales edit today | Logistics edit today |
|-------|-------|-----------|------------------|----------------------|
| Make / Model / HSN / Unit / Category-kind | Logistics | Yes | **No** (403 on PUT) | Yes (same PUT as price/name) |
| Description | AE | Yes | No | Yes |
| Price | Contested / manual | Yes | No | Yes — **no commercial-only path** |
| SKU / product_code | Optional, non-identity | Yes | No | Yes; Zoho refresh fills only if AE SKU NULL |
| Name | Co-managed; refresh merge | Yes | No | Yes |
| Origin / origin_ref / id | Immutable | Yes | No | No |

**UI contradictions:** Products table is the Product entity (correct) but operators expect new Zoho rows there after “Sync catalog” (wrong). Unlinked catalog lives under Inventory → Zoho Reference Catalog. List `limit=200` of 203. No from-catalog **create** button; link-existing wizard exists. Inventory picker still instantiates from `zoho_catalog` (GAP-105). Asset view still **pushes Asset → Zoho Product** (`/api/zoho/sync-asset/:id`).

**GAP-108:** catalog pull `totalFound: 200`; page-1 churn leaves stale Zoho IDs in cache.

---

# PART 7 — PROCUREMENT AUDIT

Locked Phase 9:

- **Zoho owns** CREATE / REVISE / APPROVE / CANCEL.
- **AE owns** VIEW / IMPORT / REFRESH / RECEIVE.
- **P9-CREATE = no.** `POST /api/projects/:id/orders` → 409 `LOCAL_PO_CREATE_CONTAINED`. `PUT /api/orders/:orderId` → 409 `LOCAL_PO_EDIT_CONTAINED` (**dead code after `return`** — leftover, not a second writer).
- New tables `procurement_po*` — **not** a rewrite of `project_orders`.

**Implemented:** import, refresh, preview, scope check, Product mapping on lines, cancelled PO, revision → `RECONCILIATION_REQUIRED`, outstanding vs accepted, receipt eligibility. **Fixture-proven on scratch.**

**Not live in production:** `procurement_po` = 0. Zoho PO GET = **`BLOCKED_BY_SCOPE`**. This is an **ops/OAuth** gate, not a missing service. **Do not add scopes from this audit.**

Set shortfall does **not** auto-create a PO (correct). Procurement is a human/Zoho step.

---

# PART 8 — RECEIPT NOTE AUDIT

Chain: PO (mirror or legacy local context) → PO line → Receipt Note → accepted / rejected / damaged → **post** → Asset and/or Inventory via `receipt_physical_output`.

| Rule | Implementation |
|------|----------------|
| No physical create on OPEN | Yes |
| Post creates holdings | Yes |
| Over-receipt | Reject `OVER_RECEIPT` |
| Cancelled PO | Cannot receive |
| Revision | `RECONCILIATION_REQUIRED` |
| Reverse | `NOT_REVERSIBLE` when qty moved |
| No auto reservation | Yes |
| No auto Set allocate | Yes |
| Idempotency | `receipt_idempotency` |
| Projection | Outbox; **do not publish stock qty** |

**Bypass still live:** `POST /api/inventory/items` and `POST /api/assets` and catalog picker and temp-asset promote. Production inventory currently small; the **code path** is the hole, not the row count.

UI: Receipts view exists; receiving is also launched from PO detail. Not the default operator home.

---

# PART 9 — SET AUDIT

Canonical: create with **immutable Product requirements** → allocate Asset/Inventory (creates reservation) → completeness = required − allocated (OVERCOMPLETE allowed) → dealloc/replace → disband releases **this Set’s** reservations only → optional commercialize → Product origin SET → explicit Zoho publish.

| Feature | Status |
|---------|--------|
| Requirements immutable | Implemented |
| Alloc / dealloc / replace | Smoke-proven |
| Completeness / OVERCOMPLETE | Smoke-proven |
| Commercialize | Smoke-proven |
| Disassemble / Absorb (Subset / Super Set) | **notImplemented** — **deferred** |
| Legacy managed sets | Listed as Manual Review; cannot alloc/disband via engine |

Production: 1 Product-backed Set; 9 without requirements. Dual model is **data + kitSetService**, not a missing engine.

---

# PART 10 — RESERVATION AUDIT

Engine complete. Whole Asset vs requested Inventory quantity. Blocks break/convert of reserved qty (`ASSET_RESERVED`). Set allocation is the primary owner in the golden path.

**UI: missing.** Operators reserve only as a side effect of Set allocate, or via raw API. `assignedto` / project assignment still looks like “reserved” in Assets UI — **misleading**.

---

# PART 11 — CONVERSION AUDIT

Engine complete. Return disposition ADR-CONVERSION-001 in canonical §42. `make-permanent` is **not** conversion.

**Test Q (locked, not a defect):** converting part of one Inventory row then allocating the remainder as mixed Set = `UNRETURNED_CONVERSION`. Mixed Sets need **independent** Asset + Inventory holdings.

CONV- IDs should stay in history drawers, not primary lists.

---

# PART 12 — BREAK / LEGACY AUDIT

| Route | Status |
|-------|--------|
| `POST /api/break` | Canonical |
| `POST /api/quantity/split` | **410 KEEP** |
| `POST /api/assets/split` | **LIVE** — quantity mode calls `breakService` then may assign/project |
| `POST /api/assets/unsplit` | **LIVE** |
| `POST /api/assets/make-set` | **LIVE**, JWT only, writes `parentid`/`is_set` | **P0** |
| UI Make Set (dashboard + projects) | **LIVE** | **P0** |

Break HTTP 400 vs conflict 409 is inconsistent in places (UX polish, not conservation).

---

# PART 13 — PO / RECEIPT / PHYSICAL CROSS-MODULE

**Intended:** Set shortfall → human creates Zoho PO → AE import → RN → post → physical → **explicit** Set allocate.

**Actual production:** Products exist; Sets mostly legacy; **zero** procurement POs; one Receipt Note not on the new PO table; Assets/Inventory still creatable from catalog/forms.

**Never automatic:** PO ↛ RN, RN ↛ reservation, RN ↛ Set, PO ↛ Set.

---

# PART 14 — AUTHORIZATION AUDIT

| Surface | Auth today | Gap |
|---------|------------|-----|
| Canonical mutations (Product, Set, Break, Reservation, Conversion, RN, PO import) | JWT + manager/admin/superuser | Sales/user **403** (smoke) |
| Canonical GET lists | JWT | Unauthenticated **401** |
| `POST /api/assets/make-set` | JWT **only** | Sales can hit if logged in |
| `POST /api/assets` | JWT **only** | Same |
| Product PUT | Manager+; **all UPDATE_FIELDS** | No Sales-safe name/SKU vs Logistics make/model |
| DC / some settings | Weak / none | Out of this release but real |
| Public asset view | Intentional | Must not gain mutators |

Field-level Product matrix is **documented, not enforced**.

---

# PART 15 — HISTORY / AUDIT TRAIL

Reconstructable on scratch for the golden path (smoke). Writers: `asset_history`, `quantity_events`, `inventory_quantity_events`, `reservation_event`, `conversion_event`, `set_event`, `receipt_event`, `procurement_sync_event`, `zoho_sync_logs`.

**UI:** quantity-history modal exists; no single “lifecycle timeline” across Product → PO → RN → physical → Set. Operators cannot tell a story without SQL or multiple screens.

---

# PART 16 — ERROR / EXCEPTION MODEL

Canonical services use `httpError` + `reasonCode` (409 business, 400 validation, 404 missing, 401/403 auth). Examples: `OVER_RECEIPT`, `NOT_REVERSIBLE`, `RECONCILIATION_REQUIRED`, `PRODUCT_MAPPING_REQUIRED`, `LOCAL_PO_*`, `LEGACY_QUANTITY_SPLIT_DISABLED`, `UNRETURNED_CONVERSION`, `ASSET_RESERVED`, `BLOCKED_BY_SCOPE`, `INELIGIBLE`.

**Gaps:** many `server.js` legacy routes return 500 strings; split/make-set lack the same reasonCode vocabulary; frontend often `showToast` of `error` only. Break 400 vs 409 inconsistency.

---

# PART 17 — UI / UX AUDIT (current)

**What exists:** Assets (home), Inventory, Sets, Receipts, Purchase Orders, Products, ARRI, Create DC, Projects, Warranty, plus hidden modules. PO banner: “Purchase Orders are created and managed in Zoho.” View/Import/Refresh present. Set cards distinguish Manual Review. Conversion attached to Asset/Inventory. Products is a table.

**What is missing:** Reservations as a place; Conversion as a step; Catalog → Product create; unlinked catalog on Products; lifecycle progress (need → ordered → received → allocated); completeness as a warehouse job, not only a chip; role-specific chrome (Sales vs Logistics).

**Misleading:** Assets home implies Assets **are** the system of record for “what we have.” Catalog looks like a product master. Projects still feels like procurement. Make Set looks like the Set product. Push to Zoho looks like commercial publish.

**Cache:** `main.js?v=7.25` — remember to bump on UI work.

---

# PART 18 — NEW UI/UX INFORMATION ARCHITECTURE (proposed, not built)

Primary operator IA for **this** release (not Projects/DC/Rentals):

1. **Catalogue** — Products (AE) + unlinked Zoho cache + mapping health  
2. **Buy** — Purchase Orders (mirror only)  
3. **Receive** — Receipt Notes  
4. **Stock** — Assets and Inventory as **physical holdings**, not the product master  
5. **Reserve** — holds (filter by Set / Project later)  
6. **Assemble** — Sets (requirements, allocation, completeness)  
7. **History** — one timeline per ID  

Keep Assets grid for power users; **stop** making it the default mental model. Hide or quarantine: Make Set, Split/Unsplit, catalog-instantiate, Push Asset to Zoho, Create PO on Projects (already contained).

---

# PART 19 — LIFECYCLE-DRIVEN UI (proposed screens)

| Screen | Job | Primary objects | Hidden from daily chrome |
|--------|-----|-----------------|--------------------------|
| Product workspace | Define / map / refresh | Product, mapping, catalog | CONV-, PSE- |
| Need / shortfall | From Set completeness | Set, REQ, Product | — |
| PO workspace | Import / refresh / eligibility | PPO, POL | Commercial create |
| Receipt workspace | Count / accept / post | RN, RNL | Reverse (admin) |
| Holding sheet | Find physical ID | Asset, Inventory, QR | Internal qty columns optional |
| Reservation board | See holds | RSV | — |
| Set board | Allocate to completeness | SET, ALC | Disassemble/Absorb |
| Audit drawer | Reconstruct | events | Raw table names |

---

# PART 20 — USER MENTAL MODEL

**Target sentence:** “We buy a **Product** on a **Zoho PO**, **receive** it here, then **hold**, **reserve**, and **put it in a Set**.”

**Today’s sentence:** “We live in **Assets**, sometimes Inventory, sometimes we Make a Set, and Zoho is a catalog over there.”

Until IA matches the first sentence, engines will be unused or bypassed.

---

# PART 21 — UI STATE MODEL (proposed)

Derive chrome from **server state**, not parallel JS flags:

- Product: ACTIVE / ARCHIVED / mapping SYNCED|UNLINKED|CONFLICT  
- PO: commercial status + sync status + outstanding  
- RN: OPEN / POSTED / CANCELLED / REVERSED  
- Holding: available / reserved / assigned (legacy) — **label reserved from `reservation`**  
- Set: status × completeness × engine (CANONICAL vs LEGACY_MANAGED)

Do not invent a second status enum in the frontend.

---

# PART 22 — OPERATOR WORKFLOWS (target)

1. Logistics creates/links Product (or Sales requests name; Logistics owns make/model).  
2. Warehouse sees Set shortfall.  
3. Purchasing creates/revises PO **in Zoho**.  
4. Logistics **imports** PO, maps any unmapped lines.  
5. Dock **opens Receipt**, counts, posts accepted.  
6. Physical IDs / QR appear.  
7. Optional reserve; **allocate to Set**; completeness updates.  
8. History answers “why is this here?”

Today steps 3–4 are blocked in production by scope; step 5 can still be bypassed; step 7 has UI only on Sets.

---

# PART 23 — CROSS-MODULE UX

Need deep links: Product → open POs → RN → holdings → reservations → Sets. Reverse: scan QR → holding → Product → open RN. None of this is first-class today (PO → Receipt is the only deliberate jump).

---

# PART 24 — SEARCH / FILTER / REPORTING

Lists are local `q` + limit 200. No cross-entity search. No “outstanding on order” dashboard. No mapping-health home (exists as APIs/scripts). **P2** after containment and IA.

---

# PART 25 — MOBILE / RESPONSIVE

Desktop-first tables and sidebars. Receiving and allocation will fail in a warehouse-on-phone shape. **P2/P3** — do not block engine containment.

---

# PART 26 — ACCESSIBILITY

Toasts, icon nav, colour chips, little keyboard support. **P3** for this release unless a legal requirement is stated.

---

# PART 27 — LEGACY UI DEBT (lifecycle-adjacent)

Must contain before calling the UI “the new lifecycle”: Make Set modals (`dashboard.js`, `projects.js`), Split UI (`dashboard.js`, `projects.js`), Inventory from catalog (`inventory.js`), Zoho Reference Catalog as instantiate source, Asset “Push to Zoho”, Projects as PO home (create already removed), `is_set` chrome, temp-asset promote as if it were receiving.

Leave unrelated: ARRI, OCR, scanner, sheet, employees, warranty, recovery centre, RBAC admin — except auth hardening if they stay public.

---

# PART 28 — TECHNICAL READINESS

| Area | Ready? |
|------|--------|
| Engines 1–9 | **Yes** (scratch 79/79) |
| IDs | **Yes** (checksum family) |
| Migrations applied | **Yes** (except abandoned 24 Aug file — stay that way) |
| `server.js` size / dual routes | **No** — containment still required |
| Catalog pagination | **No** (GAP-108) |
| Live Zoho PO | **No** (scope) |
| Tests in CI | Verify **scripts**, not a full automated CI matrix for all 79 |
| Observability | `zoho_sync_logs` + reasonCodes; no product APM |

---

# PART 29 — PRODUCTION READINESS

| Gate | Result |
|------|--------|
| Core lifecycle smoke | **PASS** scratch; prod delta **0** |
| Protected IDs | Untouched |
| Live PO mirror | **Empty** |
| Zoho PO | **BLOCKED_BY_SCOPE** |
| Dual physical-create | **Open** |
| Operator login-through of new screens | Cookie-walled in automation; structurally present |
| BRD file in repo | **Missing** |

**Verdict:** CONDITIONALLY READY — engines yes; production operator use **no**.

---

# PART 30 — REMAINING WORK

## Current State (one line each)

| Area | State |
|------|--------|
| Product engine | Done |
| Product UI / catalog / field auth | Partial |
| Quantity engine | Done |
| Identity | Done (legacy split IDs still mintable) |
| Reservation engine | Done |
| Reservation UI | Missing |
| Conversion engine | Done |
| Conversion UX | Buried |
| Break engine | Done |
| Legacy split/make-set | **Live dangerous** |
| Set engine | Done |
| Set production data | Mostly legacy |
| Receipt engine | Done |
| Receipt as only physical birth | **Bypassed** |
| Procurement engine | Done |
| Live Zoho PO | **Blocked** |
| UI IA | Not started |
| Phase 10 | **Not started — do not start** |

## Backlog (priority, not phase numbers)

**P0 — safety (contain, do not redesign):** disable or 409 `make-set`; stop Split/Unsplit UI or force `/api/break` only; reject catalog/`ZohoProductId` physical create; 409 or auth-align `POST /api/assets` with Receipt rule; contain Asset→Zoho push.

**P0 — ops (not code):** Zoho PO OAuth scope on TEST then production, re-consent. Out of this document’s implementation.

**P1 — UX that unblocks the golden path:** Products from-catalog + pagination honesty; PO/Receipt as default inbound path; Set board as assembly; hide CONV-; Reservations at least a filter on Set/holding.

**P1 — Product field/auth:** split PUT or role-field matrix.

**P2:** GAP-108 catalog pages; history timeline; search; dead-code after LOCAL_PO return; `APP_VIEWS` completeness.

**P3:** retire kitSet/parentid/is_set; Subset/Super Set; CI packaging of smoke.

---

# PART 31 — IMPLEMENTATION ORDER

Order by: **1. safety 2. dependency 3. user experience 4. minimal duplicate work 5. low rollback risk.**

1. **Contain leftover mutators** (`make-set`, split/unsplit as public Break bypass, catalog physical create, Asset push). Rollback = revert 409/410.  
2. **Ops: Zoho PO scopes** (human/OAuth). Code already waits on `BLOCKED_BY_SCOPE`.  
3. **Lifecycle IA** (nav + defaults) without rewriting engines.  
4. **Product catalog UX + field/auth** (depends on Product engine already there).  
5. **Live import** of one TEST PO, then production import — only after (2).  
6. **Receiving UX** polish on the existing Receipts view.  
7. **Reservation visibility + Set allocation polish.**  
8. **History / search.**  
9. **Later:** retire kitSet/`parentid` (high data risk; not required to *use* the engine).

Do **not** implement Customer PO, Work Orders, Projects/DC/Rentals, Subset, Super Set, or Phase 10 in this sequence.

---

# PART 32 — DO NOT TOUCH

Already correct — leave unless a later, scoped defect is proven:

- `productService`, `reservationService`, `conversionService`, `breakService`, `legacyBreakContainment`, `setService` (except notImplemented Subset/Super Set), `receiptService` over-receipt/cancel/recon/reverse rules, `procurementService` / `zohoProcurementService` (no local create), `zohoProductFields`
- Checksum ID generators (`PRD`/`RSV`/`CONV`/`SET`/`REQ`/`ALC`/`RN`/`RNL`/`PPO`/`POL`/`PSE`)
- 410 `LEGACY_QUANTITY_SPLIT_DISABLED` and 409 `LOCAL_PO_CREATE_CONTAINED` / `LOCAL_PO_EDIT_CONTAINED`
- Conservation checks in reservation / break / conversion / set allocate
- Set requirement immutability
- Strict 1:1 Product ↔ Zoho mapping
- Pull-does-not-auto-create-Product
- Abandoned migration `20260824120000_create_managed_sets_tables.js` (stay unapplied)
- OAuth token files, `.env`, production compose/ports, protected asset IDs
- Projects / DC / Rentals modules (deferred)

---

# PART 33 — TEST STRATEGY

Keep **scratch DB** smokes (`final-lifecycle-smoke.js` and phase verifiers). Never point them at production write.

Minimum before calling a containment slice done:

- Existing 79-path still green on scratch  
- Contained route returns 409/410 with reasonCode  
- Sales 403 on canonical mutations  
- Protected prod IDs unchanged  
- One authenticated click-path for the screens actually changed  

Do not replace engine tests with UI-only tests.

---

# PART 34 — FINAL GOLDEN PATH

The locked path (unchanged):

1. Product  
2. Zoho Product mapping where applicable  
3. Set requirement (immutable)  
4. Procurement need (human / Zoho, not auto)  
5. Zoho-owned outbound PO  
6. AE import / mirror  
7. Receipt Note  
8. Accepted stock  
9. Asset / Inventory  
10. Reservation  
11. Set allocation  
12. Completeness  
13. History reconstructable  

**Code can walk this on scratch. Production cannot complete steps 5–6 until PO scope exists. Steps 8–9 can still be skipped via legacy create.**

---

# PART 35 — BRD ALIGNMENT

**Source of truth used:** Phase 8/9 plans + Zoho Product sync audit + production Zoho module status. **Word BRD not in tree.**

| BRD / plan boundary | AE today |
|---------------------|----------|
| Zoho = commercial; AE = physical | **Aligned in engines**; UI still mixes them |
| Zoho Products catalogue; AE Product 1:1 | **Aligned**; pull ≠ auto-create |
| Zoho owns PO mutate; AE mirrors | **Aligned in code**; **blocked live by scope** |
| Do not publish stock qty to Zoho | **Aligned** (OD-12 closed No) |
| Do not duplicate Quotes/SO/Invoice/Vendor master | **Aligned** (absent / deferred) |
| Deals → Projects | Code exists, **unsafe/unused**; out of this release |
| Custom modules in BRD | Cannot verify without the docx |

**Alignment: YES at architecture/engine layer; NO at live commercial PO and operator UX.** Missing BRD file is a documentation gap, not a licence to invent Zoho modules.

---

# PART 36 — ADR / ARCHITECTURE CHECK

| ADR / lock | Still valid? | Drift |
|------------|--------------|-------|
| Canonical §1 Zoho vs AE | Yes | UI + legacy asset push |
| ADR-PRODUCT-001–017 | Implemented | Field-level auth not coded |
| Phase 2 conservation | Yes | Legacy writers remain |
| Phase 3 reservation | Yes | No UI; `assignedto` competes |
| ADR-CONVERSION-001 | Yes | make-permanent still exists |
| Phase 5 containment | Partial | split/unsplit/make-set not fully contained |
| Phase 6 requirement immutability | Yes | Dual Set rows in prod |
| Phase 7 Receipt as birth | Partial | GAP-105 bypass |
| Phase 8 1:1 + pull cache-only | Yes | GAP-108; missing create-from-catalog UI |
| Phase 9 P9-CREATE=no | Yes | Live import empty / scoped out |
| Canonical Subset/Super Set | Deferred | `notImplemented` — correct |

No new ADRs required to **contain** leftover mutators. New ADRs only if someone proposes auto-create Product on pull, AE-created commercial POs, or collapsing reservation into `assignedto`.

---

# PART 37 — FINAL ANSWER

## EXECUTIVE VERDICT

AssetEngine’s **core lifecycle engines are in place and proven on scratch**. The product is **not** operator-production-ready for that lifecycle until leftover physical mutators are contained, Zoho PO READ is enabled by **ops**, and the UI is rearranged around Product → PO → Receive → Hold → Set instead of Assets-first tables.

## CURRENT STATE

Phases 1–9: **implemented**. Production: Products mapped; Sets mostly legacy; **0** procurement POs; Receipt engine idle relative to Zoho POs; 4 assets / 2 inventory. Smoke 79/79. Phase 10: **not started**.

## PRODUCTION READINESS

**CONDITIONALLY READY.** Ready as a platform to build the operator experience on. **Not ready** as the daily warehouse/purchasing system.

## TOP 10 remaining issues

1. Zoho PO OAuth scope (`BLOCKED_BY_SCOPE`); live mirror empty  
2. `POST /api/assets/make-set` + UI still writes `parentid`/`is_set`  
3. Inventory/Asset create bypasses Receipt (GAP-105), including catalog picker  
4. `POST /api/assets/split` and `/unsplit` still live  
5. UI Assets-first, not lifecycle-first; no Reservations place  
6. Product list 200, no from-catalog create, catalog pagination GAP-108  
7. Product PUT not field-split; `make-set`/`POST /api/assets` weaker auth  
8. Dual Set model in production data (9/10 without requirements)  
9. Legacy Asset → Zoho Product push still in asset-view  
10. No cross-entity history/search for the golden path  

## TOP 10 remaining UI problems

1. Home = Assets, not inbound/set work  
2. Catalog confused with Product master  
3. Missing Create Product from catalog  
4. Missing Reservations nav  
5. Conversion buried  
6. Make Set looks official  
7. Split looks like Break  
8. Projects still smells like procurement despite banner  
9. Completeness not a job queue  
10. CONV- and internal IDs in operator chrome  

## TOP 10 remaining legacy problems

1. make-set  
2. split/unsplit  
3. catalog instantiate  
4. `parentid` / `is_set`  
5. `assets.zoho_product_id` vs `product_id`  
6. kitSetService dual API  
7. `project_orders` coexistence (contained, still present)  
8. promote/make-permanent  
9. Asset Zoho push  
10. Abandoned `sets` migration file (process hazard)

## IMPLEMENTATION ORDER

Contain mutators → ops PO scope → lifecycle IA → Product UX/auth → live import → receiving UX → reservation/set polish → history/search → later retire kitSet/parentid.

## BRD ALIGNMENT

**Engines aligned** with the Zoho-commercial / AE-physical boundary in Phase 8–9 docs. **Live PO and UI not aligned.** Word BRD not found.

## FINAL GOLDEN PATH

Product → (optional Zoho map) → Set requirements → Zoho PO → AE import → Receipt → accepted Asset/Inventory → Reservation → Set allocation → completeness → history.

## DO NOT TOUCH

Listed in Part 32. Especially: engines 1–9, checksum IDs, contained 409/410 routes, 1:1 mapping, pull≠create Product, OAuth/tokens/prod config, abandoned 24 Aug migration, protected IDs.

## DEFERRED FUTURE SCOPE

Projects, DC lifecycle, Rentals, Customer PO, Work Orders, Vendor master, Subset, Super Set, full disposition, major unrelated legacy cleanup, Phase 10.

---

## Master area table

| Area | Exists? | Canonical? | Production-ready? | Remaining work | Priority |
|------|---------|------------|-------------------|----------------|----------|
| Product engine | Yes | Yes | Engine yes | Field auth, list cap | P1 |
| Product UI | Partial | Partial | No | From-catalog, catalog honesty | P1 |
| Zoho Product mapping | Yes | Yes | Partial (GAP-108) | Pagination; hide asset push | P1/P2 |
| Quantity engine | Yes | Yes | Engine yes | Stop legacy writers | P0 |
| Physical identity | Yes | Yes | Yes if no split suffixes | Stop split IDs | P0 |
| Reservation engine | Yes | Yes | Engine yes | UI | P1 |
| Conversion engine | Yes | Yes | Engine yes | UX placement | P2 |
| Break | Yes | Yes | Engine yes | Contain split/unsplit | P0 |
| Set engine | Yes | Yes | Engine yes | Prod data mostly legacy | P2 data |
| Receipt engine | Yes | Yes | Engine yes | Make it the only birth | P0 |
| Procurement engine | Yes | Yes | Code yes, live no | Ops scope + import | P0 ops |
| Auth (route) | Yes | Partial | Partial | make-set/assets; field matrix | P0/P1 |
| History | Yes in DB | Yes | Weak UI | Timeline | P2 |
| UI IA | No | No | No | Lifecycle nav | P1 |
| Projects/DC/Rentals | Legacy yes | No | N/A | **Deferred** | — |
| Phase 10 | No | — | — | **Do not start** | — |

---

*End of audit. No implementation follows from this file until a separate, scoped task is approved.*
