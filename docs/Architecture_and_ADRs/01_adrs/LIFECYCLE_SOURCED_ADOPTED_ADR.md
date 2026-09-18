# Sourced vs Adopted Lifecycle — Architecture Decision Record

**Status:** ACCEPTED as owner direction (2026-09-08). **Not implemented.** This document does **not** authorize code, schema, migration, production, or Zoho changes.
**Date:** 8 September 2026
**IDs:** `ADR-LIFECYCLE-002` · `ADR-DASHBOARD-001`
**Canonical register:** [`ASSETENGINE_CANONICAL_ARCHITECTURE.md`](./ASSETENGINE_CANONICAL_ARCHITECTURE.md) §42
**Related:** `ADR-INTAKE-001` · commercial provenance (`NOT_REQUIRED` / `AWAITING_PO` / `PO_LINKED`) · Receipt Notes Phase 7 · Operations dashboard

---

## Reading rule

- **Locked** means the owner has chosen the business meaning.
- **Not implemented** means the dashboard, lists, filters, charts, and windowed SQL do not exist yet.
- **Does not authorize** means do not start migrations or UI until a follow-up implementation plan is approved.

---

## 1. The two commercial lifecycles

Physical stock is always an Asset or an Inventory holding. How that holding got its **commercial parent** is one of two lifecycles.

### Sourced Lifecycle (procurement-first)

Normal path:

1. A Purchase Order is generated (Zoho; AssetEngine mirrors it).
2. Goods are received as a **Receipt Note**.
3. Posting the Receipt Note **creates** the Asset or Inventory holding.

The holding is born already parented by PO + Receipt Note.

```text
Product → Purchase Order → Receipt Note → Asset / Inventory
```

This is the existing Receipt Note engine. Do not invent a second procurement path.

### Adopted Lifecycle (physical-first)

Path when stock is taken into the system as **already-physical** stock (Physical Intake — opening balance, legacy, donation, external acquisition, and similar):

1. Physical Intake **creates** the Asset or Inventory holding.
2. Every such holding starts as **Awaiting PO** and appears on Dashboard **Awaiting Adoption**. Intake type must not default the row to No PO Required.
3. After registration, the operator decides, from that list / holding:
   - **Leave waiting** — stays Awaiting Adoption.
   - **No PO Required** — operator-explicit close without a PO; leaves Awaiting Adoption.
   - **Backlink PO + adoption Receipt Note** — commercially parented; leaves Awaiting Adoption.

```text
Physical Intake → Asset / Inventory (Awaiting PO)
                → Awaiting Adoption (dashboard)
                → leave waiting
                  or mark No PO Required
                  or PO backlink + adoption Receipt Note
```

**Birth does not change.** `ADR-INTAKE-001` still holds: Physical Intake is the birth operation for non-procurement stock. Direct `POST /api/assets` and `POST /api/inventory/items` stay contained. The new rule is **commercial completion**, not a second physical create.

### What adoption must not do

An adoption Receipt Note:

- **Must** record the commercial parent (PO + Receipt Note) on the existing holding.
- **Must not** create a second Asset or Inventory row.
- **Must not** increase physical quantity again.
- **Must not** pretend the goods arrived today if they were already registered.

That is the difference from Sourced posting: Sourced RN **creates** physical stock; Adopted RN **parents** stock that already exists.

This **refines** the current commercial-provenance lock “link PO never creates a Receipt Note.” Linking a PO without an adoption Receipt Note is no longer a complete Adopted lifecycle. Implementation of that RN is a later phase; this ADR only locks the meaning.

---

## ADR-LIFECYCLE-002

**Title:** Physical holdings have two commercial lifecycles — Sourced and Adopted
**Problem:** Operators and the dashboard cannot tell “this holding arrived through procurement” from “this holding was registered as existing stock and still has no commercial parent.” Physical Intake can create parentless holdings. The business now requires Adopted holdings to be backlinked to a PO and given a Receipt Note, and to be visible on the Dashboard until that happens.
**Options:** (a) Treat all stock as Sourced and invent a PO/RN at intake time (`ADR-INTAKE-001` option a, previously rejected). (b) Leave Adopted holdings permanently parentless except for optional PO provenance. (c) Keep Physical Intake as birth, name two lifecycles, require PO + adoption Receipt Note to complete Adopted, and surface parentless holdings as **Awaiting Adoption**.
**Decision:** (c).
**Rationale:** Sourced remains the honest procurement path. Adopted remains honest physical registration. Commercial history is still reconstructable (PO + RN) without duplicating holdings or reopening general Asset/Inventory create.
**Trade-offs:** Two birth classes stay distinct. Adoption adds a Receipt Note whose job is parenting, not receiving-into-existence. Current intake-type defaults that write `NOT_REQUIRED` at create (opening balance, donation, and similar) are **superseded**: create always starts `AWAITING_PO`. `NOT_REQUIRED` is a later operator action, not a registration default. Commercial provenance still does not create an adoption RN and does not yet drive the Dashboard card.
**Future impact:** Dashboard **Awaiting Adoption**; adoption RN API; query of parentless holdings. Named migrations only. Never `migrate:latest`.
**Status:** ACCEPTED (2026-09-08). Not implemented.

