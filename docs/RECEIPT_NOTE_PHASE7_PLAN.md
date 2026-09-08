# Phase 7 — Receipt Note / GRN Plan

**Status:** PLAN ONLY. No code written. No migration created. No schema applied. No production mutation. No Receipt Note created. No Asset, Inventory, Product, Set, Reservation, Conversion, Break, Project, DC, Zoho or OAuth change.  
**Date:** 28 August 2026  
**Scope:** Design the canonical AssetEngine Receipt Note as the logistics receiving transaction, on top of Phase 1 (Product), Phase 2 (Quantity / Physical Identity), Phase 3 (Reservation), Phase 4 (Conversion), Phase 5 (Break containment) and Phase 6 (Set Engine).  
**Environment audited:** Source in this repository after Phase 6. Production database `asset_manager` inspected **read-only** on 28 August 2026.

**This document authorizes no implementation.**

---

## Authoritative inputs

- `docs/ASSETENGINE_CANONICAL_ARCHITECTURE.md` (revision 3; §1, §6, §8, §22–§25, §28–§30, §32.9, §33 Phases 7 and 9, §36 rules 101–109, §37–§38, §40 **OD-13**, §42 **ADR-CONVERSION-001**)
- `docs/ARCHITECTURE_GAP_ANALYSIS.md` (GAP-105, GAP-601–606, UNMAPPED-01)
- `docs/PRODUCT_ARCHITECTURE_DECISION.md` / `docs/PRODUCT_PHASE1_IMPLEMENTATION_PLAN.md`
- `docs/QUANTITY_PHYSICAL_IDENTITY_PHASE2_PLAN.md` (QR, `physical_marking`, conservation)
- `docs/RESERVATION_PHASE3_PLAN.md` (no automatic reservation from receipt)
- `docs/CONVERSION_PHASE4_PLAN.md` (OD-13 deferred to Phase 7; `make-permanent` not conversion)
- `docs/PHASE5_LEGACY_BREAK_CUTOVER_PLAN.md`
- `docs/SET_PHASE6_PLAN.md` (Product requirements feed future procurement; Receipt must not mutate Sets)
- `docs/ASSETENGINE_COMPLETE_ARCHITECTURE_AUDIT.md` (26 Aug PO / temp-asset map; some counts are stale after Phases 1–6)
- Live source: `server.js` (`/api/projects/:id/orders`, `/api/orders*`, `/api/temporary-assets*`, `/api/assets/:id/link-po-item`, DC PO-status write), `zohoService.js`, `IdGenerator.js`, `productService.js`, `inventoryMovementService.js`, `conversionService.js`, `projects.js`, `inventory.js` (`openInventoryFromCatalog`)
- Live schema: `project_orders`, `project_order_items`, `temporary_assets`, `assets.linked_po_item_id`, `product`, `reservation`, `conversion`, `set_requirement`. **No `receipt_note` table.**

**Facts the 26 August complete audit is stale on:** Product, reservation, conversion, Break containment, and canonical Sets now exist. GAP-601 (no Receipt Note) and GAP-602 (POs are local) are **not** stale.

**Canonical phase split that this plan must not collapse:**

| Canonical phase | What it owns |
|---|---|
| **Phase 7** | AssetEngine Receipt Note, physical creation from accepted quantity, reconciliation against a PO *context*, projection *design* |
| **Phase 9** | Transition of **commercial PO authority** from AssetEngine-local `project_orders` to Zoho Purchase Orders; Work Orders; Customer POs |

Phase 7 must **not** redesign the entire PO system.

---

## Production snapshot (read-only, 28 August 2026)

| Object | Count / state |
|---|---|
| `project_orders` | **2** (`PO-1779691453564-194` / `ARM-PO-01-26-27`; `PO-1779796181621-757` / `PO980`). Both `Active`. `vendorname` empty. |
| `project_order_items` | **2**. Line `id=2`: Apple MacBook Air 24 ×1 Nos, status **Shipped**, `assetid=APP-MUM-0526-MMKBX9-W`. Line `id=3`: MacBook ×1 Nos, status **Pending**, no asset. |
| Assets with `linked_po_item_id` | **1** (`APP-MUM-0526-MMKBX9-W` → line 2). **No `product_id`.** |
| `temporary_assets` | **0** |
| `quotes` | **0** |
| `receipt_note` table | **does not exist** |
| `product` | **201** |
| `assets` / `inventory_items` | **4** / **1** |
| `managed_sets` | **9** (7 legacy Managed + 2 Phase 6 disposable canonical Sets) |

No Zoho Purchase Order pull, no GRN table, no Receipt Note rows.

---

## 1. Executive summary

Receipt Note is an **AssetEngine logistics transaction**. It answers:

> What physically arrived against this PO, what was accepted, and which physical Asset/Inventory records were created?

It is **not** a Product, Asset, Inventory record, PO, Set, reservation, DC, or Zoho document.

Canonical target flow:

```
Zoho Purchase Order          (commercial source of record — target)
        ↓
PO Product line              (Product + ordered qty + unit)
        ↓
AssetEngine Receipt Note     (logistics transaction)
        ↓
Physical receiving / verify
        ↓
Accepted / Rejected / Damaged
        ↓
Create Inventory OR Asset    (accepted quantity only)
        ↓
GRN / receipt projection     (Zoho acknowledgement — separate)
```

**Present reality.** AssetEngine **is** the de-facto PO system (`project_orders` / `project_order_items`). Zoho CRM OAuth scopes cover **Products and Deals only**. There is no Purchase Order module client, no Books/Inventory SDK, and no “GRN” object in this codebase. Physical creation today happens through:

- ordinary Asset / Inventory create (including **catalogue → Inventory** with no PO);
- project temporary assets → unauthenticated `make-permanent`;
- `assets.linked_po_item_id` plus a **row-count** “fulfillment” heuristic;
- DC writing PO line status **Shipped** (outbound, not inbound).

