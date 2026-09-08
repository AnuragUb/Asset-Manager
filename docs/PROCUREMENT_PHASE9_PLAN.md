# Phase 9 — Procurement / PO Authority Transition Plan

**Status:** PLAN ONLY. No code written. No migration created. No schema applied. No production mutation. No Zoho mutation. No OAuth, token, or scope change. No PO create/update/delete. No Receipt Note change. No Asset / Inventory / Set / Reservation / Conversion / Break / Project / DC / Rental change.  
**Date:** 29 August 2026  
**Scope:** Design the procurement/commercial workflow layer on top of Phases 1–8, and the deliberate transition of commercial PO authority from AssetEngine-local `project_orders` to Zoho.

This document authorizes **no** implementation.

**Do not start Phase 10. Do not implement Customer PO. Do not implement Work Orders.**

---

## Authoritative inputs

- `docs/ASSETENGINE_CANONICAL_ARCHITECTURE.md` (rev 3; §1 boundary, §22 Receipt, §23 PO, §24 Customer PO, §25 Work Orders, §26 Projects, §27 DC, §33 Phase 9, §36 rules 10–13 / 80, §38, §40 **OD-15**)
- `docs/ARCHITECTURE_GAP_ANALYSIS.md` (GAP-601–606, GAP-602, GAP-704, UNMAPPED-03/04, stale phase numbering vs canonical)
- `docs/PRODUCT_ARCHITECTURE_DECISION.md` (Product as PO-line key; no fuzzy match)
- `docs/PRODUCT_PHASE1_IMPLEMENTATION_PLAN.md` (Product identity, strict 1:1 `product_external_ref`, origins)
- `docs/QUANTITY_PHYSICAL_IDENTITY_PHASE2_PLAN.md` (Product has no quantity)
- `docs/RESERVATION_PHASE3_PLAN.md` (Reserved ≠ On Order)
- `docs/CONVERSION_PHASE4_PLAN.md`
- `docs/PHASE5_LEGACY_BREAK_CUTOVER_PLAN.md`
- `docs/SET_PHASE6_PLAN.md` (immutable requirements; completeness = required − allocated)
- `docs/RECEIPT_NOTE_PHASE7_PLAN.md` (`P7-PO-SOURCE = LOCAL`; Zoho adapter `NONE`/`SKIPPED`; OVER_RECEIPT = REJECT)
- `docs/ZOHO_PRODUCT_SET_PHASE8_PLAN.md` (CRM Product mapping; OAuth freeze; PO/Books deferred here)
- `docs/ASSETENGINE_COMPLETE_ARCHITECTURE_AUDIT.md` (26 Aug PO/Zoho map; counts below supersede that file)

**Live source audited (read-only):** `project_orders`, `project_order_items`, `quotes`, `receipt_note*`, `receiptProjectionService.js`, `receiptService.js`, `server.js` PO/DC/link-po routes, `projects.js`, `receipts.js`, `dcProjectFetcher.js`, `dashboard.js` DC helpers, `zohoService.js`, `package.json`, production Postgres, Zoho CRM `getModules` + `inspectModuleFields` (fields only; **no PO record GET/CREATE/UPDATE**).

**OD numbering trap:**

| ID | Source | Question | Status entering Phase 9 |
|---|---|---|---|
| Canonical **OD-15** | Canonical §40 | Where PO authority lives during transition, and how long both representations coexist | **OPEN — this phase** |
| Canonical **OD-12** | Canonical §40 / Phase 8 | Publish stock quantity to Zoho? | **CLOSED Phase 8: No** |
| Phase 7 **P7-PO-SOURCE** | Receipt plan | What PO context does receiving use? | **CLOSED Phase 7: LOCAL `project_orders`.** Zoho = this phase |

---

## Locked system boundary

**Zoho (target commercial / procurement authority):**

- Vendor procurement Purchase Order header and lines
- Vendor master used by those POs
- Commercial status, ordered quantity, agreed purchase price, tax/discount on the PO document
- Zoho Product catalogue (already mapped 1:1 in Phase 8)

**AssetEngine (physical / logistics authority — unchanged):**

- Receipt Note / accepted / rejected / damaged
- Asset and Inventory creation from **posted** Receipt Notes only
- Set requirements (immutable) and physical allocation (mutable)
- Reservation, Conversion, Break
- Quantity conservation
- DC / dispatch (outbound; not receiving)

They do **not** share a database.

```
SET (immutable Product requirements)
        │
   completeness / shortfall (computed)
        │
   PROCUREMENT (execution; this phase)
        │
   PURCHASE ORDER (commercial document)
        │  vendor
        ▼
   RECEIPT NOTE          ← physical authority (Phase 7; do not redesign)
        │
   ACCEPTED
   ┌────┴────┐
 ASSET    INVENTORY
        │
   SET ALLOCATION        ← explicit, never automatic from PO or RN
```

**Never:**

```
PO → Asset / Inventory
PO → Set requirement edit
PO → reservation
Receipt POST → rewrite historical RN ordered snapshot
DC "Shipped" → inbound receive state
```

---

## Production snapshot (read-only, 29 August 2026)

Verified against production database `asset_manager` after Phase 8 close-out. **Do not treat these as a mandate to mutate them.**

