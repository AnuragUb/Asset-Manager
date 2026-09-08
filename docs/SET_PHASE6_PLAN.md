# Phase 6 — Set Engine Plan

**Status:** PLAN ONLY. No code written. No migration created. No schema applied. No production mutation. No Set created, allocated, reserved, disbanded, disassembled or absorbed. No Project, DC, Zoho or OAuth change.  
**Date:** 28 August 2026  
**Scope:** Design the canonical AssetEngine Set Engine on top of Phase 1 (Product), Phase 2 (Quantity / Physical Identity / Break), Phase 3 (Reservation), Phase 4 (Conversion) and Phase 5 (Legacy Break containment).  
**Environment audited:** Source in this repository after Phases 1–5. Production database `asset_manager` as last verified 28 August 2026 (4 assets, 1 inventory item, 7 managed sets, 12 components, 0 SET-owned reservations). No Set mutation was executed for this plan.

**This document authorizes no implementation.**

---

## Authoritative inputs

- `docs/ASSETENGINE_CANONICAL_ARCHITECTURE.md` (revision 3; §2, §13–§21, §29–§30, §33, §36 rules 31–51, §40 OD-05/06/07/14)
- `docs/ARCHITECTURE_GAP_ANALYSIS.md` (GAP-202–204, GAP-401, GAP-501–517; several GAP-2xx rows are **stale** after Phase 3)
- `docs/PRODUCT_ARCHITECTURE_DECISION.md` / `docs/PRODUCT_PHASE1_IMPLEMENTATION_PLAN.md`
- `docs/QUANTITY_PHYSICAL_IDENTITY_PHASE2_PLAN.md`
- `docs/RESERVATION_PHASE3_PLAN.md` (owner type `SET` already in the ledger)
- `docs/CONVERSION_PHASE4_PLAN.md`
- `docs/PHASE5_LEGACY_BREAK_CUTOVER_PLAN.md`
- `docs/ASSETENGINE_COMPLETE_ARCHITECTURE_AUDIT.md` (26 Aug map; Product / reservation / conversion / Phase 5 findings in that file are **stale**)
- Live source: `kitSetService.js`, `reservationService.js`, `breakService.js`, `conversionService.js`, `productService.js`, `IdGenerator.js`, `server.js` (`/api/managed-sets`, `/api/assets/make-set`, `/api/assets/break-set`), `kitSets.js`, `index.html` `#sets-view`
- Live schema: `migrations/20260825120000_create_managed_sets_v2.js` (applied). Abandoned `20260824120000_create_managed_sets_tables.js` **must never** be applied via `migrate:latest`.

**Facts the gap analysis is stale on:**

| Gap | Status after Phases 3–5 |
|---|---|
| GAP-201 “no reservation representation” | **Closed.** `reservation` + `reservation_event` + `quantity_reserved` exist. Owner type `SET` is already legal. |
| GAP-206 / GAP-207 / quantity-split | **Contained by Phase 5.** Canonical Break is `breakService`. `/api/quantity/split` is 410. |
| GAP-404 “Make Individual does not exist” | **Closed by Phase 2.** |

**Facts that are not stale:** GAP-202 (Managed Set add reserves nothing), GAP-401 (`parentid` overload), GAP-501–508, GAP-515 (legacy + managed merged in one list).

**Ambiguities resolved by canonical revision 2** (do not re-open as contradictions):

| Ambiguity | Resolution |
|---|---|
| AMB-01 SET ADD/REMOVE vs immutability | ADD/REMOVE are **allocation** operations. Requirements are immutable. |
| AMB-02 Super Set double-count | Absorption uses reservation **TRANSFER**, never release-and-recreate. |
| AMB-03 leaving ACTIVE | DISASSEMBLE / ABSORB / DISBAND. Archive is not a staging area for Subsets. |

---

## 1. Executive summary

A Set is an **operational composition**. It is not an Asset, not Inventory, not a Product, not a Project, not a location, and not a reservation ledger.

The engine has two mandatory layers that must never be collapsed:

```
REQUIREMENT LAYER (immutable after create)
  Product + quantity + unit

ALLOCATION LAYER (mutable warehouse events)
  Asset OR Inventory quantity that satisfies a specific requirement
       ↓
  reservationService  (the only reserved/available math)
```

Today production has **two incompatible Set systems** and **neither is the canonical engine**:

| System | What it actually is | What it is not |
|---|---|---|
| **Legacy Set-as-Asset** | `assets.is_set=1` + `parentid` children; recursive status; Make Set / Break Set; optional price rollup | Not Product requirements. Not reservations. Overloads `parentid` with Break/subassembly. |
| **Managed Sets** | `managed_sets` + `managed_set_components` physical membership | No requirement layer. No completeness. No history. No reservation. Archive empties membership. |

Phase 6 must **consume** Product, quantity, reservation, Break and Conversion. It must **not** recreate them.

**Phase 6 implementation scope (when later approved):**

- Canonical create (immediately ACTIVE, requirements frozen, no auto Product)
- Allocate / deallocate / physical substitute against a requirement
- Completeness computed from linked allocations
- Disband (release **this Set’s** reservations only)
- Archive as freeze, distinct from disband
- Append-only Set history
- JWT Logistics authorization
- Scratch tests covering the 52 cases in §40

**Explicitly out of Phase 6 implementation:** Zoho, Set→Product commercialization UI, Subset/disassemble execution, Super Set/absorb execution, Receipt Note, Projects, DC, QR, serial redesign. Schema **must** support Subset and Super Set so those operations are not a rewrite later.

**Do not auto-migrate** the 7 production Managed Sets. They have no requirements, almost no active allocations, and the one active Inventory membership has **no reservation**. Classify, quarantine, review.

---

## 2. Set definition

A Set answers two questions that must remain separate:

1. **What must it contain?** — Product requirements with quantities and units.  
2. **What currently satisfies that?** — allocated Assets and/or Inventory quantities.

A Set:

- has a permanent, immutable Set ID
- becomes **ACTIVE** at creation
- may exist with **zero allocations** (completeness EMPTY is valid)
- may mix Asset and Inventory allocations
- never converts an Asset into Inventory or vice versa by being a Set
- is not inherently a Product
- cannot be deleted by ordinary business operations

SET ADD = **ALLOCATE**. SET REMOVE = **DEALLOCATE**. Neither mutates requirements.

If the commercial definition changes:

```
OLD SET → DISBAND / ARCHIVE → NEW SET with new requirements
```

The old Set remains permanently queryable.

---

## 3. Requirement layer

The requirement layer answers: **“What must this Set contain?”**

Identity of a requirement is **`product_id`**. Never Asset name, Inventory name, Make/Model, SKU, Zoho Product ID, or `parentid`.

Example:

```
CAMERA KIT
  Camera   Product PRD-…  × 1  unit
  Lens     Product PRD-…  × 2  unit
  Battery  Product PRD-…  × 10 unit
```

**Locked after Set creation.** No operator, API or SQL-from-app path may change Product, quantity or unit on an existing requirement. Frontend disabling is not sufficient.

If Lens ×2 must become Lens ×3: disband/archive the Set and create a new one.

**Create-time rules:**

- At least one requirement is required to create a Set (a Set with no definition is not a Set).
- `product_id` NOT NULL, FK to `product(id)` ON DELETE RESTRICT.
- Quantity `numeric(18,6)` **> 0**, same family as reservation / Phase 2.
- Unit copied from `product.unit` at creation and **stored on the requirement** so later Product unit edits cannot rewrite history.
- **One requirement row per Product per Set** — `UNIQUE (set_id, product_id)`. Duplicate Product at create is **rejected**, not silently merged.
- Sequence / `sort_order` is display-only and may be set only at insert.

**Deletion:** requirement rows are never deleted. Disband/archive leave them in place.

---

## 4. Allocation layer

The allocation layer answers: **“Which physical Asset or Inventory quantity currently satisfies which requirement?”**