Phase 7 must introduce a first-class Receipt Note **without** pretending Zoho already owns POs, **without** evolving `temporary_assets` into the engine, and **without** creating Product as a receiving side effect.

**When later approved, Phase 7 implementation should:**

- Add checksum-family Receipt Note / line IDs (`RN-` / `RNL-`)
- Draft → controlled **POST** → immutable posted transaction
- Snapshot PO line context (Product, ordered qty, unit, references)
- Reconcile Ordered / Received / Accepted / Rejected / Damaged / Outstanding with **two equations** (see §11)
- Create physical records **only from accepted quantity**
- Let Logistics choose Inventory / grouped Asset / individual Assets
- Write receipt lineage, quantity events, and Asset history
- Use an **outbox** for any Zoho projection (never hold a DB transaction across HTTP)
- JWT + Logistics roles; Sales cannot post
- Quarantine `temporary_assets` and local PO CRUD (do not delete)

**Explicitly out of Phase 7 implementation:** full Zoho PO authority migration (Phase 9), Work Orders, Customer POs, Set allocation, automatic reservations, serial architecture, QR redesign, disposition engine, DC/Project redesign, OAuth scope expansion unless the owner separately approves it.

---

## 2. Current PO audit

### 2.1 Local PO model (source of truth today)

| Table | Role |
|---|---|
| `project_orders` | Header. PK `id` format `PO-{epoch}-{rand}` (not checksum family). Fields: `projectid`, `ponumber` (free text), `podate`, `vendorname`, buyer/consignee GST block, `totalamount`, `status` default `Active`, soft delete. |
| `project_order_items` | Lines. Integer PK `id`. `orderid`, `srno`, `itemdescription` (free text), `qtyordered` float, `uom`, prices, optional `assetid`, `status` default `Pending`, `is_deleted`. |

**There is no `product_id` on a PO line.** Identity is a description string. That is incompatible with locked Product rules.

**There is no ordered-vs-received ledger.** “Fulfillment” in `GET /api/projects/:id/orders` is:

```
COUNT(assets WHERE linked_po_item_id = line)
+ COUNT(temporary_assets WHERE linked_po_item_id = line)
```

That counts **rows**, not quantity, and treats temps as received stock.

### 2.2 Routes (all JWT except where noted)

| Route | Auth | Behaviour |
|---|---|---|
| `GET/POST /api/projects/:id/orders` | JWT; POST requires admin | List/create local POs |
| `GET /api/orders`, `GET/PUT /api/orders/:orderId` | JWT | Search / edit |
| `DELETE /api/projects/:projectId/orders/:orderId` | JWT | Nulls `linked_po_item_id` on assets/temps then deletes lines |
| `PUT /api/orders/:orderId/status` | JWT | Header status |
| `POST /api/assets/:id/link-po-item` | JWT | Links an existing Asset to a line |
| `POST /api/dc` | (existing DC auth) | Sets linked PO item status **`Shipped`** |

PO create IDs are `PO-${Date.now()}-${rand}`. Not `RN-`, not Zoho IDs.

### 2.3 Quotes / Work Orders / Customer POs

- `quotes`: four columns, **0 rows**, no FK from `project_orders` (GAP-603).
- Work Orders: none (GAP-605).
- Customer vs vendor PO: not distinguished (GAP-604). Canonical defers to Phase 9.

### 2.4 Production PO evidence

| PO | Vendor | Line | Qty | Status | Linked physical |
|---|---|---|---|---|---|
| `ARM-PO-01-26-27` | (empty) | Apple MacBook Air 24 | 1 | **Shipped** | `APP-MUM-0526-MMKBX9-W` (no Product) |
| `PO980` | (empty) | MacBook | 1 | Pending | none |

`Shipped` here is **DC outbound**, not a Receipt Note. Do not reinterpret it as GRN.

---

## 3. Current receiving-like behaviour

| Mechanism | What it does | Why it is not Receipt Note |
|---|---|---|
| Add Asset / Add Inventory | Creates physical stock | No PO, no accepted/rejected split, catalogue path can skip Product |
| `openInventoryFromCatalog` | Prefills Inventory from `zoho_catalog` | GAP-105: Zoho Product alone creates stock. **Forbidden** as the receiving path |
| `linked_po_item_id` + fulfillment count | Associates an Asset/temp with a PO line | No quantities of accepted/damaged, no Product, row-count math |
| `make-permanent` | Temp → new Asset ID | No Product, no quantity events, no reservation counters, **no JWT** |
| DC `Shipped` | Marks PO line shipped | Outbound document, not inbound receive |
| `inventoryMovementService` `RECEIVE` | Registry entry | **`enabled: false`**. Sprint 1 only enabled CONSUME |

Physical creation **does** occur in production. It does **not** occur through a Receipt Note.

---

## 4. `temporary_assets` audit (OD-13)

### 4.1 What it is

Table created in `20260417060510_create_initial_schema.js`. Production also has `name` and `quantity` not in that migration (schema drift). Columns of interest: `projectid`, `ispermanent`, `linked_po_item_id`, `estimatedprice`, rental-ish `status`.

Complete-audit description: **non-owned / rental / borrowed gear on a project**, with optional PO-line link.

### 4.2 What it does

- `POST /api/projects/:id/temporary-assets` (JWT): creates `TEMP-…` IDs via `generateTempAssetId`.
- `POST /api/temporary-assets/:id/make-permanent` (**no `authenticateJWT`**): inserts a new `assets` row with `generateModernAssetId`, QR, optional `project_assets` membership, sets `ispermanent=1`, **keeps the temp row**. Does not set `product_id`, `quantity_*` conservation fields, or `linked_po_item_id` on the new Asset.
- Project asset list **unions** temps with permanent assets.

Production row count: **0**.

### 4.3 Disposition (recommendation)

