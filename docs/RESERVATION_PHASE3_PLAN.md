# Reservation Foundation — Phase 3 Plan

**Status:** PROPOSED — awaiting approval. No code written. No migration created. No schema applied.  
**Date:** 28 August 2026  
**Scope:** Generic reservation engine. Quantity-specific Inventory reservation. Whole-Asset exclusive reservation.  
**Environment audited:** PRODUCTION `asset-manager-prod`, database `asset_manager`, after Phase 2. The 9090 test instance was not used.

**Authoritative inputs**

- `docs/ASSETENGINE_CANONICAL_ARCHITECTURE.md` (§7.1–7.2, §12, §14.7–14.10, §17–19, §26–27, §29–30, §33, §36)
- `docs/ARCHITECTURE_GAP_ANALYSIS.md` (GAP-201–204, GAP-209, GAP-212, GAP-449/702, GAP-703, AMB-02, AMB-05)
- `docs/QUANTITY_PHYSICAL_IDENTITY_PHASE2_PLAN.md` (§11 conservation; B-5: no reservation stubs in Phase 2)
- `docs/PRODUCT_PHASE1_IMPLEMENTATION_PLAN.md` (Product is independent of quantity and reservation)
- `docs/PRODUCT_ARCHITECTURE_DECISION.md` (allocation carries reservation; Product does not)
- `docs/ASSETENGINE_COMPLETE_ARCHITECTURE_AUDIT.md` (Projects, DC, movement types)
- Live `server.js`, `kitSetService.js`, `inventoryMovementService.js`, `lifecycleModel.js`, `breakService.js` as of this date

**Deliberately out of scope for this plan's future implementation**