```
Requirement REQ-001  Lens × 2
  AST-001  → REQ-001
  AST-003  → REQ-001
```

Allocations may change without changing the requirement. That is a warehouse event.

**Existing `managed_set_components` is the closest table.** It already:

- XOR Asset vs Inventory
- Asset quantity = 1
- Inventory quantity > 0
- global unique active Asset
- per-Set unique active Inventory row
- deactivate-not-delete (`is_active`)
- ON DELETE RESTRICT

It currently **lacks**: `requirement_id`, `reservation_id`, `released_at` / `released_by`, Product match, availability check, history.

**Recommendation:** keep the table; **extend** it. Do not drop or rename it in Phase 6. Do not auto-fill `requirement_id` on the 12 existing rows.

Every **new** active allocation must:

1. reference exactly one `set_requirement`
2. match that requirement’s `product_id`
3. hold a corresponding ACTIVE `reservation` (`owner_type='SET'`, `owner_id=set_id`)
4. agree with that reservation’s quantity

No active allocation without a reservation (except classified **legacy** rows until reviewed — see §8 and §35).

---

## 5. Product relationship

```
Requirement.product_id  →  product.id   (identity)
Allocation              →  assets.product_id or inventory_items.product_id
                           MUST equal requirement.product_id
```

Never use Make/Model/SKU/Zoho ID as the requirement key.

**A Set is not a Product.** `product.origin` already permits `'SET'` and `origin_ref` for a Set ID (`migrations/20260827120000_create_product_foundation.js`). That is the future commercialization slot. Phase 6 must **not** write it.

`managed_sets.zoho_product_id` is a leftover slot (GAP-516). All 7 production values are NULL. **Do not** use it as the commercialization path. Future link is:

```
Set → explicit Commercialize → product (origin=SET, origin_ref=set_id)
    → explicit Publish → product_external_ref → Zoho Product
```

Zoho Product Description is a **human-readable projection** of immutable requirements (Make / Model / Description per line). It is never read back to reconstruct the Set.

Allocation changes must not modify a Set-derived Product.

---

## 6. Current legacy Set audit

Legacy system: **Set-as-Asset**.

| Mechanism | Location | Behaviour | Disposition |
|---|---|---|---|
| `assets.is_set` | schema + UI checkbox | Marks an **Asset row** as a kit container | **QUARANTINE**. Do not use as canonical Set. |
| `inventory_items.is_set` | inventory create/update | Same flag on Inventory | **QUARANTINE**. |
| `assets.parentid` | make-set / break-set / split / subassembly | Overloaded: kit membership **and** split **and** subassembly | **KEEP column. NEVER use as new Set hierarchy (OD-14).** |
| `POST /api/assets/make-set` | `server.js` ~6882, JWT | Sets `is_set=1` on parent; writes `parentid` on children; may **split quantity** into `{id}-S{timestamp}` writing **both** `quantity_parent_id` and `parentid` (hybrid Break+Set) | **KEEP** as legacy. **QUARANTINE** from new engine. Do not route through `setService`. |
| `POST /api/assets/break-set` | `server.js` ~7081, JWT | Clears `parentid`; may `promoteToAsset` for No-QR components | **KEEP** as legacy. |
| Recursive `updateAssetStatus` down `parentid` | `server.js` ~440–484 | Status walks whatever `parentid` means, including split edges (GAP-401) | **KEEP** until OD-14. New Sets **must not** participate. |
| `set_price_mode` / SUM_OF_CHILDREN | asset edit | Price rollup for box-sets | **LEAVE**. New engine does not roll up price. |
| Dashboard / Projects Make Set, Break from Set, SET badge | `dashboard.js`, `projects.js`, `asset-view.js` | Operator tools on **assets** | **KEEP** for legacy Asset kits. Do not retarget to Managed Sets in Phase 6. |
| `POST /api/zoho/sync-asset/:id` “Superset (Box Set)” | `server.js` ~2697 | Pushes a **legacy asset** as a Zoho Product | **QUARANTINE**. Do not extend. Do not change `zohoService.js`. |
| List merge `legacy:` prefix | `kitSetService.listSets` / `getSet` | Presents `is_set=1` assets as Sets via `parentid` children (GAP-515) | **SHIM then REMOVE LATER** from the canonical list. Legacy kits stay on Assets UI. |

Production legacy row: `HAR-MUM-0826-IEIZP5-U` has `is_set=1`, **no children**, no Product. Classify **LEGACY**. Do not migrate into `managed_sets`.

Production `APP-MUM-0526-MMKBX9-W`.`parentid` → `HAR-MUM-0726-55QOFA-R` is **Phase 5 LEGACY/SUBASSEMBLY**, not a Set. **Do not reinterpret.**

---

## 7. Current managed Set audit

Applied schema: `20260825120000_create_managed_sets_v2.js`.

### 7.1 `managed_sets`

| Column | Live | Notes |
|---|---|---|
| `id` | PK string | Generated `SET-YYYYMMDD-HEX` via `kitSetService.newId` (crypto). **Not** checksum family. |
| `set_code` | UNIQUE NOT NULL | Often equals `id`; **mutable** via PUT |
| `name`, `description` | | Mutable via PUT |
| `status` | CHECK `DRAFT\|ACTIVE\|ARCHIVED`, default **DRAFT** | Service writes **ACTIVE** (GAP-510). Production **0 DRAFT**. |
| `zoho_product_id` | nullable, partial unique | Unused, all NULL |
| `created_by`, `updated_by`, timestamps, `archived_at` | | Archive consistency CHECK |

**Missing:** `product_id`, `source_set_id`, `absorbed_into_set_id`, requirement table, event table.

### 7.2 `managed_set_components`

XOR Asset/Inventory. Asset qty must be 1. Inventory qty integer > 0. Soft-deactivate. FKs RESTRICT.

Indexes:

- **Global** unique active `asset_id` (one Asset, one active Set) — correct for leaf allocation; **blocks naive Super Set flattening** (GAP-505).
- **Per-set** unique active `(set_id, inventory_item_id)` — same Inventory may appear in many Sets (GAP-204: no qty sum).

**Missing:** `requirement_id`, `reservation_id`, `released_at`, `created_by`, Product snapshot.

### 7.3 Service behaviour (`kitSetService.js`)

| Operation | Behaviour | Disposition |
|---|---|---|
| `createSet` | ACTIVE, name only, **no requirements**, no Product | **REPLACE** by `setService.create` |
| `updateSet` | Mutates name, description, **set_code** | **SHIM**: name/description only if OD-06 allows; freeze `set_code` |
| `addComponent` | Membership only. No Product check. No availability. **No reservation** (GAP-202/203) | **REPLACE** with allocate |
| `removeComponent` | `is_active=false`. No reservation release | **REPLACE** with deallocate |
| `archiveSet` | Status ARCHIVED **and deactivates all active components** (GAP-508) | **REPLACE**. Must not be the reservation-release path |
| `restoreSet` | ACTIVE again; **does not** reactivate components (GAP-508) | **REMOVE LATER** (one-way archive) |
| `computeComposition` | EMPTY/MIXED/ASSET/INVENTORY from kinds present (GAP-503) | **KEEP** as composition only. Completeness is separate. |
| `listEligibleAssets` | Not deleted, not already in an active Set. **Ignores** project, DC, assignment, repair, Product, reservation (GAP-509) | **REPLACE** with `reservationService` eligibility + Product match |
| `listEligibleInventory` | Not deleted. Does not compare requested qty to available | **REPLACE** |
| `attachManagedSetToAssets/Inventory` | Badge on list APIs | **KEEP** once allocation is reservation-backed |
| `newId` | `SET-YYYYMMDD-HEX` / `CMP-YYYYMMDD-HEX` | **REPLACE** generator for **new** rows; do not rewrite existing IDs |

### 7.4 Routes (`server.js` ~2794–2887)

JWT on all. Mutations: `superuser` / `admin` / `manager`.