| Option | Verdict |
|---|---|
| Evolve into Receipt Note | **Reject.** Wrong domain (project staging / rental), wrong ID family, unauthenticated promote, no Product, no quantity ledger |
| Treat as a third physical entity | **Reject.** Canonical has Asset and Inventory only |
| **Quarantine, do not delete, do not migrate into Receipt Note** | **Recommend.** OD-13 closed as **QUARANTINE**. Future retirement is a separate reviewed task after Receipt Note exists |

Phase 7 must **not** call `make-permanent`. New receiving writes go only through `receiptService`.

---

## 5. Zoho PO integration audit

### 5.1 What exists

`zohoService.js` is a **Zoho CRM** client (`@zohocrm/nodejs-sdk-8.0`).

OAuth scopes in source:

```
ZohoCRM.modules.products.ALL
ZohoCRM.modules.deals.READ
ZohoCRM.settings.fields.READ
ZohoCRM.settings.modules.READ
```

There is **no** `ZohoCRM.modules.purchaseorders` (or similar) scope. There is **no** Zoho Books / Zoho Inventory SDK. Grep of the backend for Purchase Order / Purchase Receive / GRN API usage: **zero**.

Deals sync is already documented as inoperative (GAP-704). Product pull/push exists and **must not be redesigned** here.

### 5.2 What “GRN” means in this product vs Zoho

| Term | AssetEngine | Zoho (typical products — **not verified for this org**) |
|---|---|---|
| Purchase Order | Local `project_orders` | CRM `Purchase_Orders` **or** Books/Inventory PO — **unknown which, if any, this org uses** |
| Goods receipt / Purchase receive | **Does not exist** | Zoho Inventory/Books “Purchase Receives”; CRM may have no equivalent object |
| GRN number | Not present | Often a Books document number, not a CRM ID |

**Do not assume the Zoho object is named GRN.** Until a live `inspectModuleFields` / org-module catalogue is run under an **approved** read-only probe, the projection target is an **adapter**, not a concrete SDK call.

### 5.3 Implication for Phase 7

Canonical §33 Phase 7 lists “Zoho PO pull”. Canonical §33 Phase 9 lists “transition of PO authority to Zoho”. Those are different jobs.

**Recommendation:** Phase 7 **consumes local `project_orders` as the PO context** (the only working PO). It defines `PoSourceAdapter` (`LOCAL` now, `ZOHO` later). It does **not** expand OAuth, does **not** modify `zohoService.js` Product/Deal paths, and does **not** call Zoho mutation APIs until the owner approves a named adapter and scopes.

Projection is designed as **outbox** (see §26–§28). Default implementation posture: **outbox rows may stay PENDING** if no Zoho receive object is configured. That is honest. It is not a fake GRN.

---

## 6. Receipt Note definition

A Receipt Note is:

- an AssetEngine **inbound logistics transaction**;
- always against **one PO header** (local today; Zoho later);
- composed of **one or more lines**, each against one PO line + one Product;
- the document on which accepted / rejected / damaged quantities are recorded;
- the **only** approved workflow in this phase that creates physical Asset/Inventory **from procurement receiving**.

It is not the PO. It does not replace `project_orders`. It does not allocate Sets. It does not create reservations.

---

## 7. GRN definition

In this architecture:

| Document | Authority | When it exists |
|---|---|---|
| **Receipt Note** | AssetEngine | Always, for every posted receive |
| **GRN / receipt projection** | External Zoho acknowledgement | Only if a configured adapter can create/correlate a remote receive document |

If Zoho has no receive object, AssetEngine still has a Receipt Note. Operators must not be told a GRN exists when only an outbox `PENDING` row exists.

---

## 8. PO → Receipt flow

```
PO header (local project_orders.id  OR  future zoho_po_id)
    └── PO line (project_order_items.id  OR  future zoho_po_line_id)
            └── Product (AssetEngine product.id)   ← required at POST
                    └── Receipt Note (RN-…)
                            └── Receipt line (RNL-…)
                                    ├── snapshot (ordered qty, unit, description, hashes)
                                    ├── this-receipt qty split
                                    └── outputs (Asset/Inventory IDs)
```

**Product rule (locked):** a Zoho Product by itself does nothing. The Receipt line’s `product_id` must be an existing AssetEngine Product, obtained either because the PO line was already linked or because the operator **explicitly** ran the approved Product-link / Product-create workflow (Phase 1 `POST /api/products` + optional external ref). Receiving **must not** create Product as a side effect and **must not** fuzzy-match Make/Model/SKU/name.

---

## 9. Receipt lifecycle

Do **not** copy Set’s “immediately ACTIVE” model. Physical stock must not appear from an incomplete form.

| Status | Meaning | Physical records | Editable |
|---|---|---|---|
| `OPEN` | Operator is recording a delivery. Not posted. | None | Yes |
| `POSTED` | Accepted quantity created physical records. Immutable. | Yes (accepted) | **No** |
| `CANCELLED` | Abandoned before post. | None | No (terminal) |
| `REVERSED` | Posted note that has been fully reversed by a later reversal document | Reversal created; originals remain queryable | No |

**Do not write `DRAFT` as a stored status** unless the owner insists on that word. `OPEN` is the incomplete state. This avoids inventing a Set-like DRAFT that Phase 6 explicitly refused, while still preventing accidental stock.

**When it becomes final:** `POST` succeeds.

**Posted edits:** forbidden. Corrections = reversal + new Receipt Note (or a typed `ADJUSTMENT` receipt — see §23).

**Cancel:** only `OPEN` → `CANCELLED`. Never delete the row.

---

## 10. PO line snapshot

Because the local PO (and later Zoho PO) can change after receiving, each Receipt **line** stores a snapshot at POST time (and an earlier snapshot at OPEN if the operator loaded a preview).

**Snapshot (required):**

