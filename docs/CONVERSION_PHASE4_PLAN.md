# Conversion Foundation — Phase 4 Plan

**Status:** PROPOSED — awaiting approval. No code written. No migration created. No schema applied.  
**Date:** 28 August 2026  
**Scope:** First-class Asset ↔ Inventory conversion engine. Cross-domain physical lineage. Product preserved. Original Inventory retained.  
**Environment audited:** PRODUCTION source on this repository after Phase 1 (Product), Phase 2 (quantity / Break / QR), and Phase 3 (reservation). Production database `asset_manager`, app `asset-manager-prod` `:8080`. The 9090 test instance was not used.

**Authoritative inputs**

- `docs/ASSETENGINE_CANONICAL_ARCHITECTURE.md` (§7.1–7.2, §9–12, §28–30, §32.7, §33 Phase 4, §36 rules 19–24, OD-10 / OD-13)
- `docs/ARCHITECTURE_GAP_ANALYSIS.md` (GAP-301–304, GAP-209, GAP-152, UNMAPPED-01, UNMAPPED-10)
- `docs/PRODUCT_PHASE1_IMPLEMENTATION_PLAN.md` and `docs/PRODUCT_ARCHITECTURE_DECISION.md` (`product_id` is the conversion invariant)
- `docs/QUANTITY_PHYSICAL_IDENTITY_PHASE2_PLAN.md` (Model B conservation; CONVERTED deferred; B-5 no `quantity_converted`)
- `docs/RESERVATION_PHASE3_PLAN.md` (§12 conversion interaction; locked eligibility and locking model)
- `docs/ASSETENGINE_COMPLETE_ARCHITECTURE_AUDIT.md` (temporary-asset / `promoteToAsset` precedent)
- Live `server.js`, `breakService.js`, `reservationService.js`, `productService.js`, `inventoryMovementService.js`, `lifecycleModel.js`, `inventoryEventSystem.js`, `IdGenerator.js` as of this date

**Locked business model in this brief overrides older wording where they conflict.** In particular: partial Inventory conversion is allowed; operator chooses GROUPED vs INDIVIDUAL; return is always to the original Inventory lineage; reserved quantity is not converted silently; Sets are not implemented in Phase 4.

**Deliberately out of scope for this plan's future implementation**

Sets / Subsets / Super Sets, Receipt Notes / GRN, PO, DC redesign, Project redesign, Rentals, serial architecture, QR redesign, Zoho synchronization, enabling legacy `RESERVE`/`UNRESERVE` movements, rewriting Break, and opportunistic security hardening of unrelated unauthenticated routes.

