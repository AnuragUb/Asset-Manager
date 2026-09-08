# Quantity / Physical Identity — Phase 2 Plan

**Status:** PROPOSED — awaiting approval. No code written. No migration created. No schema applied.  
**Date:** 27 August 2026  
**Scope:** Quantity conservation, physical identity, QR association, Break / Make Individual lineage.  
**Environment audited:** PRODUCTION `asset-manager-prod`, database `asset_manager`, container `asset-manager-db`, port 8080 (`192.168.6.237`). The 9090 test instance was not used.

**Authoritative inputs**

- `docs/ASSETENGINE_CANONICAL_ARCHITECTURE.md` (§7 quantity, §8 identity/QR, §12 Break)
- `docs/ARCHITECTURE_GAP_ANALYSIS.md` (GAP-205–213, GAP-401–405, GAP-801–803, GAP-901)
- `docs/PRODUCT_PHASE1_IMPLEMENTATION_PLAN.md` (Product is independent of quantity)
- `docs/ASSETENGINE_COMPLETE_ARCHITECTURE_AUDIT.md` (§8–12)
- Live production schema (`information_schema`) and `server.js` as of this date
- `PROCESS_LOGIC.md` (documents **current** unsplit behaviour, not the target)

**Deliberately out of scope for this phase and this plan's future implementation**

Receipt Notes, GRN, Purchase Orders, DC, Projects redesign, Inventory → Asset conversion, Asset → Inventory return, reservation, Sets / Subset / Super Set, serial-to-Zoho synchronization, rewriting `zohoService.js`, and opportunistic security hardening of legacy unauthenticated routes.

---

## Table of contents