| Object | Count / state |
|---|---|
| `project_orders` | **2**, both `status=Active`, `is_deleted=0`, **`vendorname` empty** |
| `project_order_items` | **2** |
| `quotes` | Table exists (4 columns). **0 rows.** No FK from `project_orders` (GAP-603) |
| `vendors` / `work_orders` / `procurement_request` | **Do not exist** |
| `receipt_note` | **1** (`RN-0826-S3JN7C-C`, `POSTED`, `po_source=LOCAL`, `po_id=PO-1779796181621-757`) |
| `receipt_note_line` | **1** (local line `3`, Product `PRD-0826-2FB5I8-2`, accepted 1 / ordered snapshot 1) |
| `receipt_projection_outbox` | **1**, status **`SKIPPED`** (adapter not configured) |
| `assets.linked_po_item_id` | **1** (`APP-MUM-0526-MMKBX9-W` → line `2`). **No `product_id`. No `receipt_line_id`.** |
| `inventory_items.linked_po_item_id` | **Column does not exist** |
| `temporary_assets` | **0** |
| `product` / `product_external_ref` | **203 / 203** (strict 1:1; includes Phase 8 close-out probe + Set Product) |
| `managed_sets` / `set_requirement` | **10 / 3** |
| `projects` | **2** (`MUM-0526-664651-P` Sample, `MUM-0526-643243-P` Ajanta) |
| `delivery_challans` | **1** |
| OAuth scopes (source) | `ZohoCRM.modules.products.ALL`, `ZohoCRM.modules.deals.READ`, `ZohoCRM.settings.fields.READ`, `ZohoCRM.settings.modules.READ` |
| Zoho client | `@zohocrm/nodejs-sdk-8.0` only. India CRM (`accounts.zoho.in` / `zohoapis.in`). **No Books/Inventory SDK.** |
| Token store | FileStore `zoho_tokens.txt`. **Do not overwrite.** |

### The two local POs

| Local PO ID | `ponumber` | Project | Line | Description | Qty | Price | Line status | Physical link |
|---|---|---|---|---|---|---|---|---|
| `PO-1779691453564-194` | `ARM-PO-01-26-27` | Sample | `2` | Apple MacBook Air 24 | 1 Nos | 350000 | **Shipped** | Asset `APP-MUM-0526-MMKBX9-W` via `linked_po_item_id` (legacy; not a Receipt Note) |
| `PO-1779796181621-757` | `PO980` | Ajanta | `3` | MacBook | 1 Nos | 0 | **Pending** | Receipt Note posted accepted 1 against Product `PRD-0826-2FB5I8-2` (origin ZOHO, name is **not** the PO description) |

There is **no** `product_id` on `project_order_items`. Identity on the local line is free-text `itemdescription`.

---

## 1. Executive summary

AssetEngine **is currently the commercial PO system of record.** That is a fact, not a target. Canonical §1 / §23 / GAP-602 / OD-15 require a **deliberate, staged** move of commercial authority to Zoho, while Receipt Note remains the only path that creates physical stock.

This org’s connected Zoho product is **Zoho CRM (India Production)**. A read-only module catalogue on 29 August 2026 shows CRM **does** expose:

- `Purchase_Orders` (standard, API-supported)
- `Purchase_Items` (subform = PO lines)
- `Vendors` (lookup from PO)
- `Quotes`, `Sales_Orders`, `Invoices` (commercial siblings; **out of Phase 9 mutate scope**)

CRM **does not** expose a Purchase Receive / GRN module (`Purchase_Receives` inspect → invalid module). Receiving stays AssetEngine.

Field inspection of `Purchase_Orders` succeeded with **existing** `settings.fields.READ`. **PO record** GET/CREATE/UPDATE was **not** attempted. It will require **new OAuth module scopes**, requested as a **separate approved OAuth change**, not as a silent constant edit during coding.

Phase 9 therefore:

1. **Audits and freezes** the local PO module (do not silently rewrite it).
2. **Mirrors** Zoho CRM Purchase Orders as logistics context for Receipt Notes.
3. **Links** each PO line to an AssetEngine Product via existing 1:1 Zoho Product mapping — never by SKU/Make/Model/fuzzy match, never by auto-creating Product from a PO.
4. **Computes** Set shortfall and optional On Order **without** changing Set requirements or allocating stock.
5. **Does not** implement Customer PO, Work Orders, DC redesign, or Zoho Books.

---

## 2. CURRENT STATE vs TARGET STATE

Do not collapse these.

### 2.1 What local PO is today

`project_orders` + `project_order_items` is a **project-owned purchasing notepad with weak commercial identity and a broken “fulfillment” heuristic.**

It is used as:

| Use | Mechanism | What it actually is |
|---|---|---|
| Create/edit PO in Projects UI | `POST /api/projects/:id/orders`, `PUT /api/orders/:orderId` | AssetEngine is the author |
| Search POs | `GET /api/orders` | JWT; non-admin filtered by project/department |
| Receipt Note context | `receiptService` `po_source=LOCAL` only | Phase 7 logistics consumer |
| “Fulfillment” | `COUNT(assets.linked_po_item_id) + COUNT(temporary_assets.linked_po_item_id)` vs `qtyordered` | **Row count, not accepted quantity** |
| Line status | `Pending` / `Partially Fulfilled` / `Shipped` / UI also mentions `Asset Created` | **Outbound DC writes `Shipped`.** Link-PO also writes `Shipped` when count ≥ ordered |
| Consignee/buyer GST block | Copied from Project into PO | Logistics/document print, not Zoho vendor |
| Excel import | Description/qty/price only | No Product |

It is **not**:

- a Zoho document
- a vendor master
- a Product-keyed commercial line
- a receiving ledger (Receipt Note is)
- distinguished vendor-PO vs customer-PO (GAP-604)

### 2.2 Schema (production)

**`project_orders`**