`GET/POST /api/managed-sets`, `GET/PUT /api/managed-sets/:id`, components POST/DELETE, archive, restore, eligible-assets, eligible-inventory.

**Disposition:** **QUARANTINE** writes once `setService` exists. Prefer **new** `/api/sets*` for the canonical engine so the list no longer mixes `legacy:` IDs.

### 7.5 UI (`kitSets.js` + `#sets-view`)

Create name only. Add/remove physical members. Composition filter. Archive/restore. **No requirement pane. No completeness. No substitution as a first-class action. No history.**

**Disposition:** **REPLACE** the interior of the existing Sets view. Keep the nav, toolbar, cards, modals, toasts, “Raul” visual language.

---

## 8. Production Set inventory

Verified 28 August 2026 against production `asset_manager` (same counts as `ARCHITECTURE_GAP_ANALYSIS.md` §0.3 and the Phase 6 live inspection). **Not mutated.**

### 8.1 Managed Sets — 7 rows

| id | set_code | name | status |
|---|---|---|---|
| SET-20260825-0582C6 | TEST-MANAGED-SET-001 | Managed Set Integration Test | ACTIVE |
| SET-20260825-D2168F | TEST-MANAGED-SET-002 | Managed Set Conflict Test | ARCHIVED |
| SET-20260825-FB075C | 4536 | Sample test | ACTIVE |
| SET-20260825-4AC944 | TEST-MANAGED-SET-UI-003 | UI Verification Set | ACTIVE |
| SET-20260825-21D1C2 | SET-20260825-21D1C2 | Testg | ACTIVE |
| SET-20260825-2877F5 | SET-20260825-2877F5 | TEST-SET-UIUX-004 | ARCHIVED |
| SET-20260825-6DFCCF | SET-20260825-6DFCCF | Transponders | ACTIVE |

- 5 ACTIVE, 2 ARCHIVED, **0 DRAFT**
- All `zoho_product_id` NULL
- **No requirement rows** (table does not exist)
- **0** reservations with `owner_type='SET'`
- **0** conversions

IDs are `SET-YYYYMMDD-HEX`, **not** `SET-MMYY-XXXXXX-C`.

### 8.2 Components — 12 rows

- **1 active:** `CMP-20260825-8BA1B8` on `SET-20260825-0582C6` → Inventory `MIS-MUM-0826-H4XVLL-W` qty **1**
- **11 inactive:** 8 ASSET + 3 INVENTORY (HAR, APP MacBooks, IEIZP5, MIS qty 1 or 2)

`MIS-MUM-0826-H4XVLL-W`: total 3, available **1**, **no `product_id`**, `is_set=0`. Set claims qty 1 **without a reservation**, so Available is **not** reduced. That is GAP-202 in live data.

### 8.3 Legacy assets

| Asset | Flags | Classification |
|---|---|---|
| `HAR-MUM-0826-IEIZP5-U` | `is_set=1`, no children, no Product | **LEGACY** kit flag, empty |
| `APP-MUM-0526-MMKBX9-W` | `parentid` → HAR, on Project `MUM-0526-664651-P` | Phase 5 **LEGACY/SUBASSEMBLY**. Not a Set. |
| `APP-MUM-0526-PZ2J6E-8` | no parentid | Ordinary asset |
| `HAR-MUM-0726-55QOFA-R` | Product `PRD-0826-W3TB7U-Z`, quantity root, not `is_set` | Ordinary asset; historically inactive Set member |

### 8.4 Classification buckets (no migration)

| Bucket | What |
|---|---|
| **CAN MIGRATE** | **None** today. Cannot invent requirements from membership. MIS has no Product. |
| **LEGACY** | IEIZP5 `is_set=1`. APP→HAR `parentid`. |
| **AMBIGUOUS** | All 7 `managed_sets` (test names, no requirements, no Product on the only live member). |
| **ORPHANED** | 11 inactive components (membership history without actor/reason/requirement). |
| **MANUAL REVIEW** | The 1 active MIS component **before** any reservation backfill (would change Available 1 → 0). |

Names strongly indicate **test/integration fixtures**, not operational kits. Do not auto-migrate. Do not silently reserve `MIS` qty 1.

---

## 9. Proposed Set schema

Keep `managed_sets` / `managed_set_components`. Additive only. Named migration later (never `migrate:latest` while `20260824120000` remains).

### 9.1 `managed_sets` — additive columns

| Column | Type | Purpose |
|---|---|---|
| `source_set_id` | nullable FK → `managed_sets.id` RESTRICT | Subset lineage (disassembly source). Canonical `parent_set_id` synonym. **One column.** |
| `absorbed_into_set_id` | nullable FK → `managed_sets.id` RESTRICT | Super Set absorption target |
| `product_id` | nullable FK → `product.id` RESTRICT | Explicit commercialization only. Default NULL. |
| `created_by` | already exists | |

**Status CHECK** (later): `ACTIVE | DISBANDED | ABSORBED | ARCHIVED`. Keep `DRAFT` in the CHECK until confirmed 0 rows, then drop it from allowed values. **Never write DRAFT.**

Do **not** add `parent_set_id` and `super_set_id` as extra synonyms. Two FKs are the minimum hierarchy.

Do **not** put a `SET-MMYY-XXXXXX-C` CHECK on `id` — the 7 live IDs would fail. Enforce format in the **generator** for new rows only.

`set_code`: unique; **immutable after create** (service + trigger). Default = Set ID if omitted.

### 9.2 `set_requirement` — new

| Column | Rules |
|---|---|
| `id` PK | `REQ-MMYY-XXXXXX-C` |
| `set_id` | FK `managed_sets` RESTRICT, NOT NULL |
| `product_id` | FK `product` RESTRICT, NOT NULL |
| `quantity` | `numeric(18,6)` CHECK `> 0` |
| `unit` | text NOT NULL (copied from Product at insert) |
| `sort_order` | int NOT NULL default 0 |
| `created_at`, `created_by` | | 

- `UNIQUE (set_id, product_id)`
- **No `updated_at` used for mutation.** No application UPDATE/DELETE.
- Trigger: BEFORE UPDATE of `product_id`/`quantity`/`unit`/`set_id` → exception. BEFORE DELETE → exception.

### 9.3 `managed_set_components` — additive (allocation)

| Column | Rules |
|---|---|
| `requirement_id` | FK `set_requirement` RESTRICT. NULL allowed **only** for pre-engine rows |
| `reservation_id` | FK `reservation` RESTRICT. NULL allowed **only** for pre-engine rows |
| `released_at`, `released_by` | set on deallocate |
| `created_by` | |

Keep `is_active`. Deallocate sets `is_active=false` and `released_at`. **Never DELETE** allocation rows.

Quantity: prefer `numeric(18,6)` for new writes. Existing column is `integer`. Implementation may add `quantity_n numeric(18,6)` and backfill from `quantity`, or ALTER with care. Asset CHECK `quantity = 1` stays.

**New-row invariant (service + later CHECK once legacy classified):**

```
is_active = true  ⇒  requirement_id IS NOT NULL
                  AND reservation_id IS NOT NULL
```

Do **not** apply that CHECK while `CMP-20260825-8BA1B8` is still the unclassified active row.

### 9.4 `set_event` — new, append-only

Mirror `reservation_event`: bigserial PK, `set_id`, `type`, `actor`, `timestamp`, `note`, `metadata_json`. FK `set_id` RESTRICT. **No UPDATE/DELETE.** Optional `set_event_line` for per-requirement / per-allocation payloads if JSON is too opaque for queries; JSON is enough for Phase 6 if indexed by `set_id` + `timestamp`.

### 9.5 IDs

Reuse `IdGenerator` checksum family (`PRD` / `RSV` / `CONV`):

| Entity | Format | Payload |
|---|---|---|
| New Set | `SET-MMYY-XXXXXX-C` | `SET` + MMYY + XXXXXX |
| Requirement | `REQ-MMYY-XXXXXX-C` | `REQ` + … |
| New allocation | `ALC-MMYY-XXXXXX-C` | `ALC` + … |
| Event | serial (like `reservation_event`) | |

