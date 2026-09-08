# Phase 8 — Zoho Product Integration + Set Commercialization Plan

**Status:** PLAN ONLY. No code written. No migration created. No schema applied. No production mutation. No Zoho mutation. No OAuth, token, or scope change. No Product, Set, Asset, Inventory, Reservation, Conversion, Break, Receipt Note, PO, Project, or DC change.  
**Date:** 29 August 2026  
**Scope:** Design two related but distinct workflows on top of Phases 1–7:

- **A.** AssetEngine Product ↔ Zoho Product (explicit link / publish / pull / conflict)
- **B.** Set → AssetEngine Product → Zoho Product (explicit commercialize, then explicit publish)

Do **not** combine them into one uncontrolled Zoho rewrite.

**Environment audited:** Source in this repository after Phase 7. Production facts below are from prior read-only inspections and Phase 1–7 reports. **This document authorizes no implementation and no live Zoho call.**

---

## Authoritative inputs

- `docs/ASSETENGINE_CANONICAL_ARCHITECTURE.md` (revision 3; §1–§6, §21, §33 Phase 8, §36 Product/Set rules, §40 **OD-05 / OD-07 / OD-12**, §41)
- `docs/ARCHITECTURE_GAP_ANALYSIS.md` (GAP-101–112, GAP-516–517, GAP-904, UNMAPPED-06)
- `docs/PRODUCT_ARCHITECTURE_DECISION.md` (§6 field matrix, §8 Set commercialization, ADR-PRODUCT-*)
- `docs/PRODUCT_PHASE1_IMPLEMENTATION_PLAN.md` (entity, 1:1 mapping, conflict *table*, backfill, closed ODs)
- `docs/QUANTITY_PHYSICAL_IDENTITY_PHASE2_PLAN.md` (Product has no quantity)
- `docs/RESERVATION_PHASE3_PLAN.md`
- `docs/CONVERSION_PHASE4_PLAN.md`
- `docs/PHASE5_LEGACY_BREAK_CUTOVER_PLAN.md`
- `docs/SET_PHASE6_PLAN.md` (§24 commercialization deferred; OD-05 / OD-07 recommendations)
- `docs/RECEIPT_NOTE_PHASE7_PLAN.md` (physical receiving; Zoho adapter NONE/SKIPPED; PO authority = Phase 9)
- `docs/ASSETENGINE_COMPLETE_ARCHITECTURE_AUDIT.md` (26 Aug Zoho map; Product/Set counts in that file are **stale**)
- Live source: `zohoService.js`, `productService.js`, `setService.js`, `server.js` (`/api/products*`, `/api/zoho/*`, `/api/sets*`), `products.js`, `kitSets.js`, `inventory.js` (`openInventoryFromCatalog`), `asset-view.js` (legacy Asset push), `product-backfill.js`
- Live schema: `product`, `product_external_ref`, `product_name_conflict`, `zoho_catalog`, `zoho_sync_logs`, `managed_sets.product_id`, `set_requirement`, `assets.zoho_product_id`, `inventory_items.zoho_product_id`, `managed_sets.zoho_product_id`

**OD numbering trap (do not confuse):**

| ID | Source | Question | Status entering Phase 8 |
|---|---|---|---|
| Product-decision **OD-05** | `PRODUCT_PHASE1_IMPLEMENTATION_PLAN.md` §20 | 1:1 vs 1:N Product ↔ Zoho | **CLOSED Phase 1: strict 1:1** |
| Canonical **OD-05** | Canonical §40 | Product versioning across *successive Sets* | **OPEN — this phase** |
| Product-decision **OD-07** | Phase 1 §20 | Auto-create Product on every catalog pull | **CLOSED Phase 1: one-time backfill only** |
| Canonical **OD-07** | Canonical §40 | May a Set-derived Product be another Set's requirement? | **OPEN — this phase** |
| Canonical **OD-12** | Canonical §40 | Publish stock quantity to Zoho? | **OPEN — this phase; recommend No** |

---

## Locked system boundary

**AssetEngine is authoritative for:**

- Product entity (`product.id` = `PRD-MMYY-XXXXXX-C`, immutable)
- Asset, Inventory, quantity, physical identity
- Sets (requirements + allocations)
- Reservations, conversion, Break, receiving, physical history

**Zoho is authoritative / external for:**

- Zoho Product representation
- Commercial procurement documents
- Future Zoho Purchase Order (Phase 9 — **not this phase**)

Do **not** create a shared database. Do **not** make Zoho the physical-system database. Do **not** publish stock quantity. Do **not** parse Zoho Description back into structured data.

---

## Production snapshot (read-only, as of Phases 1–7)

| Object | Count / state |
|---|---|
| `product` | **201** (Phase 1 backfill: ~200 `origin=ZOHO` from catalog + 1 `origin=ASSET` round-trip; later local creates possible) |
| `product_external_ref` | 1:1 UNIQUE both ways already applied (`product_external_ref_external_unique`, `product_external_ref_product_unique`) |
| `product_name_conflict` | Table exists. **No detector. No UI. No rows expected.** |
| `zoho_catalog` | ~202 rows (includes quarantined `ZP-SAMPLE-0001`; GAP-904) |
| `assets.zoho_product_id` | At least 1 live round-trip (`HAR-MUM-0726-55QOFA-R` → `1205624000001284002`) |
| Canonical Sets | Phase 6 engine live; `managed_sets.product_id` column exists, **unused by commercialization** |
| `managed_sets.zoho_product_id` | Still present; create still writes `null` (GAP-516) |
| Receipt Notes | Schema/API/UI exist; **zero production posts** (Phase 7) |
| OAuth scopes | `ZohoCRM.modules.products.ALL`, `ZohoCRM.modules.deals.READ`, `ZohoCRM.settings.fields.READ`, `ZohoCRM.settings.modules.READ` |
| Token store | FileStore `zoho_tokens.txt` (gitignored). **Do not overwrite.** |

---

## 1. Executive summary

Phase 1 created an AssetEngine Product and a strict 1:1 external mapping. Phase 6 created Sets whose requirements already reference Products. **Neither phase talks to Zoho as a Product-centric system.**

What talks to Zoho today is a **legacy Asset-driven push** and a **catalog cache pull**:

```
LEGACY A (working, wrong identity)
  Asset  →  POST /api/zoho/sync-asset/:id  →  Zoho Product
            write-back assets.zoho_product_id
            description from children / ciphertext serials

LEGACY B (working, cache only)
  Zoho Product  →  POST /api/zoho/sync-products  →  zoho_catalog
            does NOT create product rows on an ongoing basis
```

The canonical loops this phase must implement, as **two separate operator actions**:

```
WORKFLOW A — Product integration
  AssetEngine Product
       ↓ explicit Link  (existing Zoho Product)
  product_external_ref   (1:1)
       ↓ explicit Publish
  Zoho Product create/update

WORKFLOW B — Set commercialization
  Set (immutable requirements)
       ↓ explicit Commercialize
  AssetEngine Product   origin=SET  origin_ref=Set ID
       ↓ explicit Publish   (same as A)
  Zoho Product
```

Set create does **not** create a Product. Set allocation does **not** create a Product. Zoho publish does **not** create a Set. Pulling a Zoho Product into `zoho_catalog` does **not** create a Product.

Phase 8 is an **integration and commercialization** phase. It is not:

- a Zoho rewrite
- a Zoho Custom Set Module
- a PO / Work Order / Customer PO phase (Phase 9)
- a Receipt Note change (Phase 7 remains physical receiving authority)
- a Projects / DC / Rentals phase (canonical Phase 10)

When later approved, implementation should:

1. Inspect Zoho Product fields **read-only** (`inspectModuleFields`) before any write mapping is coded.
2. Add Product-centric create/update on top of existing OAuth/SDK/`toZohoRecordBigInt` — **do not rewrite `zohoService.js`.**
3. Detect and resolve `NAME_CONFLICT` using the Phase 1 table that already exists.
4. Keep Description AssetEngine-authoritative (Zoho Description edits lose on later sync).
5. Never auto-push Price.
6. Contain `syncAssetToZoho`; deprecate after the Product path is proven.
7. Commercialize a Set into a Product from **immutable requirements**, with a deterministic description hash. Allocation must not rewrite Zoho.
8. Keep `zoho_catalog`. Do not delete it. Classify remaining reads KEEP / DUAL-READ / MIGRATE / RETIRE-LATER.

---

## 2. Current Zoho Product audit

### 2.1 What already works (preserve)

| Capability | Location | Verdict |
|---|---|---|
| OAuth Server-Based flow | `zohoService.js` `ZOHO_OAUTH_SCOPES`, `/api/zoho/oauth/*` | Working. FileStore. Do not change scopes or tokens. |
| SDK init / singleton reset | `init`, `_resetSdkSingleton`, `_retainLatestFileStoreRow` | Working. Product path must reuse this. |
| BigInt boundary | `toZohoRecordBigInt` | Working. Zoho IDs stay strings in DB/API; BigInt only at `record.setId`. |
| Product **pull** | `syncProductsFromZoho` | Working as a **cache upsert** into `zoho_catalog`. String-safe IDs. |
| Product GET field list | `PRODUCT_GET_FIELDS` | `Product_Name,Unit_Price,Description,Product_Code,Make,Model,HSN_Code` |
| Health check | `checkConnection` | Hits Products `getRecords` with `PER_PAGE=1`. |
| Sync log | `logSync` → `zoho_sync_logs` | Working. Reuse for Product publish. |
| Field inspector | `inspectModuleFields` | Exists, **not routed**. Required **read-only** before write mapping. |
| Deal pull | `syncDealsFromZoho` | Out of Phase 8 scope. Do not modify. |

### 2.2 What is broken / incompatible with Product architecture

| Defect | Evidence | Phase 8 action |
|---|---|---|
| GAP-103 Name last-write-wins | `syncAssetToZoho` always rewrites `Product_Name` | Product path: conflict-aware. Legacy: contain. |
| GAP-104 Description clobbered both ways | Pull writes Zoho Description into catalog; push writes local description into Zoho | Product path: AE → Zoho only for Description. Pull must not overwrite `product.description`. |
| GAP-109 Push write-back hardcoded to `assets` | `handleSyncResponse` `db('assets').update({ zoho_product_id })` | Product path writes `product_external_ref` only. Never reuse `handleSyncResponse` for Products/Sets. |
| GAP-110 Duplicate create | CREATE vs UPDATE solely on `assets.zoho_product_id` | Product path: mapping exists → UPDATE. |
| GAP-111 Ciphertext serials in Description | `buildAssetDescription` embeds `srno` | Product path **must not** call this. Legacy contain. Blocker for any kit-as-Product reuse of this helper. |
| GAP-108 Single-page pull, no `is_active`, no deletion | `getRecords` one page, row-by-row upsert | Improve pagination on pull **only if** needed for catalog freshness; do not auto-create Products. |
| GAP-517 Set path is legacy Asset | Docstring: “Pushes a Superset (Box Set) to Zoho CRM as a Product” | New path: Set → Product → Zoho. Never `syncAssetToZoho` for canonical Sets. |
| Price zeroing | `parseFloat(parent.asset_value \|\| 0)` sent as `Unit_Price` | Product path: **never auto-send Price.** |
| HSN never pushed | Pull reads `HSN_Code`; push does not send it | Product path: push HSN if field exists. |
| No Unit / Category in GET list | `PRODUCT_GET_FIELDS` omits UOM and Category | Inspect org metadata. Do not invent fields. |
| Pull comment lies | “syncs them to the local Assets catalog” (`server.js`) | Comment-only; still writes `zoho_catalog`. |

### 2.3 Zoho ID safety (locked)

Store Zoho Product ID as an **external string**.

Never:

- parse as integer
- convert to JS `Number`
- use floating point
- treat as an AssetEngine Product ID

`productService.asExternalIdString` already rejects unsafe numbers. `toZohoRecordBigInt` is the only allowed numeric conversion, at the SDK boundary.

---

## 3. Current Product sync audit

### 3.1 Product entity (Phase 1 — keep)

`productService.js` already provides:

- `createProduct` / `updateProduct` / archive / restore
- Immutable `id`, `origin`, `origin_ref` (DB trigger)
- Origins: `ZOHO | ASSETENGINE | ASSET | INVENTORY | SET` — **no RECEIPT**
- `createExternalRef` with 409 on either unique violation
- `baseline_name` / `baseline_captured_at` / `last_pushed_hash` / `last_pulled_at` / `last_pushed_at` columns — **unused by any sync worker**

**Missing (this phase):**

- Publish
- Pull-into-Product (explicit link only)
- Name-conflict detector and resolver
- Set commercialize
- Description renderer / `content_hash`
- Sync-status derivation
- Field-level push policy (Price excluded)

### 3.2 Product APIs (Phase 1 — keep, extend)

| Method | Path | Auth today |
|---|---|---|
| GET | `/api/products` | JWT |
| GET | `/api/products/:id` | JWT |
| GET | `/api/products/:id/external-refs` | JWT |
| POST | `/api/products` | JWT + superuser/admin/manager |
| PUT | `/api/products/:id` | JWT + superuser/admin/manager |
| POST | `/api/products/:id/external-refs` | JWT + superuser/admin/manager |
| POST | `/api/products/:id/archive` | JWT + superuser/admin/manager |
| POST | `/api/products/:id/restore` | JWT + superuser/admin/manager |

There is **no** Sales-specific role on these routes. Mutations are Logistics-shaped (`manager`+). Phase 8 must not give Sales physical Set controls. See §28.

### 3.3 UI today

`products.js`: list + detail. Shows Product ID, Zoho external ID, origin, name, description, make, model, HSN, unit, SKU, price. **No Publish, no Link wizard, no conflict banner, no sync status.**

`kitSets.js`: Set engine UI. **No Commercialize.** `managed_sets.product_id` is displayed only as requirement Product IDs.

`asset-view.js`: **Publish to Zoho** still calls `/api/zoho/sync-asset/:id`.

`dashboard.js` / `contextMenu.js`: catalog pull `/api/zoho/sync-products`.

`inventory.js`: catalogue picker reads `/api/zoho/catalog` and can create Inventory from a Zoho Product (GAP-105). **Do not rewrite this opportunistically in Phase 8.**

---

## 4. `zoho_catalog` audit

`zoho_catalog` is a **transitional Zoho Product cache**. Primary key is `zoho_product_id` (string). Columns: `product_name`, `unit_price`, `make`, `model`, `hsn_code`, `description`, `sku`, `is_active`, `last_synced_at`, `created_at`.

It is **not** the AssetEngine Product. Phase 1 already established that. Phase 8 **must not delete it**.

### 4.1 Current consumers

| Consumer | Read / write | Classification |
|---|---|---|
| `zohoService.syncProductsFromZoho` | **WRITE** upsert by `zoho_product_id` | **KEEP** |
| `GET /api/zoho/catalog` | READ ordered by name | **KEEP** |
| `inventory.js` catalogue cards + `openInventoryFromCatalog` | READ → may create Inventory (GAP-105) | **KEEP** (do not migrate picker in Phase 8) |
| `product-backfill.js` | READ (historical) | **KEEP** (script; do not re-run as ongoing import) |
| Phase 1–7 verify scripts | checksum | **KEEP** |
| `ZP-SAMPLE-0001` seed row | present, quarantined from Product | **KEEP** (do not promote to Product) |
| New Product UI “unlinked Zoho rows” | optional dual display | **DUAL-READ** |
| Identity for publish / link / conflict | — | **MIGRATE** to `product` + `product_external_ref` |
| Long-term Product identity | — | **RETIRE-LATER** (not Phase 8) |

### 4.2 KEEP / DUAL-READ / MIGRATE / RETIRE-LATER