### User-facing language

Never expose enums (`AWAITING_PO`, `PO_LINKED`, `NOT_REQUIRED`) on the Dashboard.

| Operator label | Meaning |
|----------------|---------|
| **Sourced** | Holding was created by posting a procurement Receipt Note. |
| **Adopted** | Holding was created by Physical Intake. |
| **Awaiting Adoption** | Adopted holding still waiting: PO not linked and operator has not marked No PO Required. |
| **No PO Required** | Operator closed commercial waiting without a PO. **Not** a registration default. |

### Registration default (OD-ADOPT-1 closed)

**Locked:** every Physical Intake holding is registered as **Awaiting PO**, including types that previously defaulted to No PO Required (opening balance, legacy, donation, non-PO, internal transfer, other approved).

- Do **not** offer No PO Required as the create-time default, and do **not** apply it from intake type.
- After the holding exists, it **always** appears on Dashboard **Awaiting Adoption**.
- From that view the operator may **leave it waiting**, or **register it as No PO Required**, or complete PO backlink + adoption Receipt Note.
- **Purchase Order Already Available** remains valid **only** when a real PO line is linked at registration; that holding does not enter Awaiting Adoption.

No PO Required is therefore an **after-the-fact operator decision**, not a birth class.

### Awaiting Adoption definition

A holding is **Awaiting Adoption** when all of the following are true:

1. It was born by **Physical Intake** (Adopted Lifecycle), not by a Sourced Receipt Note post.
2. Commercial state is still **waiting** (`AWAITING_PO`): no linked PO, and the operator has not marked No PO Required.
3. It is not deleted / recovered-only.

Clicking **Awaiting Adoption** on the Dashboard opens the **full list** of those Assets and Inventory rows. Each row is a link to the holding so the operator can: leave waiting, mark No PO Required, link PO, or create the adoption Receipt Note.

Holdings the operator has marked **No PO Required** leave this list. They are Adopted and commercially closed without a PO — they are not “still parentless waiting.”

Historical rows already stored as `NOT_REQUIRED` must **not** be rewritten in production without an approved named backfill. New registrations follow this rule immediately once implemented.

This card is **not** the deferred “Expecting POs” / “PO Waitlist” idea. PO Waitlist remains receivable Zoho PO lines with outstanding quantity. Awaiting Adoption is **waiting Adopted physical stock**.

### Relation to `ADR-INTAKE-001`

| `ADR-INTAKE-001` | This ADR |
|------------------|----------|
| Two **birth** classes: Receipt vs Physical Intake | Unchanged |
| Do not invent a fake PO/RN **at birth** | Unchanged |
| Do not merge provenance classes | Unchanged: Sourced RN creates stock; Adopted RN parents stock |
| Intake does not create Receipt Notes | **Refined:** intake still does not; **adoption completion** later creates an RN that does not birth stock |

### OD-ADOPT-1 — CLOSED (2026-09-08)

Every former “No PO Required at registration” case is **Awaiting PO** at birth. After register, all of those holdings are on Awaiting Adoption. The operator then leaves them waiting or marks No PO Required. See **Registration default** above.

---

## ADR-DASHBOARD-001

**Title:** Operations Dashboard — Awaiting Adoption, Receipt Note calendar windows, Asset pie and Inventory donut
**Problem:** The Operations Dashboard shows lifecycle stage counts without Adopted parentless stock, without honest period windows on Receipt Notes, and without holdings composition (ownership / stock vs sold).
**Options:** (a) Client-side filter of the existing `limit=100` lists. (b) Dedicated dashboard aggregate APIs with calendar windows computed in PostgreSQL, plus two composition chart cards.
**Decision:** (b).
**Rationale:** Monthly / quarterly / yearly counts from a capped list are false. Windowed SQL is the source of truth. Composition charts are operator views over physical holdings, not Product catalogue counts.
**Trade-offs:** New read APIs, indexes, and chart UI. Must not change Sourced/Adopted write paths in the same change set as the first chart drop unless the implementation plan says otherwise.
**Future impact:** Operations dashboard gains three surfaces described below. Named migrations if the query needs persisted buckets or indexes.
**Status:** ACCEPTED (2026-09-08). Not implemented.

### 1. Awaiting Adoption card

- Shows the count of waiting Adopted Assets + Inventory (definition in ADR-LIFECYCLE-002).
- Click → list of those holdings (both types in one view, each row linking to the correct workspace).
- From a row, the operator leaves it waiting, marks **No PO Required**, or completes PO + adoption Receipt Note.
- Counts come from a server aggregate, not `window.assets`.