Do **not** reuse `generateModernAssetId` (embeds location/type). Do **not** reuse `kitSetService.newId` for new canonical rows. Existing `SET-20260825-*` and `CMP-20260825-*` stay as-is.

---

## 10. Requirement immutability

**Service:** `createSet` inserts requirements in the same transaction as the Set. No `updateRequirement`. No PATCH of quantity/Product. Create API accepts the full requirement list once.

**Database:** BEFORE UPDATE / BEFORE DELETE triggers on `set_requirement`. Application role is the same Postgres user as everything else, so triggers beat REVOKE.

**Do not** use append-only versioning of requirements. Canonical change of definition is a **new Set**, not a new version row. Versioning tables would invite “edit in place.”

**OD-06 (name/description):** recommend **allow** cosmetic `name` / `description` correction on ACTIVE Sets. **Forbid** changing `id`, `set_code`, requirements. Archived/disbanded/absorbed: name/description freeze as well (or allow description-only notes via events, not column edits).

---

## 11. Allocation model

Conceptual fields (mapped onto extended `managed_set_components`):

- `set_id`
- `component_type` ASSET | INVENTORY
- `asset_id` XOR `inventory_item_id`
- `quantity` (Asset = 1; Inventory = requested qty)
- `requirement_id` (`satisfies_requirement_id`)
- `reservation_id`
- `is_active`, `created_at`/`created_by`, `released_at`/`released_by`

**Linkage is mandatory for new allocations.** Completeness cannot be computed from membership count.

**Product match:** holding.`product_id` = requirement.`product_id`. Null Product on the holding → **reject** (same spirit as conversion C-1). No Make/Model fallback. No “operator thinks they are equivalent.”

**Domain:** Asset allocations satisfy a requirement with Assets; Inventory with Inventory. A requirement is not typed ASSET vs INVENTORY in the schema — eligibility is “this physical row’s Product matches, and the chosen domain is the one the operator picked.” A Camera requirement may be filled by Camera Assets; a Battery requirement by Battery Inventory. Mixing domains on **one** requirement is allowed only if both holdings share that Product (unusual; default UI offers one domain picker per allocate action).

**History:** inactive rows remain. Events record every allocate/deallocate. Point-in-time query:

```
created_at <= T  AND  (released_at IS NULL OR released_at > T)
```

plus `set_event` for actor/reason. Current `is_active` alone is **not** sufficient (GAP-507).

---

## 12. Reservation integration

The Set engine **must not** compute reserved or available quantity.

Owner type `SET` already exists. `assertOwnerExists` already looks up `managed_sets.id`. Asset reserve is whole-record. Inventory reserve is requested quantity with `FOR UPDATE`. `release({ quantity })` already supports **partial** Inventory release. `transfer()` already exists and **does not** change `quantity_reserved` on the holding.

### 12.1 ALLOCATE (atomic)

```
BEGIN
  lock holding (reservationService.lockHolding)
  load Set (must be ACTIVE)
  load requirement (set_id + requirement_id)
  verify holding.product_id = requirement.product_id
  verify domain XOR, qty rules, resource active / not converted-blocked
  reservationService.reserve({
    resourceType, resourceId, quantity,
    ownerType: 'SET', ownerId: setId,
    actor, reason, trx
  })
  INSERT allocation (requirement_id, reservation_id, is_active=true)
  INSERT set_event ALLOCATED
COMMIT
```

**Order is mandatory: reserve, then insert allocation.**

`assertAssetEligible` currently rejects `ASSET_IN_MANAGED_SET` if an active component row already exists. If allocation were inserted first, reserve would 409. Keep that guard as a second line of defence for **other** owners; Set allocate must reserve first.

### 12.2 DEALLOCATE (atomic)

```
BEGIN
  lock holding + allocation row
  reservationService.release({ id: allocation.reservation_id, quantity, trx })
    -- Inventory: partial or full; Asset: full only
  UPDATE allocation SET is_active=false, released_at, released_by
  INSERT set_event DEALLOCATED
COMMIT
```

Release **this allocation’s** reservation only.

### 12.3 Quantity agreement

`allocation.quantity` = `reservation.quantity` while both active. No allocation without reservation for new rows. No reservation owned by this Set without a matching active allocation (except a crash window inside a rolled-back transaction — there should be none after COMMIT).

If a reservation is RELEASED by a non-Set path, Set allocate/deallocate must not leave a dangling active allocation. Phase 6 should refuse foreign release of SET-owned reservations (reservation `reason_code` / owner check) or treat it as an invariant break. **Recommendation:** only `setService` releases SET-owned reservations.

### 12.4 Do not Set-local-math

No `kitSetService` updates of `quantity_available` / `quantity_reserved`.

---

## 13. Completeness

**Computed. Never stored as an editable status. Distinct from lifecycle status.**

Per requirement:

```
allocated_qty = SUM(active allocations.quantity WHERE requirement_id = R)
compare to R.quantity
  short | met | over
```

Set-level:

| Label | Rule |
|---|---|
| **EMPTY** | Zero active allocations |
| **INCOMPLETE** | At least one requirement is short (overage on another line does not promote the Set) |
| **COMPLETE** | Every requirement met, none over |
| **OVERCOMPLETE** | Every requirement at least met, and at least one over |

Reservation **alone** does not complete a Set. The allocation must carry `requirement_id`.

**OVERCOMPLETE is representable** (canonical examples). Default Phase 6 UI: **warn** on allocate that would overshoot; still allow so the four states remain reachable. Owner may later lock “reject overshoot.”

---

## 14. Composition

Keep existing `computeComposition`:

| Value | Meaning |
|---|---|
| EMPTY | No active physical rows |
| ASSET | Only Assets |
| INVENTORY | Only Inventory |
| MIXED | Both |

This is **kinds present**, not completeness. Completeness EMPTY and composition EMPTY coincide when there are no allocations; they diverge as soon as the vocabularies are mixed in filters. UI must show **both** dimensions with different labels (GAP-503).

Do not store composition.

---

## 15. Allocation / substitution

**SET ADD = ALLOCATE. SET REMOVE = DEALLOCATE.** Requirements unchanged.

**Physical substitution** (same requirement):

```
BEGIN
  deallocate old allocation (release its reservation)
  allocate new holding against the SAME requirement_id
  set_event SUBSTITUTED (or DEALLOCATED + ALLOCATED with substitution_group)
COMMIT
```

Product of the replacement must equal the requirement Product. No exception path.

**Product substitution:** forbidden. No API, no UI, no override flag.

---

## 16. Asset allocation

- Whole Asset. Quantity = 1. `reservationService` already rejects `ASSET_PARTIAL_NOT_ALLOWED`.
- One ACTIVE Asset reservation globally (partial unique index).
- One active Set allocation globally (existing unique index) — keep.
- Same Asset cannot be in two conflicting active Sets.
- Eligibility: `reservationService.assertAssetEligible` (deleted, retired, inactive lineage, blocked status, `assignedto`, `sentagainstdc`, project_assets, existing managed-set membership) **plus** Product match **plus** not a converted/blocked record (`conversionService.assertNoUnreturnedConversions` as consulted, not copied).

Do not duplicate those rules in `setService`.

---

## 17. Inventory allocation

- Quantity-specific. Requested qty ≤ currently available. Failure is total (no partial reserve) — already Phase 3.
- Same Inventory row **may** satisfy multiple Sets up to unreserved quantity. Do **not** duplicate Inventory rows. Keep per-set unique `(set_id, inventory_item_id)` so one Set has at most one active row per Inventory SKU; change quantity via deallocate+allocate or a controlled adjust that updates **both** allocation qty and reservation qty atomically.
- Example: Total 100, Set A reserves 4, Set B reserves 8 → Available 88.
- Allocation quantity must equal reservation quantity.

GAP-204 is closed **by the reservation ledger**, not by a new global unique on Inventory components.