| Class | Meaning | Phase 8 |
|---|---|---|
| **KEEP** | Continue to read/write `zoho_catalog` as today | Pull, catalog GET, inventory picker, verify checksums |
| **DUAL-READ** | UI may show catalog row *and* Product mapping | Product detail “Zoho cache” panel for operators; catalog remains source for unlinked rows |
| **MIGRATE** | New behaviour uses Product mapping | Link, publish, name conflict, Set commercialize, description authority |
| **RETIRE-LATER** | Drop table / stop pull-to-cache | Only after: Product is picker source, GAP-105 closed, pull dual-writes Product-owned fields, no verify script depends on catalog-as-identity. **Not Phase 8. Not Phase 9.** |

Retirement conditions (record now, execute later):

1. Every numeric catalog ID either maps 1:1 via `product_external_ref` or is explicitly quarantined.
2. Inventory create no longer accepts raw `ZohoProductId` from the picker without a Product ID.
3. Pull updates `product` (AE-owned fields never overwritten from Zoho Description/Name-conflict) **and** `zoho_catalog`.
4. No regression checksum treats catalog as the Product entity.

**Do not rewrite unrelated catalog reads opportunistically.**

---

## 5. Product ↔ Zoho mapping

Relationship:

```
ONE AssetEngine Product  ↔  ONE Zoho Product
ONE Zoho Product         ↔  ONE AssetEngine Product
```

Storage: `product_external_ref`

| Column | Role in Phase 8 |
|---|---|
| `product_id` | AssetEngine Product ID |
| `system` | `ZOHO_CRM` |
| `module` | `Products` |
| `external_id` | Zoho Product ID **string** |
| `link_origin` | `PULL` (explicit link from cache) or `PUSH` (publish created it). Immutable. |
| `baseline_name` | Last mutually agreed Name |
| `baseline_captured_at` | When baseline was set |
| `last_pushed_hash` | Hash of **AE-owned fields last successfully pushed** (exclude Price; exclude Zoho-only fields) |
| `last_pulled_at` / `last_pushed_at` | Timestamps |

No fuzzy match. External identity comes **only** from this mapping (or from an operator-supplied Zoho ID at explicit link time).

Never match/create by: name similarity, Make, Model, SKU, Description, HSN, closest match, fuzzy search.

---

## 6. One-to-one enforcement

Already at database level (Phase 1):

- `UNIQUE (system, module, external_id)`
- `UNIQUE (product_id, system, module)`

Phase 8 service rules:

1. Publish: if mapping exists → **update** that Zoho Product. Never `createRecords`.
2. Publish: if mapping missing → `createRecords` then `createExternalRef` with `link_origin=PUSH` in the **same** DB transaction after Zoho success. If unique insert fails, treat as concurrent publish and switch to update (do not leave an orphan Zoho Product unmapped — see §13).
3. Link: reject if either unique would fire (409, existing messages).
4. Do not write `assets.zoho_product_id` from the Product path.
5. Do not write `managed_sets.zoho_product_id` from the Product path (superseded by `managed_sets.product_id` + `product_external_ref`).
6. Do not invent a second mapping table.

---

## 7. Field ownership

Owner decisions already established (canonical §4, Phase 1 §20, this brief). Phase 8 **implements** them; it does not reopen them.

| Field | Owner | Sync | Conflict |
|---|---|---|---|
| AssetEngine Product ID | AE exclusive | never sent | n/a |
| Zoho Product ID | Zoho exclusive | stored as string | n/a |
| `origin` / `origin_ref` | AE exclusive | never sent; **never overwritten on sync** | n/a |
| **Name** | Co-managed | ↔ via baseline | **NAME_CONFLICT** if both changed |
| **Description** | AE / Logistics | AE → Zoho | No conflict table. Zoho edits lose. |
| **Make** | Logistics / AE | AE → Zoho if field exists | AE wins |
| **Model** | Logistics / AE | AE → Zoho if field exists | AE wins |
| **HSN** | Logistics | AE → Zoho if field exists | AE wins |
| **Unit** | Logistics | AE → Zoho if field exists | AE wins |
| **Product Category / Kind** | Logistics | AE → Zoho **only if a matching Zoho field exists and is approved after inspect** | AE wins. Do not assume Zoho Category = AE Kind. |
| **Asset Kind** | Logistics | **never synced** | n/a — navigation / physical |
| **Inventory Kind** | Logistics | **never synced** | n/a |
| **SKU / Product_Code** | Optional, co-editable | not identity | No conflict table. Not a match key. See §10. |
| **Price / Unit_Price** | **Manual** | **no automatic authority** | Never push from `asset_value`. Never pull as truth into AE without operator. |
| Set composition (structured) | AE exclusive | rendered into Description only | AE wins absolutely |
| Qty in stock | AE (physical) | **never** (OD-12 → No) | n/a |
| Serials | AE instance | **never** | n/a |
| Tax / Vendor / Zoho Category | Zoho | do not clobber | Zoho |

Sales may **view and use** Product-facing commercial fields (name, SKU, price, published Zoho ID). Sales does **not** control Asset Kind, Inventory Kind, Product Category/Kind as logistics taxonomy, or physical Asset/Inventory/Set lifecycle.

---

## 8. Name conflict model

Phase 1 created `product_name_conflict` so a conflict is *representable*. Phase 8 **detects, surfaces, and resolves** it. No silent last-write-wins.

### 8.1 Baseline storage

`product_external_ref.baseline_name` + `baseline_captured_at`.

Set baseline when:

- mapping is created (link or first successful publish)
- a conflict is resolved
- a one-sided sync applies (only AE changed, or only Zoho changed)

### 8.2 Detection (three-way merge on Name only)

On publish or on an explicit “compare with Zoho” / pull-for-linked-Product:

Let `B` = baseline, `A` = current AssetEngine `product.name`, `Z` = current Zoho `Product_Name`.

| A vs B | Z vs B | A vs Z | Action |
|---|---|---|---|
| same | same | — | no-op |
| changed | same | — | AE wins → push Name, then `B = A` |
| same | changed | — | Zoho wins → pull Name into AE, then `B = Z` |
| changed | changed | A = Z | both moved to the same value → `B = A` |
| changed | changed | A ≠ Z | **NAME_CONFLICT** |

While a conflict is `OPEN` for that Product:

- Do **not** push Name
- Do **not** pull Name
- Other AE-owned fields may still publish if the operator confirms (Description/Make/…)
- UI shows CONFLICT; publish of Name is blocked

### 8.3 Conflict record

Reuse `product_name_conflict`. Do **not** add a second name-conflict table.

Preserve:

- `product_id`
- Zoho Product ID via `external_ref_id` → `product_external_ref.external_id` (string)
- `ae_name`, `zoho_name`, `baseline_name`
- `detected_at`, `status` (`OPEN`/`RESOLVED`)
- `resolved_by`, `resolved_at`, `final_value`

**Additive schema (recommended, named migration only):**

- `resolution` `AE_WINS | ZOHO_WINS` (nullable until resolved)
- Optional `zoho_external_id` denormalized string for UI/audit (must remain string; FK still via `external_ref_id`)

Partial unique index already enforces one OPEN conflict per Product.

### 8.4 UI

Product detail: conflict card (existing bordered section / modal / toast). Show AE value, Zoho value, baseline, detected_at. Buttons: **Use AssetEngine name** / **Use Zoho name**. Confirmation required.

### 8.5 Resolution actor

Logistics: `superuser` / `admin` / `manager` (same as Product mutations). Sales views the conflict; does not resolve unless a future Sales role is explicitly granted.

### 8.6 Resolution direction and retry

1. Operator chooses AE_WINS or ZOHO_WINS.
2. Apply `final_value` to **both** sides on next allowed write (AE row immediately; Zoho on publish/update).
3. Set `baseline_name = final_value`.
4. Mark RESOLVED.
5. Retry publish is idempotent (mapping exists → update).

---

## 9. Description authority

Description is **AssetEngine-authoritative**.