Sets / Subsets / Super Sets, Inventory ↔ Asset conversion, Receipt Notes, GRN, DC redesign, Projects redesign, Rentals, Product, serial redesign, QR redesign, enabling legacy `RESERVE`/`UNRESERVE` movement types, and opportunistic security hardening of unauthenticated legacy routes.

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [Current-state audit](#2-current-state-audit)
3. [Reservation definition](#3-reservation-definition)
4. [Resource vs owner model](#4-resource-vs-owner-model)
5. [Asset reservation rules](#5-asset-reservation-rules)
6. [Inventory reservation rules](#6-inventory-reservation-rules)
7. [Quantity conservation model](#7-quantity-conservation-model)
8. [Reservation lifecycle](#8-reservation-lifecycle)
9. [Partial release decision](#9-partial-release-decision)
10. [Transfer decision](#10-transfer-decision)
11. [Break interaction](#11-break-interaction)
12. [Conversion interaction](#12-conversion-interaction)
13. [Set interaction](#13-set-interaction)
14. [Project interaction](#14-project-interaction)
15. [DC interaction](#15-dc-interaction)
16. [Concurrency model](#16-concurrency-model)
17. [Idempotency model](#17-idempotency-model)
18. [Authorization](#18-authorization)
19. [Audit / history](#19-audit--history)
20. [Status model](#20-status-model)
21. [Proposed schema](#21-proposed-schema)
22. [Proposed API](#22-proposed-api)
23. [Proposed service layer](#23-proposed-service-layer)
24. [Database constraints](#24-database-constraints)
25. [Migration strategy](#25-migration-strategy)
26. [Compatibility strategy](#26-compatibility-strategy)
27. [Test strategy](#27-test-strategy)
28. [Rollback strategy](#28-rollback-strategy)
29. [Files that would change](#29-files-that-would-change)
30. [Files that must NOT change](#30-files-that-must-not-change)
31. [Blockers](#31-blockers)
32. [Open decisions](#32-open-decisions)
33. [Mandatory decision matrix](#33-mandatory-decision-matrix)

---

## 1. Executive summary

Phase 3 designs a **generic reservation ledger**: an attributable relationship that says a physical AssetEngine record, or a quantity of one, is committed to an operational owner. It is not Break, not Conversion, not Set membership, not Project assignment, and not a DC document.

Locked rules this plan does not reopen:

| Resource | What is reserved |
|---|---|
| **Asset** | The **whole** Asset record. Exclusive. A second conflicting reservation is rejected with the existing owner's identity. |
| **Inventory** | **Only the requested quantity.** Aggregated record stays one record, one QR. `Requested ≤ Available`. No partial fill. No negative available. No borrowing against future receipt. |

Reservation does **not** change Product identity, Asset/Inventory identity, manufacturer serial, QR, quantity lineage (`quantity_parent_id` / `quantity_root_id` / `lineage_status`), `quantity_original`, or Product definition.

Phase 2 already stores `NUMERIC(18,6)` quantities, `quantity_original`, Break lineage, and Inventory QR. It deliberately **did not** add `quantity_reserved` (decision B-5). That column belongs here, as a denormalised counter maintained in the same transaction as the ledger.

**Hardest problem:** two operators reading Available = 5 and both writing. Application-only checks will lose. The holding row must be locked (`SELECT … FOR UPDATE`) and Available decremented with `WHERE quantity_available >= requested` in one PostgreSQL transaction.

**Phase order stays valid.** Canonical §33 already placed reservation at Phase 3, before conversion (4) and Sets (6), for the same four reasons: it is a quantity term; Sets, Projects and DC all need one ledger; Super Set absorption is a reservation transfer; disband must release only one owner's reservations. Phase 2 having shipped Break does **not** move reservation later. The user's Phase 5 (“Break legacy cutover”) is leftover split/unsplit cleanup, not a reason to delay this engine.

This document is a plan. Nothing has been implemented.

---

## 2. Current-state audit

### 2.1 What Phase 2 left in production

Verified after `20260827180000_quantity_physical_identity.js`:

| Fact | Production |
|---|---|
| `quantity_total` / `quantity_available` | `NUMERIC(18,6)` on assets and inventory |
| `quantity_original` | present; HAR and MIS repaired as roots |
| `quantity_reserved` / `quantity_converted` | **absent** (B-5) |
| `lineage_status` | `ACTIVE` / `INACTIVE` |
| Inventory QR | one QR on `MIS-MUM-0826-H4XVLL-W`; no per-unit children |
| Break engine | `POST /api/break`, `POST /api/break/inactivate` (JWT) |
| Legacy split | `/api/assets/split`, `/api/quantity/split` unchanged, still unauthenticated |

Live holdings (unchanged by this plan):

| ID | Domain | Total | Available | Notes |
|---|---|---|---|---|
| `HAR-MUM-0726-55QOFA-R` | Asset | 1 | 0 | Product linked; `parentid` child APP is **not** quantity lineage |
| `HAR-MUM-0826-IEIZP5-U` | Asset / legacy Set | 1 | 1 | `is_set=1`; not reinterpreted |
| `MIS-MUM-0826-H4XVLL-W` | Inventory | 3 | 1 | Consume-shaped **TERMINAL leak** of 2; not a reservation |

### 2.2 Words that are not reservation

| Term in production | What it actually is | Reservation? |
|---|---|---|
| `quantity_available` | Remainder after Break and after CONSUME (which also drops `quantity_total`) | No. It is a counter, not a ledger. |
| `lifecycleModel.RESERVED` | Display state annotated *“Held for a future assignment (future module)”* (`lifecycleModel.js:67`) | **Stub only.** Not written by any live path. |
| Movement `RESERVE` / `UNRESERVE` | Registry entries, `enabled: false` (`inventoryMovementService.js:76-88`) | **Disabled.** No owner, no lock, no ledger. |
| Event types `RESERVE` / `UNRESERVE` | Catalog strings in `inventoryEventSystem.js` | Names only. |
| Managed Set `addComponent` | Membership row. Assets exclusive via unique index; Inventory unlimited and **no** available check (`kitSetService.js:356-399`) | Composition, not reservation (GAP-201–204). |
| `project_assets` | Asset ↔ Project join. JWT `assign-asset` / `unassign-asset`. Unassign of qty children still **hard-deletes** | Assignment relationship, not reservation (GAP-701, GAP-702). |
| `assignedto` | Employee string on the Asset | Assignment, not reservation. |
| `sentagainstdc` | DC number stamped on the Asset | Document flag, not quantity hold (GAP-703). |
| `POST /api/dc` | Creates `delivery_challans`; updates `sentagainstdc` / `boughtagainstpo`; **no JWT**; **no quantity change**; Assets only | Logistics document, not DISPATCH-as-movement. |
| Break `SEPARATED` | Child `quantity_total` after Phase 2 Break | Not reserved. Parent total already decreased. |
| CONSUME | Decrements **both** total and available; no owner | TERMINAL leak, not reservation. |

**GAP-201 remains true after Phase 2:** there is still no reservation table and no reserved bucket.

### 2.3 Closest existing analogues (do not reuse as the engine)

1. **`managed_set_components` unique index on active `asset_id`** — exclusive Asset membership. Inventory has **no** cross-Set exclusive index (only unique per set+item). This is composition uniqueness, not a quantity ledger.
2. **`getAssetAssignmentStatus`** (`server.js:2614`) — user `assignedto` or `project_assets`. Does **not** consult Managed Sets.
3. **CONSUME available check** — `amount > prevAvailable` then update, **without** `SELECT … FOR UPDATE` (`inventoryMovementService.js:239-288`). Do not copy this locking model.

### 2.4 Current movement types — recommendation

| Type | Today | Phase 3 |
|---|---|---|
| `CONSUME` | Enabled; drops total+available | Leave enabled. Do not teach it reservation. |
| `RESERVE` / `UNRESERVE` | Disabled | **Remain disabled.** Do not enable. Retire later. The new engine is owner-attributed; these types are not. |
| Other disabled types | Unchanged | Unchanged. |

---

## 3. Reservation definition

A reservation is a **durable, attributable relationship**:

```
This physical resource (or this quantity of it)
is currently committed to this operational owner.
```

| A reservation is | A reservation is not |
|---|---|
| A ledger row with identity, quantity, owner, status, actor, timestamps | Break (no new physical record, no lineage change) |
| A hold against Available | Conversion (domain stays the same) |
| Reusable by Sets, Projects, DC, future logistics | Set membership, Project assignment, or a DC document |
| Still physically on the same Asset/Inventory row | A change to Product, QR, serial, or `quantity_original` |

Canonical §7.1: reservation **does not consume, move, or transform** the physical quantity. Canonical §29: **RELEASE** “sets no status of its own” on the Asset/Inventory operational status field.

---

## 4. Resource vs owner model

Two axes. Never collapse them into `set_id`.

```
RESOURCE  (what is held)              OWNER  (who holds it)
────────────────────────              ─────────────────────
type: ASSET | INVENTORY               type: SET | PROJECT | DC | MANUAL | SYSTEM
id:   AssetEngine ID                  id:   that owner's AssetEngine ID
quantity:  whole record | requested   one reservation → exactly one owner
```

Examples the engine must accept without schema change to a Set-shaped FK:

| Resource | Owner |
|---|---|
| `INVENTORY` / `INV-001` qty 4 | `SET` / `SET-001` |
| `ASSET` / `AST-001` qty = whole total | `PROJECT` / `PROJ-001` |
| `INVENTORY` / `MIS-MUM-0826-H4XVLL-W` qty 1 | `DC` / `DC…` (future) |
| `ASSET` / `HAR-…` | `MANUAL` (operator hold, tests, scratch) |

**No `set_id` column.** Owner is (`owner_type`, `owner_id`). Resource is (`resource_type`, `resource_id`). Existence of the owner row is validated in the service for known types; there is **no polymorphic FK**. Resource existence is validated against `assets` or `inventory_items` in the same transaction that locks the row.

`MANUAL` and `SYSTEM` exist so Phase 3 tests and future jobs need no Set/Project tables.

---

## 5. Asset reservation rules

1. An Asset reservation commits the **entire remaining holding** on that row (`quantity` = that row's `quantity_total` if quantity-tracked, else 1).
2. At most **one ACTIVE** reservation may exist for a given Asset.
3. A second owner is **rejected**. The error names the existing `owner_type`, `owner_id`, and reservation ID. No silent steal.
4. Requested quantity for an Asset is not a free-form partial amount. Partial Asset reservation is not a Phase 3 operation (an Asset is indivisible for reservation — canonical §14.7).
5. Deleted / inactive-lineage Assets are not reservable.
6. Break children are first-class records: they may be reserved **themselves**. Reserving a parent does not reserve its children.

**Conflict example**

```
AST-001 reserved by PROJECT-001
SET-002 attempts to reserve AST-001
→ REJECT
  "ASSET AST-001 already reserved by PROJECT PROJECT-001 (RSV-…)"
```

**Not in the Phase 3 core engine:** employee `assignedto` and `project_assets` are **assignment**, not reservation. Callers (future Set/Project modules) may add those checks. The ledger itself only knows other **reservations**. GAP-702 (Set membership + project assignment coexistence) remains until Project allocation becomes reservation-backed (canonical Phase 10). Do not pretend Phase 3 closed that gap by mutating Projects.

---

## 6. Inventory reservation rules

1. Reserve **only the requested quantity**. The aggregated Inventory row, ID, and QR stay one.
2. `requested > 0` at the holding's `quantity_precision`.
3. `requested ≤ quantity_available` at the lock instant.
4. If Available = 4 and requested = 5 → **REJECT**. No partial reservation. No rounding up. No borrow against PO/expected receipt.
5. Multiple ACTIVE reservations on one Inventory row **are allowed** (different owners, or the same owner with distinct idempotency keys / distinct requests).
6. Sum of ACTIVE reservation quantities on that row must never exceed Available-at-start-of-transaction; equivalently after the write: `quantity_reserved` increases and `quantity_available` decreases by the same amount.

**Worked concurrency case (must hold)**

```
Inventory total = 10, available = 10

Reservation A = 4  → available 6, reserved 4
Reservation B = 3  → available 3, reserved 7
Reservation C = 4  → REJECT (4 > 3)
```

Atomicity is specified in §16.

---

## 7. Quantity conservation model

Phase 2 implemented **Model B** (quantity moves onto children):

```
ORIGINAL(root) = Σ quantity_total  of ACTIVE nodes in the tree
On a clean node with no TERMINAL leak:
  quantity_total(P) = quantity_available(P) + SEPARATED(P)
SEPARATED(P) = Σ quantity_total of ACTIVE direct children
RESERVED was not a term.
```

Break has **no** “reserved by break” bucket (canonical §7.1, Phase 2 §11.5).

### 7.1 Node equation after Phase 3

RESERVED lives **on the record that still represents that quantity**, never on the parent of a Break child.

For each ACTIVE holding `P`:

```
quantity_total(P)
  = quantity_available(P)
  + quantity_reserved(P)          -- SUM of ACTIVE reservations on P
  + TERMINAL_ON_ROW(P)            -- consume/sold/etc. not yet a named column
```

`TERMINAL_ON_ROW` is **not** introduced as a column in Phase 3. Today it is the residual:

```
TERMINAL_ON_ROW(P) = quantity_total(P) - quantity_available(P) - quantity_reserved(P)
```

Production MIS (`3` total, `1` available, `0` reserved) already has `TERMINAL_ON_ROW = 2`. Phase 3 **must not** “fix” that by inflating reserved or available. Conservation checks use `≤`, not a forced equality to ORIGINAL on dirty rows.

### 7.2 Root equation

```
ORIGINAL(R)
  = Σ_ACTIVE_nodes (
        AVAILABLE
      + RESERVED
      + TERMINAL_ON_ROW
    )
  = Σ_ACTIVE_nodes quantity_total
```

`SEPARATED` does not appear as a stored bucket: it is already the children's `quantity_total`. A unit in an ACTIVE child is **not** also reserved on the parent.

`CONVERTED` remains a future term (Phase 4). It must not be faked as RESERVED.

### 7.3 What Break may consume

```
Break amount ≤ quantity_available(P)
```

**Not** `available + reserved`. Reserved quantity stays on `P`. See §11.

### 7.4 Double-count guards

1. A unit cannot be AVAILABLE and RESERVED on the same row.
2. A unit cannot be RESERVED on the parent and REPRESENTED on a child.
3. INACTIVE Break children contribute 0 to ORIGINAL and cannot be newly reserved.
4. Two ACTIVE Asset reservations for one Asset ID are impossible (unique index).
5. Inventory: `SUM(ACTIVE reservation.quantity) = quantity_reserved` on that row, maintained in the same transaction.

---

## 8. Reservation lifecycle

```
        (idempotent retry of the same key)
                    │
                    ▼
              ┌─────────┐
   RESERVE ─► │ ACTIVE  │
              └────┬────┘
                   │
       ┌───────────┼──────────────┐
       ▼           ▼              ▼
  RELEASE     PARTIAL        TRANSFER
  (full)      RELEASE        (owner change)
       │           │              │
       ▼           ▼              ▼
  RELEASED    still ACTIVE   TRANSFERRED
              (qty reduced)  + new ACTIVE
                             (same resource)
```

| Transition | Effect on holding | Effect on ledger |
|---|---|---|
| RESERVE | `available -= q`, `reserved += q` | Insert ACTIVE row |
| RELEASE (full) | `available += remaining`, `reserved -= remaining` | Row stays; status RELEASED; remaining 0 |
| PARTIAL RELEASE | same, for `q < remaining` | Same row stays ACTIVE; remaining decreases |
| TRANSFER | **no** available/reserved change | Old row TRANSFERRED; new ACTIVE row, same resource+qty, new owner; link `parent_reservation_id` |

Release restores Available **only for that reservation**. It does not set Asset/Inventory `status`. It does not release other owners. It never `DELETE`s the reservation row.

---

## 9. Partial release decision

**Recommendation: support in Phase 3.** Not deferred.

Reason: canonical SET REMOVE decreases “reservation against that Set” without requiring the Set to drop the rest of its hold (§14.8). Implementing only full release would force “release 10, re-reserve 6”, which is exactly the disappearance window §19.2 forbids for transfer and is equally wrong for deallocate.

```
Reservation remaining = 10
Release = 4
→ remaining = 6, available += 4, reserved -= 4
→ same reservation ID, still ACTIVE
```

`release > remaining` → REJECT. `release = remaining` → full RELEASED.

Asset reservations: quantity is the whole record; partial release of an Asset is **rejected** (indivisible). Deallocate of a Set Asset is a full release of that Asset reservation.

---

## 10. Transfer decision

**Recommendation: implement TRANSFER as a first-class service primitive in Phase 3. Do not expose a Set/Super Set UI. Do not auto-call it from anywhere except tests and the API (authenticated).**

Can Super Set absorption be represented **without** transfer?

**No.** Canonical §19.2: reservations transfer **exactly once**; they are not released and recreated. A release-then-reserve sequence has a moment where quantity is Available (another operator can take it) or a moment of double-count if recreate happens first. Disband (§17) **releases**; absorption **must not** use disband-as-transfer. AMB-02 is resolved by making TRANSFER a reservation operation, not a Set operation.

Subset disassembly (§18.3) needs the same primitive: source Set's reservations pass to Subsets with no double-count.

Phase 6 **calls** `reservationService.transfer({ fromReservationId, toOwner })` inside its own transaction. Phase 3 only guarantees the primitive is correct.

Transfer rules:

- Source must be ACTIVE.
- Resource and quantity do not change.
- Holding Available/Reserved **do not change**.
- Target owner must not create an Asset double-reserve (Asset unique still holds because the old row is no longer ACTIVE in the same transaction).
- History: both IDs remain queryable.

---

## 11. Break interaction

Phase 2 Break already exists. Reservation must define the join, not guess.

| Question | Recommended rule | Why |
|---|---|---|
| Can reserved quantity itself be Broken? | **No.** | Break creates a new resource ID. A reservation pointing at the parent would then describe quantity the parent no longer represents → silent under-reserve or a hidden transfer. |
| Can only Available be Broken? | **Yes.** `amount ≤ quantity_available`. | Available is the uncommitted remainder on that row. |
| Can a child inherit a reservation? | **No, not automatically.** | Reservation is a relationship to a resource ID. Inheritance would be a transfer, which must be explicit. |
| Can a child be created from reserved quantity? | **No.** Same as row 1. | |
| Parent has both available and reserved? | Break **available only**. Reserved stays on the parent. | Example: total 10, reserved 4, available 6 → Break at most 6. After Break 3: parent total 7, reserved 4, available 3; child 3/3 unreserved. |

If a caller needs the reserved slice to become its own record, that is **release or transfer, then Break** (or a future explicit “break reserved into a child and retarget the reservation”). That compound operation is **not** Phase 3.

Phase 3 must patch `breakService` to reject `amount > available` **after** reserved is real — Phase 2 already rejects over-available, but Available will then mean “unreserved remainder”, which is the correct input.

Inactivate of a Break child: if that **child** has ACTIVE reservations, inactivate is **rejected** (409). Do not dump reserved qty onto the parent.

---

## 12. Conversion interaction

Phase 4. **Do not implement conversion.**

**Can reserved Inventory be converted?**  
**Recommended default: NO.**

Conversion mints a new AssetEngine Asset ID (and QR) while the Inventory row remains. A reservation whose `resource_id` is the Inventory ID would either:

- stay on Inventory that no longer holds that quantity (lie), or
- silently retarget the new Asset (hidden transfer + domain change).

Both violate “reservation does not change identity” and “no guessed transfers”. Required path: **RELEASE or TRANSFER**, then convert. Same for converting an Asset that is reserved.

---

## 13. Set interaction

Phase 6 consumes this engine. Phase 3 does **not** change `kitSetService`.

Conceptual flow (future):

```
SET ALLOCATE (SET ADD)
      ↓
reservationService.reserve({
  resourceType, resourceId, quantity,
  ownerType: 'SET', ownerId: setId,
  reason, idempotencyKey
})
      ↓
Inventory: qty hold   OR   Asset: exclusive hold
      ↓
then (and only then) write managed_set_components
```

SET REMOVE → `release` or `partialRelease` for **that Set's** reservation IDs only.  
DISBAND → release every ACTIVE reservation with `owner_type=SET` and that `owner_id`. Does not touch Project/DC/employee state (§17).  
ABSORB → `transfer` each source Set reservation to the Super Set owner (§10).  
DISASSEMBLE → `transfer` slices to new Subset owners.

The Set module must **not** maintain its own available math. Today's `addComponent` inventory path (no available check, unlimited cross-Set claims) is exactly why the engine is Phase 3 rather than buried in Phase 6.

---

## 14. Project interaction

**Do not change Project behaviour in Phase 3.**

| Mechanism | Today | Relation to reservation |
|---|---|---|
| `project_assets` | Asset ID + project ID; JWT assign/unassign | **Relationship / assignment** |
| `assignedto` | Employee name | **Assignment** |
| Split-into-project | Legacy `/api/assets/split` writes `parentid` + project | Not reservation; not Break lineage |
| Unassign qty child | Hard-delete child (`server.js` unassign / unsplit) | Destructive; Phase 5 cutover |

`assign-asset` already rejects a second **project** or a user assignment (`getAssetAssignmentStatus`). It does **not** consult reservations or Managed Sets.

**Should assignment become reservation-backed?**  
Eventually yes (canonical §26). **Not in Phase 3.** Converting live `project_assets` into reservations would change Project semantics without a Project phase and would collide with HAR-style available=0 rows.

**Can Project assignment and Set reservation coexist?**  
Today they can (GAP-702). After Phase 6, Set allocate will reserve; Project assign still will not, until Phase 10. The engine will reject a second **reservation** on an Asset, but will not see `project_assets` unless a later caller adds that eligibility hook.

Keep the three words distinct in APIs and UI:

| Word | Meaning |
|---|---|
| Relationship | Any durable link (product_id, parentid, project_assets, set component) |
| Assignment | Employee or Project membership as implemented today |
| Reservation | This Phase 3 ledger |

---

## 15. DC interaction

**Do not modify DC.**

`POST /api/dc` (`server.js:3946`) is unauthenticated. It writes `sentagainstdc` and optionally `boughtagainstpo`. It does not change `quantity_available`. It does not load Inventory. Project linkage is a **name heuristic** on `payload.meta.referenceNo` (GAP-703).

| Question | Answer for this plan |
|---|---|
| What is currently “committed”? | A string on the Asset (`sentagainstdc`). Not a quantity hold. |
| Should DC reserve before dispatch? | **Yes, in the DC phase (canonical §33 Phase 10 / §27).** Not now. |
| When should reservation release? | When dispatch becomes TERMINAL / IN_TRANSIT, or when the DC is cancelled — DC module decides; engine only provides release/transfer. |
| Is dispatch a terminal movement? | Canonical DISPATCH is a physical movement (§29). Today's DC is not that. Phase 3 must not pretend `sentagainstdc` is RESERVED. |

---

## 16. Concurrency model

**This is the load-bearing design.**

Failure mode without a lock:

```
Available = 5
Operator A reads 5, Operator B reads 5
A writes available=1 (reserved 4)
B writes available=2 (reserved 3)
→ 7 reserved on 5 stock
```

### 16.1 Recommended strategy

PostgreSQL default isolation is **READ COMMITTED**. Do **not** switch the database to SERIALIZABLE for this product. Use:

1. `BEGIN`
2. `SELECT … FROM assets|inventory_items WHERE id = $id FOR UPDATE`  
   (lock the **resource row**, not only the reservation table)
3. Re-read `quantity_available`, `quantity_total`, `quantity_reserved`, `lineage_status`
4. Evaluate rules (Asset uniqueness, `requested ≤ available`, precision)
5. `UPDATE … SET quantity_available = quantity_available - $q, quantity_reserved = quantity_reserved + $q WHERE id = $id AND quantity_available >= $q`  
   If `rowCount !== 1` → REJECT (lost race)
6. `INSERT` reservation (and event)
7. `COMMIT`

Operator B blocks on `FOR UPDATE`, then sees A's Available.

Knex: `db.transaction` + `.forUpdate()` as used nowhere on consume today — **new** here, modelled on Break's transaction in `breakService.js`.

### 16.2 Isolation and constraints

| Tool | Role |
|---|---|
| `SELECT … FOR UPDATE` | Serialize writers of one holding |
| Conditional `UPDATE … AND quantity_available >= $q` | Belt if the lock is missed |
| Unique index: one ACTIVE reservation per Asset | Absolute Asset exclusivity |
| `CHECK (quantity_available >= 0 AND quantity_reserved >= 0)` | No negatives |
| **No** CHECK `available + reserved = total` | TERMINAL leak (MIS) would fail the migration |
| Do not lock “the whole inventory table” | Unnecessary; row lock is enough |

### 16.3 What not to do

- Do not compute Available in JS from a stale GET, then POST.
- Do not enable movement `RESERVE` as a second writer of the same counters.
- Do not use `quantity_total` as the Inventory availability check (that would ignore existing holds and the MIS leak incorrectly).

---

## 17. Idempotency model

Browser retry must not reserve twice.

**Mechanism:** optional `idempotency_key` (UUID or client token) stored on `reservation`. Unique among **all** rows (including RELEASED), scoped globally or per `(owner_type, owner_id)`.

On RESERVE:

- If a row with that key exists → return **that** reservation (200), no second decrement.
- If key missing → treat as a new request (two clicks without a key **will** double-reserve; the UI must send a key).

Do not infer idempotency from `(owner, resource, quantity)`: a Set may legitimately reserve 4, release, reserve 4 again — that is two historical rows plus one ACTIVE.

Header: `Idempotency-Key` and/or JSON `idempotencyKey`, same as common HTTP practice. Phase 3 UI (if any scratch/test client) must send it.

---

## 18. Authorization

All reservation **mutations** use the existing JWT cookie model:

`authenticateJWT` + `authorizeRoles('superuser', 'admin', 'manager')`

Same as `POST /api/break` and Product writes (`server.js` product/break blocks).

Reads (`GET` tree/list by resource or owner): `authenticateJWT` (any logged-in role), like `GET /api/products`.

Do **not** authenticate legacy `/api/dc` or `/api/assets/split` as a side effect of this phase.

Actor: `req.user.username || req.user.user_id` (same as `productActor`).

---

## 19. Audit / history

Requirement: who reserved what, how much, for whom, when; who released, when, why.

**Recommendation:** mutable **projection** row (`reservation`) + **immutable** `reservation_event` append-only log.

| Approach | Verdict |
|---|---|
| Current row only | Insufficient (partial release overwrites remaining) |
| Event log only (event-sourced replay as truth) | Heavier than this codebase; Break already uses dual write (row + quantity_events) |
| History table of full snapshots | Redundant with events |
| **Row + `reservation_event`** | Matches `quantity_events` / `asset_history` style |

Never `DELETE` reservation or event rows. `RELEASED` / `TRANSFERRED` remain queryable.

Optionally also write `quantity_events` / `inventory_quantity_events` type `RESERVE` / `UNRESERVE` (catalog already has the names) as **holding-level** audit, in addition to `reservation_event`. That keeps quantity history UI honest. Do not use those events as the lock/ledger.

---

## 20. Status model

| Status | Meaning |
|---|---|
| `ACTIVE` | Currently holding quantity against the owner |
| `RELEASED` | Quantity returned to Available (full). Row kept |
| `TRANSFERRED` | Quantity still reserved, but this row is not the holder; successor is `transferred_to_id` |

**`CANCELLED`:** do **not** add as a fourth status. A cancelled hold is a `RELEASED` row with `reason_code = 'CANCELLED'`. A fourth status would fork “did Available increase?” into two paths. Asset `status`, Inventory `status`, Set completeness, and Product `status` stay unrelated.

---

## 21. Proposed schema

Named migration only (timestamp after Phase 2), e.g. `YYYYMMDDHHMMSS_reservation_foundation.js`. **Never** `migrate:latest` while `20260824120000_create_managed_sets_tables.js` remains unapplied.

### 21.1 Holding columns (both `assets` and `inventory_items`)

| Column | Type | Null | Notes |
|---|---|---|---|
| `quantity_reserved` | `NUMERIC(18,6)` | NOT NULL DEFAULT 0 | Denormalised SUM of ACTIVE reservations on this id |

No `quantity_converted` (Phase 4).

Backfill: `0` on every existing row. Do not invent reservations from Set membership or `project_assets`.

### 21.2 Table `reservation`

| Column | Type | Notes |
|---|---|---|
| `id` | `varchar(255)` PK | `RSV-MMYY-XXXXXX-C` (checksum, same family as Product IDs) |
| `resource_type` | `varchar(16)` | `ASSET` \| `INVENTORY` |
| `resource_id` | `varchar(255)` | Holding AssetEngine ID |
| `quantity` | `NUMERIC(18,6)` | **Remaining** ACTIVE quantity; 0 when RELEASED |
| `quantity_original` | `NUMERIC(18,6)` | Amount at first RESERVE; never increased; partial release does not change it |
| `owner_type` | `varchar(16)` | `SET` \| `PROJECT` \| `DC` \| `MANUAL` \| `SYSTEM` |
| `owner_id` | `varchar(255)` | Owner's ID; **not** FK |
| `status` | `varchar(16)` | `ACTIVE` \| `RELEASED` \| `TRANSFERRED` |
| `reason` | `text` | Free text |
| `reason_code` | `varchar(32)` | nullable; e.g. `CANCELLED`, `DISBAND`, `DEALLOCATE` |
| `reference` | `varchar(255)` | External/doc ref |
| `idempotency_key` | `varchar(64)` | nullable; unique when present |
| `parent_reservation_id` | `varchar(255)` | predecessor on TRANSFER; FK to `reservation.id` ON DELETE RESTRICT |
| `transferred_to_id` | `varchar(255)` | successor on TRANSFER |
| `created_by` / `created_at` | | |
| `released_by` / `released_at` | nullable | set on full or last partial that zeroes remaining |
| `updated_at` | | |

### 21.3 Table `reservation_event`

| Column | Notes |
|---|---|
| `id` | serial/bigserial |
| `reservation_id` | FK RESTRICT |
| `type` | `RESERVE` \| `PARTIAL_RELEASE` \| `RELEASE` \| `TRANSFER` |
| `quantity` | delta magnitude |
| `actor` | |
| `timestamp` | |
| `note` | |
| `metadata_json` | previous/new remaining, from/to owner on TRANSFER |

No `reservation_source` table. `owner_type` + `reference` cover attribution. A third table would duplicate owner.

---

## 22. Proposed API

All under `/api/reservations`. JWT as §18.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/reservations` | RESERVE |
| `POST` | `/api/reservations/:id/release` | Full or partial (`{ quantity? }`) |
| `POST` | `/api/reservations/:id/transfer` | `{ ownerType, ownerId }` — primitive for Phase 6; no Set UI |
| `GET` | `/api/reservations/:id` | One row + events |
| `GET` | `/api/reservations` | Filter `resourceType`, `resourceId`, `ownerType`, `ownerId`, `status` |
| `GET` | `/api/reservations/resource/:resourceType/:resourceId` | Active + history for a holding |

`POST` body (reserve):

```
resourceType, resourceId, quantity,
ownerType, ownerId,
reason?, reasonCode?, reference?, idempotencyKey?
```

Asset: `quantity` omitted or must equal whole `quantity_total` (or 1 if untracked).

Errors: 400 validation; 404 missing resource; 409 conflict (Asset held, insufficient available, child has reservations on inactivate — when Break is wired); 401 unauthenticated.

**No** `/api/sets/:id/reserve`. Sets call this API later.

---

## 23. Proposed service layer

New `web-app/asset-manager-backend/services/reservationService.js` (same shape as `breakService.js` / `productService.js`).

Exports:

- `reserve(args)`
- `release({ id, quantity?, actor })`
- `transfer({ id, ownerType, ownerId, actor })`
- `getById` / `list`
- `assertNoActiveReservations(resourceType, resourceId)` — for Break inactivate / future conversion

Does **not** import `kitSetService`, `zohoService`, DC helpers, or project assign.

Surgical callers in Phase 3 implementation:

- `breakService`: Break amount vs `quantity_available` (already); **inactivate** rejects if child has ACTIVE reservations; do not Break reserved qty.
- `server.js`: route registration only, next to Break/Product.
- Holding create paths: `quantity_reserved = 0` on new qty-tracked rows.

Optional scratch/test UI only if required to exercise the API; production Set/Project/DC screens **unchanged**.

---

## 24. Database constraints

| Invariant | Enforcement |
|---|---|
| `quantity > 0` on ACTIVE rows | CHECK `(status <> 'ACTIVE' OR quantity > 0)` |
| `quantity_original > 0` | CHECK |
| `quantity ≤ quantity_original` | CHECK |
| Resource type | CHECK `IN ('ASSET','INVENTORY')` |
| Owner type | CHECK `IN ('SET','PROJECT','DC','MANUAL','SYSTEM')` |
| Status | CHECK `IN ('ACTIVE','RELEASED','TRANSFERRED')` |
| One owner per row | columns, not an array |
| One ACTIVE reservation per Asset | **Partial unique index** on `resource_id` WHERE `resource_type = 'ASSET' AND status = 'ACTIVE'` |
| Idempotency | UNIQUE on `idempotency_key` WHERE NOT NULL |
| No orphan events | FK `reservation_event.reservation_id` |
| Transfer lineage | FK `parent_reservation_id`; TRANSFERRED rows must have `transferred_to_id` (CHECK) |
| Holding non-negative | CHECK on `quantity_available` and `quantity_reserved` ≥ 0 |
| Aggregate ≤ available at write | **Not** a table CHECK across tables (would need a trigger). Enforced by `FOR UPDATE` + conditional UPDATE + service assert `SUM(ACTIVE) = quantity_reserved` before commit |
| Release cannot exceed remaining | Service + CHECK would require event-time logic; reject in service |
| Resource exists | Service (polymorphic); optional trigger later — not required for v1 if every write goes through the service |

Trigger to keep `quantity_reserved` in sync is **not** recommended as the primary writer (two writers). The service is the only writer of both the ledger and the counter. A **deferred** assertion query in tests: `quantity_reserved = SUM(ACTIVE)`.

---

## 25. Migration strategy

Copy Phase 1 / Phase 2 ops exactly.

1. `pg_dump` production → `backups/8080_prod/`.
2. Baseline: holdings, `quantity_*`, `parentid`, `product_id`, history counts, events, `managed_sets`, QR lengths, **zero** expected reservations.
3. Confirm latest knex is `20260827180000_quantity_physical_identity.js`; abandoned `20260824120000` still **not** applied.
4. Restore dump to scratch DB on the same Postgres.
5. Park abandoned migration file; `knex migrate:up <named Phase 3 file>` on scratch; restore file.
6. Backfill `quantity_reserved = 0` only (column default). **No** DML that interprets Set components or `project_assets` as reservations.
7. Full §27 tests on scratch, including two concurrent reserve clients.
8. Production named `migrate:up` only after scratch green. Never `migrate:latest`.
9. Restart `asset-manager-prod` only to load new routes (bind-mount JS).

Stop if: schema differs, a row would get a guessed reservation, conservation `available + reserved ≤ total` fails after adding the column (it must hold with reserved=0: MIS `1+0 ≤ 3`), or migration would drop data.

---

## 26. Compatibility strategy

| Keep | Stop using as reservation truth |
|---|---|
| `managed_set_components` | Availability / commitment |
| `project_assets`, `assignedto` | Commitment ledger |
| `sentagainstdc` | Quantity hold |
| `lifecycleModel.RESERVED` | Do not start writing Asset `status = Reserved` from this engine (RELEASE sets no status — §29) |
| Disabled movement RESERVE/UNRESERVE | Do not enable |
| Phase 2 Break / lineage / QR / Product | Unchanged semantics except Break/inactivate consult ACTIVE reservations |
| Legacy split / unsplit | Unchanged (Phase 5) |

Existing Available values stay as they are. Phase 3 does not convert the MIS terminal leak into reserved qty.

---

## 27. Test strategy

Scratch only for mutations. Never reserve live HAR/MIS except read-only conflict messages in HTTP 401 tests.

| Test | Expect |
|---|---|
| Inventory 10; A=4, B=3; C=4 | C rejected; available 3 |
| Two parallel reservations of 4 on available 5 | One 200, one 409 |
| Inventory request 5 when available 4 | 409, no row, counters unchanged |
| Asset exclusive | Second owner 409 with first owner in body |
| Idempotent retry | One decrement |
| Partial release 10→6 | Same ID ACTIVE, available +4 |
| Over-release | 409 |
| Full release | RELEASED, history remains, GET works |
| Transfer | Available/reserved unchanged; old TRANSFERRED; new ACTIVE |
| Break 3 when reserved 4 available 6 | Allowed; reserved stays 4 on parent |
| Break 7 when available 6 | Rejected |
| Inactivate reserved child | Rejected |
| Product / QR / lineage / `parentid` / `quantity_original` | Unchanged |
| `zoho_catalog` checksum | Unchanged |
| Set addComponent | Still does not change available (compat) until Phase 6 |
| Unauthenticated POST | 401 |

---

## 28. Rollback strategy

- Down migration: drop `reservation_event`, `reservation`; drop `quantity_reserved` if and only if every value is 0 (otherwise STOP — data loss).
- If Phase 3 has live ACTIVE reservations, rollback is a **restore from pg_dump**, not `down()`.
- Application rollback: revert `server.js` routes and `breakService` guards; leftover empty tables are inert.

---

## 29. Files that would change

Implementation (after this plan is approved — **not now**):

| File | Why |
|---|---|
| `migrations/<ts>_reservation_foundation.js` | Schema |
| `services/reservationService.js` | Engine |
| `IdGenerator.js` | `generateReservationId` |
| `server.js` | Routes; inventory/asset create `quantity_reserved: 0` |
| `services/breakService.js` | Reserved qty cannot Break; inactivate vs child reservations |
| `shared/inventoryEventSystem.js` | Display names already exist; maybe `PARTIAL_RELEASE` / `TRANSFER` if quantity_events are written |
| Optional: minimal test/admin UI | Only if required to exercise API |
| `scripts/reservation-phase3-verify.js` | Like Phase 2 verify |
| Frontend cache-bust | Only if UI is added |

---

## 30. Files that must NOT change

| File / area | Why |
|---|---|
| `zohoService.js`, OAuth, tokens | Out of scope |
| `kitSetService.js` / Managed Set UI | Phase 6 consumes the engine |
| Project assign/unassign, `project_assets` | Assignment ≠ reservation |
| `POST /api/dc` and DC UI | Document ≠ reservation |
| `/api/assets/split`, `/api/quantity/split` | Phase 5 |
| `productService.js` | Product has no quantity |
| Enabling `MOVEMENT_TYPES.RESERVE` | Wrong engine |
| Production compose, ports, `.env` | Ops |

---

## 31. Blockers

None that stop **planning**. Implementation must not start until the owner confirms the decision matrix in §33.

Genuine owner decisions (not engineering guesses):

1. **Partial release in Phase 3 vs defer** — this plan recommends **now**.
2. **TRANSFER primitive in Phase 3 vs schema-only** — this plan recommends **service + API + tests**, no Set UI.
3. **Whether Asset reserve should also refuse `project_assets` / `assignedto`** — this plan recommends **no** in the core engine (keep assignment separate); Sets/Projects add hooks later.
4. **`CANCELLED` as status vs reason_code** — this plan recommends **reason_code**.
5. **Writing `quantity_events` RESERVE lines in addition to `reservation_event`** — recommended **yes** for Inventory/Asset quantity history UI, as dual audit, not as truth.

No lineage ambiguity in current production requires stopping the plan: B-1 `parentid` and IEIZP5 Set flags stay untouched; they are not reservations.

---

## 32. Open decisions

| ID | Topic | This plan's default | If rejected |
|---|---|---|---|
| R-1 | Partial release | Support now | Full-release-only; Phase 6 deallocate becomes unsafe |
| R-2 | Transfer primitive | Service + authenticated API in Phase 3 | Super Set cannot be correct without inventing transfer later under time pressure |
| R-3 | Asset vs assignment | Engine ignores `project_assets` | Engine becomes a Project rewrite |
| R-4 | CANCELLED status | Use `reason_code` | Extra status; two release paths |
| R-5 | Denormalised `quantity_reserved` | Yes, service-maintained | Every read would SUM the ledger; still need a lock |
| R-6 | Quantity events dual-write | Yes | Quantity history UI stays Break-only |
| R-7 | Phase 3 production UI | API + optional scratch verification only | Avoids implying Sets are done |

---

## 33. Mandatory decision matrix

| Decision | Recommendation | Reason | Phase |
|---|---|---|---|
| Full Asset reservation | **Yes.** Whole record, exclusive, one ACTIVE row | Locked business model; canonical §14.7 | 3 |
| Partial Inventory reservation | **Yes.** Requested qty only; reject if `requested > available` | Locked model; no partial fill | 3 |
| Partial release | **Support now** | SET REMOVE and safe deallocate need it; release+re-reserve races | 3 |
| Reservation transfer | **Primitive now; no Super Set UI** | §19.2 cannot be expressed as release+recreate; closes AMB-02 | 3 (primitive) / 6 (Super Set calls it) |
| Reserved quantity Break | **Forbidden.** Break `≤ available` only | Avoids orphan reservations and hidden transfers | 3 (Break guard) |
| Reserved quantity Conversion | **Forbidden** until release/transfer | Conversion changes resource ID; default NO | 4 |
| Super Set reservation transfer | **Uses Phase 3 TRANSFER** | Absorption is reservation transfer, not Set-internal math | 6 |
| Project assignment | **Unchanged.** Not reservation-backed yet | `project_assets` is assignment; canonical Projects/DC are Phase 10 | 10 |
| DC commitment | **Unchanged.** `sentagainstdc` is not a hold | DC is a document today (GAP-703) | 10 |
| Concurrency locking | **`SELECT … FOR UPDATE` + conditional UPDATE** | Two operators on Available=5; READ COMMITTED + row lock | 3 |
| Idempotency | **`idempotency_key` unique** | Browser retry must not double-decrement | 3 |
| Reservation history | **Keep row + append-only `reservation_event`; never DELETE** | Who/what/when/why reconstructable | 3 |
| Database enforcement | **CHECKs + Asset partial unique index + non-negative counters; no `available+reserved=total` CHECK** | TERMINAL leak (MIS); polymorphic owner has no FK | 3 |

---

## Phase order (verified)

| Phase | Subject | Status vs this plan |
|---|---|---|
| 1 | Product | Done |
| 2 | Quantity / physical identity | Done |
| 3 | Reservation | **This plan** |
| 4 | Inventory ↔ Asset conversion | After reservation (must refuse reserved qty) |
| 5 | Break **legacy** cutover / cleanup | After a complete quantity model; not a reason to delay Phase 3 |
| 6 | Set engine | Consumes Phase 3; must not invent a second ledger |
| 7 | Receipt Note / GRN | Unchanged |
| 8 | Zoho logistics integration | Unchanged |

Canonical §33 Phase 9 (PO) and Phase 10 (Projects / DC / Rentals) remain **after** reservation. They do not need to precede Phase 3. **Do not reorder.**

---

*End of plan. No application code, migration, schema change, database write, Set change, Project change, DC change, Inventory/Asset mutation, or Zoho change has been made by producing this document.*