| Column | Role |
|---|---|
| `id` | PK, format `PO-{epoch}-{rand}` (not checksum family) |
| `projectid` | **Required** FK `projects.id` `ON DELETE CASCADE` |
| `ponumber` | Free-text commercial number |
| `podate` | String date |
| `vendorname` | Free text. **Empty on both live rows.** No vendor id |
| `orderno` / `orderdate` | Legacy aliases; unused by current create path |
| Consignee / buyer GST block | Document header |
| `totalamount` | `real`. Client-supplied, not a conserved ledger |
| `status` | Default `Active`. **No CHECK.** `PUT /api/orders/:id/status` writes arbitrary strings |
| `is_deleted` / `deleted_at` | Soft-delete columns exist; **DELETE route hard-deletes** header+lines |
| `createdby` | Present; create path does not reliably set it |
| Zoho / currency / tax rate columns | **Absent** |

**`project_order_items`**

| Column | Role |
|---|---|
| `id` | Integer identity (`nextval`). **This is the local line ID Receipt Notes already store as `po_line_id` text** |
| `orderid` | FK header `ON DELETE CASCADE` |
| `srno` | Display sequence, not identity |
| `itemdescription` | **Only item identity today** |
| `qtyordered` | `real` (not `numeric(18,6)`) |
| `uom` | Unit string |
| `unitprice` / `total` | `real`. PO purchase price, distinct from `product.price` |
| `assetid` | Optional FK to `assets` `ON DELETE SET NULL` (fulfillment hint; line 2 points at the MacBook) |
| `status` | Default `Pending` |
| `product_id` | **Absent** |
| Zoho line id | **Absent** |

**Dangerous coupling:** `receipt_note.po_id` is a **plain string** (no FK). Hard-delete of `PO-1779796181621-757` would orphan `RN-0826-S3JN7C-C`. Phase 9 must **freeze deletes** of local POs that Receipt Notes reference.

### 2.3 APIs (current)

| Method | Path | Auth | Behaviour |
|---|---|---|---|
| GET | `/api/projects/:id/orders` | JWT | Header + lines + `fulfilledQty` row-count |
| GET | `/api/orders` | JWT | Search; price redacted without `asset.view_price` |
| GET | `/api/orders/:orderId` | JWT | By id or `ponumber` |
| POST | `/api/projects/:id/orders` | JWT + `requireAdmin` (`admin` / `superuser` / **`it_manager`**) | Creates local PO |
| PUT | `/api/orders/:orderId` | JWT **only** | Rewrites header; **deletes missing lines**; nulls `linked_po_item_id`; can rewrite qty/price/status |
| PUT | `/api/orders/:orderId/status` | JWT **only** | Arbitrary header status |
| DELETE | `/api/projects/:projectId/orders/:orderId` | JWT **only** | Hard-delete header+lines |
| GET | `/api/purchase-orders/:id/receipt-balance` | JWT | Phase 7 outstanding (LOCAL) |
| POST | `/api/assets/:id/link-po-item` | JWT | Legacy link; may set line `Shipped` |
| GET | `/api/all-orders` | **No backend route** | Frontend DC helper calls it; dead |

Receipt Note create/post: Logistics roles (`superuser` / `admin` / `manager`) via Phase 7. **Manager cannot create local POs** (`requireAdmin` excludes `manager`). That split is closer to target than the JWT-open PUT/DELETE.

### 2.4 UI (current)

- **Projects** (`projects.js`): PO modal, Excel template (description/qty/price), fulfillment panel, “Create DC from PO”.
- **Receipts** (`receipts.js`): pick local PO from `/api/orders`, then receipt-balance.
- **DC** (`dcProjectFetcher.js`, `dashboard.js`): uses project orders as **consignee source** and later writes PO line `Shipped`.

### 2.5 Target state

| Concern | Target |
|---|---|
| Who authors the commercial PO | **Zoho CRM Purchase Orders** |
| Who receives goods | **AssetEngine Receipt Note** |
| Who creates Asset/Inventory | **Receipt POST (accepted qty only)** |
| Who owns Set definition | **Set requirements; never PO** |
| Local `project_orders` | **LEGACY / BRIDGE context**, not the long-term commercial master |
| Product on a line | AssetEngine `product.id` + Zoho Product external id (string) |
| Vendor | Zoho CRM `Vendors` id (string) + display name snapshot |
| On Order | Computed from open commercial lines; **not** a reservation |
| Customer PO / Work Order | **Not this phase** |

---

## 3. Authority transition (canonical OD-15)

**Do not move authority in one step.**

```
CURRENT     AssetEngine local PO is commercial SoR
              ↓
BRIDGE      Zoho CRM PO is pulled/linked; AE mirrors context;
            Receipt Notes may use po_source=ZOHO when a mirror+Product link exists;
            local writers remain but are contained
              ↓
TARGET      Zoho creates/owns commercial PO;
            AE never silently edits Zoho qty/vendor/status/price;
            AE remaining job = receive + physical
              ↓
RECEIPT     Unchanged: AssetEngine authoritative for physical receiving
```

| Stage | Commercial create | Commercial edit | Receiving | Local `project_orders` |
|---|---|---|---|---|
| CURRENT | AE | AE | LOCAL only | SoR |
| BRIDGE | Zoho (primary). AE create **optional and explicit** only if P9-CREATE = yes | Zoho wins on conflict | LOCAL existing RNs stay; new RNs may be ZOHO | Frozen for migrated/linked rows; leftover = LEGACY |
| TARGET | Zoho only | Zoho only | ZOHO (and remaining LOCAL historical) | Read-only / historical |

**Recommendation for OD-15:** BRIDGE lasts until (a) OAuth record scopes are approved and proven, (b) at least one live Zoho PO is mirrored and received without touching the two historical local POs, (c) local PUT/DELETE are refused for rows that have Receipt Notes or Zoho links. Do **not** pick a calendar date in this plan.

---

## 4. Zoho PO reality (this org, read-only)