```
Zoho Description edit
        ↓
later synchronization
        ↓
AssetEngine Description wins
```

This consequence stays explicit in UI copy: “Zoho Description is a projection. Logistics Description overwrites it on publish.”

Rules:

- Publish always sends `product.description` (for Set-derived Products, the **rendered** description — §17).
- Pull **never** overwrites `product.description`.
- Pull may still update `zoho_catalog.description` (cache of what Zoho currently holds) — KEEP.
- For `origin=SET`, Description is write-only into Zoho. **Never parse it back** into requirements.
- Legacy `buildAssetDescription` is **not** used on the Product path.

---

## 10. SKU

SKU (`product.product_code` ↔ Zoho `Product_Code` where present) is:

- optional
- editable on both sides
- **non-canonical**
- **not** an identity key
- **not** the matching key
- **not** used for deduplication

Phase 8 recommendation:

- Operator may edit SKU in AssetEngine.
- Publish **may** send SKU if AE has a non-null value.
- Pull **may** fill AE SKU only when AE SKU is null; never overwrite a non-null AE SKU from Zoho.
- No SKU conflict table.
- Empty SKU is valid.

---

## 11. Publish flow

**Publishing means:** AssetEngine Product → explicit operator action → Zoho Product.

Do **not** publish merely because a Product exists. Do **not** bulk-publish the ~201 existing Products.

### 11.1 Preconditions

- JWT + Logistics role
- Product exists and is ACTIVE (archived: reject)
- OPEN name conflict: Name excluded from payload until resolved
- OAuth connected

### 11.2 Create vs update

```
mapping = product_external_ref for (ZOHO_CRM, Products)
if mapping:
    UPDATE Zoho Product mapping.external_id
    refresh last_pushed_hash / last_pushed_at
else:
    CREATE Zoho Product
    createExternalRef link_origin=PUSH
    baseline_name = product.name
```

### 11.3 Payload (only fields that exist after inspect)

Always (if present on Zoho):

- `Product_Name` (unless OPEN conflict)
- `Description` (AE)
- `Make`, `Model`, `HSN_Code` when AE has values and Zoho field exists

Optional:

- `Product_Code` if AE SKU non-null

Never automatic:

- `Unit_Price` / Price
- Quantity
- Serials
- Asset Kind / Inventory Kind
- AssetEngine Product ID as Zoho name

### 11.4 Idempotency and mapping

See §13. Repeated Publish PRD-001 must not create a second Zoho Product.

### 11.5 Conflict handling

Name: §8. Description: AE wins, no conflict row. If Zoho returns 400 on a missing custom field, fail the publish, log, do not partially invent mappings.

### 11.6 Response recording

- `zoho_sync_logs` (`PUSH_PRODUCT_CREATE` / `PUSH_PRODUCT_UPDATE`)
- `product_external_ref.last_pushed_at`, `last_pushed_hash`
- Return Zoho ID as **string**

Do not write `assets.zoho_product_id`.

---

## 12. Pull flow

### 12.1 Catalog pull (KEEP)

`POST /api/zoho/sync-products` → `syncProductsFromZoho` → `zoho_catalog` upsert.

A Zoho Product by itself does nothing.

```
Zoho Product
    ↓ pull
zoho_catalog
    ✗ does not create product
```

**Do not** automatically convert every pulled Zoho Product into an AssetEngine Product. Phase 1 backfill was a **one-time** approved import. It is not an ongoing rule.

Improvements allowed without changing identity rules:

- Pagination (GAP-108) so the cache is complete
- Still no auto Product create
- Still no fuzzy match
- Still no deletion of catalog rows in Phase 8 (deletion detection = report only)

### 12.2 Explicit link (approved Product-link workflow)

Operator selects:

1. An AssetEngine Product with no mapping, and
2. A catalog / Zoho ID not mapped to another Product

Then `POST /api/products/:id/external-refs` with `link_origin=PULL` (already exists).

Optional Phase 8 wizard: from catalog row → “Link to existing Product” or “Create Product then link” (create uses `origin=ZOHO`, `origin_ref=NULL`). Creating is **explicit**, not a side effect of pull.

### 12.3 Linked pull (refresh)

If mapping exists, a “Refresh from Zoho” may:

- Update `zoho_catalog` as today
- Apply Name via §8 (may open NAME_CONFLICT)
- **Not** overwrite Description, Make, Model, HSN, Unit, Category from Zoho into `product` (AE-owned)
- Fill null SKU per §10
- **Not** touch Price automatically
- Never change `origin` / `origin_ref`

### 12.4 Four create/link directions (exact)

| # | Situation | Result |
|---|---|---|
| 1 | AssetEngine Product created locally | `origin=ASSETENGINE`. No Zoho row. No mapping. Publish is a later explicit action. |
| 2 | Zoho Product already exists and is explicitly linked | Mapping only. Do not create a second Product. Do not create a second Zoho Product. |
| 3 | Zoho Product pulled but not yet linked | `zoho_catalog` row only. No `product`. |
| 4 | Set commercialized | `origin=SET`, `origin_ref=Set ID`. No Zoho row until publish. |
| 5 | AssetEngine Product published to Zoho | Create or update per mapping. `link_origin=PUSH` on first create. |

---

## 13. Idempotency

### 13.1 Publish

Repeated `Publish PRD-001`:

- Must **not** create multiple Zoho Products
- Key: existing `product_external_ref` row (natural idempotency key = `product_id + ZOHO_CRM + Products`)
- If mapping exists → update
- Deterministic hash `last_pushed_hash`: if payload hash equals last successful push, skip Zoho write (still return success). Allocation changes must **not** change this hash for Set-derived Products (hash is over requirements + AE-owned fields, not allocations).

**Orphan create race:** if `createRecords` succeeds and mapping insert hits unique on `external_id`, another Product already owns that Zoho ID → **fail closed**, log, do not attach. If unique hits on `product_id`, mapping already exists → treat as success and update.

Do **not** delete the Zoho Product on mapping failure. Operator intervention.

### 13.2 Pull

Repeated catalog pulls upsert `zoho_catalog` by Zoho ID. They must **not** create duplicate AssetEngine Products. Unlinked rows stay cache-only.

### 13.3 Set commercialization

Commercializing the same Set twice:

- If `managed_sets.product_id` is set → return that Product. No second Product.
- Recommended unique: partial unique index on `product (origin_ref) WHERE origin = 'SET' AND origin_ref IS NOT NULL` so two Sets cannot silently share origin_ref, and one Set cannot mint two SET-origin Products.

### 13.4 Retry

OAuth / 401 / 403 / 4xx / 5xx / timeout / rate limit / malformed response: no mapping insert on failed create. Retry of publish after success is an update. Log every attempt in `zoho_sync_logs`.

---

## 14. Provenance

| How Product was created | `origin` | `origin_ref` |
|---|---|---|
| Created directly in AssetEngine | `ASSETENGINE` | NULL |
| Explicitly created to represent a Zoho Product | `ZOHO` | NULL |
| From an Asset (Phase 1 backfill class B) | `ASSET` | Asset ID |
| From Inventory | `INVENTORY` | Inventory ID |
| From Set commercialization | `SET` | Set ID (`SET-…`) |

Do **not** add `RECEIPT` as Product provenance. Receipt provenance remains physical receipt lineage (Phase 7).

Do **not** overwrite provenance on subsequent synchronization, link, or publish. DB trigger already forbids `origin` / `origin_ref` updates.

---

## 15. Set commercialization

A Set may be **explicitly** commercialized into an AssetEngine Product.

```
SET
 ↓ EXPLICIT COMMERCIALIZE
PRODUCT          origin=SET  origin_ref=Set ID
 ↓ EXPLICIT PUBLISH
ZOHO PRODUCT
```

| Action | Creates Product? | Publishes to Zoho? | Changes physical? |
|---|---|---|---|
| Set create | No | No | No |
| Set allocate / deallocate / substitute | No | No | Reservations/allocations only (unchanged by commercialize) |
| Commercialize | Yes (or returns existing) | No | **No** |
| Publish | No | Yes | No |
| Zoho publish | No Set | — | No |