---

## 18. Set creation

```
Operator:
  name (+ optional description, optional set_code)
  ADD REQUIREMENT (Product, quantity, unit preview from Product)
  Create

System:
  SET-MMYY-XXXXXX-C
  insert managed_sets status=ACTIVE
  insert all set_requirement rows
  set_event SET_CREATED + REQUIREMENT_CREATED
  no Product
  no allocation
  no reservation
  completeness EMPTY
```

No Draft. No allocation required. Empty allocation is valid.

Reject create with zero requirements, non-positive quantity, unknown/archived Product, or duplicate Product in the same list.

---

## 19. Set disband

```
ACTIVE → DISBANDED
```

Atomic:

```
BEGIN
  lock Set
  for each active allocation:
    release that SET-owned reservation
    inactivate allocation (released_at)
  status = DISBANDED
  set_event DISBANDED
COMMIT
```

**Releases only this Set’s reservations.** Does **not**:

- delete Assets or Inventory
- reset Projects, DC, `assignedto`, location, maintenance
- erase conversion / Break lineage
- mark physical records Available if other commitments remain
- delete the Set or its requirements

No automatic “restore from DISBANDED” that re-reserves. Need the kit again → **new Set**.

An ACTIVE Set cannot be disassembled or absorbed in the same operation as disband; those are distinct transitions.

---

## 20. Set archive

**Current production archive is the wrong concept** (GAP-508): it deactivates membership and restore does not put it back. That silently looks like disband without reservations.

**Canonical archive:** freeze a Set that is **not** an operational allocation holder.

**Recommendation:**

| | Disband | Archive |
|---|---|---|
| Purpose | Tear down operational hold | Freeze a historical / unused definition |
| Reservations | Released | Must already be none — **reject** archive if active SET reservations exist |
| Allocations | Inactivated as part of disband | Unchanged if already empty/inactive |
| Further allocate | No | No |
| Restore | No | **No** (remove restore from canonical UI) |
| Delete | No | No |

Do **not** archive-as-empty-membership as a substitute for disband.

If an operator archives an EMPTY ACTIVE Set (requirements only, never allocated): status ARCHIVED, requirements remain, completeness EMPTY, no reservation change.

---

## 21. Set history

Mandatory. Independent of current component rows.

**Phase 6 minimum event types:**

| Type | When |
|---|---|
| `SET_CREATED` | create |
| `REQUIREMENT_CREATED` | each requirement at create (or one event with lines) |
| `ALLOCATED` | allocate |
| `DEALLOCATED` | deallocate |
| `SUBSTITUTED` | physical replace (optional if A+D pair is linked) |
| `DISBANDED` | disband |
| `ARCHIVED` | archive |

**Schema-ready, not implemented in Phase 6 UI/API unless cheap:** `DISASSEMBLED`, `ABSORBED`, `RESERVATION_TRANSFERRED`, `COMMERCIALIZED`, `PRODUCT_PUBLISHED`.

Payload must include: Set ID, requirement id/Product, allocation id, physical resource type+id, quantity, actor, timestamp, reason, reservation id/operation.

No hard-delete of `set_event`. History survives disband, archive, absorption, disassembly, substitution.

**Point-in-time:** “What physical Asset was in this Set on 28 August 2026?” → allocation rows with `created_at`/`released_at` window **and** events. Dual store: current/inactive allocation row + event log.

---

## 22. Subset architecture

**Do not implement DISASSEMBLE in Phase 6.** Prove the schema.

```
ACTIVE SET
    ↓ DISASSEMBLE
SOURCE → DISBANDED (never deleted)
NEW SET(s) each:
  own SET-MMYY-XXXXXX-C
  own immutable requirements (partition / copy of source lines as operator specifies)
  own allocations
  own reservations
  source_set_id = source
```

An ACTIVE Set cannot “become” a Subset in place. Disassembly is the transition.

**Reservation:** source holds possibly several RSV rows. They must move to Subsets **without** a double-count window.

`reservationService.transfer()` moves a **whole** reservation to a new owner. It cannot split Inventory qty 10 into 4+6.

**Subset Inventory split needs a later primitive** (e.g. `splitTransfer` in `reservationService`): one locked transaction, source RSV → TRANSFERRED, N new ACTIVE RSV summing to the same quantity, holding `quantity_reserved` unchanged. **Do not** implement that in Set code. **Do not** fake it with release+reserve (forbidden window, even if “fast”).

Until that primitive exists, DISASSEMBLE of Inventory allocations is blocked. Schema still holds `source_set_id`.

---

## 23. Super Set architecture

**Do not implement ABSORB in Phase 6.** Prove the schema and the reservation sequence.

```
Set A, Set B  (must not stay ACTIVE as independent operators)
      ↓ ABSORB  (atomic)
Super Set (new SET-…, ACTIVE)
  source Sets: status ABSORBED, absorbed_into_set_id = Super Set
  never deleted
```

An ACTIVE Set cannot be used **directly** as a Super Set container without absorption. An ACTIVE Set cannot be disassembled and absorbed at once.

### 23.1 Do not flatten Assets into the Super Set

GAP-505: global unique active `asset_id` forbids copying leaf Assets onto the Super Set while source allocations remain active.

**Recommendation:** Super Set members are **Sets**, not a second copy of AST/INV rows. Physical allocations stay on absorbed leaf Sets (frozen). Reservations **transfer** to the Super Set as owner.

Completeness of the Super Set = aggregate of absorbed Sets’ requirement vs their frozen allocations (or a snapshot requirement list created at absorb by summing `product_id` quantities — owner decision, see §45). Do not re-insert `managed_set_components` Asset rows on the Super Set.

### 23.2 Reservation transfer sequence (design)

`transfer()` already: lock holding → mark old RSV TRANSFERRED → insert new RSV same quantity, new owner, `parent_reservation_id` → **holding reserved unchanged** → ledger assert.

```
BEGIN
  lock Super Set row + source Sets + all holdings
  verify sources ACTIVE, not already ABSORBED/DISBANDED
  verify not simultaneously targeted for DISASSEMBLE
  create Super Set (requirements snapshot if that decision is YES)
  for each ACTIVE reservation owner_type=SET owner_id in sources:
    reservationService.transfer({ id, ownerType:'SET', ownerId: superId, trx })
  UPDATE sources SET status=ABSORBED, absorbed_into_set_id=superId
  freeze source allocations (is_active stays as historical membership on the leaf;
    they are no longer independently mutable)
  set_event ABSORBED on sources, SET_CREATED on super, RESERVATION_TRANSFERRED
COMMIT
```

**Never** release then reserve. **Never** increment `quantity_reserved` again.

---

## 24. Set / Product commercialization

**Not implemented in Phase 6.** Boundary only.

```
Set (immutable requirements)
  ↓ explicit Commercialize
AssetEngine Product  origin=SET  origin_ref=set_id
  ↓ explicit Publish
Zoho Product   Description = human projection of requirements
```

- Do not create a Product at Set create.
- Do not publish to Zoho.
- Do not sync allocations to Zoho.
- Do not read Zoho Description back.
- Do not change `zohoService.js`.
- Do not write `managed_sets.zoho_product_id`.

**OD-05 Product versioning (recommendation, Phase 8 executes):**

If Set A (Camera ×1, Lens ×2) was commercialized to Product P-001, then disbanded, and Set B is created (Camera ×1, Lens ×3):

- **Default: create a new Product** when Set B is later commercialized.
- **Do not auto-reuse** P-001 because names look similar.
- Optional later UX: “link existing Product” only if requirement fingerprint (sorted `product_id`+qty+unit) is **identical**, and only by explicit operator choice.

Fingerprint helper can live in `setService` as a read-only hash; commercialization is still a later phase.

**OD-07:** a Set-derived Product **must not** be a requirement of another Set in Phase 6. Grouping is Super Set, not recursive commercial kits.

---

## 25. Legacy `parentid` isolation

Three systems remain separate:

1. Break / Conversion lineage — `quantity_parent_id` / `quantity_root_id` / conversion events  
2. Set composition / allocation — `managed_set_components`  
3. Set hierarchy — `source_set_id` / `absorbed_into_set_id`

**`assets.parentid` is none of these for the new engine.**

**OD-14 recommendation:** freeze the legacy `parentid` Set model **read-only**. Do not migrate APP→HAR. Do not migrate IEIZP5. Do not write `parentid` from `setService`. Phase 5 already protects the APP→HAR edge.

Make-set / break-set remain the legacy Asset-kit tools until a future retirement, not Phase 6.

---

## 26. Break interaction

Set allocation creates a reservation. Break consumes **available** quantity only (`breakService`).

```
Set allocation → reservation → Break of reserved qty → REJECT
```

Do **not** auto-deallocate to allow Break. Operator must deallocate (or a future explicit controlled workflow), then Break.

If Break is rejected, Set allocation is untouched.

Phase 5 inactivate of canonical children already refuses hard-delete. FK RESTRICT on `managed_set_components.asset_id` is a backstop (GAP-208).

---

## 27. Conversion interaction

Conversion already uses remaining **Available**. Reserved qty cannot convert (`RESERVED_QUANTITY_NOT_CONVERTIBLE` / insufficient available).

```
Inventory total 10, Set reserves 4, Available 6
Convert 7 → REJECT
Convert 6 → ALLOW
Set allocation untouched
```

An Asset allocated to a Set has an ACTIVE whole-record reservation; conversion/return of that Asset must fail eligibility until deallocate.

Do not change `conversionService.js` for Phase 6 unless a Set-specific error message is later desired. Accounting is already correct **once** the Set actually reserves.

Today’s MIS active component **does not reserve** — Conversion/Break of “available 1” can still consume the quantity the Set claims. That is a **go-live blocker** for the unclassified row, not a conversion bug.

---

## 28. Merge interaction

Generic merge / inactivate must not destroy Set relationships.

- Active allocation + reservation → inactivate/merge already 409s on ACTIVE reservation (Phase 5 / reservation).
- Legacy allocation **without** reservation → FK RESTRICT on delete; inactivate of the Asset could still proceed. Phase 6 allocate path must reserve; unclassified legacy rows need MANUAL REVIEW before merge.

Do not silently detach `managed_set_components` on merge. Do not DELETE allocation rows.

---

## 29. Project interaction

`reservationService.assertAssetEligible` already rejects `ASSET_ASSIGNED_TO_PROJECT`. Set allocate of a project-assigned Asset **fails** once it goes through reserve.

**Reverse path:** project assign does **not** currently consult reservations or Set membership (GAP-509). Once SET reservations exist, project assign of a reserved Asset should **409**. That is a **surgical eligibility check** on the existing assign path, not a Project redesign.

Disband does not unassign Projects.

Production: APP MacBook is on project `MUM-0526-664651-P` and was an **inactive** Set component — no current conflict. Do not “fix” that row.

---

## 30. DC interaction

`assertAssetEligible` already rejects `sentagainstdc`. Set allocate of a dispatched Asset fails.

Reverse: DC dispatch of a SET-reserved Asset should fail via reservation/availability. Do not redesign DC.

Disband does not clear DC.

---

## 31. UI architecture

Reuse `#sets-view`, toolbar, cards, existing buttons, bordered sections, confirmation modals, toasts. Do not redesign the application.

**Separate panes:**

```
CAMERA KIT    SET-0826-XXXXXX-C    ACTIVE    completeness COMPLETE    composition MIXED

REQUIREMENTS (frozen after create)
  Camera    1
  Lens      2
  Battery  10

ALLOCATION
  Camera    AST-001
  Lens      AST-002
            AST-003
  Battery   INV-001 × 10

  [Allocate]  [Replace]  [Remove]
```

No editor on requirement rows after create.

**Create UX:** name → add Product requirements (search `/api/products`, not Sales Zoho UI) → quantity/unit → Create → ACTIVE. Then Allocate from Asset or Inventory search (existing management pickers, tightened by eligibility).

**Asset allocate:** pick Asset → show Product, availability, reservation eligibility → ALLOCATE.

**Inventory allocate:** pick Inventory → show Total / Reserved / Available / Requested → ALLOCATE. Operator must see remaining Available.

**Replace allocation:** not “change requirement Product.” Pick replacement of the **same Product**.

**Disband confirm copy (locked):**

> This will release this Set’s reservations. It will NOT delete Assets or Inventory.

**Archive confirm:** freeze; no reservation release if any remain (rejected). Does not delete members.

**History UI (Phase 6):** created, requirements, allocations, substitutions, deallocations, disband, archive. Disassembly/absorption/commercialization can wait.

**Do not** add a Delete button.

Remove or hide Restore; it is a GAP-508 trap.

Composition filter may remain; add a completeness filter without overloading the same dropdown.

---

## 32. API proposal

New prefix **`/api/sets`** so canonical list is not mixed with `legacy:` (GAP-515). JWT on all. Mutations: `authorizeRoles('superuser','admin','manager')`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/sets` | Create ACTIVE Set + requirements |
| GET | `/api/sets` | List (managed canonical only; no `legacy:` merge) |
| GET | `/api/sets/:id` | Header + composition + completeness summary |
| GET | `/api/sets/:id/requirements` | Immutable requirements |
| POST | `/api/sets/:id/allocations` | Allocate (body: requirement_id, ASSET\|INVENTORY, id, qty) |
| DELETE | `/api/sets/:id/allocations/:allocationId` | Deallocate |
| POST | `/api/sets/:id/allocations/:allocationId/replace` | Physical substitution |
| GET | `/api/sets/:id/completeness` | EMPTY/INCOMPLETE/COMPLETE/OVERCOMPLETE + per-line |
| POST | `/api/sets/:id/disband` | Disband |
| POST | `/api/sets/:id/archive` | Archive if no active SET reservations |
| GET | `/api/sets/:id/history` | Events |
| GET | `/api/sets/:id/eligible-assets` | Product-filtered, reservation-eligible |
| GET | `/api/sets/:id/eligible-inventory` | Same for Inventory + available qty |

**Not implemented (501 if registered at all):**

- `POST /api/sets/:id/disassemble`
- `POST /api/sets/absorb`

**Idempotency:** header or body `idempotency_key` on allocate, deallocate, replace, disband, archive (conversion pattern).

**Quarantine `/api/managed-sets` mutations** once `/api/sets` is live (410 or proxy). Keep GET temporarily if old UI still points there. Do not keep `legacy:` merge on the new list.

---

## 33. Service architecture

New **`web-app/asset-manager-backend/services/setService.js`**.

Coordinates: Product lookup, requirement insert, allocation rows, **calls** `reservationService`, writes `set_event`.

**Must not implement:** reserved/available math, Break math, conversion, Product sync, Zoho, Project/DC ledgers.

`kitSetService.js`: **QUARANTINE**. Stop using it for new writes. Read helpers (`attachManagedSetToAssets`) can remain until they read reservation-backed allocations.

`reservationService.js`: already SET-capable. Possible later micro-adjustments (not in this planning task): refuse non-setService release of SET owners; `splitTransfer` for Subsets. Do not duplicate eligibility.

Pass `trx` into `reserve` / `release` / `transfer` (already supported) so Set operations are one transaction.

---

## 34. DB constraints

| Invariant | Enforcement |
|---|---|
| Set ID immutable | No UPDATE of `id`; no rewrite job |
| `set_code` immutable after insert | Trigger |
| Requirement Product NOT NULL | Column + FK |
| Requirement qty > 0 | CHECK |
| Requirement immutable | Triggers forbid UPDATE/DELETE |
| Allocation XOR Asset/Inventory | Existing CHECK |
| Allocation qty > 0 | Existing CHECK |
| Asset allocation qty = 1 | Existing CHECK |
| Inventory allocation qty > 0 | Existing CHECK |
| Active allocation ↔ requirement + reservation | Service now; CHECK after legacy classified |
| Allocation Product = requirement Product | Service; optional trigger joining holdings |
| No duplicate active Asset | Existing unique |
| One active Inventory row per Set per item | Existing unique |
| Lifecycle | Expand CHECK; no DRAFT writes |
| No DELETE of Set / requirement / event / allocation | No DELETE routes; FKs RESTRICT; triggers |
| Reservation consistency | `reservationService.assertLedgerMatchesCounter` inside trx |

Frontend checks are not sufficient.

---

## 35. Production migration strategy

**Do not migrate during planning. Do not migrate automatically at implementation start.**

### 35.1 Answers to the six questions

1. **Can existing `managed_sets` migrate directly?** Header rows can be **kept as IDs**. They cannot become canonical Sets without invented requirements. Bucket: **AMBIGUOUS / MANUAL REVIEW**.
2. **Can `managed_set_components` become allocation rows?** Structure yes (same table). They have **no `requirement_id` / `reservation_id`**. Do not backfill.
3. **Allocations with no requirement?** **All 12.**
4. **Legacy `parentid` / `is_set`?** IEIZP5 `is_set=1`; one APP→HAR `parentid`. **Do not migrate.**
5. **Incomplete history?** **All Sets.** No `set_event`. Inactive components are not history.
6. **Inactive components?** **11 of 12.** Keep rows. Do not reactivate.
7. **Reservation conflicts?** **0 SET reservations.** The active MIS qty 1 **conflicts with the new rule** (allocation without reservation) and with Available=1 (backfill would consume last available unit).

### 35.2 If a later named migration runs

```
pg_dump production
scratch restore
baseline: Sets, components, Assets, Inventory, Reservations, Projects, DC, Products, History
named migration only
NEVER migrate:latest while 20260824120000 exists
```

No reservation backfill without operator review of `CMP-20260825-8BA1B8`.

---

## 36. Compatibility strategy

```
Phase 6 ship
  canonical /api/sets + setService
  kitSetService writes quarantined
  make-set / break-set unchanged (legacy Asset kits)
  parentid / is_set unchanged
  list APIs stop advertising legacy: as Managed Sets
  existing 7 managed_sets remain readable, not silently upgraded