| Field | Why |
|---|---|
| `po_id` / `po_line_id` | Join |
| `po_source` (`LOCAL` / `ZOHO`) | Adapter |
| `product_id` | Identity |
| `ordered_qty` | Reconciliation base for **this** document |
| `unit` | Unit snapshot (from Product if PO `uom` empty) |
| `item_description` | Human reconstruction |
| `po_number` / `vendor_name` | Header crumbs (nullable if empty) |
| `fetched_at` | Staleness |
| `source_hash` | Detect later PO change |

**Do not snapshot:** unit price / GST / buyer address (commercial; not required to reconstruct physical receipt). May store `vendor_invoice_no` / `delivery_note_no` on the **header** as operational references, not as identity.

`source_hash` = stable hash of `(po_line_id, product_id, ordered_qty, unit, description)`.

---

## 11. Quantity reconciliation (locked equations)

Do **not** use a single equation that treats damaged/rejected as filling the PO.

### 11.1 This Receipt line (posted)

```
received = accepted + rejected + damaged
received > 0  OR  (accepted=rejected=damaged=0 is illegal on POST)
accepted, rejected, damaged, received  ≥ 0
```

`received` is the physical count the operator claims arrived **in this delivery**. It is an intermediate logistics term. It is **not** outstanding and **not** ordered.

### 11.2 Commercial remaining on a PO line (posted receipts only)

```
accepted_to_date = SUM(accepted)  over POSTED, non-reversed lines for that po_line_id
outstanding     = ordered_current − accepted_to_date
```

`ordered_current` is the **live** PO ordered qty at the moment of the check (local row, or Zoho after refresh).

**Damaged and rejected do not reduce outstanding.** The vendor still owes the unordered remainder unless a human changes the PO (Phase 9 / commercial process). They remain on the Receipt Note so we can answer “what happened to the other units in that box.”

### 11.3 Cross-check against a snapshot

At POST, also store `ordered_qty` snapshot. If `ordered_current ≠ ordered_qty` snapshot → **stale PO** path (§25), not silent accept.

### 11.4 What must never be conflated

| Term | Meaning |
|---|---|
| Ordered | Commercial PO line quantity |
| Received | This delivery’s physical count (`accepted+rejected+damaged`) |
| Accepted | Quantity that may become Asset/Inventory |
| Rejected | Arrived, not accepted (wrong/spec) — not stock |
| Damaged | Arrived, not saleable — not Available stock (**ADR-CONVERSION-001** analogue) |
| Outstanding | `ordered_current − accepted_to_date` |

---

## 12. Partial receipts

Supported and required. Multiple POSTED Receipt Notes may target the same PO line.

Example:

```
Ordered 10
RN-1 accepted 6  → outstanding 4
RN-2 accepted 4  → outstanding 0
```

Each note has its own `received/accepted/rejected/damaged`. Completeness of the **PO line** is computed, never stored as a single mutable counter without a ledger.

---

## 13. Rejected / damaged

- Recorded on the Receipt line.
- **Not** included in physical creation.
- **Not** written as Available Inventory.
- **Not** a first-class disposition holding in Phase 7 (ADR-CONVERSION-001 future engine).
- If a damaged unit must later exist as a managed physical record, that is an explicit **future disposition** decision, not a receive side effect.

Under-receipt: `outstanding > 0` after POST. PO is not auto-closed.

---

## 14. Physical creation

Only **accepted** quantity creates AssetEngine physical records.

```
PO 10, received 8, accepted 7, damaged 1, outstanding 3
→ create quantity 7
```

Never create 8 saleable units. Never create stock for rejected/damaged.

Creation happens **only inside POST**, in one DB transaction with the Receipt row.

---

## 15. Inventory creation

If Logistics selects **INVENTORY** for a line with accepted = N:

- **One** `inventory_items` row
- `quantity_total = quantity_available = N`
- `quantity_reserved = 0`
- `quantity_converted = 0`
- `product_id` = receipt line Product
- **One QR** (Phase 2 aggregated rule)
- `lineage_status = ACTIVE`
- No per-unit Inventory QR

---

## 16. Asset creation

If Logistics selects **GROUPED ASSET**:

- One Asset, `quantity_total = quantity_available = N` (quantity-tracked), one QR

If Logistics selects **INDIVIDUAL ASSETS**:

- N Asset rows, each qty 1, each own ID and QR
- Uses Phase 2 physical identity (`generateModernAssetId` / existing Asset ID family — **not** `RN-` as the Asset ID)

Sales does not choose this. UI is Logistics-only.

---

## 17. Grouped vs individual

| Choice | Records | QR |
|---|---|---|
| Inventory | 1 row qty N | 1 |
| Grouped Asset | 1 Asset qty N | 1 |
| Individual Assets | N Assets qty 1 | N |

Do not create ten Inventory rows for qty 10.

---

## 18. Product propagation

Every created holding **must** have `product_id = receipt_line.product_id`.

Store separately (nullable): `zoho_product_id` only if already on the Product mapping — **do not** use Zoho Product ID as physical identity. Do not use PO number or PO line id as Product.

If Product is null at POST → **409 / 422 `PRODUCT_REQUIRED`**. Offer the existing Product picker; do not auto-create.

Wrong Product (does not match PO-line linked Product if one was snapshotted) → reject.

---

## 19. Receipt lineage

New dimension. **Do not** stuff into:

- `assets.parentid`
- `quantity_parent_id` / `quantity_root_id`
- `conversion_source_id`
- Set `requirement_id` / `managed_set_components`

**Use:**

```
receipt_physical_output
  receipt_line_id → physical_type (ASSET|INVENTORY) → physical_id → quantity
```

Plus nullable columns on holdings:

- `receipt_line_id` (FK)
- optionally `receipt_note_id` (denormalized for search)

Search: Receipt Note → all outputs; Asset → line → PO line → PO header.

---

## 20. Origin / provenance

**Product.origin** stays `ZOHO | ASSETENGINE | ASSET | INVENTORY | SET`. Receiving does **not** create Products, so do **not** add `RECEIPT` to Product origin.