### 4.1 Which Zoho product owns procurement?

**Zoho CRM**, not Books, not Inventory — for **this connected application**.

Evidence:

- Runtime SDK is `@zohocrm/nodejs-sdk-8.0` + `INDataCenter.PRODUCTION()`.
- `getModules` HTTP 200, **56** modules.
- `Purchase_Orders` is a **default** CRM module, `apiSupported=true`.
- `Purchase_Receives` is **not a CRM module**.
- No Books/Inventory client in `package.json`.

A later Books/Inventory program would be a **different OAuth app, different SDK, different document IDs.** Do not fold it into Phase 9.

The application **is** connected to the CRM org that actually has Purchase Orders. That answers “wrong Zoho product?” for CRM. It does **not** mean CRM PO is used operationally today (no AE code reads those records).

### 4.2 Objects

| Zoho object | API name | Role |
|---|---|---|
| Purchase Order header | `Purchase_Orders` | Commercial PO |
| PO lines | `Purchase_Items` (subform on `Purchase_Items` field) | Line qty/price/product |
| Vendor | `Vendors` | Lookup `Vendor_Name` |
| Product on line | `Purchase_Items.Product_Name` | Lookup → CRM Products |
| PO number | `PO_Number` (text) | Document number, **not** CRM id |
| CRM record id | `Purchase_Orders.id` (bigint in fields) | Store as **string** everywhere; `toZohoRecordBigInt` only at SDK `setId` |
| Quotes / Sales Orders / Invoices | present | **Do not couple** |
| Work Orders | **not in module list** | Out of scope; do not invent |

### 4.3 Inspected header fields (capability)

Present and relevant: `PO_Number`, `Subject`, `Vendor_Name` (lookup), `PO_Date`, `Due_Date`, `Status` (picklist), `Purchase_Items` (subform), `Sub_Total`, `Discount`, `Tax`, `Adjustment`, `Grand_Total` (**formula**), billing/shipping address block, `Tracking_Number`, `Requisition_No`.

**Absent in this org:** a `Currency` field on `Purchase_Orders` (inspect returned none). Do not invent multi-currency in Phase 9 unless a later inspect finds it. Treat org default currency as implicit.

**Status picklist (actual):** `Created`, `Approved`, `Delivered`, `Cancelled`.

There is **no** `Partially_Received` / `Fully_Received` in CRM. Do not fake them onto Zoho. Physical completion is computed in AssetEngine.

`Delivered` is a **CRM commercial picklist value**. It is **not** Receipt Note `POSTED` and **not** DC `Shipped`. Do not write CRM `Delivered` from receiving in the first slice.

### 4.4 Inspected line fields (capability)

`Sequence_Number`, `Parent_Id`, `Product_Name` (lookup), `Description`, `Quantity` (double), `List_Price`, `Total` (formula), `Discount`, `Total_After_Discount` (formula), `Tax`, `Net_Total` (formula), `Line_Tax`, `Price_Book_Name`.

`getFields('Purchase_Items')` did **not** list an `id` field. CRM subform rows still have record ids at GET time in normal Zoho usage. **P9-LINE-ID:** first scoped `getRecord(Purchase_Orders)` must confirm line `id` is present and stable. Until then, do **not** use `Sequence_Number` as identity.

### 4.5 Receiving in Zoho

**None in CRM.** Phase 7 outbox remaining `SKIPPED` / `ADAPTER_NOT_CONFIGURED` is still correct. Phase 9 must **not** invent a fake GRN module. Optional later: custom CRM module, or a separate Books program. Default: **no AE→Zoho receive mutation** in Phase 9.1–9.3.

### 4.6 Can Product IDs map directly?

Yes, **if and only if** the line’s Zoho Product id already has `product_external_ref` (`ZOHO_CRM` / `Products`). Then:

```
Zoho Purchase_Items.Product_Name.id  →  product_external_ref.external_id  →  product.id
```

If unmapped: **explicit Product link / create-then-link** (existing Phase 8 workflows). Receiving and PO mirror **block** until linked (`409 PRODUCT_NOT_LINKED`). **No auto-create Product from a PO. No fuzzy match.**

### 4.7 Can lines be revised after creation?

CRM allows PO updates subject to org layout/approval. AssetEngine rules (independent of Zoho):

- After any **POSTED** Receipt Note exists on a line: Zoho qty decrease below `accepted_to_date` → AE **409 STALE_PO / OVER_RECEIPT** on further receive; **do not rewrite** `ordered_qty_snapshot` on old RNs.
- Qty increase: allowed commercially; new outstanding may be received on **new** RNs.
- Line delete in Zoho after posted receive: **MAPPING_INCONSISTENT**; historical RN remains.

### 4.8 OAuth

| Scope | Today | Phase 9 record access |
|---|---|---|
| `settings.modules.READ` / `settings.fields.READ` | Yes | Enough to **inspect** (already done) |
| `modules.products.ALL` | Yes | Product mapping only |
| `modules.purchaseorders.READ` or `.ALL` | **No** | **Required** to GET/list PO records |
| `modules.vendors.READ` | **No** | Required to resolve vendor lookup usefully |
| Books / Inventory scopes | **No** | Not for this CRM-shaped Phase 9 |

**Phase 9 requires new CRM module scopes.** That is a **separate owner-approved OAuth reconnect** (new authorize URL, same redirect `https://api.spvtm.com/api/zoho/oauth/callback`, **no redirect change**, **no token file edit by hand**). Until that happens, implementation may add **dead** adapter code behind `501 PO_SOURCE_NOT_CONFIGURED`, but must **not** call PO record APIs.

Do **not** expand scopes in the same PR as schema.