```

Feature flag optional; default must **not** enable destructive archive-emptying on the new path.

Coexistence: old UI talking to `/api/managed-sets` must not create more reservation-less memberships once the engine is on. Contain those POSTs.

---

## 37. Authorization

Set mutations: **JWT** + Logistics roles `superuser` / `admin` / `manager` (same as current Managed Sets and Product archive).

Unauthenticated → 401. Wrong role → 403.

**Sales** must not receive allocate/deallocate/disband merely because a future Set-derived Product appears in Zoho. Sales uses **Product**. Physical Set management is Logistics.

GET list/detail/history/completeness: JWT; same Logistics roles unless a later read-only Sales view of **commercialized Product** is designed (not Phase 6).

---

## 38. Concurrency

Reuse Phase 3 `FOR UPDATE` on the holding. No Set-specific lock table.

```
Inventory Available = 5
Set A allocates 4
Set B allocates 3
→ one COMMIT succeeds, one 409 QUANTITY_CONFLICT / insufficient available
```

Same for two Sets allocating the same Asset: unique reservation + unique active component.

Idempotent retries after success must not double-reserve (see §39).

---

## 39. Idempotency

Follow `conversionService` (`idempotency_key` unique).

| Operation | Key scopes |
|---|---|
| Allocate | set + requirement + resource + qty + key |
| Deallocate | allocation id + key |
| Substitute | old allocation + new resource + key |
| Disband / archive | set id + key |
| Disassemble / absorb | later |

Repeat click returns the original result, no second RSV/allocation.

---

## 40. Test strategy

Scratch database first. Do not use production.

**SET CREATION**  
1. Create Set  
2. Immediately ACTIVE  
3. Requirements immutable (API + expect DB trigger)  
4. No Product automatically created  

**REQUIREMENTS**  
5. Product requirement stored  
6. Quantity validation (>0)  
7. Duplicate Product rejected  
8. Requirement immutability (PATCH/DELETE fail)  

**ASSET ALLOCATION**  
9. Allocate Asset  
10. Whole-Asset reservation  
11. Duplicate Asset allocation rejected  
12. Incompatible Asset rejected (project/DC/assigned/wrong Product)  

**INVENTORY ALLOCATION**  
13. Partial Inventory quantity  
14. Two Sets sharing one Inventory row  
15. Insufficient quantity rejected (no partial)  
16. Available quantity correct after allocate  

**COMPLETENESS**  
17. EMPTY  18. INCOMPLETE  19. COMPLETE  20. OVERCOMPLETE  

**SUBSTITUTION**  
21. Physical substitution  
22. Old RSV released / new RSV created (or transfer if used)  
23. Requirement unchanged  

**DISBAND**  
24. This Set’s reservations released  
25. Physical records preserved  
26. Projects preserved  
27. Assignments preserved  
28. DC state preserved  

**BREAK**  
29. Reserved quantity cannot Break  
30. Allocation preserved if Break rejected  

**CONVERSION**  
31. Reserved Inventory cannot convert  
32. Remaining Available can convert  

**HISTORY**  
33. Create history  34. Allocation history  35. Substitution history  
36. Disband history  37. No history deletion  

**CONCURRENCY**  
38. Concurrent Inventory allocations  
39. Concurrent Asset allocation  

**IDEMPOTENCY**  
40. Duplicate allocate  41. Duplicate deallocate  

**SECURITY**  
42. Unauthenticated mutation 401  
43. Unauthorized role 403  

**LEGACY**  
44. Existing managed Sets unchanged before migration  
45. `parentid` unchanged  
46. Existing `is_set` unchanged  
47. No accidental legacy Set mutation  

**INTEGRATION**  
48. Product unchanged by Set create  
49. Reservation engine remains green  
50. Conversion remains green  
51. Break remains green  
52. Zoho unchanged (`zohoService.js` git-clean)  

---

## 41. Rollback

If a later implementation must roll back:

- Application: revert `setService` routes; re-enable quarantined `kitSetService` writes only if product-safe.
- Schema: `down()` of the named migration **refuses** if `set_requirement` / `set_event` / new FKs have rows (same pattern as reservation `down()`).
- Data: do not DELETE historical Sets. Rollback is “stop using the new API,” not erase.
- Production: restore from the pre-migration `pg_dump` if schema apply failed mid-way. Never `migrate:latest`.
- Reservations created by the engine: release via disband, not by dropping tables.

---

## 42. Exact files that would change

*(Implementation later. Not this task.)*

| File | Why |
|---|---|
| `web-app/asset-manager-backend/migrations/YYYYMMDDHHMMSS_set_engine_foundation.js` | Named additive migration |
| `web-app/asset-manager-backend/services/setService.js` | **New** domain service |
| `web-app/asset-manager-backend/IdGenerator.js` | `generateSetId` / `generateRequirementId` / `generateAllocationId` |
| `web-app/asset-manager-backend/server.js` | Register `/api/sets*`; quarantine managed-set writes |
| `web-app/asset-manager-backend/services/kitSetService.js` | Quarantine writes; stop `legacy:` merge on canonical list |
| `web-app/asset-manager-frontend/js/kitSets.js` | Requirements vs allocation UI |
| `web-app/asset-manager-frontend/index.html` | Completeness vs composition filters; copy |
| `web-app/asset-manager-frontend/static/style.css` | Only if existing Set styles need panes |
| `web-app/asset-manager-frontend/js/main.js` | Wire if needed |
| Optional later: project-assign eligibility | Surgical 409 if SET-reserved — **ask first** |
| `docs/README.md` / architecture nav | Index the plan **only if** a docs PR is requested |

Scratch verify script analogous to `reservation-phase3-verify.js` / `conversion-phase4-verify.js`.

---

## 43. Exact files that must NOT change

| File / area | Why |
|---|---|
| `zohoService.js` | Phase 6 non-goal |
| OAuth / `zoho_tokens*` / `.env` | Secrets and Zoho |
| `conversionService.js` | Already available-only; do not recreate |
| `breakService.js` | Already available-only |
| `productService.js` | No auto Product |
| `migrations/20260824120000_create_managed_sets_tables.js` | Abandoned; never apply |
| Production compose / ports / replication | Ops |
| `PROCESS_LOGIC.md` | Not a Set rewrite |
| Make-set / break-set bodies | Legacy quarantine, not a rewrite in this phase |
| `assets.parentid` / `is_set` data | OD-14 freeze |
| Project / DC modules as redesigns | Eligibility only, if ever |
| QR / serial / PO / GRN / Receipt Note / Rental | Non-goals |

---

## 44. Blockers

| # | Blocker | Effect |
|---|---|---|
| B1 | Active MIS component without reservation or Product | Cannot apply “active allocation ⇒ reservation” CHECK; Conversion/Break can still take Available 1 |
| B2 | All 7 Managed Sets lack requirements | Completeness not computable; no auto-migration |
| B3 | GAP-508 archive semantics vs canonical archive | Must replace behaviour; restore is unsafe |
| B4 | `assertAssetEligible` membership vs reserve-first order | Wrong order 409s; document and test |
| B5 | Abandoned migration still in tree | `migrate:latest` remains forbidden |
| B6 | Subset Inventory split | No `splitTransfer` primitive yet — blocks DISASSEMBLE implementation |
| B7 | GAP-505 if Super Set flattens Assets | Must use Set-of-Sets + transfer |
| B8 | Project assign ignores reservations | Reverse eligibility hole until a surgical guard |
| B9 | Physical rows without `product_id` | Cannot allocate under Product-match rule (MIS, IEIZP5, some APPs) |
| B10 | Dual Set UIs (legacy Make Set vs Managed Sets) | Terminology; do not merge lists |

None of these authorize production writes in this task.

---

## 45. Open decisions

| ID | Decision | Recommendation | Blocks |
|---|---|---|---|
| **OD-06** | May name/description be corrected? | **Yes** for ACTIVE Sets. Freeze id, set_code, requirements. | Create/update API |
| **OD-07** | May a Set-derived Product be a requirement of another Set? | **No** in Phase 6. Super Set groups Sets. | Requirement FK policy |
| **OD-05** | Successive commercialized Sets vs Product identity | **New Product by default**; explicit identical-fingerprint reuse only. Execute in Phase 8. | Commercialization |
| **OD-14** | Migrate vs freeze `parentid` Sets | **Freeze read-only.** Do not migrate APP→HAR or IEIZP5. | Hierarchy / list merge |
| **OD-16** | Approved workflows for Product↔physical link | Set allocate requires existing `product_id` on the holding. Creating that link is **not** a Set side-effect. | Allocation eligibility |
| **P6-A** | Reject vs allow OVERCOMPLETE allocate | **Allow + warn** so four completeness states exist. | Allocate validation |
| **P6-B** | Archive of EMPTY ACTIVE Set | **Allow** (freeze definition). Archive with live reservations **reject**. | Archive API |
| **P6-C** | Restore | **Remove** from canonical UI. | kitSets restore button |
| **P6-D** | Super Set requirement snapshot | **Yes:** sum source requirements by `product_id` at absorb, then freeze. Completeness walks frozen leaf allocations. | Super Set schema usage |
| **P6-E** | Mixed domain on one requirement | **Allow if Product matches**; UI still picks one domain per action. | Allocate |
| **P6-F** | Minimum requirements at create | **≥ 1** requirement. | Create |
| **P6-G** | `splitTransfer` for Subsets | **Later**, in `reservationService`, not Set math. | DISASSEMBLE |
| **P6-H** | Fate of 7 production Managed Sets | **MANUAL REVIEW.** Do not invent Products. Do not auto-reserve MIS. | Go-live CHECK |
| **P6-I** | New `/api/sets` vs evolve `/api/managed-sets` | **New `/api/sets`.** Quarantine old writes. | Routes / UI |

---

## Decision matrix

| Decision | Recommendation | Reason | Phase |
|---|---|---|---|
| Set definition immutability | Requirements immutable after create; DB trigger + no update API | Canonical §14.3; frontend disable is insufficient | 6 |
| Set creation lifecycle | Immediately ACTIVE; no Draft; allocations optional | Canonical §14.1; GAP-510 default DRAFT must not be written | 6 |
| Asset allocation | Whole record, qty 1, unique active membership | Canonical §14.7; existing unique index | 6 |
| Inventory allocation | Requested qty only; same row may serve many Sets | Canonical §14.7; reservation ledger closes GAP-204 | 6 |
| Partial Inventory allocation | Required; never reserve the whole row because it is in a Set | Canonical example Battery 4 of 20 | 6 |
| Asset reservation | `reservationService.reserve` whole Asset, owner SET | No Set-local math; unique ACTIVE Asset RSV already exists | 6 |
| Inventory reservation | `reservationService.reserve` requested qty, `FOR UPDATE` | Phase 3 | 6 |
| Allocation ↔ requirement linkage | `requirement_id` mandatory on new active rows | Completeness otherwise lies | 6 |
| Completeness | Computed EMPTY/INCOMPLETE/COMPLETE/OVERCOMPLETE from linked qty | Distinct from composition GAP-503 | 6 |
| Physical substitution | Deallocate + allocate same `requirement_id`, atomic | Canonical §16 | 6 |
| Product substitution | Forbidden; no override | Canonical §16 | 6 |
| Disband | Release this Set’s RSV only; keep physical/Project/DC/assignment | Canonical §17 | 6 |
| Archive | Freeze; reject if SET RSV still active; do not empty membership as disband | Fix GAP-508; not a Subset staging area | 6 |
| Set history | Append-only `set_event` + retain inactive allocations | GAP-507; point-in-time queries | 6 |
| Set deletion | No DELETE API or UI | Canonical §14.5; GAP-512 keep | 6 |
| Subset creation | Schema `source_set_id` now; DISASSEMBLE **not** implemented | Needs `splitTransfer` for Inventory | Schema 6 / exec later |
| Super Set absorption | Schema `absorbed_into_set_id`; Set-of-Sets; **not** implemented | GAP-505 if flattened; use `transfer()` | Schema 6 / exec later |
| Reservation transfer | Use existing `reservationService.transfer`; never release+recreate | Canonical §19.2; holding reserved unchanged | Super Set later |
| Break interaction | Reserved qty cannot Break; no auto-deallocate | Phase 2/5 + Phase 3 available-only | 6 |
| Conversion interaction | Reserved qty cannot convert; remaining Available can | Phase 4 already | 6 |
| Project interaction | Allocate uses existing project eligibility; reverse assign should 409 once reserved | Surgical, not a Project rewrite | 6 (+ optional assign guard) |
| DC interaction | Allocate uses `sentagainstdc`; disband does not clear DC | Existing eligibility | 6 |
| Set → Product commercialization | Explicit later; no auto Product; no Zoho | Canonical §21 | 8 |
| Product versioning | New Product for new Set unless operator reuses identical fingerprint | OD-05 | 8 |
| Legacy `managed_sets` migration | Classify; no auto-migrate; no silent MIS reserve | No requirements; test fixtures | 6 review |
| Legacy `parentid` handling | Freeze; never new hierarchy | OD-14; GAP-401; Phase 5 protection | 6 |
| Concurrency | Phase 3 holding locks only | One of 4+3 on Available 5 must fail | 6 |
| Idempotency | Conversion-style `idempotency_key` | Duplicate clicks must not double-RSV | 6 |
| Authorization | JWT + superuser/admin/manager; Sales excluded from operational Set controls | Logistics vs Sales boundary | 6 |

---

*End of Phase 6 Set Engine plan. This document authorizes no implementation, no migration, no production change, and no Zoho change.*