**Physical provenance:** `receipt_line_id` is sufficient. Do not overload Product `origin_ref`.

If a denormalized label is wanted later: `origin_type=RECEIPT`, `origin_ref=RN-…` on the holding — **open as P7-PHYS-ORIGIN**. Prefer `receipt_line_id` only in Phase 7 to avoid a third origin scheme.

---

## 21. Receipt IDs

Existing checksum family (`IdGenerator.generateChecksumPrefixedId`): `PRD`, `SET`, `REQ`, `ALC`, plus reservation/conversion prefixes already in that family.

| Entity | Format | Notes |
|---|---|---|
| Receipt Note | **`RN-MMYY-XXXXXX-C`** | Internal operational ID |
| Receipt line | **`RNL-MMYY-XXXXXX-C`** | Immutable |
| Projection outbox | bigserial + `idempotency_key` | Not an RN |

Do **not** reuse `PO-{timestamp}`, `TEMP-`, `generateModernAssetId()`, or `kitSetService.newId()`.

External references remain columns: `ponumber`, `vendor_invoice_no`, Zoho IDs (strings).

---

## 22. Receipt history

Append-only `receipt_event`. Never UPDATE/DELETE.

Minimum types: `NOTE_OPENED`, `LINE_RECORDED`, `POSTED`, `CANCELLED`, `REVERSED`, `PROJECTION_ENQUEUED`, `PROJECTION_SENT`, `PROJECTION_FAILED`.

Payload: note id, line id, product id, quantities, output physical ids, actor, timestamp, location snapshot, Zoho correlation, note text.

Posted Receipt Notes are never deleted.

---

## 23. Correction / reversal

**Forbidden:** `UPDATE accepted_quantity 10 → 7` on a POSTED line.

**Required path:**

1. `POST /api/receipt-notes/:id/reverse` (Logistics)
2. Reverse **releases** created quantity using existing engines:
   - If still Available and not reserved / converted / set-allocated / assigned / DC-committed → allow reverse of that quantity (Break/conversion/reservation eligibility reused; do not invent parallel math)
   - If not fully reversible → **409** with reason; do not partial-lie
3. New Receipt Note for the corrected accepted qty

Do not delete Assets. Reverse may convert/adjust quantity via quantity events (`ADJUST` / dedicated `RECEIPT_REVERSAL` event type) while preserving IDs.

OPEN vs POSTED: cancel OPEN without reversal.

---

## 24. Concurrency

Two operators must not both consume the same outstanding.

**Lock:** `SELECT … FOR UPDATE` on the **local PO line row** (`project_order_items` where `po_source=LOCAL`). Compute `accepted_to_date` inside the transaction from posted receipt lines.

```
outstanding = 5
A posts 4 → success, outstanding 1
B posts 3 → 409 INSUFFICIENT_OUTSTANDING
```

Do not build a Receipt-specific lock table. Do not lock Zoho over the network inside the same transaction.

When `po_source=ZOHO` exists in a later phase, still lock the **local mirror row** (or a `po_line_mirror` table) that POST refreshed.

---

## 25. Stale PO handling

**Preview (OPEN):** snapshot current PO.

**POST:** re-read PO line (local always; Zoho only if adapter enabled). Recompute hash.

| Situation | Response |
|---|---|
| Hash matches | Continue |
| Ordered qty increased | Allow only if new outstanding covers this accepted qty; show warning; store both snapshots |
| Ordered qty decreased below `accepted_to_date + this.accepted` | **409 STALE_PO / OVER_RECEIPT** |
| Line deleted / PO cancelled | **409 PO_UNAVAILABLE** |
| Cache said outstanding 5, live says 2, operator posts 4 | **409** — no silent over-receipt |

No silent accept of changed quantities.

---

## 26. Zoho projection

Receipt Note POST is **AssetEngine-authoritative** for physical stock.

Zoho acknowledgement is **best-effort, durable, asynchronous**.

```
DB transaction: POST receipt + create physical + write outbox PENDING
COMMIT
then: worker / request-tail tries adapter.send()
```

**Never** `BEGIN … HTTP Zoho … COMMIT`.

If adapter is `NONE` (Phase 7 default): outbox row `SKIPPED` or remain `PENDING` with reason `ADAPTER_NOT_CONFIGURED`. Operator UI shows projection status honestly.

---

## 27. Idempotency

Two layers:

| Layer | Key | Protects |
|---|---|---|
| AssetEngine POST | `Idempotency-Key` header (same pattern as Conversion / Set) unique on `receipt_note` | Duplicate RN, duplicate physical rows |
| Zoho projection | `outbox.idempotency_key` = `RN-id` + line set hash | Duplicate remote receives |

Retry of the same POST key returns the original POSTED note. Retry of outbox send is upsert/get-by-key on the remote side if the API supports it; otherwise send once and store remote id.

---

## 28. Outbox / retry

Table `receipt_projection_outbox`:

- `receipt_note_id`
- `po_id` / `zoho_po_id`
- `zoho_receipt_id` (nullable)
- `status`: `PENDING | SENT | FAILED | RETRY | SKIPPED`
- `attempt_count`, `next_attempt_at`, `last_error`, `request_fingerprint`, timestamps

Worker is **not** implemented in this plan. Implementation later may start as “try once after POST, leave FAILED for retry script” — still an outbox, not an in-transaction HTTP call.

Failure modes: OAuth, timeout, 4xx, 5xx, rate limit, malformed JSON, duplicate. Physical stock stays; projection status is visible.

---

## 29. Authorization

| Operation | Auth |
|---|---|
| List / get Receipt Notes | JWT |
| OPEN / POST / cancel / reverse | JWT + `superuser` / `admin` / `manager` (same Logistics set as Sets/Break/Conversion) |
| Sales | **No** post, no Asset vs Inventory choice, no qty split |

Do not leave `make-permanent` as the receiving API. Do not add Receipt routes without JWT.