Commercialization must **not**: allocate, deallocate, reserve, release, convert, break, alter Assets, or alter Inventory. It is commercial metadata / projection only.

Event types already exist on `set_event`: `COMMERCIALIZED`, `PRODUCT_PUBLISHED`. Phase 6 schema reserved them; Phase 8 should write them.

---

## 16. Set → Product

The Product created from a Set must have:

- `origin = SET`
- `origin_ref = Set ID`
- `managed_sets.product_id = Product ID` (Phase 6 column; first writer)

Composition is derived from **immutable Set requirements**, **not** current physical allocations.

Example:

```
Set Requirement:
  Camera ×1
  Lens ×2
  Battery ×10

Product Description (projection):
  Camera — {req Product name} — {Make} / {Model}
  Lens — …
  Battery — …
```

Do **not** derive commercial Product composition from current Asset or Inventory allocations.

Copy into the Product at commercialize time:

- Proposed name (operator-editable before confirm; default = Set name)
- Generated description (previewed)
- Optional: Make/Model/HSN/Unit left null unless operator fills them (a Set-derived Product is a package, not a camera body)

Do **not** copy reservation state, allocation IDs, serials, or QR.

---

## 17. Product description projection

Deterministic rendering. Same Set requirements + same referenced Product data ⇒ same description and same hash.

Recommended `content_hash` (SHA-256 hex, stored on `product_external_ref.last_pushed_hash` and/or `product` additive column `composition_hash`):

```
canonical = sorted requirements by product_id
  for each: product_id | quantity | unit | name | make | model | description
hash = sha256(canonical UTF-8)
```

Gating:

- If hash unchanged since last successful publish → **do not** call Zoho update.
- Allocation changes **do not** enter the canonical string → **do not** rewrite the Zoho Product on every allocation.

Zoho Description is a **human-readable projection only**. It is never:

- parsed back into structured Set requirements
- used to reconstruct Products
- used to determine quantity
- used for identity matching

Preview example (operator sees this before commercialize and before publish):

```
CAMERA PACKAGE
Camera — Apple MacBook Air
Lens — Canon …
Battery — …
```

Structured requirements in `set_requirement` remain authoritative.

---

## 18. Set Product versioning (canonical OD-05)

A live Set's requirements cannot change (Phase 6). Versioning is about **successive Sets**, not edits of one Set.

Given:

- Set A: Camera ×1, Lens ×2 → commercialized as `PRD-001`
- Set B: Camera ×1, Lens ×3

**Recommendation:**

| Composition vs PRD-001 | Behaviour |
|---|---|
| **Different** | Always create a **new** Product. Do **not** overwrite PRD-001. |
| **Identical** immutable requirement fingerprint | Reuse PRD-001 **only if the operator explicitly chooses reuse** and it is safe (below). Default: still create a new Product. |

Safe reuse conditions (all required):

1. Fingerprint identical (sorted `product_id` + qty + unit).
2. Explicit UI choice “Reuse existing Product PRD-…” — not inferred from name.
3. PRD-001 `origin=SET`.
4. Reuse does **not** rewrite `origin_ref` (immutable; stays the first Set).
5. 1:1 Zoho mapping unchanged — both Sets then share the **same commercial Product** (quotes keep meaning).
6. If PRD-001 is already mapped and Sales has quoted it, reuse is commercially meaningful; still operator-chosen.

Do **not** auto-reuse because names look similar.

Default for Set B with changed composition: **new Product**. Old Product preserved (ACTIVE or later archived by operator, never silently mutated).

---

## 19. Set-derived Product provenance

- `origin=SET` (immutable)
- `origin_ref=Set ID` of the Set that **created** the Product
- Subsequent reuse (OD-05 identical case) does **not** change provenance
- `managed_sets.product_id` on the commercializing Set (and on a reusing Set if explicit reuse)
- Publish does not change provenance
- Pull does not change provenance

### 19.1 Canonical OD-07 — Product as another Set's requirement

**Recommend: REJECT in Phase 8.**

A Set-derived Product (`origin=SET`) **must not** be used as `set_requirement.product_id` for another Set unless the organisation deliberately adopts recursive commercial kits.

Phase 6 already said grouping is Super Set, not recursive commercial kits. Recursive Set-as-requirement would:

- nest commercial descriptions
- confuse quantity (a Product-of-Set is not a physical holding)
- fight 1:1 Zoho mapping (inner and outer packages)

**Enforcement:** Set create / requirement validation: if `product.origin = 'SET'` → `409` `SET_DERIVED_PRODUCT_NOT_A_REQUIREMENT`.

Do not implement recursive commercial composition in Phase 8.

---

## 20. Zoho field capability map

**Do not assume fields exist.** `inspectModuleFields('Products')` exists and is unrouted. Implementation **must** run it read-only against the org before coding write mappings. This plan does **not** call Zoho.

### 20.1 Known from current GET list (code evidence, not a live inspect)

`PRODUCT_GET_FIELDS` currently requests:

| Zoho API name | Used on pull | Used on legacy push |
|---|---|---|
| `Product_Name` | yes | yes |
| `Unit_Price` | yes | yes (from `asset_value` — **stop on Product path**) |
| `Description` | yes (catalog only) | yes |
| `Product_Code` | yes as SKU | **no** |
| `Make` | yes | yes (`addKeyValue`) |
| `Model` | yes | yes |
| `HSN_Code` | yes | **no** |

Omission from GET list is **not** proof of absence, but it is evidence the current integration does not use:

- Unit of measure
- Category
- Qty_in_Stock (must remain unused — OD-12)

### 20.2 Mapping table (fill after inspect; direction locked now)

| AssetEngine field | Zoho field (if present) | Direction | Owner | Conflict |
|---|---|---|---|---|
| `product.id` | — | never | AE | n/a |
| `product_external_ref.external_id` | record id | Z→ store string | Zoho | n/a |
| `product.name` | `Product_Name` | ↔ baseline | co-managed | NAME_CONFLICT |
| `product.description` | `Description` | AE → Z | AE | AE wins; Zoho edit discarded later |
| `product.make` | `Make` | AE → Z | Logistics | AE wins |
| `product.model` | `Model` | AE → Z | Logistics | AE wins |
| `product.hsn_code` | `HSN_Code` | AE → Z | Logistics | AE wins |
| `product.unit` | **TBD inspect** | AE → Z if exists | Logistics | AE wins |
| Product Category / Kind | **TBD inspect** — likely **no safe map** to Zoho Category | none unless approved | Logistics | do not sync Kind names as Zoho Category |
| `product.product_code` | `Product_Code` | fill-null pull; optional push | co-editable | not identity |
| `product.price` | `Unit_Price` | **manual / none** | none automatic | never last-write from Asset value |
| quantity | `Qty_in_Stock` | **never** | AE physical | n/a |

If inspect shows Make/Model/HSN as custom fields with different API names, map to those names. If a field is absent, skip it; do not create Zoho custom fields in Phase 8.

---

## 21. OAuth boundary

Current scopes (do **not** change in Phase 8):

```
ZohoCRM.modules.products.ALL
ZohoCRM.modules.deals.READ
ZohoCRM.settings.fields.READ
ZohoCRM.settings.modules.READ
```

Products ALL already covers catalog pull and Product create/update. `settings.fields.READ` already covers `inspectModuleFields`.

**Do not add:**

- Purchase Order scope
- Books scope
- Inventory / warehouse scope
- Deals write
- Users/org extra scopes

**Do not:** overwrite tokens, rotate FileStore as part of this phase, change redirect URL, or reconnect production as a side effect of deploy.

If Product create fails with `OAUTH_SCOPE_MISMATCH`, that is a **blocker to report**, not a reason to silently expand scopes.

Deal sync remains untouched.

---

## 22. Legacy Asset push containment

`POST /api/zoho/sync-asset/:id` → `syncAssetToZoho` is the only live Product **write** path. It is **not** compatible with the Product architecture.