### 4.9 Different SDK?

**No** for CRM POs. Reuse the existing CRM SDK, `init()`, FileStore, `toZohoRecordBigInt`, `logSync`, `zohoIdToString`.

A Books adapter would be a different project.

---

## 5. Zoho service boundary

**Do not blindly grow `zohoService.js` with PO CRUD beside Product/Deal/OAuth.**

**Recommendation:** `services/zohoProcurementService.js`

- `listPurchaseOrders` / `getPurchaseOrder` / `getPurchaseOrderLines`
- `refreshPurchaseOrder` (explicit)
- vendor lookup (`getVendor`)
- optional later: `createPurchaseOrder` / `updatePurchaseOrder` only if **P9-CREATE** is approved
- **no** receive/GRN create in 9.1

It must:

- call `zohoService.init()` (single OAuth)
- never call `handleSyncResponse` (that still writes `assets.zoho_product_id`)
- never send stock, serials, Asset IDs, Inventory IDs, Set allocations, reservations
- store every Zoho id as string
- log to `zoho_sync_logs` with operations like `PULL_PO`, `PULL_PO_ERROR`

`receiptProjectionService` stays adapter-shaped. Default adapter remains **NONE**.

---

## 6. Product relationship on a PO line

A PO line is **commercial procurement data**.

Required:

```
PO line
  ├── AssetEngine product_id     (PRD-…)
  └── zoho_product_id            (string; from line lookup / mapping)
```

Forbidden as identity: Asset ID, Inventory ID, Set ID, SKU, Make/Model, `itemdescription` alone, array index.

**Unmapped Zoho Product on a pulled line:**

1. Show Zoho Product id + name.
2. Operator runs Phase 8 **explicit link** or **create Product then link**.
3. Retry refresh. Until then the line is `UNLINKED` and **cannot** be received (`po_source=ZOHO`).

Do not set `product.origin=RECEIPT`.

---

## 7. Set → procurement (shortfall)

Set completeness today (`setService.computeCompleteness`):

```
required  = set_requirement.quantity
allocated = sum(active allocations on that requirement)
shortfall = max(required − allocated, 0)
```

**Keep that formula for Set completeness.** Do not fold On Order, damaged, rejected, or unrelated reservations into completeness.

Procurement **view** (new, computed; does not write Sets):

| Dimension | Definition | Stored on Set? |
|---|---|---|
| Required | Immutable requirement qty | Already |
| Allocated | Active physical allocation | Already |
| Reserved | Phase 3 reservation carried by that allocation | Already (not a second number) |
| Shortfall (physical) | `required − allocated` | **No** — computed |
| On Order | Sum of **open commercial** qty for that Product still outstanding on POs (see §8) | **No** — computed |
| Received / Accepted | Sum of POSTED Receipt accepted qty for those PO lines | Receipt ledger |
| Additional procurement need | `max(shortfall − on_order, 0)` | **No** — computed |

**Locks:**

- PO must **not** edit Set requirements (canonical rule 80: genuine requirement change = new Set).
- Receiving must **not** auto-allocate to Sets.
- On Order must **not** create reservations.
- Multiple POs per Product / per Set are allowed. **No** “one PO per Set”.

Set UI may show a **read-only** procurement panel. Creating a PO from shortfall is an **explicit** operator action in the BRIDGE/TARGET stage, never an automatic write.

---

## 8. On Order

**Introduce ON_ORDER as a computed dimension in Phase 9.** Do not collapse it into Allocated or Received.

For a Product (optionally scoped to a Set’s requirement, still without storing a Set FK on the PO unless P9-SET-REF is later approved — default **no Set FK on PO line**):

```
on_order(product) =
  sum over ZOHO (and optionally still-open LOCAL) PO lines
    where product_id = product
      of max(ordered_qty − accepted_to_date, 0)
  excluding Cancelled commercial headers
```

Example from the prompt:

```
Required 10, Allocated 4, On Order 6 → Additional need 0
```

Unrelated Sets’ reservations do **not** reduce this Product’s On Order.

---

## 9. Procurement demand object

**9.1 recommendation: do not add `procurement_request` yet.**

A first-class demand table is justified only if the business must approve “please buy X” **before** a Zoho PO exists. Today there is no such workflow, and PO itself can represent demand once Zoho is SoR.

Phase 9.1: **computed shortfall / on-order view** + explicit “open in Zoho / refresh PO”.

Revisit a demand entity only if operators need a queue that is not a PO. That is **P9-DEMAND** (default: no).

---

## 10. Multiple POs and receipts

Required behaviour (example in the prompt is accepted as the model):

```
Requirement Battery ×10
PO A ×4  received 4
PO B ×3  received 2
Allocated 0
On Order 1
Accepted 6
Physical shortfall 10
Additional procurement need 4
```

Receipt Notes already allow multiple POSTED notes per local line (Phase 7). Preserve that for Zoho lines. Unique `(receipt_note_id, po_line_id)` stays; multiple notes × one line are separate RNs.

---

## 11. PO line → Receipt Note

**Do not redesign Phase 7.**

Target chain:

```
PO header (local id and/or zoho_po_id string)
  └── PO line (local integer id and/or zoho_po_line_id string)
        └── Receipt Note line.po_line_id  (already string)
              └── product_id required at POST
                    └── accepted → Asset / Inventory
```

Phase 9 may:

- implement `po_source=ZOHO` in `receiptService` (today `501 PO_SOURCE_NOT_CONFIGURED`)
- lock `FOR UPDATE` on the **local mirror row**, not on a live Zoho HTTP call inside the POST transaction (Phase 7 already warned: refresh then post)
- keep OVER_RECEIPT = REJECT even if a human marks CRM `Delivered` incorrectly