Existing unauthenticated `make-permanent` is **out of scope to fix in the same PR** unless the owner asks; call it out as a leftover GAP-606 hole.

---

## 30. UI architecture

Reuse `#sets-view` visual language: top bar, cards, bordered sections, confirm modals, toasts. **No new visual system.**

**Recommended home:** new `#receipts-view` nav item (Logistics), not buried only inside Project Kanban — receiving is a warehouse action. Project PO panel may link “Receive against this PO” into the same modal.

Conceptual POST screen (from the brief; confirm against `index.html` spacing at implementation):

- PO number, vendor (may be empty today)
- Per line: Product, ordered, previously accepted, outstanding
- This receipt: received / accepted / damaged / rejected
- Physical creation: Inventory / grouped Asset / individual Assets
- Preview of records that will be created
- `[Post receipt]`

Do not put an Edit control on posted quantities.

Over-receipt: warn + block unless P7-OVERRECEIPT is approved.

---

## 31. Proposed schema (minimum additive)

Named migration only, e.g. `YYYYMMDDHHMMSS_receipt_note_foundation.js`. **Never `migrate:latest`.** Abandoned `20260824120000` remains unapplied.

### 31.1 `receipt_note`

- `id` `RN-…` PK  
- `status` `OPEN|POSTED|CANCELLED|REVERSED`  
- `po_source` `LOCAL|ZOHO`  
- `po_id` (local `project_orders.id` or future Zoho id string)  
- `po_number` snapshot  
- `vendor_name` snapshot (nullable)  
- `vendor_invoice_no`, `delivery_note_no` (nullable)  
- `received_at`, `received_at_location` (nullable snapshot of existing location string)  
- `received_by` / `created_by` / `posted_by`  
- `posted_at`  
- `idempotency_key` unique nullable  
- timestamps  

### 31.2 `receipt_note_line`

- `id` `RNL-…` PK  
- `receipt_note_id`  
- `po_line_id` (string; local integer stored as text)  
- `product_id` FK `product(id)` **NOT NULL on POST** (nullable while OPEN until operator links)  
- snapshot fields §10  
- `qty_received`, `qty_accepted`, `qty_rejected`, `qty_damaged` numeric(18,6)  
- `unit`  
- `creation_mode` `INVENTORY|ASSET_GROUPED|ASSET_INDIVIDUAL` (required at POST if accepted>0)  
- `sort_order`  
- immutability trigger after parent is POSTED  

### 31.3 `receipt_physical_output`

- `id` bigserial  
- `receipt_line_id`  
- `resource_type` `ASSET|INVENTORY`  
- `resource_id`  
- `quantity`  
- unique `(resource_type, resource_id)` for provenance search  

### 31.4 Holding columns (nullable, no backfill)

- `assets.receipt_line_id`  
- `inventory_items.receipt_line_id`  

Do **not** backfill `APP-MUM-0526-MMKBX9-W` from `linked_po_item_id`. That is legacy association, not a Receipt Note.

### 31.5 `receipt_event` (append-only)

As §22.

### 31.6 `receipt_projection_outbox`

As §28.

### 31.7 Do not create

- Fake Zoho PO tables
- Disposition holdings
- Set/reservation rows
- Automatic `product` rows

---

## 32. Proposed API

Prefix `/api/receipt-notes`. JWT throughout. Mutations Logistics roles.

| Method | Path | Notes |
|---|---|---|
| POST | `/api/receipt-notes` | OPEN; body: po_id, optional lines |
| GET | `/api/receipt-notes` | Filter po, status, q |
| GET | `/api/receipt-notes/:id` | Hydrated lines + outputs + projection |
| PUT | `/api/receipt-notes/:id` | OPEN only |
| POST | `/api/receipt-notes/:id/post` | Atomic physical create |
| POST | `/api/receipt-notes/:id/cancel` | OPEN only |
| POST | `/api/receipt-notes/:id/reverse` | POSTED |
| GET | `/api/receipt-notes/:id/history` | |
| GET | `/api/purchase-orders/:id/receipt-balance` | Computed outstanding (local adapter) |

Do **not** implement Zoho PO CRUD. Existing `/api/orders*` remain for local PO until Phase 9.

501 is acceptable for `POST /api/receipt-notes/:id/project-to-zoho` if adapter is unset.

---

## 33. Service architecture

```
receiptService.js          canonical writes (like setService)
  ├── productService       load/verify Product (no create)
  ├── existing Asset/Inventory insert helpers (quantity INIT events)
  ├── inventoryEventSystem RECEIVE (enable for this path only)
  ├── reservationService   not called on create
  └── kitSetService / setService   not called

receiptProjectionService.js   outbox worker (new file)
  └── must NOT rewrite zohoService Product/Deal logic
```

`inventoryMovementService.RECEIVE` is currently `enabled: false`. Phase 7 should either enable it **only** as a wrapper around the same quantity events, or write `EVENT_TYPES.RECEIVE` directly the way create-Inventory writes INIT. Prefer **one** quantity accounting path.

**Event split:**

| Event | Meaning |
|---|---|
| `receipt_event` | What was received / posted / reversed |
| `quantity_events` / `inventory_quantity_events` | Physical qty came into existence (`RECEIVE` or `INIT`+metadata `receipt_line_id`) |
| `asset_history` | Asset CREATE from receipt |

Do not triple-count quantity. Receipt event is not a second quantity ledger.

---

## 34. Migration strategy

1. Named additive migration only.  
2. Scratch restore from `pg_dump`.  
3. Apply named up.  
4. Do not convert the 2 existing POs, the Shipped MacBook, or `linked_po_item_id` into Receipt Notes.  
5. `temporary_assets` untouched.  
6. Down: refuse if any POSTED receipt exists (same pattern as Set engine down()).

---

## 35. Legacy compatibility