### 22.1 Risks (do not assume compatibility)

| Risk | Mechanism |
|---|---|
| Duplicate Zoho Products | CREATE when `assets.zoho_product_id` empty (splits, kits, children) |
| Description overwrite | Unconditional Description replace; kit serial ciphertext (GAP-111) |
| Field ownership violations | Name, Price (`asset_value\|\|0`), Description, Make, Model — last write wins |
| Wrong identity source | Asset ID / item name as Product, no `product` row required |
| Missing mapping | Writes `assets.zoho_product_id`, not `product_external_ref` |
| Role | JWT only on the route (no manager gate in the snippet at 2709) — confirm and tighten on contain |
| GAP-109 | `handleSyncResponse` cannot serve Inventory or Sets |

### 22.2 LEGACY → CONTAIN → PRODUCT-CENTRIC → DEPRECATE

| Stage | Behaviour |
|---|---|
| **LEGACY** (today) | Asset → Zoho Product. Leave code in place. |
| **CONTAIN** (Phase 8 ship) | Keep route. Do **not** use it from Set UI. Banner on Asset view: “Legacy publish. Prefer Product publish.” Optionally: if `assets.product_id` has a mapping, **redirect** the button to Product publish instead of `syncAssetToZoho`. Do not remove the API until replacement is proven. Do not extend it to Sets. |
| **PRODUCT-CENTRIC PATH** | `POST /api/products/:id/publish` is the supported write. |
| **DEPRECATE** | After scratch + one controlled production Product publish succeed, mark `/api/zoho/sync-asset/:id` deprecated (410 or feature flag). **Do not remove in the same PR that ships publish.** |

Do **not** delete created Zoho Products when containing. Do **not** bulk-fix historical `assets.zoho_product_id` into mappings without an explicit link/backfill task (out of default Phase 8 mutate scope; a **read-only report** of assets with Zoho IDs vs `product_external_ref` is in scope).

---

## 23. UI architecture

Native Product + Set commercialization UI using **existing** AssetEngine visual language:

- current top bar
- existing cards, bordered sections, modals, confirmation patterns, toast system
- no new design system

### 23.1 Product view

Distinguish clearly:

- AssetEngine Product ID (immutable)
- Zoho Product ID (external string or “Unlinked”)
- Origin + origin_ref
- Name, Description, Make, Model, HSN, Unit, Category/Kind (AE taxonomy — local), SKU, Price
- Sync status (§23.3)
- OPEN name conflict card

Sales: view commercial fields as authorized. Logistics: edit AE-owned fields + link/publish/resolve. Price remains manually managed (edit locally; not auto-synced).

Buttons (Logistics): **Link to Zoho Product**, **Publish to Zoho**, **Refresh from Zoho** (linked only), **Resolve name conflict**.

### 23.2 Sync status model

Avoid a second source of truth if derivable:

| Status | Derivation |
|---|---|
| **UNLINKED** | no `product_external_ref` |
| **LINKED** | mapping exists; never successfully pushed/pulled since link (both timestamps null except baseline) |
| **SYNCED** | mapping exists; last push or pull succeeded; no OPEN conflict |
| **CONFLICT** | OPEN `product_name_conflict` |
| **PENDING** | in-flight publish (optional; else omit and use toast) |
| **FAILED** | last `zoho_sync_logs` for this product_id is ERROR |

Do **not** add `product.sync_status` unless derivation in the API becomes too expensive. Prefer compute in `publicProduct`.

### 23.3 Set commercialization UI

From canonical Set detail (`kitSets.js`):

**[ COMMERCIALIZE SET ]** — hidden if `managed_sets.product_id` already set; then show Product ID + **[ Publish to Zoho ]**.

Before confirm, show:

- Set ID, Set name
- Requirements (Product × qty × unit)
- Proposed Product name (editable)
- Generated description (read-only preview)
- “Product ID will be generated on confirm” (do not pre-allocate IDs that can collide)

Confirm: **[ Create Product ]**

Then Product exists: **[ Publish to Zoho ]** — separate explicit action. Same publish API as Workflow A.

If composition fingerprint matches an existing SET-origin Product: optional checkbox **Reuse PRD-…** (default off). Changed composition: no reuse option.

### 23.4 No Set physical controls for Sales

Sales must not see Allocate / Deallocate / Disband / Absorb on Sets as part of this work. Do not add those. Commercialize / Publish are Logistics.

---

## 24. API architecture