Phase 9 must **not**:

- bypass outstanding checks
- write `linked_po_item_id` by default (Phase 7 default off)
- treat DC `Shipped` as accepted qty

Existing RN `RN-0826-S3JN7C-C` remains LOCAL history. Do not rewrite it to ZOHO.

---

## 12. Local PO classification (do not bulk-upload)

| Local PO | Category | Why | Action |
|---|---|---|---|
| `PO-1779691453564-194` | **LEGACY / MANUAL REVIEW** | Line `Shipped` via DC/link heuristic; Asset has no Product, no Receipt Note; description-only line | Freeze. Do not push to Zoho. Do not auto-repair `linked_po_item_id` |
| `PO-1779796181621-757` | **BRIDGE / HISTORICAL LOCAL** | Has a POSTED Receipt Note + Product, but line status still `Pending` (RN does not update PO status); description ≠ Product name | Freeze header/lines against delete. Keep `receipt_note.po_id`. Do not upload to Zoho |

**No automatic upload of existing POs.** Incomplete Product linkage is exactly why.

New Zoho POs get **new mirror rows**, not overwrites of these two ids.

---

## 13. Identity

| Identity | Authority | Rule |
|---|---|---|
| Zoho PO record id | Zoho | String. External reference |
| Zoho `PO_Number` | Zoho | Document number; unique in Zoho org if they enforce it; **not** our PK |
| Local `project_orders.id` | AssetEngine historical | **Keep.** Already referenced by `receipt_note.po_id` |
| New mirror PK | AssetEngine | Prefer **keeping** `project_orders.id` **or** a new `procurement_po.id` — see P9-MIRROR. Do **not** introduce a third checksum `PO-MMYY-XXXXXX-C` unless implementation proves local ids cannot represent ZOHO rows |
| Local line `project_order_items.id` | AE | Keep for LOCAL RNs |
| Zoho line id | Zoho subform row | String, once P9-LINE-ID confirmed |
| Receipt Note id | AE | Unchanged `RN-…` |

PO number ≠ Zoho id ≠ Receipt Note id.

---

## 14. P9-MIRROR — do not silently rewrite `project_orders`

**Recommendation:** additive **mirror tables** (names illustrative):

- `procurement_po` (source `ZOHO|LOCAL_REF`, `zoho_po_id` unique nullable, `po_number`, vendor snapshots, commercial status, timestamps, optional `project_id`)
- `procurement_po_line` (`zoho_line_id` unique nullable, `product_id` nullable until linked, ordered qty `numeric(18,6)`, unit, `list_price` as document price, tax/discount snapshots, `source_hash`)
- `procurement_po_external_ref` if 1:1 needs the same provenance pattern as Product (optional if unique on `zoho_po_id` is enough)

**Keep `project_orders` / `project_order_items` in place** (GAP-602 / UNMAPPED-04 / §38). Quarantine writers in later slices. Receipt adapter maps:

- LOCAL → existing loaders
- ZOHO → mirror tables (`po_id` = mirror id **or** zoho id — pick one and freeze; recommendation: `po_id` = **AssetEngine mirror id**, plus `zoho_po_id` column on RN **only if** Phase 7 snapshot is insufficient; RN already has `po_id` + `po_number`. Prefer: ZOHO RN `po_id` = mirror PK, `po_number` = Zoho `PO_Number`, line `po_line_id` = Zoho line id string)

Do not add speculative FKs to Work Order / Customer PO / Set.

---

## 15. Immutability and commercial vs physical status

### 15.1 Do not copy CRM picklist as AE receiving states

| CRM `Status` | Meaning for AE |
|---|---|
| Created | Commercial draft-ish; **do not receive** until policy says otherwise (recommend: receive only `Approved`, P9-RECEIVE-STATUSES) |
| Approved | Commercial open; receiving allowed |
| Delivered | CRM flag; **ignore for outstanding math** |
| Cancelled | Block **new** receiving; keep posted RNs |

AE physical PO-line completeness (computed, not a CRM write):

```
outstanding = ordered − sum(POSTED accepted)
fully_received_physically ⇔ outstanding <= 0
```

### 15.2 After receipt, illegal commercial edits (AE enforcement)

| Change | Legal? |
|---|---|
| Increase ordered qty | Yes (new outstanding) |
| Decrease ordered below accepted | Illegal for further receive; snapshots stay |
| Change Product on a line with posted RN | Illegal (`409`) |
| Change vendor on header with posted RN | Snapshot stays; display both; Zoho wins future refresh of header crumbs |
| Delete line / cancel header | Block new receive; physical stock remains |

PUT local order today can delete lines and change qty without consulting Receipt Notes. **Contain that in BRIDGE.**

### 15.3 OVER_RECEIPT

Phase 7 lock stands. If Zoho UI allows over-receive conceptually, AE still rejects.

---

## 16. Vendor

**Current:** `vendorname` text, empty in production. No vendor table.

**Target:** Zoho CRM `Vendors.id` (string) + `Vendor_Name` snapshot on PO header / RN.

Do **not** create a duplicate AE vendor master in 9.1. Optional later cache `zoho_vendor_id` / name if list UX needs it — still not a second SoR.

---

## 17. Price, tax, totals

| Concept | Authority | Rule |
|---|---|---|
| `product.price` | Manual Product field (Phase 8: never auto-push) | **Never overwrite from PO** |
| PO line `List_Price` / local `unitprice` | Commercial document | Snapshot on RN **only if** needed for print; Phase 7 currently does **not** snapshot price — keep that unless finance requires it. Receiving math must **not** depend on price |
| Tax / Discount / Grand_Total | Zoho formulas/fields | Snapshot on mirror; **do not recompute for outstanding qty** |
| Currency | Not on this org’s PO layout | Do not invent |