| Legacy | Phase 7 action |
|---|---|
| `project_orders` CRUD | Keep. Receipt **reads** it. Do not remove. |
| `linked_po_item_id` | Keep. New physical rows from Receipt use `receipt_line_id`. Do not write `linked_po_item_id` unless a tiny compatibility flag is owner-approved (default **off**) |
| Fulfillment row-count | Stale; leave until Project UI is updated to read receipt balances |
| DC `Shipped` | Unchanged. Not inbound GRN |
| Catalogue → Inventory | Unchanged (GAP-105 remains until a later quarantine) |
| `temporary_assets` | Quarantine |
| `make-permanent` | Leave; do not use |

---

## 36. Test strategy

Scratch first. Restore production dump. Named migration. No `migrate:latest`.

Mandatory cases (from the brief, mapped):

**PO / receipt:** one line; multi-line note; partial; two partials summing to ordered; exact completion; under-receipt; over-receipt rejected (or approved path if P7-OVERRECEIPT); stale hash; PO qty change after RN-1.

**Quantity:** equations §11; damaged; rejected; outstanding; no negatives; no double POST of same idempotency key; concurrent FOR UPDATE 409.

**Product:** required at POST; propagated; no auto Product; mismatch rejected.

**Physical:** Inventory / grouped Asset / individual; qty; Product; QR count; lineage.

**Reservation:** reserved=0; later `reservationService.reserve` works.

**Set:** no auto allocate; later allocate matching Product works.

**History:** receipt + quantity + asset_history; PO→RN→physical query.

**Lifecycle:** POSTED immutable; reverse; cancel OPEN; no delete.

**Zoho:** with adapter=`NONE`, outbox SKIPPED/PENDING; with a **fake adapter** in scratch: timeout, 401/4xx/5xx, retry, idempotent replay, correlation. **Do not** call live Zoho mutation APIs in tests.

**Security:** 401 / 403 / Sales blocked.

**Regression:** Phase 1–6 verify scripts without mutation flags against protected holdings.

**Data safety:** existing 4 assets, 1 inventory, 2 POs, MIS, APP, HAR, IEIZP5, 7 legacy Managed Sets unchanged; no reservation invention; `zoho_catalog` unchanged; OAuth unchanged.

---

## 37. Production rollout

1. `pg_dump`  
2. Scratch restore  
3. Named migration  
4. Full scratch suite  
5. Phase 1–6 regression  
6. Deploy schema + API + UI  
7. Verify routes, auth, empty Receipt list, existing POs unchanged  
8. **Do not** auto-receive ARM-PO or PO980  

First real smoke (separate owner approval): a **small, non-sensitive** PO line whose Product already exists — not `APP-MUM-0526-MMKBX9-W`, not HAR/IEIZP5/MIS.

---

## 38. Rollback

| State | Rollback |
|---|---|
| OPEN, not posted | Cancel. No physical rows |
| POSTED | Reverse workflow. **Never** “delete RN and delete Assets” |
| Projection FAILED | Retry outbox. Stock remains |
| Schema | Down only if zero POSTED receipts |
| App | Stop serving `/api/receipt-notes`; local PO UI unchanged |

Database restore is not the default rollback.

---

## 39. Files that would change (when implementation is approved)

| File | Role |
|---|---|
| `migrations/…_receipt_note_foundation.js` | Additive schema |
| `services/receiptService.js` | **New** canonical service |
| `services/receiptProjectionService.js` | **New** outbox (adapter may be no-op) |
| `IdGenerator.js` / `utils.js` | `generateReceiptNoteId` / `generateReceiptLineId` |
| `server.js` | `/api/receipt-notes*` |
| `scripts/receipt-phase7-verify.js` | **New** |
| Frontend: `js/receipts.js`, `index.html` `#receipts-view`, `main.js`, `style.css` | Receiving UI |
| `inventoryEventSystem` / movement registry | Enable RECEIVE for this path only |

---

## 40. Files that must NOT change

| File / area | Why |
|---|---|
| `zohoService.js` | Product/Deal/OAuth boundary; no PO rewrite in Phase 7 |
| OAuth / tokens / `.env` | Secrets; no scope expansion without a separate approval |
| `productService.js` | No hidden Product create |
| `conversionService.js` / `breakService.js` | Eligibility reuse only |
| `reservationService.js` | No auto reserve; no math copy |
| `setService.js` / Set requirements | No allocate, no requirement edit |
| `kitSetService.js` / Make Set / Break Set | Unrelated |
| Abandoned `20260824120000_create_managed_sets_tables.js` | Never apply |
| `temporary_assets` data / `make-permanent` body | Quarantine |
| `project_orders` redesign | Phase 9 |
| DC / Projects / serial / QR architecture | Non-goals |
| `parentid` / `is_set` / conversion lineage columns | Wrong lineage |
| Production compose / ports | Ops |

---

## 41. Blockers

| # | Blocker | Effect |
|---|---|---|
| **B1** | No Zoho PO module, no receive API, no OAuth scope | Cannot honestly “pull Zoho PO” or emit GRN in Phase 7 without a separate Zoho workstream |
| **B2** | Local PO lines have **no `product_id`** | Every receive requires an explicit Product link first |
| **B3** | Almost no production holdings have `product_id` (Phase 6 smoke) | Received stock will be the main way Product-linked Inventory/Assets appear — do not “fix” this by auto-creating Products |
| **B4** | Fulfillment is row-count; DC uses **Shipped** | Operators will confuse inbound Receipt with outbound DC until UI copy is careful |
| **B5** | `make-permanent` unauthenticated | Parallel unsafe create path remains unless separately gated |
| **B6** | GAP-105 catalogue → Inventory | Still bypasses Receipt; quarantining it is **not** automatic in Phase 7 |
| **B7** | Reverse vs reserved/converted/set-allocated stock | Reversal can 409; that is correct, not a workaround to delete |
| **B8** | `inventoryMovementService.RECEIVE` disabled | Must wire events without a second ledger |
| **B9** | Production POs have empty vendor and weak descriptions | Snapshot will be sparse; still required |
| **B10** | Abandoned sets migration still in tree | `migrate:latest` remains forbidden |