This document is a plan. Nothing has been implemented.

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [Current-state conversion audit](#2-current-state-conversion-audit)
3. [Temporary Asset / promotion audit](#3-temporary-asset--promotion-audit)
4. [Inventory → Asset semantics](#4-inventory--asset-semantics)
5. [Asset → Inventory semantics](#5-asset--inventory-semantics)
6. [Grouped conversion](#6-grouped-conversion)
7. [Individual conversion](#7-individual-conversion)
8. [Break interaction](#8-break-interaction)
9. [Reservation interaction](#9-reservation-interaction)
10. [Project interaction](#10-project-interaction)
11. [DC interaction](#11-dc-interaction)
12. [Product propagation](#12-product-propagation)
13. [Physical identity / QR](#13-physical-identity--qr)
14. [Manufacturer serial treatment](#14-manufacturer-serial-treatment)
15. [Lineage model](#15-lineage-model)
16. [Conservation equations](#16-conservation-equations)
17. [Conversion operation identity](#17-conversion-operation-identity)
18. [History / events](#18-history--events)
19. [Transaction model](#19-transaction-model)
20. [Concurrency](#20-concurrency)
21. [Idempotency](#21-idempotency)
22. [API proposal](#22-api-proposal)
23. [Service architecture](#23-service-architecture)
24. [Proposed schema](#24-proposed-schema)
25. [Migration / backfill strategy](#25-migration--backfill-strategy)
26. [Compatibility / cutover strategy](#26-compatibility--cutover-strategy)
27. [Authorization](#27-authorization)
28. [Test strategy](#28-test-strategy)
29. [Rollback](#29-rollback)
30. [Exact files that would change](#30-exact-files-that-would-change)
31. [Exact files that must NOT change](#31-exact-files-that-must-not-change)
32. [Blockers](#32-blockers)
33. [Open decisions](#33-open-decisions)
34. [Mandatory decision matrix](#34-mandatory-decision-matrix)

---

## 1. Executive summary

Phase 4 designs a **first-class conversion engine**: an atomic, attributable, reversible-in-lineage operation that moves a physical quantity between the Inventory and Asset operational domains without deleting the source, without changing Product, and without inventing a new identity namespace.

```
INVENTORY  --CONVERT-->  ASSET
ASSET      --RETURN--->  ORIGINAL INVENTORY LINEAGE
```

This is **not** Break (same domain, granularity). It is **not** reservation (same record, hold). It is **not** `promoteToAsset` (same ID, source deleted). It is **not** `make-permanent` (temp table → Asset, no Inventory). It is **not** the dashboard unit-conversion tool (`conversion_unit` / `factor` / `mode`).

Phases already shipped that this engine must sit on:

| Phase | What exists | What conversion must not break |
|---|---|---|
| 1 | `product.id`, `assets.product_id`, `inventory_items.product_id` | Copy `product_id`. Never create Product or Zoho Product |
| 2 | `NUMERIC(18,6)` qty, `quantity_original`, Break lineage, Inventory QR | Intra-domain Break conservation; new AssetEngine ID + QR on new records |
| 3 | `reservation` + `quantity_reserved` + `SELECT … FOR UPDATE` | Convert **available remainder only**. Do not consume or retarget reservations |

**Where converted quantity lives (recommendation, not yet implemented):**

On convert of 3 from Inventory total 10 / available 10:

- Source Inventory **row remains**. `quantity_original` stays 10.
- Source `quantity_total` and `quantity_available` decrease by 3 (quantity leaves this domain's *represented* amount, same motion as Break leaving the parent).
- Source `quantity_converted` (new denormalised counter) increases by 3.
- One or more new Asset rows represent 3 in the Asset domain, with conversion lineage pointing at the Inventory source.
- A `conversion` operation row (`CONV-…`) is the ledger of the move, the way `reservation` is the ledger of a hold.

Conservation is reconstructed **without double-counting children** by treating CONVERTED as quantity that has left the Inventory tree's `quantity_total` sum and is accounted on the conversion ledger / `quantity_converted`, not by adding Asset totals into the Inventory original sum.

**Hardest problems**

1. **Lineage / conservation:** Phase 2 asserts `quantity_original(root) = Σ ACTIVE same-table quantity_total`. Conversion must extend that equation with an explicit CONVERTED term or the 3 units disappear from Inventory and appear on Asset with no legal reconstruction.
2. **Reservation:** A reservation points at a resource ID. Converting reserved quantity would either lie (hold remains on Inventory that no longer represents it) or silently retarget the Asset (hidden transfer + domain change). Phase 3 already forbade that. Convert only `quantity_available`.

No implementation in this task.

---

## 2. Current-state conversion audit

**True Asset ↔ Inventory conversion does not exist.** GAP-301 / GAP-302 remain true after Phases 1–3. There is no `quantity_converted`, no `source_inventory_id`, no `conversion` table, and no `/api/conversions` route.

What exists instead is a set of **lookalikes**. None of them is the engine. They must not be reused as the implementation.

### 2.1 Lookalike inventory (do not modify in Phase 4)

| # | Route | File | Function | Auth | What it actually is | Conversion? |
|---|---|---|---|---|---|---|
| 1 | (internal) | `server.js:397` | `promoteToAsset` | caller-dependent | Moves `components` → `assets` **same ID**, then **DELETE**s the component | **No.** Same-domain promotion; source destroyed |
| 2 | `POST /api/temporary-assets/:id/make-permanent` | `server.js:9062` | inline | **None** | Temp row → **new** Asset ID; temp kept `ispermanent=1`; links `project_assets` | **No.** Not Inventory. Closest *retention* precedent only |
| 3 | `GET/POST /api/projects/:id/temporary-assets` | `server.js:8977`, `8988` | inline | JWT | CRUD on `temporary_assets` | No |
| 4 | `GET/POST /api/temporary-assets` | `server.js:9019`, `9028` | inline | JWT | List/create temps | No |
| 5 | `DELETE /api/temporary-assets/:id` | `server.js:9140` | inline | JWT | Soft-delete temp | No |
| 6 | `POST /api/break` | `server.js:2993` → `breakService.breakQuantity` | JWT + roles | Intra-domain child records | **No.** Same domain |
| 7 | `POST /api/break/inactivate` | `server.js:3011` → `inactivateChild` | JWT + roles | Restore qty to parent; child INACTIVE | **No.** Same domain merge-back |
| 8 | `POST /api/assets/split` | `server.js:11614` | **None** | Asset children via `parentid`; optional project assign; may merge into existing child | **No.** Destructive sibling of Break; Phase 5 cutover |
| 9 | `POST /api/quantity/split` | `server.js:6796` | **None** | Quantity child with `parentid` **and** `quantity_parent_id`; suffix IDs | **No.** |
| 10 | `POST /api/assets/unsplit` | `server.js:11907` | JWT | Qty child: **hard-DELETE** child and add qty back to parent | **Forbidden pattern** for conversion return |
| 11 | `DELETE /api/projects/:id/unassign-asset/:assetId` | `server.js:8818` | JWT | Qty/`is_batch` children: merge + **hard-DELETE** | Same forbidden pattern |
| 12 | `POST /api/quantity/consume` | `server.js:7339` | **None** | Creates a Consumed child asset; not cross-domain | No |
| 13 | `POST /api/inventory/movements` CONSUME | `inventoryMovementService.js:58` | JWT + roles | Decrements Inventory **total and available** together (TERMINAL leak) | **Not** conversion. Must not be copied |
| 14 | `POST /api/quantity/issue` | `server.js:7207` | **None** | Issues qty (still Asset domain) | No |
| 15 | `POST /api/assets/make-set` | `server.js` ~7019 / 7090 / 7173 | mixed | May call `promoteToAsset` for components | Set composition, not conversion |
| 16 | `GET /api/projects/:id/available-inventory` | `server.js:12119` | JWT | Queries **`assets`**, not `inventory_items`; selects missing `unitprice` | Name lie (GAP-303). Not conversion |
| 17 | Dashboard “Apply Conversion” | `dashboard.js` unit tool | n/a | Rewrites number/unit via `conversion_unit` / `factor` / `mode` in the browser | **Unit rename.** Not domain conversion |
| 18 | Create inventory from Zoho catalog | `inventory.js` | JWT create | New `inventory_items` row from catalogue | Create, not convert |
| 19 | `POST /api/reservations` | `server.js:3043` → `reservationService` | JWT + roles | Hold against owner | Not conversion |
| 20 | Recovery restore | `POST /api/recovery-center/.../restore` | JWT | Undelete | Not conversion |

### 2.2 Per-path forensic notes (lookalikes 1–2 expanded in §3)

**`POST /api/break`** — Input: `{ holdingType, parentId, mode, amount, children }`. Output: parent counters + child IDs. DB: decrement parent total+available; insert same-domain children with `quantity_parent_id` / `quantity_root_id`; `product_id` copied; new QR. History: `quantity_events` / `inventory_quantity_events` type `BREAK`; Asset `asset_history`. Reservation: amount ≤ `quantity_available` only. Failure: 400 over-available, 409 reserved child on inactivate.

**`POST /api/assets/split`** — Unauthenticated. Writes `parentid` (legacy Set/split), not conversion lineage. Can auto-assign to project. Failure: invalid qty vs `quantity_available`.

**`POST /api/assets/unsplit`** — JWT. For quantity-tracked parent: restores parent total+available, **deletes** child from `assets` and `components`, deletes `project_assets`. History on parent `SPLIT_CHILD_RESTORED`. **Must not** become conversion return.

**CONSUME inventory** — Input amount. Decrements both `quantity_total` and `quantity_available`. No owner. No conversion ledger. MIS production (`3` total / `1` available / `0` reserved) is this leak, not conversion.

**Unit conversion columns** — `conversion_unit`, `conversion_factor`, `conversion_mode` on both holdings. Client computes; server stores. Irreversible from stored data. Unrelated to Phase 4. Leave untouched.

### 2.3 Confirmed absences

| Expected by canonical §10–11 | Production after Phase 3 |
|---|---|
| Inventory → Asset conversion route | Absent |
| Asset → original Inventory return | Absent |
| `quantity_converted` | Absent (Phase 2 B-5; Phase 3 did not add it) |
| `source_inventory_id` / conversion lineage columns | Absent (GAP-302) |
| Conversion operation ID | Absent |
| Grouped vs individual conversion | Absent (Break has `BREAK` / `MAKE_INDIVIDUAL` in-domain only) |
| Event types CONVERT / RETURN_TO_INVENTORY | Absent from `inventoryEventSystem.js` (has `RETURN` meaning quantity-returned-from-delete/consume, not domain return) |

### 2.4 Shared ID space (GAP-152, now an asset)

Asset and Inventory IDs are both minted by `generateModernAssetId` (TYPE-LOC-MMYY-RAND6-C). Phase 2 Inventory Break children use the same generator. Conversion **must mint a new Asset ID** and **must not** reuse the Inventory ID as the Asset ID (that would collide in the shared space and destroy the source identity). Do not introduce a second namespace.

---

## 3. Temporary Asset / promotion audit

Two production paths are routinely cited as “conversion.” They are not. They are the closest **precedents**, and both violate canonical conversion in different ways.

### 3.1 `promoteToAsset` — CURRENT PRECEDENT

| Attribute | Behaviour |
|---|---|
| Route | Not public. Called from make-set / project flows (`server.js:7090`, `7173`, `8759`) |
| Direction | `components` → `assets` |
| Identity retained | **The same ID** |
| Identity destroyed | The `components` row is **deleted** after insert (`server.js:423`) |
| History | `asset_history` action `PROMOTED`, old `COMPONENT`, new `ASSET` |
| Product | Not a Product operation; no `product_id` contract |
| Zoho Product | Not copied as an invariant |
| Quantity | Whatever was on the component row; no conservation equation |
| Reversible? | **No.** Source row is gone |
| Auth | Inherits caller; some callers unauthenticated |

**Canonical target:** Conversion never deletes the source, never reuses the source ID as the destination ID, and always crosses Inventory ↔ Asset.

**Verdict:** Anti-pattern. Study only as “atomic insert-then-cleanup.” Do not call `promoteToAsset` from the conversion service. Do not delete Inventory.

### 3.2 `POST /api/temporary-assets/:id/make-permanent` — CURRENT PRECEDENT

| Attribute | Behaviour |
|---|---|
| Auth | **Unauthenticated** (`server.js:9062`) |
| Source | `temporary_assets` (rental/borrow / proto-receiving — UNMAPPED-01 / OD-13) |
| Destination | New `assets` row, `generateModernAssetId(location)` |
| Source retained? | **Yes** — `ispermanent = 1`, row kept |
| History | `audit_log` `CONVERT_TEMP`; `asset_history` `CREATE` Temporary → Permanent |
| Project | Inserts `project_assets` type `Permanent` if `ProjectID` set |
| Product | **Not set.** No `product_id`, no `zoho_product_id` |
| QR | New QR on the new Asset |
| Quantity | Temp `quantity` is **not** copied onto the Asset as a conserved holding |
| Inventory | **Never touched** |
| Reversible? | Temp row remains but there is no return-to-inventory path |

Frontend callers: `projects.js:1970`, `dashboard.js:3554` — POST with no JWT header.

**Canonical target:** Retain-source + new-ID + new-QR is the useful precedent. Missing: Inventory, Product, quantity conservation, reservation checks, authorization, return lineage.

**Verdict:** Closest **shape** (keep source, mint new ID). Wrong **domain** (temp table, not Inventory). Leave the route in place. Do not wrap it. Do not authenticate it as a side effect of Phase 4. OD-13 (retire vs Receipt Note prior art) stays Phase 7.

### 3.3 CURRENT PRECEDENT vs CANONICAL TARGET

| Question | Current precedent | Canonical / Phase 4 target |
|---|---|---|
| What identity is retained? | Temp: temp ID. Promote: the same ID | Inventory ID retained; Asset gets a **new** AssetEngine ID |
| What is destroyed? | Promote: component row. Temp: nothing | **Nothing.** No hard-delete |
| What history survives? | New Asset CREATE/PROMOTED only | Inventory history + Asset history + conversion operation events |
| Product | Not preserved as invariant | `product_id` copied; no new Product |
| Zoho Product | Not a conversion concern | Untouched (`zoho_catalog`, `zohoService.js`) |
| Quantity | Unconserved | Available decreases; CONVERTED increases; original unchanged |
| Reversible? | No true reverse | RETURN to **original Inventory lineage** only |
| Reservation | Unaware | Available only; reserved blocked |

---

## 4. Inventory → Asset semantics

### 4.1 Operation

`CONVERT` quantity `N` of an Inventory holding into Asset representation.

Locked:

- Partial quantity is allowed.
- Requested `N` must be `> 0` at the holding's `quantity_precision`.
- `N ≤ quantity_available` at lock time. **No partial fill.**
- Original Inventory row is never deleted.
- `quantity_original` on the Inventory root is never reduced.
- Product is copied, not created.
- Converted quantity is no longer available Inventory.

### 4.2 Worked example (clean node, no reservation, no Break children)

```
INV-001  Product PRD-001
  quantity_original = 10
  quantity_total    = 10
  quantity_available= 10
  quantity_reserved = 0
  quantity_converted= 0

CONVERT 2, GROUPED

INV-001  (same ID, same QR)
  quantity_original = 10
  quantity_total    = 8
  quantity_available= 8
  quantity_reserved = 0
  quantity_converted= 2

AST-001  (new ID, new QR)
  product_id        = PRD-001
  quantity_total    = 2
  quantity_available= 2
  quantity_reserved = 0
  conversion source = INV-001
```

`10 = 8 represented still on Inventory + 2 converted.`

The “3 converted” / “2 converted” term is **not** an ambiguous bucket. It is:

1. `inventory_items.quantity_converted` on the source holding (denormalised remaining unreturned converted qty), **and**
2. `SUM(quantity)` of `conversion` rows in status `ACTIVE` sourced from that holding, **and**
3. `SUM(quantity_total)` of **ACTIVE** Assets whose conversion source is that holding.

Those three must match before commit. The Asset totals are **not** added into the Inventory `quantity_original = Σ inventory totals` check — that would double-count.

### 4.3 Eligibility (Inventory source)

Reject with explicit reason, do not coerce:

| Condition | Reason code (proposed) |
|---|---|
| Missing / deleted / inactive lineage | `INVENTORY_NOT_CONVERTIBLE` |
| Not quantity-tracked | `NOT_QUANTITY_TRACKED` |
| `N > quantity_available` | `INSUFFICIENT_AVAILABLE` |
| `N` intersects reserved qty (i.e. using reserved) | `RESERVED_QUANTITY_NOT_CONVERTIBLE` |
| Source already fully converted with available 0 and request > 0 | `INSUFFICIENT_AVAILABLE` |

Do not require the Inventory row to have a Product. Copy `product_id` even if null. **Do not create a Product to make conversion possible.** Whether missing Product should be a hard reject is an [open decision](#33-open-decisions) (C-1).

### 4.4 What the new Asset is

- Company-owned internal Asset (`purpose` Owned / status `In Store` unless a future rule says otherwise).
- Assignable **after** conversion (employee/team/project) — conversion itself does **not** assign.
- Quantity-tracked with the converted quantity.
- `quantity_root_id` is **itself** (Asset-domain Break root). Do not point `quantity_root_id` at an Inventory ID (different table, Break FKs are intra-table).
- Conversion lineage is a **separate** column set (§15).

### 4.5 What conversion is not

- Not Break (no same-domain child).
- Not reservation (available actually leaves Inventory representation).
- Not consume (Inventory `quantity_original` unchanged; Asset exists).
- Not DC, Project assign, or Set allocate.

---

## 5. Asset → Inventory semantics

### 5.1 Operation

`RETURN` an Asset (whole remaining represented quantity) to the **original Inventory lineage**.

Locked:

- No destination picker. No `INV-999`.
- Asset row is **not deleted**.
- Asset-specific history remains on the Asset.
- Inventory receives quantity and an Inventory-side event; historical receipt events are not rewritten.
- Return is blocked if the Asset has a blocking reservation or operational commitment (§9–11).

### 5.2 Destination

```
conversion_root (Inventory ID stored on the Asset / conversion row)
            ==
the Inventory record that originally sourced this quantity
(or that record's quantity_root if we ever need the ultimate stock line)
```

**Immediate source** vs **ultimate root:**

- Immediate: the Inventory ID that this conversion operation consumed (`conversion.source_id`).
- Ultimate: that Inventory row's `quantity_root_id` (Break root of the Inventory tree).

**Return destination recommendation:** the **immediate source Inventory row** (the record whose available/total were decremented), not a newly created Inventory child, and not a sibling. If that row was a Break child (`INV-002` of `INV-001`), return to `INV-002`. That preserves “original lineage” more faithfully than collapsing onto the root. If `INV-002` were later inactivated, return is a blocker until that is designed — recommend **reject** rather than silently retarget `INV-001` (open decision C-2).

Assets that **never** came from Inventory (`conversion_source_id` null): **reject** `NO_INVENTORY_LINEAGE`. Do not invent a destination. HAR-style native Assets stay Assets unless a future exception is explicitly approved.

### 5.3 Asset lifecycle after return (recommendation)

Reuse Phase 2 **`lineage_status = INACTIVE`**.

| After RETURN | Value |
|---|---|
| `assets` row | Remains, queryable |
| `lineage_status` | `INACTIVE` |
| `quantity_total` | Historical converted quantity (unchanged) |
| `quantity_available` | 0 |
| QR / ID / `product_id` | Unchanged |
| `status` | Do **not** invent `Converted`. Leave operational status or set `In Store` historically; INACTIVE lineage is the gate |

This matches Break inactivate: the row drops out of the Asset-domain original sum because INACTIVE is excluded, without hard-delete.

Do **not** use `is_deleted` (Recovery Center / soft-delete is a different meaning).  
Do **not** keep the Asset ACTIVE with quantity 0 as the primary design (ambiguous vs “empty holding still in service”).

### 5.4 Return condition

Operator chooses one of:

| Operator choice | Maps to existing conventions | Quantity effect on **source Inventory** |
|---|---|---|
| **AVAILABLE** | `inventory_items.status` stays / returns toward `In Store` **only if** the row is not a mixed aggregated line | `quantity_total += q`, `quantity_available += q`, `quantity_converted -= q` |
| **INSPECTION / HOLD** | Operational status already exists: `Under Inspection` (`lifecycleModel.OPERATIONAL_STATUS`) | `quantity_total += q`, `quantity_available` **unchanged** (enters TERMINAL_ON_ROW / non-available remainder), `quantity_converted -= q`. Do **not** flip the whole aggregated Inventory row to Under Inspection if other units remain available |
| **DAMAGED / NOT AVAILABLE** | No first-class Damaged qty bucket today. Closest: `Scraped` / retired are Asset-level. For Inventory qty, use the same TERMINAL remainder as Inspection, with `reason_code = DAMAGED` on the conversion event | Same counters as Inspection; reason distinguishes condition |

**Do not** add a parallel first-class disposition schema in Phase 4. Quantity availability (`quantity_available`), physical condition (conversion `condition` / `reason_code`), and lifecycle (`lineage_status` on the Asset, `status` string on holdings) stay separate.

Inspection / Damaged on an aggregated Inventory line **cannot** be fully managed by `inventory_items.status` alone. That is accepted for Phase 4: they remain represented on the original lineage and **not Available** (**ADR-CONVERSION-001**). A future disposition engine must manage Inspection, Damaged, Consumed, Retired, and similar states independently without deleting or rewriting the original record. Phase 4 does not design that schema. Open decision **C-3 is closed** by that ADR.

### 5.5 Whole-Asset return only in Phase 4

Asset reservations are whole-record (Phase 3). Asset conversion return is likewise **the remaining represented quantity of that Asset ID**. Partial return of a grouped Asset (return 1 of 3 without Break) is **not** a Phase 4 operation. Operator Breaks the Asset first (Phase 2 engine), then returns children.

### 5.6 MERGE BACK vs RETURN

| | RETURN | MERGE BACK (canonical §12 / §29) |
|---|---|---|
| Domain | Crosses to original Inventory | Same-domain aggregation (Break inactivate) |
| Destination | Original Inventory lineage | Parent in the same table |
| Phase 4 | **Yes** | Already exists as `POST /api/break/inactivate` |
| Grouping | Returning AST-001 qty 3 adds 3 to INV-001; does not recreate the pre-convert grouping of other units | N/A |

If AST-001 (grouped 3) was Broken into AST-002/003/004, each child returns **individually** to the same Inventory source. Lineage is preserved per child. No requirement to reassemble AST-001 first.

---

## 6. Grouped conversion

One destination Asset representing `N`.

```
CONVERT 3, granularity = GROUPED

AST-001  quantity_total = 3, quantity_available = 3
```

API field (proposed): `granularity: 'GROUPED'` (not `mode: 'BREAK'` — that word is taken).

One conversion operation ID. One conversion row. One destination Asset. One QR.

---

## 7. Individual conversion

`N` destination Assets of quantity 1. `N` must be a whole number at `quantity_precision` (same rule as Break `MAKE_INDIVIDUAL`).

```
CONVERT 3, granularity = 'INDIVIDUAL'

AST-001 qty 1
AST-002 qty 1
AST-003 qty 1
```

One conversion operation ID covering all three lines (atomic). Three Asset IDs, three QRs. If any Asset insert fails, the entire conversion rolls back — no “2 of 3 created.”

OD-10 (canonical): returning only some of several individually converted Assets is **allowed**; each RETURN is its own operation against the same Inventory source. Remaining converted siblings stay Assets. Inventory `quantity_converted` decreases by each returned 1.

---

## 8. Break interaction

Conversion is **not** a special case of Break. `breakService` stays intra-domain.

### 8.1 Convert a Broken Inventory child

```
INV-001  original 10
  BREAK 3 → INV-002 qty 3   (parent total 7)
INV-002 CONVERT → AST-001 qty 3
```

Lineage that must be stored on AST-001 / conversion row:

| Field | Value |
|---|---|
| Immediate source | `INVENTORY` / `INV-002` |
| Inventory Break parent | `INV-002.quantity_parent_id` = `INV-001` (unchanged on Inventory) |
| Inventory quantity root | `INV-002.quantity_root_id` = `INV-001` |
| Conversion root (ultimate stock line) | `INV-001` (the Inventory `quantity_root_id`) |

Do **not** rewrite Inventory `quantity_parent_id` / `quantity_root_id`. Do **not** point Asset `quantity_parent_id` at INV-002 (that FK is same-table). Conversion columns carry cross-domain ancestry. Root ancestry is **not severed**.

Product: copy from INV-002 (which Phase 2 already copied from INV-001).  
QR: new Asset QR. INV-002 keeps its Inventory QR.  
History: conversion event names INV-002 as source and INV-001 as root.

Conservation after this convert:

```
INV-001 original 10
INV-001 total 7, converted 0
INV-002 total 0, converted 3, available 0   (row remains)
AST-001 total 3
10 = 7 + 0 + 3 converted
```

INV-002 remains the permanent source row even at remaining total 0.

### 8.2 Return a Broken Asset child that itself came from Inventory

```
INV-001 CONVERT 2 GROUPED → AST-001
AST-001 BREAK 1 → AST-002
RETURN AST-002
```

Destination: original Inventory lineage of AST-001 (`INV-001` or immediate source), **not** a new Inventory record, **not** “the Asset parent.” AST-001 remains an Asset holding the leftover 1.

Do not discard: Asset Break parent (`quantity_parent_id`), conversion source, conversion root.

### 8.3 Break vs convert (operators)

| Want | Operation |
|---|---|
| Finer Inventory records, still Inventory | Break |
| Those units to become Assets | Convert the child (or convert available on parent without breaking) |
| Reserved slice to become an Asset | Release or transfer reservation first, then convert available |
| Converted Asset to become smaller Assets | Break the Asset (still Assets), then optionally return children |

### 8.4 Inactivate / Break after conversion

- Cannot Break reserved qty (Phase 3). Converted qty is already not on `quantity_available`.
- Cannot inactivate an Inventory child that still has `quantity_converted > 0` unreturned — that would drop the CONVERTED term from a naive tree walk. **Reject** inactivate while unreturned conversions exist on that node (same spirit as Phase 3 `assertNoActiveReservations`).
- `breakService` would gain a surgical guard (future implementation): `assertNoActiveConversions` analogous to reservations. Not implemented in this plan task.

---

## 9. Reservation interaction

Phase 3 is live: `reservation`, `reservation_event`, `quantity_reserved`, `reservationService.js`.

Locked default from Phase 3 §12, restated as Phase 4 rules:

### 9.1 Inventory

| Question | Answer |
|---|---|
| Can **available** Inventory be converted? | **Yes.** |
| Can **reserved** Inventory be converted? | **No.** Must `release` or an explicitly supported `transfer` first. No silent consume. |
| Can **partially reserved** Inventory convert from the available remainder? | **Yes.** |

Example (locked by this brief):

```
Total 10, Reserved 4, Available 6
CONVERT 3
→ Reserved 4 (untouched)
→ Available 3
→ Converted 3
→ Total 7
```

Reservations stay pointing at the Inventory ID. Their quantities still fit because reserved 4 ≤ remaining represented 7, and `quantity_reserved` is unchanged.

`CONVERT 8` on that row → **409** `INSUFFICIENT_AVAILABLE` (8 > 6). Do not release 2 of the reservation to make room.

### 9.2 Asset return / convert-back

If the Asset has an ACTIVE reservation (Set / Project / DC / MANUAL / SYSTEM owner): **reject**. Resolve reservation first.

Phase 3 Asset eligibility already treats project assignment, `assignedto`, `sentagainstdc`, and active Managed Set membership as commitments for **new reservations**. Conversion return must **reuse the same commitment list** so we do not return an Asset that is still operationally committed. Do not redesign those modules; call the same checks.

### 9.3 Future Set compatibility (do not implement Sets)

```
Set A reserves INV-001 qty 4 of 10
CONVERT 6 → allowed (available remainder)
CONVERT 8 → rejected

Asset AST-001 reserved by Set A
RETURN AST-001 → rejected until that reservation is released or transferred
```

Phase 6 will allocate through `reservationService`. Phase 4 only refuses ACTIVE holds and leaves `kitSetService` unchanged.

### 9.4 No guessed reservation transfer

Converting must not:

- rewrite `reservation.resource_id` from Inventory to Asset;
- auto-`transfer` to the new Asset;
- decrement `quantity_reserved`.

If a future product rule is “this hold should follow the goods into Asset form,” that is an **explicit** reservation `transfer` in the **same** transaction, designed later, not inferred.

---

## 10. Project interaction

**Do not change Project behaviour.**

| Mechanism | Today | Conversion |
|---|---|---|
| `project_assets` | Asset ↔ Project join; JWT assign/unassign | **Block RETURN** (and block converting an Asset that is project-assigned — Assets are not converted to Inventory while assigned) |
| `assignedto` | Employee / `Project: …` string | **Block** Asset return |
| `/api/assets/split` into project | Legacy `parentid` | Out of scope; not conversion |
| Unassign qty child hard-delete | `server.js:8861` | Must **not** be used as return |
| `GET …/available-inventory` | Reads **assets** | Ignore; do not “fix” in Phase 4 |
| Inventory tied to Project | **No** `project_inventory` table | Inventory convert is not blocked by Project unless a future reservation `owner_type=PROJECT` exists on that Inventory |

`GET /api/projects/:id/assets` unions `temporary_assets`. Conversion must not start writing temps.

---

## 11. DC interaction

**Do not modify DC.**

| Mechanism | Today | Conversion |
|---|---|---|
| `sentagainstdc` | String on Asset | **Block** Asset return (`ASSET_COMMITTED_TO_DC`) |
| `POST /api/dc` | Unauthenticated; no Inventory qty change | Unchanged |
| Inventory “on a DC” | Not a quantity hold today | Inventory convert not blocked by DC documents unless a Phase 3 reservation `owner_type=DC` is ACTIVE |

---

## 12. Product propagation

Phase 1 already stores `product_id` on both tables (FK to `product.id`).

| Rule | Detail |
|---|---|
| Copy | Destination `product_id = source.product_id` |
| Do not create | No `productService.createProduct` |
| Do not create Zoho Product | No `zohoService` writes |
| Do not change | `zoho_catalog`, `zoho_product_id` columns, mapping tables |
| Null | If source has no Product, destination has no Product (unless C-1 rejects) |

Conversion is the strongest argument that Product exists (`PRODUCT_ARCHITECTURE_DECISION.md` §8.3). Implementation must not undermine that by minting products “to be helpful.”

---

## 13. Physical identity / QR

Phase 2 rules apply.

**Inventory → Asset**

- New AssetEngine Asset ID via `generateModernAssetId` (same family as today).
- New QR pointing at `/asset/:id`.
- Inventory ID and Inventory QR **unchanged**.
- `client_label` derived from the new Asset ID as Break children do.
- Do not reuse Inventory ID.

**Asset → Inventory**

- Destination is the **existing** Inventory row: existing Inventory ID and QR remain.
- No new Inventory identity.
- Returned Asset keeps its Asset ID and QR as historical (INACTIVE).
- Never treat QR as identity.

**Break children that are converted** keep their Inventory QR on the Inventory child; the Asset gets a distinct QR.

---

## 14. Manufacturer serial treatment

Phase 4 does **not** redesign serials (canonical §8 still deferred; UNMAPPED-10).

| Source field | Recommendation |
|---|---|
| `inventory_items.srno` (plaintext) | **Do not copy** onto `assets.srno` (that column is encrypted-deterministic). Copying would invent a serial architecture |
| `assets.srno` on return | **Do not write** onto Inventory |
| `physical_marking` (Phase 2 table, unused for backfill) | **Do not auto-insert** conversion rows |
| Serialised individual conversion | If the operator needs serial-level Assets, that is future serial work + INDIVIDUAL conversion, not a hidden copy |

Document in the conversion event that serial handling was deferred. Operators can edit Asset `srno` through existing Asset edit after conversion if business requires it — that is not the engine's job.

---

## 15. Lineage model

Three graphs must not be collapsed (canonical §13):

| Graph | Columns | Conversion |
|---|---|---|
| Break / quantity lineage | `quantity_parent_id`, `quantity_root_id`, `lineage_status` | Unchanged; intra-domain |
| Legacy Set / split | `parentid`, `is_set` | Unchanged; not conversion ancestry |
| **Conversion lineage** | New columns / `conversion` table | Cross-domain only |

### 15.1 Recommended conversion lineage fields on holdings

On **Assets** (nullable):

| Column | Meaning |
|---|---|
| `conversion_source_type` | `INVENTORY` (Phase 4 only this direction into Asset) |
| `conversion_source_id` | Immediate Inventory ID consumed |
| `conversion_root_type` | `INVENTORY` |
| `conversion_root_id` | Inventory `quantity_root_id` of that source |
| `conversion_id` | Operation that created this Asset (`CONV-…`) |

On **Inventory**: no destination pointer required (many Assets may point at one Inventory). `quantity_converted` is the counter.

Break children of a converted Asset **copy** `conversion_source_*` / `conversion_root_*` from the parent (so return still finds INV-001) and get their own Asset `quantity_parent_id` for Break. They do **not** get a new `conversion_id` unless they are themselves converted (they are not).

### 15.2 What not to do

- Do not store conversion ancestry in `parentid`.
- Do not point `quantity_parent_id` across tables.
- Do not use reservation `owner_id` as lineage.

---

## 16. Conservation equations

### 16.1 Phase 2 (unchanged intra-domain Break)

```
ORIGINAL(inventory_or_asset_root)
  = Σ quantity_total  of ACTIVE nodes in that table with that quantity_root_id
```

On a clean node with no TERMINAL leak:

```
quantity_total = quantity_available + quantity_reserved + SEPARATED(children totals)
```

TERMINAL_ON_ROW remains the residual `total - available - reserved` (MIS leak). Phase 4 must not “fix” MIS by stuffing leak into `quantity_converted`.

### 16.2 CONVERTED term (this phase)

CONVERTED means: **quantity that left this domain's represented `quantity_total` and now exists as ACTIVE holdings in the other domain, still attributed to this source.**

On convert of `q`:

```
source.quantity_total      -= q
source.quantity_available  -= q
source.quantity_converted  += q
destination.quantity_total  = q   (new row)
```

Extended Inventory-root reconstruction:

```
ORIGINAL(R)
  = Σ quantity_total of ACTIVE Inventory nodes in R's tree
  + Σ quantity_converted of Inventory nodes in R's tree
      (including nodes whose remaining total is 0)
```

`quantity_converted` on a node must equal `SUM(ACTIVE conversion.quantity)` sourced from that node.

**Do not** also add Asset `quantity_total` into `ORIGINAL(R)` — that *is* the converted quantity already.

On RETURN AVAILABLE of `q`:

```
inventory.quantity_total     += q
inventory.quantity_available += q
inventory.quantity_converted -= q
asset.lineage_status = INACTIVE
```

INACTIVE Assets do not enter Asset-domain original sums (Phase 2 rule).

### 16.3 Double-count guards

1. Converted units are not AVAILABLE on Inventory.
2. Converted units are not RESERVED on Inventory (reserved untouched).
3. Converted units are not still in Inventory `quantity_total`.
4. SEPARATED children are Inventory totals, not CONVERTED.
5. Returning does not create a second Inventory identity for the same units.

### 16.4 No CHECK `available + reserved + converted = total`

TERMINAL leak would fail the migration (same reason Phase 3 omitted `available + reserved = total`). Enforce `converted >= 0`, `available >= 0`, `reserved >= 0`, and service-level `SUM(ACTIVE conversions) = quantity_converted`.

---

## 17. Conversion operation identity

**Yes — conversion needs an operation ID.**

Existing immutable checksum IDs:

| Prefix | Format | Phase |
|---|---|---|
| `PRD-` | `PRD-MMYY-XXXXXX-C` | 1 |
| `RSV-` | `RSV-MMYY-XXXXXX-C` | 3 |
| Holdings | `TYPE-LOC-MMYY-XXXXXX-C` | long-standing |

**Recommendation:** `CONV-MMYY-XXXXXX-C` using the same alphabet and weighted checksum family as Product/Reservation (`IdGenerator.computeProductChecksum` over payload `CONV+MMYY+XXXXXX`).

One ID per atomic operation (grouped: one dest; individual: many dests, one CONV). Return is a **new** operation ID (`CONV-…` with direction `ASSET_TO_INVENTORY`) linking `parent_conversion_id` to the original convert, rather than mutating the convert row into invisibility. The convert row stays, status `RETURNED` or remaining quantity reduced if we ever allow partial grouped return (Phase 4: full Asset only, so convert lines to that Asset become RETURNED).

Do not use holding IDs as operation IDs.

---

## 18. History / events

Never hard-delete conversion history.

### 18.1 Ledger (source of truth)

`conversion` + `conversion_event` (append-only), parallel to `reservation` + `reservation_event`.

Minimum event types:

| Type | When |
|---|---|
| `CONVERT_INVENTORY_TO_ASSET` | Inventory → Asset commit |
| `RETURN_ASSET_TO_INVENTORY` | Asset → Inventory commit |

Payload must answer: source, destination(s), quantity, Product, actor, timestamp, reason, conversion ID, return condition (on return), granularity.

### 18.2 Holding-level dual write (like Phase 3 RESERVE/UNRESERVE)

Add catalog entries in `inventoryEventSystem.js` (implementation time, not now):

- `CONVERT` / `CONVERT_RETURN` **or** reuse names above.

Write `inventory_quantity_events` on the Inventory root and `quantity_events` on Asset roots / `asset_history` on Assets (`CONVERT_FROM_INVENTORY`, `RETURN_TO_INVENTORY`).

Do **not** use existing `EVENT_TYPES.RETURN` (today: quantity returned from delete/consume) as the domain-return type without a distinct name — collision risk. Prefer `CONVERT_RETURN` in the catalog.

`reservation_event` is **not** written unless a reservation is actually released (it must not be, by default).

### 18.3 Inventory receipt history

Receipt / INIT / ADJUST rows on the original Inventory are not rewritten. Return appends a new event.

---

## 19. Transaction model

One PostgreSQL transaction. READ COMMITTED. No SERIALIZABLE database switch.

**Inventory → Asset**

1. `BEGIN`
2. `SELECT … FROM inventory_items WHERE id = $source FOR UPDATE`
3. Verify existence, lineage ACTIVE, quantity-tracked, `N ≤ quantity_available`, precision, product copy policy
4. Verify no attempt to consume reserved (`available` already excludes reserved)
5. Mint `CONV-…` and destination Asset ID(s); generate QR(s)
6. Insert Asset row(s) with lineage + `product_id`
7. `UPDATE inventory SET total -= N, available -= N, converted += N WHERE id = $source AND available >= N` — `rowCount === 1` or rollback
8. Insert `conversion` + `conversion_event` + quantity/asset history
9. Assert `SUM(ACTIVE conversions) = quantity_converted` and Phase 2 original reconstruction including converted
10. `COMMIT`

Any failure → full rollback. No Inventory decrement without Assets; no Assets without decrement; no history without both.

**Asset → Inventory**

1. Lock Asset `FOR UPDATE`, then lock destination Inventory `FOR UPDATE` (fixed lock order: Inventory id then Asset id **or** always by `(table, id)` sort to avoid deadlock — recommend **lock Inventory first** (destination), then Asset, matching “holding then reservation” discipline)
2. Eligibility: no ACTIVE reservation; no `assignedto`; no `project_assets`; no `sentagainstdc`; no active Managed Set component; has conversion source; lineage ACTIVE
3. Apply return condition math
4. Inactivate Asset; write events
5. `COMMIT`

---

## 20. Concurrency

Reuse Phase 3: row `FOR UPDATE` + conditional `UPDATE … AND quantity_available >= N`.

```
Available = 5
Operator A converts 4
Operator B converts 3
→ A commits; B sees available 1 and 409
```

Do not compute availability in the browser then POST. Two knex connections in tests, as Phase 3.

Do not lock the entire `inventory_items` table.

---

## 21. Idempotency

Optional `idempotency_key` (header `Idempotency-Key` and/or JSON), unique on `conversion` like reservations.

Replay of the same key returns the **original** conversion (same Asset IDs). No second decrement. No duplicate Assets.

Absence of a key: two clicks create two conversions if available allows — UI must send a key.

Do not infer idempotency from `(source, quantity, granularity)`: converting 2, returning, converting 2 again is a legitimate second operation.

---

## 22. API proposal

Follow `/api/reservations` and `/api/break`: a **collection noun**, not `/api/sets/.../convert`. JWT as §27.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/conversions` | Create conversion (direction in body) |
| `GET` | `/api/conversions/:id` | Operation + events + lines |
| `GET` | `/api/conversions` | Filter `direction`, `sourceType`, `sourceId`, `status` |
| `GET` | `/api/conversions/resource/:resourceType/:resourceId` | History for a holding |

Register `GET …/resource/…` **before** `GET …/:id`.

A split pair `POST /api/conversions/inventory-to-asset` and `…/asset-to-inventory` is acceptable if the owner prefers explicit verbs; it duplicates middleware. **Recommendation:** one `POST /api/conversions` with `direction`.

### 22.1 `POST /api/conversions` — Inventory → Asset

**Auth:** `authenticateJWT` + `authorizeRoles('superuser','admin','manager')`

**Input**

```
{
  direction: "INVENTORY_TO_ASSET",
  sourceId: "INV-…",
  quantity: 3,
  granularity: "GROUPED" | "INDIVIDUAL",
  reason?: string,
  reasonCode?: string,
  reference?: string,
  idempotencyKey?: string
}
```

`granularity` default: `GROUPED`.  
Asset quantity omitted; derived from `quantity` and granularity.

**Validation:** types, `quantity > 0`, INDIVIDUAL ⇒ whole units, source exists.

**Idempotency:** as §21.

**Output 200:** `{ success, conversion, assets[], source, events }`

**Failures:** 400 validation; 401; 403; 404 source; 409 insufficient / reserved / inactive; 503 tables missing.

### 22.2 `POST /api/conversions` — Asset → Inventory

```
{
  direction: "ASSET_TO_INVENTORY",
  sourceId: "AST-…",
  condition: "AVAILABLE" | "INSPECTION" | "DAMAGED",
  reason?: string,
  reasonCode?: string,
  idempotencyKey?: string
}
```

No `destinationId`. Quantity = remaining Asset represented qty.

**Failures:** 409 `ASSET_RESERVED`, `ASSET_ASSIGNED`, `ASSET_ASSIGNED_TO_PROJECT`, `ASSET_COMMITTED_TO_DC`, `ASSET_IN_MANAGED_SET`, `NO_INVENTORY_LINEAGE`, `NOT_ACTIVE`.

### 22.3 Reads

`authenticateJWT` only (any logged-in role), like Product/Reservation GET.

---

## 23. Service architecture

One module: `web-app/asset-manager-backend/services/conversionService.js`.

Exports (proposed):

- `convertInventoryToAsset(args)`
- `returnAssetToInventory(args)`
- `getById` / `list` / `listForResource`
- `assertNoUnreturnedConversions(resourceType, resourceId)` — for Break inactivate guard

Does **not** import `kitSetService`, `zohoService`, DC helpers, or project assign. May import `reservationService.assertNoActiveReservations` and shared qty helpers.

Surgical callers later: `server.js` routes; `breakService.inactivateChild` guard. Holding create paths: `quantity_converted = 0` via column default.

Do not put conversion logic in `breakService`, `promoteToAsset`, or `inventoryMovementService`. Do not enable a `CONVERT` movement type.

---

## 24. Proposed schema

Named migration only, timestamp after `20260828120000_reservation_foundation.js`. **Never** `migrate:latest` while `20260824120000_create_managed_sets_tables.js` remains unapplied.

### 24.1 Holding columns

Both `assets` and `inventory_items`:

| Column | Type | Notes |
|---|---|---|
| `quantity_converted` | `NUMERIC(18,6) NOT NULL DEFAULT 0` | Remaining unreturned converted qty **from this row**. Backfill 0. Do not guess from temps or `parentid` |

Assets only (nullable conversion lineage):

| Column | Type |
|---|---|
| `conversion_source_type` | `varchar(16)` |
| `conversion_source_id` | `varchar(255)` |
| `conversion_root_type` | `varchar(16)` |
| `conversion_root_id` | `varchar(255)` |
| `conversion_id` | `varchar(255)` FK to `conversion.id` ON DELETE RESTRICT |

No polymorphic FK to Inventory (same reason as reservation owners). Service validates.

### 24.2 Table `conversion`

| Column | Notes |
|---|---|
| `id` | `CONV-MMYY-XXXXXX-C` PK |
| `direction` | `INVENTORY_TO_ASSET` \| `ASSET_TO_INVENTORY` |
| `status` | `ACTIVE` \| `RETURNED` (ACTIVE = dest still represents qty in the other domain) |
| `source_type` / `source_id` | Holding converted from |
| `quantity` | Remaining active converted qty (0 when fully returned) |
| `quantity_original` | Amount at first convert; never increased |
| `granularity` | `GROUPED` \| `INDIVIDUAL` \| null on return ops |
| `condition` | null on convert; `AVAILABLE` \| `INSPECTION` \| `DAMAGED` on return |
| `product_id` | Snapshot of source Product at convert (nullable) |
| `reason` / `reason_code` / `reference` | |
| `idempotency_key` | unique when present |
| `parent_conversion_id` | Return ops point at original convert |
| `created_by` / `created_at` / `updated_at` | |

CHECK: statuses, directions, `quantity_original > 0`, `quantity >= 0`, `quantity ≤ quantity_original`, ACTIVE ⇒ quantity > 0.

### 24.3 Table `conversion_line`

One row per destination (or source-on-return) holding.

| Column | Notes |
|---|---|
| `id` | bigserial |
| `conversion_id` | FK RESTRICT |
| `holding_type` | `ASSET` \| `INVENTORY` |
| `holding_id` | |
| `role` | `SOURCE` \| `DESTINATION` |
| `quantity` | |

### 24.4 Table `conversion_event`

Append-only: `type`, `quantity`, `actor`, `timestamp`, `note`, `metadata_json`.

Never DELETE `conversion`, `conversion_line`, or `conversion_event`.

---

## 25. Migration / backfill strategy

Distinguish three layers. **None are executed by this plan task.**

| Layer | What | Data mutation? |
|---|---|---|
| **SCHEMA** | Columns + three tables + CHECKs + indexes | Additive |
| **BACKFILL** | `quantity_converted = 0` only | No invented conversions from `temporary_assets`, `components`, `parentid`, or `project_assets` |
| **APPLICATION CUTOVER** | Routes + service + Break inactivate guard; restart to load JS | No production CONVERT until scratch green |

Ops copy Phases 1–3: `pg_dump` → scratch restore → park abandoned `20260824120000` → named `migrate:up` → tests → production named `up()` → restart for routes.

Stop if any row would get a guessed conversion, if `available + converted > total` after reserved=0 style residual accounting on dirty MIS (`1 + 0 + 0 ≤ 3` must hold), or if `migrate:latest` is about to run.

`temporary_assets` (0 rows historically in some audits) is **not** backfilled into `conversion`.

---

## 26. Compatibility / cutover strategy

| Path | Keep / shim / deprecate / replace | Sequence |
|---|---|---|
| New `/api/conversions` | **Replace** the missing capability | Phase 4 implementation |
| `promoteToAsset` | **Keep** for `components` until that table is retired | Not conversion cutover |
| `make-permanent` | **Keep** (OD-13 Phase 7). Unauthenticated. Not a shim for conversion | Do not wrap |
| `POST /api/break` | **Keep** — intra-domain | Guard inactivate if unreturned conversions |
| `/api/assets/split`, `/api/quantity/split` | **Keep** until Phase 5 (legacy Break cutover) | Do not use for conversion |
| `/api/assets/unsplit`, unassign hard-delete | **Keep** (destructive). Conversion return must **not** call them | Phase 5 deprecates |
| Unit conversion UI | **Keep** | Unrelated |
| CONSUME movement | **Keep** enabled | Not conversion |
| `lifecycleModel.RESERVED` stub | **Keep** unused | Conversion does not write Asset `status = Reserved` |
| Disabled movement types | **Keep disabled** | No CONVERT movement |

Production Set/Project/DC/Inventory/Asset screens: **no conversion UI required** in the first implementation slice if the API is tested via scratch scripts; a minimal operator UI is optional and must not include a destination Inventory picker.

---

## 27. Authorization

Mutations: `authenticateJWT` + `authorizeRoles('superuser','admin','manager')` — same as Break, Product writes, Reservations.

Reads: `authenticateJWT`.

Actor: `productActor` (`username || user_id`).

Do **not** authenticate `/api/dc`, `/api/assets/split`, or `make-permanent` as a Phase 4 side effect.

Unauthenticated POST `/api/conversions` → 401. Role `user` → 403.

---

## 28. Test strategy

Scratch database first, restored from production dump. Disposable holdings only. Refuse mutation flags against `asset_manager`.

Production conversion operations are **not** allowed until scratch is completely green.

| # | Test | Expect |
|---|---|---|
| 1 | Convert Inventory qty 2 of 10 | Source 8/8/2 converted; one or more Assets sum to 2; source row remains |
| 2 | Convert exact available | Source available 0; original still 10 |
| 3 | Convert more than available | 409; counters unchanged |
| 4 | Partially reserved (10, reserved 4, available 6) convert 3 | reserved 4, available 3, converted 3, total 7 |
| 5 | Convert reserved quantity (convert 8 when available 6) | 409; reservations untouched |
| 6 | GROUPED 3 | One Asset qty 3 |
| 7 | INDIVIDUAL 3 | Three Assets qty 1; one CONV id |
| 8 | Convert Broken Inventory child | AST source = child; child parent/root intact |
| 9 | `product_id` preserved | Equal on source and dest; no new `product` row |
| 10 | QR | New Asset QR; Inventory QR unchanged |
| 11 | Source Inventory preserved | GET by original ID works |
| 12 | History | `conversion_event` + holding events; no delete |
| 13 | Asset → original Inventory RETURN | Lands on source ID, not a new INV |
| 14 | Return AVAILABLE | Inventory available += q |
| 15 | Return INSPECTION | total += q, available unchanged; reason recorded |
| 16 | Return DAMAGED | same counters as 15; `reason_code` DAMAGED |
| 17 | Return with ACTIVE reservation | 409 |
| 18 | Concurrent convert 4 and 3 on available 5 | one 200, one 409 |
| 19 | Idempotent retry | same CONV id, no duplicate Assets |
| 20 | Recursive lineage | Asset child of converted Asset returns to Inventory source |
| 21 | Conservation | original = Σ inv totals + Σ converted |
| 22 | Phase 1 Product verify still passes | catalog checksum, product count |
| 23 | Phase 2 Break tests still pass | on scratch, not live HAR/MIS |
| 24 | Phase 3 reservation tests still pass | |
| 25 | No Set mutation | `managed_sets` count / components of production IDs |
| 26 | No Zoho mutation | `zoho_catalog` checksum |
| 27 | History not corrupted | production `asset_history` / event counts unchanged except disposable test rows |

Also: 401/403 on conversion POSTs; INDIVIDUAL of 2.5 rejected; Asset without conversion source rejected; assigned / project / DC Asset return rejected.

Baseline before scratch tests: assets, inventory, product links, quantities, reservations, history, QR, lineage, Sets.

---

## 29. Rollback

- Down migration: drop `conversion_event`, `conversion_line`, `conversion`; drop conversion lineage columns; drop `quantity_converted` **only if every value is 0**. Otherwise STOP — restore from `pg_dump`.
- If live ACTIVE conversions exist, rollback is dump restore, not `down()`.
- Application rollback: revert routes and Break guard; empty tables are inert.

---

## 30. Exact files that would change

Implementation (not this task):

| File | Why |
|---|---|
| `web-app/asset-manager-backend/migrations/YYYYMMDDHHMMSS_conversion_foundation.js` | Schema |
| `web-app/asset-manager-backend/services/conversionService.js` | Engine |
| `web-app/asset-manager-backend/IdGenerator.js` / `utils.js` | `CONV-` IDs |
| `web-app/asset-manager-backend/server.js` | JWT routes only, next to reservations |
| `web-app/asset-manager-backend/services/breakService.js` | Inactivate / conservation guard for unreturned conversions |
| `web-app/shared/inventoryEventSystem.js` | Catalog types for CONVERT / CONVERT_RETURN |
| `web-app/asset-manager-backend/scripts/conversion-phase4-verify.js` | Scratch tests |
| Optional minimal UI | Only if requested; no destination picker |

---

## 31. Exact files that must NOT change

| File / area | Why |
|---|---|
| `zohoService.js`, OAuth, `zoho_catalog` writers | No Zoho Product, no sync rewrite |
| `productService.js` | Conversion copies `product_id`; does not create Product |
| `kitSetService.js` | Sets are Phase 6 |
| Project assign/unassign, `POST /api/dc` | No redesign |
| `promoteToAsset`, `make-permanent` | Leave as-is |
| `/api/assets/split`, `/api/quantity/split`, unsplit | Phase 5 |
| `inventoryMovementService.js` movement registry | Do not enable CONVERT/RESERVE |
| Production compose, ports, `.env` | No prod config |
| Serial encryption / `physical_marking` backfill | Deferred |

---

## 32. Blockers

| ID | Blocker | Severity |
|---|---|---|
| B-1 | Abandoned migration `20260824120000` still unapplied — `migrate:latest` unsafe | Ops (same as Phases 1–3) |
| B-2 | Native Assets with no Inventory lineage (e.g. HAR) cannot RETURN | Expected; reject, do not invent destination |
| B-3 | Aggregated Inventory has no first-class Inspection/Damaged holdings | Accepted residual for Phase 4 (**ADR-CONVERSION-001**); future disposition engine |
| B-4 | `GET /api/projects/:id/available-inventory` still means Assets | Confusion only; do not fix here |
| B-5 | Destructive unsplit/unassign still live | Must not be called by conversion |
| B-6 | `make-permanent` remains unauthenticated | Do not “fix” as conversion work |
| B-7 | Inventory without `product_id` | Policy C-1 |
| B-8 | Phase 2 conservation function `assertConservation` does not yet add CONVERTED | Must be extended in implementation, not before |

No blocker prevents **planning**. Implementation waits on the decision matrix.

---

## 33. Open decisions

These require owner input before implementation. The matrix in §34 states the **recommendation** where evidence is sufficient.

| # | Decision | Recommendation | Why it is still open |
|---|---|---|---|
| **C-1** | Reject Inventory convert if `product_id` is null? | Allow; copy null | Canonical says identity *survives*, not that it must exist. Forcing a Product create is forbidden |
| **C-2** | If immediate Inventory source is INACTIVE, retarget quantity root? | Reject return | Silent retarget is an arbitrary destination |
| **C-3** | Inspection/Damaged accounting vs a new hold column vs Break child | **CLOSED — ADR-CONVERSION-001** | Return to original lineage; only AVAILABLE increases Available; Inspection/Damaged remain represented and unavailable. No disposition schema in Phase 4 |
| **C-4** | Return destination = immediate source vs quantity root | Immediate source | Root collapse loses Break-child identity |
| **C-5** | CONV ID format | `CONV-MMYY-XXXXXX-C` | Consistent with PRD/RSV; not yet locked by the owner |
| **C-6** | One POST `/api/conversions` vs two verb paths | One POST + `direction` | Taste; both work |
| **C-7** | Minimal production UI in Phase 4? | API + scratch tests sufficient | Owner may want a convert dialog |
| **C-8** | Copy `itemname` / make / model from Inventory to Asset | Yes, copy descriptive fields like Break children | Not identity; Product remains the invariant |
| **C-9** | Convert untracked Inventory (qty 0/null) | Reject `NOT_QUANTITY_TRACKED` | Whole-record Inventory convert is undefined |
| **C-10** | Convert Asset → Inventory when Asset was created as Asset then never converted | Reject `NO_INVENTORY_LINEAGE` | Locked brief: no arbitrary destination |

Canonical **OD-10** (partial return of individually converted Assets) is **closed** by this plan: allowed, per Asset.

Canonical **ADR-CONVERSION-001** (return disposition) is **ACCEPTED**: only AVAILABLE is Available Inventory.

Canonical **OD-13** (`temporary_assets`) remains Phase 7 — not closed here.

---

## 34. Mandatory decision matrix

| Decision | Recommendation | Reason | Phase |
|---|---|---|---|
| Partial Inventory conversion | **YES** | Locked brief; canonical §10 | 4 |
| Grouped vs individual | **Operator chooses** `GROUPED` \| `INDIVIDUAL` | Locked brief; INDIVIDUAL = qty-1 Assets, whole `N` | 4 |
| Reserved Inventory conversion | **NO** | Would lie or silently transfer the hold | 4 |
| Partially reserved Inventory conversion | **YES, available remainder only** | Example 10/4/6 convert 3; reserved untouched | 4 |
| Reserved Asset return | **NO** until reservation released/transferred | Same as reserved Inventory | 4 |
| Assigned Asset conversion/return (`assignedto`) | **NO** — explicit 409 | Phase 3 eligibility; do not override assignment | 4 |
| Project-linked Asset conversion/return | **NO** — 409 while `project_assets` exists | Do not redesign Projects | 4 |
| DC-linked Asset conversion/return | **NO** — 409 while `sentagainstdc` set | Do not redesign DC | 4 |
| Conversion from Break child | **YES** | Immediate source = child; root ancestry retained on Inventory + conversion columns | 4 |
| Asset return destination | **Always original Inventory lineage** (immediate source ID) | Locked brief; no picker | 4 |
| Return condition | **AVAILABLE / INSPECTION / DAMAGED** — only AVAILABLE increases Available Inventory (**ADR-CONVERSION-001**) | Damaged/held must not become saleable; lineage preserved; no disposition schema yet | 4 |
| Parent Asset lifecycle after return | **`lineage_status = INACTIVE`**; row kept; qty historical | Same pattern as Break inactivate; not `is_deleted` | 4 |
| Product propagation | **Copy `product_id`; never create Product/Zoho Product** | Phase 1 invariant | 4 |
| QR behaviour | **New Asset QR; Inventory QR unchanged; return uses existing Inventory QR** | Phase 2 identity | 4 |
| Conversion operation ID | **`CONV-MMYY-XXXXXX-C`** (same checksum family) | Align PRD/RSV | 4 (C-5 confirm) |
| History model | **`conversion` + `conversion_event` + dual quantity/asset_history; never DELETE** | Parallel to reservation | 4 |
| Concurrency | **`SELECT … FOR UPDATE` + conditional UPDATE** | Phase 3 proven | 4 |
| Idempotency | **Optional unique `idempotency_key`** | Same as reservations | 4 |
| Sets | **Do not implement**; refuse ACTIVE Set reservations | Phase 6 | 6 |
| `temporary_assets` / `promoteToAsset` | **Keep; do not reuse** | Wrong domain / deletes source | 7 / later |
| Legacy split/unsplit | **Keep; conversion must not call DELETE** | Phase 5 cutover | 5 |

---

*End of Phase 4 conversion plan. This document authorizes no implementation.*