Physical receipt **must not** depend on Grand Total.

---

## 18. Project, DC, Customer PO, Work Orders

**Project:** Local PO **requires** `projectid`. CRM Purchase_Orders inspect showed **no Deal/Project lookup**. Target: project association is **optional logistics metadata** on the mirror, not the Zoho PK. Do not redesign Projects (Phase 10). Preserve the two existing local POs’ project FKs.

**DC:** Outbound. Keep `Shipped` off the inbound state machine. Do not use DC as GRN. Dead `/api/all-orders` is a DC bug; **out of Phase 9 mutate scope** unless a tiny containment is approved separately.

**Customer PO:** CRM `Sales_Orders` exists. **Do not implement.** No FK from procurement PO to Sales Order in this phase.

**Work Orders:** No CRM Work Orders module in this org. **Do not implement. No speculative FKs.**

---

## 19. Sync, conflict, cancel, close

**Sync mode (9.1):** **explicit refresh** (button / `POST /api/procurement/pos/:id/refresh`). No webhook, no background worker, until pull is proven. Same posture as Phase 8 Product refresh.

**Conflict (TARGET):** Zoho wins quantity, vendor, commercial status, document price. AssetEngine never rewrites posted Receipt snapshots. Physical outstanding uses **current** ordered qty vs **ledger** accepted.

**Cancel after accepted 5:** block further receive; RNs remain; Assets/Inventory remain; Set shortfall remains `required−allocated`; On Order drops for that PO; additional need may reopen.

**Closed vs fully received:** CRM has `Delivered` + `Cancelled` only. **Do not conflate** physical completion with financial closure. AE may show `physically_complete` independently. Do not require CRM `Delivered` to post the last RN.

---

## 20. Permissions

| Action | Who |
|---|---|
| Create/approve commercial PO | **Zoho** (TARGET). AE must not add a second approval workflow |
| Pull/refresh PO mirror | Logistics `manager`+ and procurement-capable admin/superuser |
| Link Product on unmapped line | Same as Phase 8 Product link (Logistics) |
| Create local PO (legacy) | Contain; eventually 403 |
| Receipt Note | Logistics (existing Phase 7) |
| Allocate Set | Logistics Set APIs (Phase 6) — **not** implied by PO |
| Sales | View Product commercial fields; **not** receive, not create stock, not allocate Sets, not own PO in AE |

Do not give Sales procurement authority in AE.

`it_manager` currently in `requireAdmin` for PO create is **legacy IT-admin bleed**. Do not expand it. Do not silently remap roles in this plan beyond “contain local writers”.

---

## 21. What Phase 9 must not do

- Bulk-publish or bulk-upload the 2 local POs
- Modify existing PO rows except later **explicit freeze flags** (implementation, not this document)
- Auto-create Products, Assets, Inventory, Sets, reservations
- Auto-allocate receipts to Sets
- Change OAuth scopes/tokens/redirect in the implementation PR
- Restart production from this plan
- Implement Customer PO, Work Orders, DC, Rentals, Books
- Use `migrate:latest`
- Apply abandoned `20260824120000_create_managed_sets_tables.js`
- Publish stock qty (OD-12 closed)
- Call `POST /api/zoho/sync-asset/:id` from procurement

---

## 22. Locked decisions (this plan)

| ID | Decision |
|---|---|
| D9-1 | Commercial SoR **target** = Zoho CRM `Purchase_Orders` for this org |
| D9-2 | Physical SoR = Receipt Note (unchanged) |
| D9-3 | Adapter = `zohoProcurementService.js` + existing CRM SDK; not a Books client in Phase 9 |
| D9-4 | New OAuth **module** scopes required before record pull; separate approval; same redirect URL |
| D9-5 | No CRM Purchase Receive object → no GRN mutation in 9.1–9.3 |
| D9-6 | No auto Product from PO; no fuzzy match |
| D9-7 | No auto Set allocate / no PO edits of requirements |
| D9-8 | ON_ORDER is computed; not a reservation |
| D9-9 | No `procurement_request` in 9.1 |
| D9-10 | Do not auto-migrate the two local POs |
| D9-11 | Keep local PO ids; RN snapshots immutable |
| D9-12 | OVER_RECEIPT remains REJECT |
| D9-13 | Zoho wins commercial conflicts; AE wins physical history |
| D9-14 | Explicit refresh only (no worker/webhook in 9.1) |
| D9-15 | Customer PO / Work Order / DC redesign = **not this phase** |
| D9-16 | Do not rewrite `project_orders` in place as the Zoho mirror |

---

## 23. Open decisions (must close before or during implementation)

| ID | Question | Recommendation |
|---|---|---|
| **OD-15** | How long BRIDGE lasts | Until one live Zoho receive cycle + local writers contained; not a date |
| **P9-CREATE** | May AE create CRM POs in BRIDGE? | **No for 9.1.** Pull-only. Revisit if operators cannot use CRM UI |
| **P9-DEMAND** | First-class demand table? | **No** until a pre-PO queue is a real workflow |
| **P9-MIRROR** | New tables vs extra columns on `project_orders` | **New additive tables**; freeze local |
| **P9-LINE-ID** | Confirm subform row `id` on first scoped GET | **Must confirm** before ZOHO receiving |
| **P9-RECEIVE-STATUSES** | Receive when CRM status is `Created`? | **Approved only** |
| **P9-SET-REF** | Store `set_id` / `requirement_id` on PO line? | **No** by default (avoids coupling). Shortfall is a view |
| **P9-PROJECT** | Require AE project on Zoho-sourced POs? | **Optional**. CRM PO has no project lookup |
| **P9-SCOPE-SET** | Exact scope strings | `ZohoCRM.modules.purchaseorders.READ` + `ZohoCRM.modules.vendors.READ` first; `.ALL` only if P9-CREATE becomes yes |
| **P9-PRICE-SNAPSHOT** | Add unit price to RN snapshot? | **No** unless finance requires print parity |