None of these authorize production writes in this planning task.

---

## 42. Open decisions (owner)

| ID | Decision | Recommendation | Blocks |
|---|---|---|---|
| **P7-PO-SOURCE** | What is the PO context in Phase 7? | **Local `project_orders`.** Zoho adapter interface only. Authority move = Phase 9 | Entire flow |
| **P7-OVERRECEIPT** | Accept beyond outstanding? | **Reject by default.** Optional later: manager override + `VARIANCE` flag | POST validation |
| **P7-DRAFT-WORD** | Status name OPEN vs DRAFT | **OPEN** (avoid Set DRAFT confusion) | Schema CHECK |
| **P7-PHYS-ORIGIN** | Extra `origin_type=RECEIPT` column? | **No.** `receipt_line_id` only | Holding ALTER |
| **P7-COMPAT-LINK** | Also write `linked_po_item_id` on new Assets? | **No** by default (legacy heuristic stays distinct) | Project fulfillment UI |
| **P7-ADAPTER** | Ship no-op outbox vs wait for Zoho object? | **No-op / SKIPPED outbox** so POST is not blocked | Projection |
| **P7-OAUTH** | Add CRM PurchaseOrders or Books scopes? | **Not in Phase 7** unless a dedicated Zoho ticket is approved | `zohoService` / tokens |
| **P7-SERIAL** | Capture manufacturer serial at receive? | **Optional `physical_marking` on individual Assets only.** Not identity | Line POST payload |
| **P7-LOCATION** | Require `received_at_location`? | **Optional** snapshot of existing `currentlocation` vocabulary | Header |
| **P7-MULTI-PO** | One RN across multiple PO headers? | **No.** One PO header per Receipt Note; many lines | Create API |
| **OD-13** | `temporary_assets` | **QUARANTINE** (this plan) | Closed for Phase 7 |

---

## Decision matrix

| Decision | Recommendation | Reason | Phase |
|---|---|---|---|
| Receipt Note identity | `RN-MMYY-XXXXXX-C` checksum family | Matches PRD/SET/REQ/ALC; not PO number | 7 |
| Receipt line identity | `RNL-MMYY-XXXXXX-C` | Immutable audit identity | 7 |
| One vs many PO lines per RN | **Many lines, one PO header** | One delivery, many products | 7 |
| Partial receipt | **Required** | Canonical §22 | 7 |
| Over-receipt | **Reject** unless P7-OVERRECEIPT | No silent extra stock | 7 |
| Accepted vs damaged vs rejected | Three columns; only accepted creates stock | Canonical + ADR-CONVERSION-001 | 7 |
| Quantity equations | §11.1 received=accepted+rejected+damaged; §11.2 outstanding=ordered−Σaccepted | Damaged/rejected do not fill the PO | 7 |
| Product required | **Yes at POST** | §6; no fuzzy match | 7 |
| Product missing | Operator uses existing Product workflow | No hidden create | 7 |
| Asset vs Inventory | **Logistics choice at POST** | Sales excluded | 7 |
| Grouped Asset | One Asset qty N, one QR | Phase 2 | 7 |
| Individual Assets | N Assets qty 1 | Phase 2 | 7 |
| Inventory aggregation | One row qty N, one QR | Phase 2; no per-unit Inventory QR | 7 |
| PO snapshot | Hash + ordered/unit/product/description | PO can change | 7 |
| PO changes after receive | Stale check at POST; 409 if unsafe | No retroactive RN edit | 7 |
| Stale cache | Refresh at POST; never trust OPEN preview alone | Outstanding can shrink | 7 |
| Lifecycle | OPEN → POSTED / CANCELLED; REVERSED | Physical create only on POST | 7 |
| Posted immutability | **Yes** | State-changing history | 7 |
| Correction | Reverse + new RN | No UPDATE of posted qty | 7 |
| Physical lineage | `receipt_line_id` + `receipt_physical_output` | Not parentid/conversion/Set | 7 |
| `temporary_assets` | Quarantine; do not migrate | OD-13; 0 rows; wrong domain | 7 |
| Reservation | **None on create**; reserved=0 | Receipt ≠ commitment | 7 |
| Set | **No auto allocate**; Product preserved for later | Phase 6 boundary | 7 |
| Serial | Optional marking; not AssetEngine ID | Phase 2 `physical_marking` | 7 |
| QR | Follow Phase 2 by creation mode | Aggregated vs individual | 7 |
| Zoho GRN object | **Unknown; adapter + SKIPPED until proven** | No code, no scopes | 7 / 9 |
| Zoho failure | Outbox; stock stays | Cannot atomically commit HTTP | 7 |
| Outbox | **Yes** | Durable retry | 7 |
| Idempotency | RN key + outbox key | Two layers | 7 |
| Concurrency | `FOR UPDATE` on PO line | Same as Phase 3 holdings | 7 |
| Authorization | JWT + Logistics roles; Sales blocked | §37 | 7 |
| Local PO system | Keep; consume; don’t replace | Phase 9 owns authority move | 7 / 9 |
| Catalogue create (GAP-105) | Leave; do not use as receive | Separate quarantine | later |

---

## Hardest issues (for the owner)

**Quantity.** Outstanding must be `ordered − accepted_to_date`. Using `ordered = accepted + rejected + damaged + outstanding` would treat damaged goods as filling the purchase, which they do not.

**Zoho.** This codebase cannot project a GRN today. Phase 7 should still post physical reality and record projection as skipped/pending. Pretending a CRM “GRN” exists would be a lie.

**`temporary_assets`.** Prior art for “create Asset from something linked to a PO line,” but it is project rental/staging, unauthenticated on promote, Product-less, and empty in production. Quarantine it. Do not build Receipt Note on it.

---

*End of plan. Implementation is not authorized by this document.*