1. [Current-state audit](#1-current-state-audit)
2. [Current quantity model](#2-current-quantity-model)
3. [Current identity model](#3-current-identity-model)
4. [Current QR model](#4-current-qr-model)
5. [Current serial model](#5-current-serial-model)
6. [Current split paths](#6-current-split-paths)
7. [Current unsplit / merge paths](#7-current-unsplit--merge-paths)
8. [Quantity precision findings](#8-quantity-precision-findings)
9. [Proposed canonical physical identity model](#9-proposed-canonical-physical-identity-model)
10. [Proposed minimum schema](#10-proposed-minimum-schema)
11. [Conservation invariants](#11-conservation-invariants)
12. [Migration strategy](#12-migration-strategy)
13. [Compatibility strategy](#13-compatibility-strategy)
14. [Test strategy](#14-test-strategy)
15. [Rollback strategy](#15-rollback-strategy)
16. [Exact files that would change](#16-exact-files-that-would-change)
17. [Exact files that must NOT change](#17-exact-files-that-must-not-change)
18. [Blockers / open decisions](#18-blockers--open-decisions)

---

## Locked business model (restated)

These rules are already decided. Phase 2 implements them; it does not reopen them.

1. Every managed physical Asset or Inventory record has an AssetEngine identity.
2. Manufacturer serial number is optional.
3. AssetEngine ID is the system identity.
4. QR is associated with the independently managed AssetEngine record.
5. Aggregated quantity does **not** create one QR per underlying unit.
6. Break creates independently managed children, each with its own ID and QR. The parent keeps its ID, QR, history, and lineage.
7. Break is recursive.
8. Make Individual is a special form of Break.
9. Break is non-destructive.
10. Parent records are never deleted because quantity was broken.
11. Children represent separated quantity.
12. No child may exceed the available quantity of its parent.
13. Quantity must never be double-counted.
14–16. Conversion is later. Do not implement it here.
17. Do not implement Sets here.
18. Do not implement reservation here.
19. Do not implement Receipt Notes.
20. Do not implement serial-to-Zoho synchronization.

Worked aggregated example (must remain valid without children):

```
Inventory INV-001
Product: Sony WF-C500
Total represented: 10
Available:         10
QR:                INV-001
Children:          none
```

Worked Break example:

```
Original: 10

Break 3:

Parent representation: 7
Child A:               1
Child B:               2

10 = 7 + 1 + 2
```

---

## 1. Current-state audit

### 1.1 Production schema vs migrations

Production schema **does not match** Knex `.float()` on inventory. Live types on 27 August 2026:

| Table.column | Production type | Migration claim |
|---|---|---|
| `assets.id` | `varchar(255)` NOT NULL | `string` |
| `inventory_items.id` | `varchar` (unbounded) NOT NULL | `string` |
| `assets.quantity_total` / `quantity_available` | **`real`** | Knex `.float()` → `real` (matches) |
| `inventory_items.quantity_total` / `quantity_available` | **`double precision`** | Knex `.float()` would be `real` (**drift**) |
| `assets.quantity_precision` | `integer` nullable | `integer` |
| `inventory_items.quantity_precision` | `integer` default 0 | `integer` default 0 |
| `assets.qrcode` | `text` | `text` |
| `assets.client_label` | `varchar(255)` | added by `20260703000000` |
| `inventory_items.qrcode` / `noqr` / `client_label` | **absent** | never migrated |
| `assets.product_id` / `inventory_items.product_id` | `varchar(255)` NULL, FK → `product.id` | Phase 1 `20260827120000` |
| `inventory_items.quantity_note` | `text` | present |
| `assets.quantity_note` | **absent** | never migrated |

`knex_migrations` holds **33 applied files**, latest `20260827120000_create_product_foundation.js`. The abandoned draft `20260824120000_create_managed_sets_tables.js` is still **not** in `knex_migrations`. **`knex migrate:latest` remains unsafe** on production (Phase 1 blocker B-3, still live).

### 1.2 Production data volume (low — cheapest moment to change lineage)

| Object | Count |
|---|---|
| `assets` | 4 |
| `inventory_items` | 1 |
| Assets with `parentid` set | **1** (`APP-MUM-0526-MMKBX9-W` → `HAR-MUM-0726-55QOFA-R`) |
| Assets with `quantity_parent_id` | **0** |
| Assets with `quantity_root_id` | **1** (`HAR-MUM-0826-IEIZP5-U`) |
| Inventory with `quantity_root_id` | **1** (`MIS-MUM-0826-H4XVLL-W`) |
| Assets with `product_id` | **1** (`HAR-MUM-0726-55QOFA-R` → `PRD-0826-W3TB7U-Z`) |
| Inventory with `product_id` | **0** |
| `quantity_events` | 1 (`INIT` on the Set/batch asset) |
| `inventory_quantity_events` | 2 |
| `asset_history` | 25 |

Live asset flags (one row is three things at once):

| ID | qty tracked | batch | set | total / available | qty root | parentid | Product | QR |
|---|---|---|---|---|---|---|---|---|
| `APP-MUM-0526-MMKBX9-W` | 0 | 0 | 0 | 0 / 0 | — | `HAR-MUM-0726-55QOFA-R` | — | set |
| `APP-MUM-0526-PZ2J6E-8` | 0 | 0 | 0 | null | — | — | — | set |
| `HAR-MUM-0726-55QOFA-R` | 1 | 0 | 0 | 1 / 0 | **null** | — | `PRD-0826-W3TB7U-Z` | set |
| `HAR-MUM-0826-IEIZP5-U` | 1 | **1** | **1** | 1 / 1 | self | — | — | set |

Inventory `MIS-MUM-0826-H4XVLL-W`: tracked, total **3**, available **1**, unit `Nos`, root = self, no Product, no QR column.

### 1.3 What production already gets right

- Aggregated quantity does **not** auto-create per-unit children or per-unit QR (GAP-802, aligned with locked rule 5).
- Asset create assigns one AssetEngine ID and (unless `noqr`) one stored QR PNG.
- AssetEngine ID generation (`TYPE-LOC-MMYY-RAND6-EXTRA`) is independent of manufacturer serial.
- Product identity exists and is independent of quantity (`product.id` via `assets.product_id`).
- Event tables exist on both domains (`quantity_events` / `inventory_quantity_events`) and can be extended rather than replaced.
- Asset main DELETE is soft-delete (Recovery Center). The **exception** is batch unsplit / project unassign, which still hard-delete children.

### 1.4 What production contradicts (canonical vs code)

| Canonical rule | Production |
|---|---|
| Break is non-destructive; records persist | Batch unsplit and project unassign **hard-delete** the child (`server.js:11775-11776`, `:8678`) |
| Each independently managed child gets ID **and QR** | Primary UI split sets `qrcode: null` (`:11569`, `:11666`) |
| Ancestry to immediate parent and original root | Primary split sets only `parentid`. It does **not** set `quantity_parent_id` or `quantity_root_id` |
| One Break mechanism | Two incompatible split APIs (GAP-206) |
| Every Asset **and Inventory** record has QR | Inventory has no QR column, no generator, and a UI button that calls a missing `window.printAssetLabel` |
| Conservation without double counting | Only `quantity_total` + `quantity_available`; replay never compares to live columns |
| `parentid` is not multi-semantic | Split + legacy Set + sub-assembly share `parentid` (GAP-401) |
| Auth on Break | `POST /api/assets/split` and `POST /api/quantity/split` have **no** `authenticateJWT` |

`PROCESS_LOGIC.md` §2 documents the **legacy** unsplit rule ("batch: merge qty and delete child"). That document matches current code. The **canonical** document is the target. Phase 2 must not treat `PROCESS_LOGIC.md` as the destination.

---

## 2. Current quantity model

### 2.1 Two buckets, one row is the truth

Both `assets` and `inventory_items` store:

- `quantity_total` — treated as "how much this row currently represents"
- `quantity_available` — treated as "how much of this row can still be taken"

There is **no** stored original/received quantity, **no** separated quantity, **no** reserved quantity, **no** converted quantity. GAP-209.

When `/api/assets/split` breaks 3 from 10, it writes parent `quantity_total = 7` and `quantity_available = 7`. The original 10 exists only if children still exist and someone sums them. After destructive unsplit, even that sum is gone.

### 2.2 Two engines, neither is sole source of truth

| Domain | Engine | Writer | When the row is updated |
|---|---|---|---|
| Asset (event path) | `applyQuantityEvent` (`server.js:1997`) | `quantity_events` + `quantity_event_lines`, then the asset row | Same transaction as the event |
| Asset (UI split path) | Direct SQL | **No** quantity event | `/api/assets/split` decrements parent and inserts child directly |
| Asset (edit path) | Direct SQL on `PUT /api/assets/:id` | **No** quantity event | Quantity fields can diverge from events |
| Inventory | Direct SQL first | Then `recordInventoryQuantityEvent` as an audit note | Row is authoritative; event is narrative |

`GET /api/quantity/replay/:rootId` (`server.js:7345`) sums event-line deltas and **does not compare** them to live columns. The code comment at the asset PUT path (`server.js:9003-9004`) states that when invariants break, the user fixes them in the qty-events UI.

### 2.3 Flags that change what a row *is*

`is_quantity_tracked` and `is_batch` live on both tables. `is_set` lives on assets. Nothing prevents all three being true. Production `HAR-MUM-0826-IEIZP5-U` is quantity-tracked **and** batch **and** a legacy Set.

Unsplit branches on `IsBatch || IsQuantityTracked` (`server.js:11760`). A Set that is also quantity-tracked therefore takes the **destructive batch path**, not the Set-preserve path.

### 2.4 Units

`quantity_unit` is free text, trimmed by `normalizeQtyUnit` (`server.js:1688-1690`). No registry, no FK, no validation against `product.unit`. Production values: `Nos`, `pcs`. Empty unit **blocks** `/api/quantity/split` (`:6626`) but does **not** block `/api/assets/split` (defaults child unit to `'pcs'`).

Related but different fields:

| Field | Meaning today |
|---|---|
| `quantity_unit` | Label on the holding ("Nos") |
| `product.unit` | Commercial Product UOM from Phase 1; **not** wired to holdings |
| `conversion_unit` / `conversion_factor` / `conversion_mode` | Client-side unit-rename tool; persisted on save; **not** applied by split/consume |

### 2.5 Inventory quantity in production

The single inventory row already shows consume-shaped drift: total 3, available 1. `CONSUME` is the only enabled inventory movement (`inventoryMovementService.js`). Consume decrements **both** total and available together, which erases "ever received" (GAP-209). Phase 2 must not implement conversion or reservation, but it **must not** further encode "total = currently remaining" as if it were original received quantity.

---

## 3. Current identity model

Four identity-like values exist. Only one is the system identity.

| Value | Where | Role | Immutable? |
|---|---|---|---|
| **AssetEngine ID** | `assets.id` / `inventory_items.id` | System identity | Intended yes; not trigger-protected |
| **QR PNG / URL** | `assets.qrcode` | Rendering of a lookup URL | No; regenerable |
| **Client label** | `assets.client_label` | Human/public label; rewritten on project split | No |
| **Manufacturer serial** | `assets.srno` (encrypted), `inventory_items.srno` (plaintext) | Optional vendor marking | No; freely editable; not unique |

There is **no second ID namespace** for physical units. When a batch is split, departing units receive a **new** `generateModernAssetId` value. Units that stay keep the parent ID. "Which physical object is this?" cannot be answered from the ID alone after a split — the ID identifies the **managed record**, not a manufacturer unit. That is acceptable under the locked model **if** the record is the thing being managed (aggregated or broken). It is not acceptable to then delete the child record.

### 3.1 ID generation

`IdGenerator.generateAssetId` (`IdGenerator.js:2-23`): `TYPE-LOC-MMYY-RAND6-EXTRA`. Trailing character is **random**, not a checksum (Phase 1 already established this). Assets and inventory share this generator (`server.js:5063`) — GAP-152, shared ID space. Collision is possible across tables; `trg_check_assets_dup` only guards `assets` vs `components`.

`generateSplitAssetId(parentId, index)` (`IdGenerator.js:41-43`) returns `{parentId}-{index+1}`. Called by `/api/quantity/split` **without** `index` → `{parentId}-NaN` (`server.js:6646`). The primary UI never calls it.

Product IDs (`PRD-MMYY-XXXXXX-C`) are a separate namespace. Splitting must **copy** `product_id`, never mint a Product.

### 3.2 Lineage columns that already exist and are unused by the primary split

| Column | Intended role | Who writes it today |
|---|---|---|
| `quantity_parent_id` | Immediate quantity parent | `/api/quantity/split`, `make-set` batch segmentation. **Not** `/api/assets/split` |
| `quantity_root_id` | Event grouping / original root | Asset create INIT; inventory create. **Not** `/api/assets/split` |
| `parentid` | Overloaded: Set member, split child, sub-assembly | Primary split, make-set, create `linkedIds` |

**Recommendation:** do not invent a third lineage column. Make `quantity_parent_id` / `quantity_root_id` the Break lineage (they already exist on both tables). Stop using `parentid` for Break. Leave `parentid` to legacy Sets until the Set phase (GAP-401 still has only **one** production row to classify).

---

## 4. Current QR model

QR is **not** identity. It is a picture of a URL that points at an identity.

### 4.1 Five mechanisms (assets)

| # | Mechanism | Encodes | Auth |
|---|---|---|---|
| 1 | Stored `assets.qrcode` PNG at create (`server.js:6416-6428`) | `http://{STATIC_IP\|\|getLocalIP()}:{PORT}/asset/{id}` | create is JWT |
| 2 | `GET /api/qr/:id` | Same URL shape; may persist back | none |
| 3 | `GET /api/qr/generate/:text` | Arbitrary text | none |
| 4 | `GET /api/qr/dynamic/asset/:id` | `req.get('host')` — correct host | none |
| 5 | Public `/api/public/assets/:label` | Lookup by `client_label` | none; rejects labels containing `-MUM-` |

Production `STATIC_IP` is unset, so stored QR encodes the Docker bridge IP (`172.18.0.4:8080` historically) — unreachable from a phone (GAP-803). Dynamic QR is the working scan path.

Default `client_label` is `KIND-LOC-RAND6` (e.g. `HAR-MUM-55QOFA`). The public endpoint **forbids** `-MUM-`, so most real labels 403. Project split rewrites the label to `KIND-PROJECTINITIALS-RAND6`, which can pass. Client label is therefore a mutable display key, not identity.

### 4.2 Split children

| Path | Child QR |
|---|---|
| `/api/assets/split` (the UI path) | **`qrcode: null`** |
| `/api/quantity/split` | Generated unless `child.NoQR` |
| `/api/quantity/issue` / `consume` | Generated |

Aggregated records: one QR per row. Aligned. Broken children on the live UI path: **no QR**. Not aligned.

### 4.3 Inventory

No `qrcode`, `noqr`, or `client_label` columns. `inventory.js:2117-2118` calls `window.printAssetLabel`, which **does not exist**. Details links reuse `/asset/{inventoryId}`.

Phase 2 must add Inventory QR association. It must **not** redesign the five asset QR mechanisms in this phase (locked: "Do NOT redesign QR yet" as a wholesale rewrite). Additive inventory columns + generate QR on Break children using the existing `qrcode` library is in scope. Changing stored URL host strategy can be a listed open decision (B-QR), not a silent rewrite of `GET /api/qr/dynamic`.

---

## 5. Current serial model

| Fact | Assets | Inventory |
|---|---|---|
| Column | `srno` (encrypted deterministic), `serialno` (bulk import) | `srno` plaintext, `serialno` unused |
| Uniqueness | None | None |
| Multi-serial | `is_batch=1`; comma/newline string in one `srno` | Flag exists; no inventory serial split |
| Split | `/api/assets/split` `{ serials: [] }` decrypts, removes selected serials, force-syncs parent qty to remaining count, creates one child per serial with `is_quantity_tracked=0` | No path |
| Quantity split copies | Child gets **parent's entire `srno` string** (`server.js:11557`) — the same serial text now lives on two rows | — |
| Zoho | Encrypted `srno` embedded in Product descriptions (GAP-111) | — |

Canonical §7: structured subordinate records replace comma-separated serial text. Phase 2 **designs** that structure (`physical_marking`, §10). It does **not** migrate existing ciphertext into Zoho, does **not** unique-index manufacturer serials yet, and does **not** change `zohoService.js`.

Make Individual (special Break) is the replacement for "explode this comma list into N child records." Until that engine exists, `is_batch` + `srno` remains a compatibility representation.

---

## 6. Current split paths

Two HTTP endpoints. They must not be modified in this planning task. They also must not both remain as Break engines.

### 6.1 `POST /api/assets/split` — the live UI path

| | |
|---|---|
| File | `server.js:11417` |
| Auth | **None** |
| Callers | `dashboard.js:6652, 6750, 6801` (no JWT); `projects.js:2312` |
| Body | `{ parentId, serials?, quantity?, autoAssign?, projectId? }` |

**Quantity mode** (`quantity` set, no `serials`):

| Item | Behaviour |
|---|---|
| Creates | One new `assets` row **or** merges qty into an existing child for the same project/assignee |
| Child ID | `generateModernAssetId(location, type)` — new random ID |
| Parent fields changed | `quantity_total -= n`, `quantity_available -= n`, `lastupdated` |
| Lineage | `parentid = parentId` only. **`quantity_parent_id` / `quantity_root_id` unset** |
| Child qty | `is_quantity_tracked=1`, `is_batch=0`, total=available=`n` |
| QR | `null` |
| Product | **`product_id` not copied. `zoho_product_id` not copied** |
| History | `asset_history`: `SPLIT_CHILD_CREATED`, `QUANTITY_REDUCED`, `QUANTITY_INCREASED` (merge) |
| Quantity events | **None** |
| Failure | 400 missing params; 404 parent; qty ≤ 0 or qty > available; 500 on transaction |

**Serial mode**:

| Item | Behaviour |
|---|---|
| Creates | One child per selected serial |
| Parent | Rewrites encrypted `srno`; force-sets total=available=remaining serial count |
| Child | Single encrypted serial; `is_quantity_tracked=0`; `qrcode: null`; `parentid` set |
| History | `SPLIT_CHILD_CREATED`, `SPLIT_PARENT_UPDATED` |

### 6.2 `POST /api/quantity/split` — event-sourced, unused by UI, currently broken

| | |
|---|---|
| File | `server.js:6613` |
| Auth | **None** |
| Callers | **None** in frontend |
| Body | `{ parentId, amount, note?, child?: { ItemName, Status, AssignedTo, QRCode, NoQR, ... } }` |

| Item | Behaviour |
|---|---|
| Parent lookup | `getQuantityAsset(parentId)` **without `await`** (`:6624`) — the value is a Promise; `quantity_root_id` is always falsy → **route returns 400** for every real request |
| Child ID | `generateSplitAssetId(parentId)` without index → `{parentId}-NaN` |
| Lineage | Sets **both** `parentid` and `quantity_parent_id` / `quantity_root_id` |
| Qty | Child inserted at 0/0; `applyQuantityEvent` type `SPLIT` moves `amount` from parent to child (both total and available) |
| QR | Generated unless `NoQR` (uses `getLocalIP()` + `PORT \|\| 9090`) |
| History | `appendAudit` `QTY_SPLIT` only — **no** `asset_history` |
| Product | Not copied |
| Requires | Parent must already have `quantity_root_id` **and** `quantity_unit`. Production `HAR-MUM-0726-55QOFA-R` is quantity-tracked but has **null** root, so it could not use this path even after the `await` fix |

### 6.3 Related quantity-mutation routes (not Break, but adjacent)

| Route | Auth | Creates children? |
|---|---|---|
| `POST /api/quantity/issue` | **None** | Yes (event-sourced) |
| `POST /api/quantity/consume` | **None** | Yes |
| `POST /api/quantity/adjust` | `requireAdmin` (not JWT) | No |
| `POST /api/assets/make-set` | JWT | Segments qty onto set-head / children; writes `quantity_parent_id` |
| `POST /api/assets/break-set` | JWT | Detaches Set member; **not** quantity Break |
| Inventory split | — | **Does not exist** |

### 6.4 Can they merge into one future Break engine?

**Yes, and they must.** They cannot both remain. The UI path has the callers and the wrong lineage/QR/Product behaviour. The quantity path has the right lineage *shape* and the wrong ID generator, a blocking bug, no UI, and no inventory support.

Phase 2 should introduce **one** authenticated Break service used by both Asset and Inventory holdings, then leave the old routes in place as compatibility shims or retire them behind a feature flag (decision B-3). Do not "fix in place" both endpoints independently — that is how GAP-206 was created.

---

## 7. Current unsplit / merge paths

Every location that deletes children, restores parents, changes quantity, or orphans history:

### 7.1 `POST /api/assets/unsplit` — `server.js:11710` — **JWT**

| Case | Parent flags | Child fate | Parent qty | History |
|---|---|---|---|---|
| Batch / quantity | `IsBatch \|\| IsQuantityTracked` | **Hard-delete** `assets` and `components`; delete `project_assets` | `total` and `available` **+=** child total | `SPLIT_CHILD_RESTORED` on **parent only**. Child `asset_history` rows remain, pointing at a missing ID |
| Legacy Set | else | Child **kept**; `parentid` cleared; status `In Store`; location `Mumbai` | Unchanged | `BREAK_SET` on child |

Does not reverse `quantity_events`. Does not touch `quantity_parent_id`. Hits `ON DELETE RESTRICT` if the child is an active Managed Set component (GAP-208) — raw 500.

Callers: `dashboard.js:6552` (JWT); `asset-view.js:543`; `projects.js:2933`.

### 7.2 `DELETE /api/projects/:id/unassign-asset/:assetId` — `server.js:8635` — **JWT**

Same destructive merge for batch/quantity split children (`:8665-8678`): restore parent qty, **hard-delete** child, `SPLIT_CHILD_RESTORED` on parent. Set children are preserved.

### 7.3 In-split merge (not unsplit)

`/api/assets/split` quantity mode, if a child already exists for the same project or assignee, **adds qty into that child** instead of creating a new row (`:11469-11526`). History: `QUANTITY_INCREASED` on the existing child. No new ID, no new QR. This is operational reuse of a child record, not canonical MERGE_BACK.

### 7.4 What is absent

- No `/api/quantity/unsplit`
- No inventory unsplit
- No event-sourced reverse-SPLIT
- No inactive/lineage-safe merge
- No generic MERGE that respects Set membership (canonical §12)

**Phase 2 target:** replace destructive unsplit with lineage-safe inactivation (child remains queryable; parent available increases; child's quantity is no longer counted). Do not implement that replacement in this document's "plan only" step — design it so the future migration can add `lineage_status` before any code stops deleting.

---

## 8. Quantity precision findings

### 8.1 Where it is stored

- `assets.quantity_precision` — integer, nullable
- `inventory_items.quantity_precision` — integer, default 0

Production: all non-null values are **0**.

### 8.2 Where it is written

- Asset create: parsed, then passed into `applyQuantityEvent` INIT (`server.js:6438-6516`)
- `applyQuantityEvent`: `COALESCE(quantity_precision, ?)` onto the row (`:2039-2049`)
- `/api/quantity/split`: copied onto the child (`:6630, :6692`)
- Frontend save: `Math.floor(qtyPrecision)` (`dashboard.js:7950`)
- Inventory create/update: persisted as an integer

### 8.3 Where it is read

- Returned on asset detail (`server.js:3602`)
- Copied to children on the event-sourced path
- **Never** used as the number of decimal places for rounding, display, or validation

### 8.4 Where it is ignored

- Backend writes use `parseQtyNumber` / `parseFloat` / raw SQL `+ delta` with **no** `toFixed(precision)`
- Inventory modal inputs use `step="1"` regardless of precision (`inventory.js:1797`)
- Precision 0 and precision 2 behave identically
- Asset `PUT` can change totals without an event and without rounding

### 8.5 Current conversion logic and `toFixed(4)`

`dashboard.js:1885-1918` (asset modal "Unit Conversion Tool"):

1. Read `conversion_unit`, `conversion_factor`, `conversion_mode` (`multiply` \| `divide`)
2. `newQty = (currentQty * factor).toFixed(4)` or `/ factor`
3. Write the string back into the **form** `quantity_total` and `quantity_unit`
4. Persist on Save via `conversion_*` columns (`server.js:6471-6473`, update `:9164-9166`)

This is a **client-side unit rename**. It does not convert children, does not write a quantity event, and does not run on split/consume. Four decimal places are hard-coded, so a holding declared as precision 0 still shows 1.0000 internally then `parseFloat` strips trailing zeros.

### 8.6 Why hard-coded `toFixed(4)` is problematic

- It disagrees with the stored `quantity_precision`.
- `real` (assets) cannot represent many 4-decimal decimal values exactly; `double precision` (inventory) disagrees with `real` across conversion (GAP-210).
- Conservation (`10 = 7 + 3`) is not defined in binary floating point.
- A later UOM registry cannot round correctly if write paths ignore declared precision.

### 8.7 Proposed future precision / UOM design (do not implement now)

1. Store holding quantities as PostgreSQL **`numeric`**, not `real` / `double precision`.
2. Treat `quantity_precision` as **scale**: every write rounds with `numeric` scale `p`, reject deltas that are not representable at that scale.
3. Keep `quantity_unit` as the holding's unit label until a unit registry exists. Do not silently couple it to `product.unit` (Product UOM is commercial; holding UOM is physical).
4. Conversion of unit (rename kg→g) becomes an explicit **ADJUST** event pair on the same record, rounded to `quantity_precision`, never a form-only `toFixed(4)`.
5. Display uses the stored scale, not a global 4.

Phase 2 implementation may **change column types to `numeric`** as part of the named migration (decision B-2) because conservation cannot be asserted on `real`. It should **not** yet build a unit registry or change the conversion UI beyond stopping new Break writes from using `parseFloat` without rounding.

---

## 9. Proposed canonical physical identity model

### 9.1 One identity system

The managed record **is** the physical identity.

```
AssetEngine ID  =  assets.id  |  inventory_items.id
```

Do **not** create `PI-…`, `QTY-…`, or per-unit surrogate IDs. Do **not** make manufacturer serial, box serial, QR PNG, or `client_label` into identity.

```
AssetEngine ID     system identity (immutable)
QR                 representation of a lookup to that ID
client_label       mutable human/public caption
manufacturer SN    optional marking on the record
box / container SN optional marking on the record
product_id         catalogue identity (Phase 1); copied on Break; never minted by Break
```

### 9.2 Aggregation vs Break

| State | Records | QR | Lineage |
|---|---|---|---|
| Aggregated (e.g. qty 10) | **One** Asset or Inventory row | **One** QR | `quantity_root_id = self`, `quantity_parent_id` null, `lineage_status = ACTIVE` |
| After Break 3 into A(1)+B(2) | Parent + two children | Three QRs | Children: parent_id = parent, root_id = original root |

No automatic 10-child explosion. Make Individual is an explicit Break that happens to produce qty-1 children (or serial-bearing children), each still a first-class record.

### 9.3 Recursive Break

```
ROOT (original 10)
 ├── CHILD-1 (2)     ACTIVE
 └── CHILD-2 (8)     ACTIVE
      └── GRAND (3)  ACTIVE     CHILD-2 now represents 5
```

Every descendant stores:

- `quantity_parent_id` — immediate parent
- `quantity_root_id` — original root (never rewritten on recursive Break)
- `lineage_status` — `ACTIVE` \| `INACTIVE`

An INACTIVE child remains in the table. Its quantity is **not** counted in conservation. That is how merge/unsplit becomes non-destructive.

### 9.4 Domain

Break is **intra-domain**. An Asset parent produces Asset children. An Inventory parent produces Inventory children. Crossing Asset ↔ Inventory is conversion (Phase 3), not Break.

### 9.5 Product

`product_id` is copied from parent to every child. Break does not create a Product. A null `product_id` stays null (legacy rows). Phase 2 does not backfill Products.

---

## 10. Proposed minimum schema

Additive unless noted. No drops. No Zoho tables.

### 10.1 Columns to **retain** as canonical

| Column | Role after Phase 2 |
|---|---|
| `assets.id` / `inventory_items.id` | AssetEngine identity |
| `quantity_parent_id` | Immediate Break parent (add FKs; currently no FK) |
| `quantity_root_id` | Original root / event group (add FKs) |
| `quantity_unit` | Holding UOM label |
| `is_quantity_tracked` | Whether quantity terms apply |
| `product_id` | Product link; propagate on Break |
| `quantity_events` + `quantity_event_lines` | Asset event log (extend types: `BREAK`, `BREAK_INACTIVATE`) |
| `inventory_quantity_events` + `_lines` | Inventory event log (same) |
| `assets.qrcode` / `noqr` | QR image cache / skip flag (compatibility store) |
| `assets.client_label` | Client-facing label |

### 10.2 Additive columns / tables

**On both `assets` and `inventory_items`:**

| Column | Type | Null | Notes |
|---|---|---|---|
| `lineage_status` | `varchar(16)` | NO | default `ACTIVE`; CHECK `IN ('ACTIVE','INACTIVE')` |
| `quantity_original` | `numeric` | YES | Set once at INIT on the **root**. Never decremented by Break. Null on non-tracked rows and on children (children do not carry original). |

**On `inventory_items` only:**

| Column | Type | Notes |
|---|---|---|
| `qrcode` | `text` | PNG data URL, same as assets |
| `noqr` | `integer` default 0 | |
| `client_label` | `varchar(255)` | `KIND-LOC-RAND6` at create |

**Type change (decision B-2, recommended in the same named migration):**

`quantity_total`, `quantity_available`, `quantity_original`, inventory `conversion_factor` → `numeric` (propose `numeric(18,6)` physically, with application rounding to `quantity_precision`). This is the one non-purely-additive step; it is required for conservation.

**New table `physical_marking` (future serial storage, unused by Zoho in this phase):**

| Column | Type | Notes |
|---|---|---|
| `id` | `varchar(255)` PK | New ID, not a second physical identity |
| `holding_type` | `varchar(16)` | `ASSET` \| `INVENTORY` |
| `holding_id` | `varchar(255)` | AssetEngine ID of the managed record |
| `kind` | `varchar(32)` | `MANUFACTURER_SERIAL` \| `BOX_SERIAL` \| `OTHER` |
| `value` | `text` | Plain (encryption policy is a later decision; do not copy asset ciphertext blindly) |
| `status` | `varchar(16)` | `ACTIVE` \| `INACTIVE` |
| `created_at` / `updated_at` | timestamptz | |

No uniqueness on `value` in Phase 2. No Zoho writer. Existing `srno` strings are **not** auto-parsed into this table in Phase 2 (too lossy / encrypted). Make Individual may *write* new rows here when exploding a batch, as a later increment inside Phase 2 implementation if B-6 is approved; the table itself is the minimum to stop inventing another serial column.

Optional CHECKs:

- `quantity_parent_id` FK to same table `id` `ON DELETE RESTRICT`
- `quantity_root_id` FK to same table `id` `ON DELETE RESTRICT`
- Child `quantity_original` IS NULL
- `lineage_status = 'INACTIVE'` implies the row is not offered as Break source

### 10.3 Compatibility fields (keep, stop being Break truth)

| Column | Keep because | Stop using for |
|---|---|---|
| `parentid` | Legacy Sets / the one production child row | Break lineage (write `quantity_parent_id` instead) |
| `srno` / `serialno` / `is_batch` | Existing batch UI | System identity; new Break children should not clone the parent's full serial blob |
| `zoho_product_id` | Legacy Zoho readers | Product identity (use `product_id`) |
| `conversion_unit` / `factor` / `mode` | Existing modal | Break / conservation |
| `quantity_precision` | Declared scale | Until write paths honour it, it stays decorative **except** new Break writes should round |

### 10.4 Deprecated later (not dropped in Phase 2)

- `/api/assets/split` and `/api/quantity/split` as Break engines (shim then remove in a later cleanup)
- Destructive unsplit / unassign-delete
- Comma-separated `srno` as the only multi-unit representation
- `generateSplitAssetId` `{parent}-NaN` usage
- Hard-coded `toFixed(4)` conversion UI

### 10.5 Replaced later (other phases)

| Concept | Phase |
|---|---|
| `quantity_reserved` / reservation engine | Reservation phase (columns may be stubbed nullable — decision B-5) |
| `quantity_converted` + `source_inventory_id` | Phase 3 conversion |
| `parentid` disambiguation / drop for Sets | Set phase (GAP-401) |
| Serial uniqueness + Zoho serial mapping | Serial/Zoho phase |
| Unit registry | After precision is real |

**Do not stub reservation or conversion columns unless B-5 explicitly asks for empty nullable columns.** Default: document the terms in §11, add columns when those phases land, so Phase 2 schema stays minimum.

### 10.6 What not to duplicate

- Do not add `physical_identity.id` parallel to `assets.id`.
- Do not add `qr_id` as a second primary key; QR remains a representation.
- Do not add `sets` / `set_components` (abandoned migration).
- Do not add Product quantity columns.

---

## 11. Conservation invariants

Define terms on a **root** holding `R` and the tree of records with `quantity_root_id = R.id`.

| Term | Phase 2? | Meaning |
|---|---|---|
| **ORIGINAL** | Yes | `R.quantity_original`. Set at INIT. Never reduced by Break. |
| **REPRESENTED(row)** | Yes | `row.quantity_total` while `lineage_status = ACTIVE`. Amount this record currently stands for. |
| **AVAILABLE(row)** | Yes | `row.quantity_available`. May be Break-sourced. `0 ≤ available ≤ represented`. |
| **SEPARATED(row)** | Yes (derived) | Sum of `REPRESENTED` of **ACTIVE** direct children. Not a stored bucket. |
| **RESERVED** | No | Future: held against a relationship; still physically this record. |
| **CONVERTED** | No | Future: moved to the other operational domain; source record remains. |
| **TERMINAL** | No | Future: consumed, sold, retired, written off, damaged, hold — named dispositions. |

### 11.1 Aggregated (no children)

```
ORIGINAL = REPRESENTED(parent) = AVAILABLE(parent)
SEPARATED = 0
```

Example: INV-001 qty 10, no children. One QR.

### 11.2 After Break (Phase 2 equation)

For any ACTIVE record `P`:

```
REPRESENTED(P) = AVAILABLE(P) + SEPARATED(P)
```

For the root:

```
ORIGINAL(R) = Σ REPRESENTED(A)   for all ACTIVE nodes A in the tree
```

Worked:

```
ORIGINAL = 10
Break 3 into Child A (1) and Child B (2)

Parent REPRESENTED = 7, AVAILABLE = 7, SEPARATED = 3
Child A REPRESENTED = 1
Child B REPRESENTED = 2

10 = 7 + 1 + 2
```

Child quantity **must not exceed** parent AVAILABLE at the moment of Break. After the write, parent AVAILABLE has already decreased.

### 11.3 Recursive Break

Same equation at every node. Grandchild quantity comes out of the child's AVAILABLE, not directly from the root. Root ORIGINAL is unchanged.

### 11.4 Inactivate (future replacement for unsplit)

Child `lineage_status → INACTIVE`. Child REPRESENTED no longer enters the sum. Parent `REPRESENTED` and `AVAILABLE` increase by that amount. Child row, ID, QR, history remain. No double count because INACTIVE is excluded.

### 11.5 Future reserved / converted (explain only)

When those phases land, the root equation becomes the canonical §7.2 form:

```
ORIGINAL
  = AVAILABLE
  + RESERVED
  + SEPARATED          (ACTIVE children)
  + CONVERTED
  + TERMINAL
```

Break still has **no** "reserved by break" bucket. Converted quantity is not available Inventory. Reserved quantity is not separated.

Until then, consume-like inventory behaviour (total and available both drop) is a **TERMINAL** leak that Phase 2 must not encode as ORIGINAL changing. New Break writes must not decrement `quantity_original`.

### 11.6 Double-count guards

1. A unit in an ACTIVE child is not also in parent AVAILABLE.
2. INACTIVE children contribute 0.
3. Replay of BREAK events must equal live `numeric` columns at the declared scale (replace today's replay-without-compare).
4. No Break across Asset/Inventory.

---

## 12. Migration strategy

Follow Phase 1 exactly. Production schema ≠ migration files.

### 12.1 Before any future migration

1. `pg_dump` of `asset_manager` into `backups/8080_prod/` (mandatory).
2. Record baseline checksums: asset/inventory IDs, quantity triples, `parentid` / `quantity_*`, `product_id`, `asset_history` count, both event tables, `managed_sets`.
3. Confirm `knex_migrations` still ends at `20260827120000_create_product_foundation.js` and that `20260824120000_create_managed_sets_tables.js` is **not** applied.
4. Restore dump into a **scratch** database on the same server.
5. Generate DDL via Knex `toSQL()`; review line by line against §10.
6. Apply **only** the named Phase 2 migration on scratch.
7. Run §14 tests on scratch.
8. Production apply only after scratch pass and plan approval.

### 12.2 Apply

```
npx knex migrate:up --name <timestamp>_quantity_physical_identity.js
```

**Never** `migrate:latest` on production while the abandoned Sets draft remains in `migrations/`.

Suggested `up()` order (structural only; no DML except `UPDATE … SET lineage_status = 'ACTIVE'` defaults and `quantity_original = quantity_total` **only** where `quantity_root_id = id` AND no ACTIVE children — safe on current production: 1 asset root, 1 inventory root):

1. `numeric` type change for quantity columns (if B-2 approved).
2. Add `lineage_status` + CHECK, default `ACTIVE`.
3. Add `quantity_original`.
4. Add inventory `qrcode`, `noqr`, `client_label`.
5. FKs on `quantity_parent_id` / `quantity_root_id` (same-table, RESTRICT).
6. Create `physical_marking`.
7. Backfill `quantity_original` on current roots from live `quantity_total` (documented DML; reversible).

No Zoho writes. No Product writes except the type of existing `product_id` columns (unchanged). No Set writes.

### 12.3 After schema, before cutting over Break

Keep old split routes working. Ship the new authenticated Break service. Wire UI to the new service. Only then stop writing Break lineage onto `parentid`. Destructive unsplit stays until the inactivate path is proven on scratch — then disable delete in unsplit for quantity parents.

---

## 13. Compatibility strategy

Phase 2 must not break dashboard Assets, inventory workspace, Product list, or Managed Sets.

| Existing behaviour | During Phase 2 |
|---|---|
| Aggregated holdings with one QR | Unchanged |
| `/api/assets/split` | Keep until UI cutover; then shim to Break service or 410 with message (B-3) |
| `/api/assets/unsplit` destructive path | Keep until inactivate path ships; document as known-unsafe |
| `parentid` on `APP-MUM-0526-MMKBX9-W` | Untouched (GAP-401 classification, B-1) |
| `srno` encryption on assets | Untouched; no Zoho serial work |
| `product` tables / `/api/products` | Untouched except Break copies `product_id` |
| `zoho_catalog` / `zohoService.js` | Untouched |
| `managed_sets` | Untouched |
| Unauthenticated legacy quantity routes | **Not fixed** in this phase (user instruction). New Break routes **are** JWT + role |

Frontend: dashboard split/unsplit and inventory print-QR are the only UI touch points. Do not refactor `dashboard.js` wholesale.

---

## 14. Test strategy

Scratch database first. No production Break until scratch is green.

### 14.1 Conservation

1. Aggregated 10: ORIGINAL=10, no children, one QR.
2. Break 3 → parent 7 + child 3: `10 = 7 + 3`; parent AVAILABLE ≥ 0; child ≤ parent available-at-request.
3. Reject Break 11 from 10.
4. Recursive Break on the child; root ORIGINAL still 10; sum of ACTIVE represented = 10.
5. Make Individual × 3 from 3: three qty-1 children, parent represented 0 or remaining; three new IDs, three QRs, parent QR unchanged.
6. Inactivate one child: parent available restored; child row still selected by ID; history intact; sum still = ORIGINAL.
7. Float regression: `0.1 + 0.2` style splits on `numeric` equal ORIGINAL at declared scale.

### 14.2 Identity / Product / QR

8. Child ID is `generateModernAssetId` (or approved generator), unique, not `{parent}-NaN`.
9. Child `product_id` equals parent `product_id` (including null).
10. Child has QR unless `noqr`; parent `qrcode` bytes unchanged.
11. Inventory aggregated row can receive QR + `client_label` without creating children.
12. No extra Product rows. No `zoho_catalog` change.

### 14.3 Lineage

13. `quantity_parent_id` / `quantity_root_id` set on every Break child.
14. `parentid` **not** required for Break (legacy Set row still has its `parentid`).
15. INACTIVE child cannot be a Break source.

### 14.4 Non-goals (must stay green)

16. Asset IDs of the four production assets unchanged by migration.
17. Inventory ID unchanged.
18. Set tables checksum unchanged.
19. Product count unchanged.
20. Zoho OAuth regression scripts still pass (no `zohoService.js` edit).
21. Destructive unsplit still functions until explicitly cut over (compatibility test), then a second test proves it no longer deletes.

### 14.5 Auth

22. New Break POST without JWT → 401.
23. Out-of-role → 403.
24. Do **not** fail the phase if `/api/assets/split` remains unauthenticated (documented debt).

---

## 15. Rollback strategy

`down()`:

1. Drop `physical_marking`.
2. Drop inventory `qrcode`, `noqr`, `client_label`.
3. Drop FKs on quantity parent/root.
4. Drop `quantity_original`, `lineage_status`.
5. If types were changed to `numeric`, restore prior `real` / `double precision` **only if** no Break data exists that depends on extra scale; otherwise restore from the §12.1 dump.

Application rollback: revert Break service + route registration; UI keeps calling `/api/assets/split`. No Zoho rollback. No Product rollback.

If Break already created children in production: dump restore is the only complete undo for those rows. Therefore production Break is gated on scratch proof.

---

## 16. Exact files that would change

**Future implementation only. Not in this task.**

**New**

1. `web-app/asset-manager-backend/migrations/<ts>_quantity_physical_identity.js`
2. `web-app/asset-manager-backend/services/breakService.js` (single Break / inactivate engine)
3. Optionally `web-app/asset-manager-backend/scripts/quantity-phase2-verify.js`

**Modified (surgical)**

4. `web-app/asset-manager-backend/server.js` — register authenticated Break routes; do not rewrite the file
5. `web-app/asset-manager-backend/IdGenerator.js` — only if a child-ID helper is added; do not change `generateAssetId` random extra char
6. `web-app/asset-manager-frontend/js/dashboard.js` — point split/unsplit UI at Break; generate child QR
7. `web-app/asset-manager-frontend/js/inventory.js` — inventory QR print using a real function; later Inventory Break UI
8. `web-app/asset-manager-frontend/index.html` — cache-buster on touched JS only
9. `PROCESS_LOGIC.md` — replace batch "delete child" with lineage-safe inactivate **when behaviour actually changes**

---

## 17. Exact files that must NOT change

- `services/zohoService.js` — no serial push, no OAuth, no Product dual-write
- `services/kitSetService.js`, Managed Sets migrations, `js/kitSets.js`
- `services/productService.js`, Product migration, `js/products.js` (except Break copying `product_id` in `breakService` / `server.js`)
- `zoho_tokens.txt`, `.env`, OAuth config, `zoho_resources/`
- Abandoned `20260824120000_create_managed_sets_tables.js` (do not apply)
- Receipt / GRN / PO / DC / project Kanban modules
- Conversion routes (none exist — do not add them)
- Reservation / `inventoryMovementService` enablement of RESERVE
- Production compose, ports, replication
- Unrelated unauthenticated routes (DC, employees, bulk, scan) — do not "while we are here" JWT-wrap them

---

## 18. Blockers / open decisions

**B-1 · Classify the one `parentid` row (`APP-MUM-0526-MMKBX9-W` → `HAR-MUM-0726-55QOFA-R`) before Break starts writing a second meaning.** GAP-401. Options: leave as legacy Set/sub-assembly and never treat it as a Break child; or migrate it onto `quantity_parent_id` if it is actually a split. Do not guess.

**B-2 · Change quantity columns to `numeric` in the Phase 2 migration?** Recommended yes. Conservation on `real` vs `double precision` is not assertable. Confirm, because it is a type change on live columns.

**B-3 · Cutover shape.** (a) New `/api/break` + `/api/break/inactivate` and leave old split routes untouched until UI moves; (b) make old split call `breakService` internally. Recommend (a) so a failure does not change the unauthenticated public split surface unexpectedly.

**B-4 · Inventory QR columns in this same migration?** Locked rule 1+4 require it for Inventory as a managed record. Recommend yes. Generating QR for the existing `MIS-MUM-0826-H4XVLL-W` row is a one-row backfill decision (yes/no).

**B-5 · Stub `quantity_reserved` / `quantity_converted` now?** Default **no** (minimum schema). Gap analysis said reservation columns are needed before Phase 5; they are still not needed to implement Break.

**B-6 · Populate `physical_marking` from existing `srno` in Phase 2?** Default **no**. Encrypted asset serials and comma lists are not a safe parse. Table exists; backfill is a later serial phase.

**B-7 · Child ID algorithm.** Keep `generateModernAssetId` (UI today) vs fix `generateSplitAssetId` with a real index vs suffix. Recommend **keep `generateModernAssetId`**: children are independently managed records, not `{parent}-n` clones. Suffix IDs collide with the mental model of "own identity."

**B-8 · `HAR-MUM-0726-55QOFA-R` has `is_quantity_tracked=1` but null `quantity_root_id`.** INIT never ran. Break engine must either backfill `quantity_root_id = id` and `quantity_original = quantity_total` for such rows, or refuse Break until repaired. Recommend explicit backfill on scratch with a report.

**B-9 · `HAR-MUM-0826-IEIZP5-U` is set+batch+qty.** Unsplit today would hard-delete quantity children because the batch/qty branch wins. Break/inactivate must key off **lineage columns**, not `is_set`. Confirm we never call `make-set` / `break-set` from the Break service.

**B-10 · `migrate:latest` hazard** remains until the abandoned Sets draft is resolved. Phase 2 uses `migrate:up --name` only.

**B-QR · Stored QR URL host.** Do not redesign in Phase 2 by default. New Inventory/child QR should prefer the **dynamic** host pattern (`req.get('host')`) for newly generated images, without rewriting the four existing asset PNGs (those IDs stay scannable via `/api/qr/dynamic/asset/:id`).

**Not blockers, recorded:** `/api/quantity/split` missing `await` and `-NaN` IDs — will be irrelevant if the route is not the Break engine. Unauthenticated `/api/assets/split` — documented, not fixed here. `PROCESS_LOGIC.md` vs canonical — update the process doc when behaviour changes, not before.

---

## STOP

This document is a plan. No application code, migration file, schema change, database write, QR rewrite, serial rewrite, quantity mutation, Set change, reservation, conversion, or Zoho change has been made.

Awaiting review and decisions **B-1** through **B-10** (and **B-QR**) before any Phase 2 implementation.