---

## 24. Implementation slices *(only if this plan is later approved)*

| Slice | Intent | Mutates |
|---|---|---|
| **9.0** | Owner-approved OAuth scope expansion + reconnect + regression | Tokens (via normal OAuth), **not** PO data |
| **9.1** | Mirror pull + Product link + read-only UI | New tables; `zoho_sync_logs`; **no** RN, **no** local PO rewrite |
| **9.2** | `po_source=ZOHO` Receipt create/post against mirror | Receipt Notes on **new** Zoho POs only |
| **9.3** | Set shortfall / On Order views | Read-only APIs/UI |
| **9.4** | Contain local PO PUT/DELETE; freeze historical two POs | Local writers |
| **9.5** | Optional AE→Zoho create | Only if P9-CREATE = yes |

Scratch first. Named migrations only. Never `migrate:latest`. One disposable Zoho PO if 9.2 is executed — **not authorized by this document**.

---

## 25. Suggested APIs *(implementation later)*

Read-only / pull:

- `GET /api/procurement/pos`
- `GET /api/procurement/pos/:id`
- `POST /api/procurement/pos/:id/refresh`
- `GET /api/sets/:id/procurement-need` (computed)

Keep:

- All Phase 7 Receipt routes
- `GET /api/purchase-orders/:id/receipt-balance` (extend adapter, do not break LOCAL)
- Phase 8 Product link/publish
- Local GET orders for historical UI

Contain (later):

- `PUT/DELETE` local orders when receipts exist → 409
- Do not add `/api/work-orders` or customer-PO routes

---

## 26. Exact files that **would** change later

*(Not now.)*

| File | Why |
|---|---|
| New named migration | Additive procurement mirror tables only |
| `services/zohoProcurementService.js` | **New** CRM PO/Vendor adapter |
| `services/receiptService.js` | Enable `po_source=ZOHO` against mirror; keep LOCAL |
| `server.js` | New procurement GET/refresh routes; contain local writers in 9.4 |
| Frontend procurement / Set need panel | New, thin |
| Verify script | Scratch-only Fake Zoho PO |

---

## 27. Exact files / areas **not** to change in Phase 9

| Area | Why |
|---|---|
| `productService.js` publish/mapping rules | Phase 8 |
| `zohoService.js` Product/Deal/OAuth core | Additive init reuse only; no handleSyncResponse reuse |
| `setService.js` requirement immutability | Shortfall is a view |
| `reservationService` / `conversionService` / `breakService` | Physical engines |
| `legacyBreakContainment.js` | Phase 5 |
| DC create path | Phase 10; `Shipped` stays outbound |
| Projects core / `zoho_deal_id` | GAP-704 / Phase 10 |
| `.env`, tokens, redirect, compose, ports | Ops freeze |
| Abandoned managed-sets migration | Never apply |
| Inventory catalogue picker | KEEP |
| Customer PO / Work Order | Out of scope |

---

## 28. Verification *(when implementing — not now)*

Scratch Fake Zoho:

- Pull one PO → one mirror → lines Product-linked → RN POST accepted → no second Zoho PO
- Repeat pull → hash skip
- Unmapped Product → 409, no RN
- OVER_RECEIPT rejected
- Set requirements unchanged; no allocations; no reservations
- Local two POs untouched
- BigInt ids remain strings
- OAuth file unchanged in the test process

Production close-out (separate approval): **one** disposable Zoho PO, never the ARM/PO980 records, never bulk.

---

## 29. Rollback *(implementation later)*

- Disable ZOHO receipt source (501)
- Keep mirrors and RNs
- Do not delete Zoho POs
- Do not restore by dropping Receipt Notes
- OAuth rollback = disconnect/reconnect only with owner, not by deleting mappings

---

## 30. Known remaining gaps this phase does not close

- GAP-704 Deal → Project sync still inoperative
- GAP-105 catalogue → Inventory picker still exists
- Legacy `linked_po_item_id` / DC `Shipped` heuristic remains until 9.4 containment
- `quotes` table still empty sediment (UNMAPPED-03)
- CRM `Delivered` vs physical complete remain distinct
- No vendor master locally
- Phase 1 verify still hardcodes old Product census (unrelated)
- Books/Inventory GRN still not a CRM object

---

## 31. Stop conditions *(implementation)*

STOP if:

- scoped GET of `Purchase_Orders` fails for a reason other than missing scopes (then fix OAuth **separately**)
- line ids are missing/unstable (P9-LINE-ID fails)
- a required CRM field disappeared vs this inspect
- implementation wants Books SDK “because CRM isn’t ERP enough”
- OVER_RECEIPT would be relaxed
- local historical POs would be auto-pushed
- Set requirements would be mutated
- `migrate:latest` is proposed
- OAuth redirect/scopes would change inside the feature PR

Do not invent a workaround.

---

## Final statement

This document is the Phase 9 **plan**. It closes the “unknown Zoho PO object” question for **this org**: commercial PO lives in **Zoho CRM `Purchase_Orders` / `Purchase_Items` / `Vendors`**. Receiving does **not**. Local `project_orders` is the **current** SoR and must be **classified and frozen**, not silently replaced.

**Phase 9 is not started.**  
**Phase 10 is not started.**  
**Customer PO is not started.**  
**Work Orders are not started.**

STOP.