Additive routes. Do **not** remove existing Product or Zoho routes.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/products/:id/publish` | JWT + Logistics | Workflow A/B publish |
| POST | `/api/products/:id/refresh-zoho` | JWT + Logistics | Linked pull / compare Names |
| GET | `/api/products/:id/conflicts` | JWT | List name conflicts |
| POST | `/api/products/:id/conflicts/:conflictId/resolve` | JWT + Logistics | AE_WINS / ZOHO_WINS |
| GET | `/api/sets/:id/commercialize/preview` | JWT | Description + fingerprint; no write |
| POST | `/api/sets/:id/commercialize` | JWT + Logistics | Create or return SET Product |
| GET | `/api/zoho/products/fields` | JWT + admin/superuser | Read-only inspect (optional ops) |

Keep:

- `POST /api/products/:id/external-refs` (explicit link)
- `POST /api/zoho/sync-products` (catalog pull)
- `GET /api/zoho/catalog`
- `POST /api/zoho/sync-asset/:id` (contained legacy)

Do **not** add PO, Books, GRN, or Set Custom Module APIs.

---

## 25. Service architecture

**Do not blindly rewrite `zohoService.js`.**

Introduce a Product-centric path **beside** existing methods:

| Layer | Responsibility |
|---|---|
| `productService.js` | Product CRUD, mapping, conflict CRUD, commercialize orchestration, hash, idempotency, field policy |
| `setService.js` | Preview + `COMMERCIALIZED` event; **no** Zoho calls; **no** allocation changes |
| `zohoService.js` | **Additive** `createProductRecord` / `updateProductRecord` / `getProductRecord` using existing `init`, `toZohoRecordBigInt`, `logSync`. Preserve `syncAssetToZoho`, `syncProductsFromZoho`, OAuth helpers, Deal sync. |
| Optional `productZohoService.js` | Only if `productService` would otherwise import too much SDK. Prefer thin wrappers on `zohoService` to avoid a third OAuth stack. |

Preserve:

- Working Product pull (`syncProductsFromZoho`)
- Working OAuth
- BigInt helper
- Broken legacy Asset push **until contained/deprecated**

`setService` must not call Zoho. Publish is Product-centric.

---

## 26. Schema requirements

**If** implementation is approved: **named migration only**, scratch first, production backup, `migrate:up --name …` only. **Never `migrate:latest`.** Do not alter existing Product identity. Do not drop `zoho_catalog`. Do not drop `assets.zoho_product_id`.

Proposed additive objects (names indicative):

| Change | Why |
|---|---|
| `product_name_conflict.resolution` | AE_WINS / ZOHO_WINS |
| Partial UNIQUE `product (origin_ref) WHERE origin='SET' AND origin_ref IS NOT NULL` | One SET-origin Product per creating Set |
| `product.composition_hash` nullable | Set-derived description gate (or rely solely on `last_pushed_hash`) |
| Optional `product_external_ref.last_error` | FAILED status without parsing logs |

Already present — **do not recreate:**

- `product`, `product_external_ref` 1:1 uniques, `product_name_conflict`, `managed_sets.product_id`, `set_event` types `COMMERCIALIZED` / `PRODUCT_PUBLISHED`

Do **not** add Product origin `RECEIPT`.

Do **not** add a quantity column on `product`.

---

## 27. `zoho_catalog` transition

See §4. Phase 8: **coexistence**.

Safe path:

1. Keep pull → catalog.
2. New identity operations use `product_external_ref`.
3. Dual-read in Product UI for operators comparing cache vs Product.
4. Leave inventory catalogue picker on catalog (GAP-105 is a known contradiction; closing it is a **receiving/UI gating** task, not a silent rewrite here).
5. Retire catalog only when §4.2 conditions hold.

Product is already the canonical AssetEngine Product. Catalog remains the Zoho **mirror**.

---

## 28. Security

All new publication / commercialization / conflict-resolution mutations require:

- `authenticateJWT`
- Logistics roles: `superuser`, `admin`, `manager` (match existing Product/Set mutations)

| Actor | Allowed | Forbidden |
|---|---|---|
| Sales (any logged-in viewer, and a future `sales` role if present) | GET Products, GET Sets (as already authorized), see commercial fields and Zoho ID | Set allocate/disband; Product publish; commercialize; Make/Model/HSN/Unit/Kind edits; physical lifecycle |
| Logistics | Field ownership edits, link, publish, commercialize, resolve NAME_CONFLICT | Bulk-publish; PO/Zoho scope expansion |

Do **not** give Sales physical Set controls.

Tighten legacy `POST /api/zoho/sync-asset/:id` to the same Logistics roles during CONTAIN if it is currently JWT-only.

OAuth authorize/disconnect remains admin/superuser. Callback remains the existing public callback (do not redesign).

---

## 29. Testing

Scratch first. Do **not** mutate production Zoho during automated tests. Use SDK mocks / recorded fixtures. Optional live pull against scratch **read-only** only if explicitly approved.

### PRODUCT

1. Create Product  
2. Product ID immutable  
3. One-to-one Zoho mapping  
4. Duplicate mapping rejected (both uniques)  
5. Pull unlinked Zoho Product remains cache-only  
6. Explicit link  
7. Publish Product  
8. Repeated publish idempotent  
9. Duplicate Zoho Product not created  
10. Zoho Product ID remains string-safe (no Number)

### FIELD OWNERSHIP

11. Make AE → Zoho  
12. Model AE → Zoho  
13. HSN AE → Zoho (skip if field absent)  
14. Unit AE → Zoho (skip if field absent)  
15. Category/Kind not pushed as physical taxonomy  
16. Description AE wins; pull does not overwrite  
17. Price manual; not sent from `asset_value`  
18. SKU optional; not used as match key  

### CONFLICT

19. Name conflict detected (both sides changed)  
20. No silent overwrite  
21. Conflict resolution AE_WINS and ZOHO_WINS  
22. Baseline preserved / updated only after apply  

### SET

23. Commercialize Set  
24. Requirements copied to description projection correctly  
25. `origin=SET`  
26. `origin_ref` = Set ID  
27. Deterministic description / hash  
28. Repeated commercialization idempotent  
29. Allocation unchanged  
30. Reservation unchanged  

### SET VERSIONING

31. Changed Set composition → new Product (default)  
32. Old Product preserved  

### BOUNDARIES

33. No Zoho physical quantity  
34. No Asset creation  
35. No Inventory creation  
36. No Set allocation changes  
37. No Reservation changes  
38. No Conversion changes  
39. No Receipt changes  
40. No PO changes  

### ZOHO FAILURE

41. OAuth failure  
42. 401  
43. 403  
44. 4xx  
45. 5xx  
46. Timeout  
47. Rate limit  
48. Malformed response  
49. Retry  
50. Idempotent retry  

### REGRESSION

51. Phase 1 Product  
52. Phase 2 quantity / QR  
53. Phase 3 reservation  
54. Phase 4 conversion  
55. Phase 5 Break containment  
56. Phase 6 Sets  
57. Phase 7 Receipt Note  

### DATA SAFETY

58. No physical data change  
59. No reservations  
60. No Sets changed except explicit commercialization **test** data  
61. Zoho catalog unchanged unless explicit approved pull/push test  
62. OAuth unchanged  

Also: OD-07 reject Set-derived Product as requirement; GAP-111 path not used by Product publish.

---

## 30. Production rollout

Production **begins with read-only verification**.

Then, only after approval:

1. Named migration if needed (`migrate:up --name` only). Scratch first. Production backup.  
2. Deploy Product/Set integration code.  
3. Restart.  
4. Verify OAuth regression (`zoho-oauth-runtime-regression` / health). **No token rewrite.**  
5. Verify existing Product mappings (counts, 1:1, string IDs).  
6. Verify no physical quantity / reservation / Set allocation drift.  
7. Authenticate UI.  
8. Create **one** controlled test Product if necessary (`origin=ASSETENGINE`).  
9. Link/publish **only after explicit approval**.  
10. Commercialize **one** disposable/test Set if safe (scratch or agreed disposable).  

**Do not** bulk-publish 201 Products.  
**Do not** bulk-create Zoho Products.  
**Do not** touch physical Assets/Inventory.  
**Do not** commercialize production operational Sets without an owner named list.

Read-only first checks:

- `inspectModuleFields('Products')` once, capture API names (ops, not app auto-write)
- Count `product` vs `product_external_ref` vs `zoho_catalog`
- List assets still using `zoho_product_id` without mapping (report only)

---

## 31. Rollback

Application rollback (normal):

- Disable publication UI (flag or hide buttons)
- Disable any sync worker (Phase 8 has **no** required background worker; pull stays manual)
- Preserve `product_external_ref` and Products
- Re-enable legacy Asset push if it was flagged off
- **No physical rollback**

Must **not**:

- Delete created Zoho Products automatically
- Delete AssetEngine Products
- Use database restore as the normal application rollback
- Drop `zoho_catalog`
- Revert OAuth tokens

Schema `down()` of a Phase 8 additive migration is last-resort and only if no production mappings were written by the new path.

---

## 32. Exact files to change

*(When implementation is later approved — not now.)*

| File | Why |
|---|---|
| `web-app/asset-manager-backend/migrations/2026________create_product_zoho_phase8.js` | Named additive migration only if §26 columns/indexes are required |
| `web-app/asset-manager-backend/services/productService.js` | Publish, refresh, conflict detect/resolve, hashes, field policy |
| `web-app/asset-manager-backend/services/zohoService.js` | **Additive** Product create/update/get; do not rewrite OAuth/pull/legacy push |
| `web-app/asset-manager-backend/services/setService.js` | Commercialize + preview; OD-07 guard; events; no Zoho |
| `web-app/asset-manager-backend/server.js` | New routes; contain legacy sync-asset roles; **no** Deal/PO/Receipt edits |
| `web-app/asset-manager-frontend/js/products.js` | Publish, link wizard, conflict, sync status |
| `web-app/asset-manager-frontend/js/kitSets.js` | Commercialize / preview / publish CTA |
| `web-app/asset-manager-frontend/js/asset-view.js` | Containment banner / redirect to Product publish |
| `web-app/asset-manager-frontend/index.html` | Only if a modal shell is required |
| `web-app/asset-manager-backend/scripts/zoho-product-phase8-verify.js` | Scratch verify (new) |

Optional: `scripts/zoho-product-fields-inspect.js` (read-only).

---

## 33. Exact files NOT to change

| File / area | Why |
|---|---|
| `receiptService.js`, `receiptProjectionService.js`, Receipt routes/UI | Phase 7 boundary |
| `reservationService.js`, `conversionService.js`, `breakService.js`, `legacyBreakContainment.js` | Physical engines |
| PO / `project_orders` writers | Phase 9 |
| Projects / DC core | Canonical Phase 10 |
| OAuth scope constant (unless a **separate** approved request) | Token/scope freeze |
| `.env`, `zoho_tokens.txt`, credential files | Secrets |
| Production compose / ports / replication | Ops freeze |
| `IdGenerator.js` Product ID algorithm | Identity already shipped |
| Abandoned `migrations/20260824120000_create_managed_sets_tables.js` | Never apply |
| Inventory catalogue picker (`openInventoryFromCatalog`) | KEEP; not opportunistic rewrite |
| `syncDealsFromZoho` | Out of scope |
| Product origin CHECK (do not add RECEIPT) | Provenance lock |

---

## 34. Blockers

| ID | Blocker | Effect |
|---|---|---|
| B8-1 | Live Product field metadata not captured | Cannot honestly map Unit/Category; inspect is a **read-only prerequisite** to coding writes |
| B8-2 | Legacy `syncAssetToZoho` still last-write-wins | Must contain before encouraging Asset-view publish |
| B8-3 | GAP-111 ciphertext in kit descriptions | Product path must not reuse `buildAssetDescription` |
| B8-4 | GAP-105 catalog → Inventory | Leave in place; do not treat catalog pull as Product create |
| B8-5 | ~200 Products already backfilled from catalog | Ongoing pull must not mint duplicates |
| B8-6 | `migrate:latest` still unsafe | Named `migrate:up` only |
| B8-7 | Canonical §33 “Set Custom Module” | **Out of Phase 8.** Description projection only. Owner confirm. |
| B8-8 | No dedicated Sales role in `authorizeRoles` | Map Sales = read; Logistics = mutate; do not invent RBAC in this phase unless owner asks |
| B8-9 | Identical-Set reuse vs immutable `origin_ref` | Documented in §18; implement default = new Product |
| B8-10 | Concurrent publish orphan Zoho Product | Fail closed; no auto-delete |

Non-blockers (do not stop the plan):

- `zoho_catalog` coexistence
- `managed_sets.zoho_product_id` leftover column
- Phase 7 zero receipts
- Deal sync inoperative (GAP-704) — out of scope

---

## 35. Owner decisions

Decisions this plan **recommends** (implementation still requires approval):

| # | Decision | Recommendation |
|---|---|---|
| D8-1 | Cardinality | Strict 1:1 (already in DB). Do not reopen Product-decision OD-05. |
| D8-2 | Publish trigger | Explicit operator action only. |
| D8-3 | Pull | Cache only; explicit link/create. No ongoing auto-Product. |
| D8-4 | Name | Three-way merge + `product_name_conflict`. Logistics resolves. |
| D8-5 | Description | AE authoritative; Zoho Description is projection. |
| D8-6 | Price | Manual. Never auto-push `Unit_Price`. |
| D8-7 | SKU | Optional, not identity, fill-null pull only. |
| D8-8 | Make/Model/HSN/Unit | Logistics-owned; AE → Zoho where fields exist. |
| D8-9 | Category/Kind | Logistics-owned locally; do not assume Zoho Category match. |
| D8-10 | OD-12 quantity | Never publish stock to Zoho. |
| D8-11 | Canonical OD-05 versioning | Changed composition → new Product. Identical → reuse only if explicit. |
| D8-12 | Canonical OD-07 | Reject Set-derived Product as another Set's requirement. |
| D8-13 | Set Custom Module | **Do not build.** Product Description only. |
| D8-14 | Catalog | KEEP / DUAL-READ / MIGRATE / RETIRE-LATER as §4. No delete. |
| D8-15 | Legacy Asset push | CONTAIN now; DEPRECATE after Product path proven. Do not remove in the same change. |
| D8-16 | OAuth | No scope/token changes. |
| D8-17 | Sales vs Logistics | Sales view commercial Product; Logistics owns fields + commercialize + publish. |
| D8-18 | Bulk | No bulk-publish of existing 201 Products. |
| D8-19 | inspectModuleFields | Mandatory read-only before write mapping is coded. |
| D8-20 | GAP-105 picker | Leave; not Phase 8. |

---

## Decision matrix

| Decision | Recommendation | Reason | Phase |
|---|---|---|---|
| AssetEngine Product ↔ Zoho Product cardinality | **Strict 1:1 both ways** | Phase 1 UNIQUE already; canonical identity; no 1:N quotes/POs | 1 closed / 8 enforce |
| Product publish trigger | **Explicit operator action only** | Existence is not publication; no bulk 201 | 8 |
| Product pull behavior | **`zoho_catalog` only; no auto Product** | Canonical §6; Phase 1 OD-07 closed as one-time backfill | 8 |
| Product field ownership | **Per §7 matrix** | Canonical §4 + this brief; Sales ≠ logistics kinds | 8 |
| Name conflict | **NAME_CONFLICT table + three-way merge; no last-write-wins** | Table exists unused; baseline on `product_external_ref` | 8 |
| Description authority | **AssetEngine → Zoho; pull never overwrites AE** | Canonical §4; Zoho edits expected to lose | 8 |
| SKU | **Optional, editable, not identity, not match key** | Phase 1 OD-02/03; sparse catalog data | 8 |
| Price | **Manual; no automatic external authority** | Legacy push zeros Zoho via `asset_value`; OD-16 | 8 |
| HSN | **Logistics-owned; AE → Zoho if field exists** | Pull already reads `HSN_Code`; legacy never pushed | 8 |
| Unit | **Logistics-owned; AE → Zoho only if inspect finds a field** | Not in current GET list | 8 |
| Make | **Logistics / AE-owned; AE → Zoho if supported** | Physical type fact; 202/202 in old mirror | 8 |
| Model | **Logistics / AE-owned; AE → Zoho if supported** | Same as Make | 8 |
| Category / Kind | **Logistics-owned; do not sync AE Kind as Zoho Category without inspect+approval** | Distinct taxonomies; Sales does not own Kind | 8 |
| Zoho field availability | **Read-only `inspectModuleFields` before write mapping** | Do not assume HSN/Unit/Make/Category | 8 prereq |
| `zoho_catalog` transition | **KEEP pull+picker; DUAL-READ UI; MIGRATE identity; RETIRE-LATER** | Transitional cache; GAP-105 not in this phase | 8 / later |
| Legacy Asset push | **CONTAIN → Product-centric path → DEPRECATE; do not remove yet** | GAP-103/109/110/111/517; only live write today | 8 |
| Set commercialization | **Explicit Commercialize then explicit Publish; no physical side effects** | Canonical §21 | 8 |
| Set-derived Product provenance | **`origin=SET`, `origin_ref=Set ID`, immutable** | Phase 1 trigger; Phase 6 `managed_sets.product_id` | 8 |
| Set Product versioning | **New Product on changed composition; never overwrite old** | Canonical OD-05; requirements immutable per Set | 8 |
| Identical Set reuse | **Allowed only with explicit operator choice + fingerprint match** | Names are not identity; origin_ref stays first Set | 8 |
| Product-as-Set-requirement | **Reject `origin=SET` Products as requirements** | Canonical OD-07; Super Set is grouping | 8 |
| Zoho publication | **Product-centric create/update; mapping idempotent; Description projection only** | No Set Custom Module; no quantity | 8 |
| Zoho failure | **Fail closed; log; no mapping on failed create; retry = update if mapped** | Orphan Zoho Products are not auto-deleted | 8 |
| Idempotency | **Mapping UNIQUE + composition hash skip + Set `product_id` return** | Repeated publish/pull/commercialize must not duplicate | 8 |
| OAuth scope changes | **None** | Products+fields already in scopes; PO/Books = Phase 9 | 8 |
| Sales permissions | **View commercial Product fields; no physical Set/Product-ownership writes** | Co-manage commercially without logistics control | 8 |
| Logistics permissions | **Make/Model/HSN/Unit/Kind, commercialize, publish, resolve NAME_CONFLICT** | AE is logistics system of record for those fields | 8 |
| Stock quantity to Zoho | **Never (OD-12 = No)** | Product has no quantity; physical stays in AE | 8 |
| Zoho Custom Set Module | **Do not implement** | Commercialization is Product Description; module = later/never | 8 |
| PO / WO / Customer PO | **Out of scope** | Phase 9 | 9 |
| Receipt Note | **Unchanged** | Phase 7 physical authority | 7 |
| Projects / DC / Rentals | **Out of scope** | Canonical Phase 10 (gap analysis “Phase 8” for DC is stale) | 10 |

---

## STOP

This document authorizes **no** implementation, migration, production write, Zoho mutation, or OAuth change.

Phase 9 (PO / Work Order / Customer PO / PO authority transition) is **not** started here.
)