### 2. Receipt Notes — period filter above the Receiving representation

The split Receiving pill (Open Notes | Total) must have a filter **above** it:

| Filter | Window |
|--------|--------|
| **Monthly** | Calendar month |
| **Quarterly** | Calendar quarter |
| **Yearly** | Calendar year |

**Database rule (locked):** these windows are computed in PostgreSQL with **window functions**, not by downloading notes and grouping in the browser.

Required shape (illustrative, not a migration):

- Bucket with `date_trunc('month' | 'quarter' | 'year', <event_ts> AT TIME ZONE 'Asia/Kolkata')`.
- Partition with `COUNT(*) OVER (PARTITION BY bucket)` (and the same for Open vs all statuses as separate filtered counts).
- Use `LAG(bucket_count) OVER (ORDER BY bucket)` when a previous-period comparison is shown.
- Filter Open vs Total **in SQL** (`FILTER (WHERE status = 'OPEN')` or equivalent), not in JS.

**Timestamp for the window (locked unless a follow-up ADR says otherwise):**

| Receipt status | Clock |
|----------------|--------|
| OPEN | `created_at` |
| POSTED / CANCELLED / REVERSED | `posted_at` if present, else `created_at` |

Timezone for truncation: **`Asia/Kolkata`**. Do not use the database session TZ implicitly.

The filter changes **which window** the Open and Total numbers describe. It does not change what Open vs Total mean (Open = still receiving; Total = all statuses in that window).

Click behaviour stays: left half → Open Receipt Notes (that window); right half → all Receipt Notes (that window).

### 3. Two new composition cards

| Card | Chart | Slices |
|------|--------|--------|
| **Assets** | Pie | **Rented** · **Demo** · **Owned** |
| **Inventory** | Donut | **Sold** · **In Stock** |

Same calendar filters as Receipt Notes: **Monthly / Quarterly / Yearly**, plus a **Value** control.

**Value (locked):** the charts support two metrics, not two different slice sets:

| Metric | Asset | Inventory |
|--------|--------|-----------|
| **Count** | Number of holdings in the window | Number of holdings in the window |
| **Value** | Sum of recorded asset value | Sum of recorded inventory value |

A holding with no usable value contributes **0** to the Value metric and still **1** to Count. Do not drop it from Count because value is missing.

**Slice mapping (locked to existing fields; display labels as specified):**

| Chart slice | Source |
|-------------|--------|
| Asset **Owned** | `purpose` (or `Purpose`) = `Owned` |
| Asset **Demo** | `purpose` = `Demo` |
| Asset **Rented** | `purpose` = `Rental` (stored value today; **show Rented**) |
| Inventory **Sold** | status `Sold` (and equivalent sold/retired-sold if already used on inventory) |
| Inventory **In Stock** | current, non-deleted inventory that is not Sold |

Soft-deleted / Recovery Center rows are excluded from both charts. Retired/scraped Assets are excluded from the Asset pie unless a follow-up ADR includes them as their own slice (they are **not** Rented/Demo/Owned for this chart).

**Window for charts:** the same `Asia/Kolkata` `date_trunc` buckets, applied to the holding’s registration clock (Physical Intake `created_at` if present, else the row `created_at`). Sourced holdings use Receipt `posted_at` when that is the birth event. Implementation must pick one documented timestamp per row in the API contract — do not mix clocks inside one slice.

**SQL:** aggregate in the database (`GROUP BY` bucket + slice, with `SUM(value) OVER (PARTITION BY bucket)` / `COUNT(*) OVER (PARTITION BY bucket)` for share-of-period). Do not assemble pie/donut data from full Asset/Inventory dumps in the browser.

---

## What this ADR deliberately leaves alone

- PO Waitlist (receivable outstanding lines).
- Partial quantity PO split, multi-PO allocation, PO family/version engine.
- Vendor master, Zoho writes, RN quantity edits after POST.
- Relink/correction UI beyond “open the holding and complete adoption.”
- Changing the current Receiving Open | Total split pill, other than adding the period filter and wiring its counts to windowed SQL.

---

## Implementation gate

Do not start this work in the same change as unrelated refactors. Suggested order when authorized:

1. Change Physical Intake so every create starts Awaiting PO (no type default to No PO Required). Define waiting query + Awaiting Adoption list API + Dashboard card. Post-register action: mark No PO Required.
2. Receipt Note windowed aggregate API + filter above Receiving.
3. Asset pie + Inventory donut APIs + cards (count metric first, then value).
4. Adoption Receipt Note that parents existing holdings (write path; separate review from charts).

Each step: named migration if schema/indexes are required; verify on scratch DB; do not apply to production until asked.
