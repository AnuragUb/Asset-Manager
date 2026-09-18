# Zoho Product → AssetEngine Sync Audit

**Status:** AUDIT ONLY — no implementation  
**Date:** 29 August 2026  
**Scope:** Why newly created Zoho Products appear not to show up or update in AssetEngine Product records  
**Not in scope:** Code, schema, migrations, Product/catalog/Set/Asset/Inventory/Reservation/Receipt/PO mutation, Zoho mutation, OAuth/token/scope changes, production restart

**Constraints honoured.** This document is the only file created. No application code, schema, or production data was changed. Catalog pull (`POST /api/zoho/sync-products`) was **not** invoked. Individual Zoho Product GET was **not** re-run from the production Node process in this audit (existing logs, catalog timestamps, and the Phase 8 close-out readback were used instead). Token files and OAuth scopes were not inspected or modified.

**Evidence base:**
- `docs/ZOHO_PRODUCT_SET_PHASE8_PLAN.md`, `docs/PRODUCT_ARCHITECTURE_DECISION.md`, `docs/PRODUCT_PHASE1_IMPLEMENTATION_PLAN.md`, `docs/ASSETENGINE_CANONICAL_ARCHITECTURE.md`, `docs/ARCHITECTURE_GAP_ANALYSIS.md`
- Source: `zohoService.js`, `productService.js`, `server.js`, `products.js`, `main.js`, `inventory.js`, `dashboard.js`, `contextMenu.js`, `zoho-product-phase8-verify.js`
- Live production `asset_manager` (read-only SQL, 29 August 2026)
- `zoho_sync_logs` (18 rows; last `PULL_CATALOG` SUCCESS at 04:46 UTC)
- Phase 8 close-out readback `scripts/reports/phase8-prod-zoho-readback.json`

---

## Verdict (read this first)

The observed behaviour is **primarily A — intentional cache-only for NEW unlinked Zoho Products**, plus **E — the operator is looking at the Product UI**, which never reads `zoho_catalog`.

It is **not** a broken linked-Product refresh, and it is **not** a failed bulk mapping.

| Question | Answer |
|----------|--------|
| 1. Are NEW Zoho Products intentionally cache-only? | **Yes.** Pull writes `zoho_catalog` only. It does not create `product` or `product_external_ref`. |
| 2. Is explicit Create Product + Link working? | **API yes. UI incomplete.** `POST /api/products/from-catalog` exists and is covered by Phase 8 verify. The Products page has **no** “Create Product from catalog” button. Link-existing is the only catalog wizard. |
| 3. Are existing linked Products refreshing correctly? | **Yes, when `POST /api/products/:id/refresh-zoho` is called.** Catalog sync does **not** refresh linked Products. That is the approved Phase 8 rule, not a defect. |
| 4. Which AE fields can Zoho update (on explicit refresh)? | **Name** (three-way baseline merge) and **SKU only if AE SKU is NULL**. |
| 5. Which AE fields must reject Zoho updates? | Description, Make, Model, HSN, Unit, Price, Category. Origin / origin_ref never change. |
| 6. Is pagination incomplete? | **Yes. GAP-108 is still true.** Every successful pull reports `totalFound: 200`. Two real Zoho IDs in `zoho_catalog` are already stale because they fell off page 1. |
| 7. Is the Product UI querying the wrong source? | **It queries the right source for Products** (`GET /api/products` → `product`). Operators who expect new Zoho rows to appear there are looking at the wrong screen. Catalog lives under Inventory → Zoho Reference Catalog. |
| 8. Is Inventory still bypassing the Product entity? | **Yes. GAP-105 is still true** in code. Live inventory currently has 0 rows with `zoho_product_id`; 1 row has `product_id` (Receipt path). |
| 9. Are there stale/missing mappings? | **No duplicate mappings. All 203 Products are mapped.** Two catalog rows have no Product (quarantined sample + B-2 HAR Zoho ID). One mapped Set Product is missing from `zoho_catalog`. |
| 10. Code defect, architecture rule, UI issue, or data issue? | **Architecture rule (A) + UI confusion (E) + known catalog-pagination gap (G / GAP-108).** Linked refresh is not broken. Do not auto-create Products from pull. |

**Do not change the rule.** Zoho pull → cache. Explicit link/create → AssetEngine Product.

---

## What “updating in AE” currently means

These are six different outcomes. They must not be collapsed.

| Meaning | What actually happens today | Where the operator looks |
|---------|-----------------------------|--------------------------|
| 1. Appearing in Zoho catalog view | Catalog pull upserts `zoho_catalog` **if the Zoho record is on page 1** | Inventory workspace → Zoho Reference Catalog (`GET /api/zoho/catalog`) |
| 2. Creating a Product entity | **Does not happen on pull.** Requires `POST /api/products/from-catalog` or New Product + Link | Products view (`GET /api/products`) |
| 3. Updating an existing mapped Product | **Does not happen on catalog pull.** Requires **Refresh from Zoho** | Product detail → “Refresh from Zoho” |
| 4. Updating Product fields | Refresh applies **Name merge + null-SKU fill only**. Make/Model/Description/HSN/Unit/Price are rejected | Product detail fields |
| 5. Appearing in Product UI | Product table only. New Zoho-only rows never appear here until explicit create/link | Products view, limit **200** of 203 |
| 6. Appearing in Inventory product pickers | Catalog picker still uses `zoho_catalog` (GAP-105). Set/Receipt pickers use `/api/products` | Inventory catalog vs Set/Receipt typeahead |

If an operator creates a Zoho Product, clicks “Sync catalog”, then opens **Products**, they will correctly see **no new Product row**. That is the approved model.

---

## Live census (production `asset_manager`, 29 August 2026)

| Table / slice | Count |
|---------------|------:|
| `zoho_catalog` | 204 |
| `product` | 203 |
| `product_external_ref` (ZOHO_CRM / Products) | 203 |
| Open name conflicts | 0 |
| Mapping `last_error` set | 0 |
| Duplicate external IDs | 0 |
| Products with no mapping | **0** |
| Catalog rows with no mapping | **2** |
| Mappings missing from catalog | **1** |

Origin census: ZOHO 200 · ASSET 1 · ASSETENGINE 1 · SET 1.

### A — Zoho / catalog rows with no Product

| `zoho_product_id` | Name | Notes |
|-------------------|------|-------|
| `ZP-SAMPLE-0001` | Sample Catalog Product (Hardcoded) | Quarantined. Not a Zoho record. Last synced 6 Aug. Must not be linked. |
| `1205624000001313001` | EVM 16 GB DDR4 | Real Zoho Product. Inserted by catalog pull 29 Aug 04:46 (`syncCount: 1`). Asset `HAR-MUM-0826-IEIZP5-U` holds this ID on `assets.zoho_product_id` with **no** `product_id` (Phase 1 B-2). **Not a Product mapping.** |

### B — Products with no Zoho mapping

None.

### C — Mappings whose Zoho ID is not in `zoho_catalog`

| Product | Zoho ID | Origin | Why |
|---------|---------|--------|-----|
| `PRD-0826-LKJBZ7-A` | `1205624000001350001` | SET | Phase 8 close-out Set publish. Publish does **not** upsert `zoho_catalog`. Refresh was run on the probe Product, not the Set Product. |

### D — Duplicate external IDs

None.

### E / F — `last_pulled_at` / `last_pushed_at`

| | Count |
|--|------:|
| `last_pulled_at` NULL | 2 (Trimble ASSET push; Set Product push — never refreshed) |
| `last_pushed_at` NULL | 200 (Phase 1 PULL backfill — never published) |
| Both NULL | 0 |
| `link_origin=PULL` | 200 |
| `link_origin=PUSH` | 3 |

`last_pulled_at` on the 200 PULL rows is the **27 Aug backfill timestamp**, not catalog-pull time. Catalog pull never writes `product_external_ref`.

### G — Stale catalog / stale baseline

Catalog `last_synced_at` day buckets:

| Day | Rows |
|-----|-----:|
| 29 Aug 2026 | 201 |
| 21 Aug | 1 |
| 20 Aug | 1 |
| 6 Aug | 1 (sample) |

Stale **real** Zoho IDs still in cache (not on the latest page-1 pull):

| Zoho ID | Name | Last synced |
|---------|------|-------------|
| `1205624000000978028` | TouchDrive 2 ME 25 XPT S Series Panel | 20 Aug 12:16 (first full pull) |
| `1205624000000978029` | TouchDrive TouchScreen Display | 21 Aug 08:44 |

These two rows prove page-1 membership **churns**. They are still `is_active=true` because pull never writes `is_active`.

Linked field mismatches vs current catalog (not defects if field ownership applies):

| Product | What differs | Interpretation |
|---------|--------------|----------------|
| `PRD-0826-4OMYG4-V` “Sample” | AE name `Sample` vs catalog `Sample Test`; AE make/model `Dell`/`Laptop` vs catalog `Samp`/`Smple`; catalog description populated, AE description empty | Zoho (and therefore cache) changed after 27 Aug backfill. Catalog pull updated cache on 29 Aug. **Product was not refreshed.** Name would follow ZOHO_WINS on explicit refresh. Make/Model would **not** overwrite AE. |
| `PRD-0826-W3TB7U-Z` Trimble | AE description empty vs catalog kit text (legacy Asset push description) | Description is AE-authoritative. Refresh must not copy it. `last_pulled_at` is NULL. |

---

## FLOW A — NEW ZOHO PRODUCT

```
Zoho Product
    ↓  POST /api/zoho/sync-products
syncProductsFromZoho
    ↓  upsert by zoho_product_id (string)
zoho_catalog
    ✗  does not insert product
    ✗  does not insert product_external_ref
    ↓  only if operator acts
POST /api/products/from-catalog     → origin=ZOHO + mapping PULL
  or
POST /api/products + /external-refs → origin unchanged (e.g. ASSETENGINE) + mapping PULL
```

### Exact pull behaviour (`zohoService.syncProductsFromZoho`)

| Topic | Actual |
|-------|--------|
| Pagination | **One `getRecords` call. No `PAGE`, no `page_token`, no loop.** GAP-108. |
| Page size | Not set. Zoho CRM default is **200**. Logs: every SUCCESS has `totalFound: 200`. |
| Filters | None. `Product_Active` / `is_active` not requested. |
| Fields fetched | `Product_Name,Unit_Price,Description,Product_Code,Make,Model,HSN_Code` |
| Upsert key | `zoho_catalog.zoho_product_id` as `String(zohoIdRaw)` |
| Insert vs update | Insert increments `syncCount`. **Update does not.** UI message is therefore “synced N **new** rows”, not “refreshed N rows”. |
| Cooldown | Redis key `zoho:last_catalog_sync`, **5 minutes**. Repeat call returns `{ ok: true, syncCount: 0, totalFound: 0, fromCache: true }` without hitting Zoho. Redis was empty at audit time (TTL expired). |
| `is_active` | Column defaults true. **Pull never writes it.** Deleted Zoho Products remain in cache. |
| Product creation | **Intentionally skipped.** Route comment: “Pulls Products from Zoho CRM into zoho_catalog only.” |
| Deletion detection | None. |
| Transaction | Row-by-row upsert. Not transactional. |
| Zoho ID | String / BigInt → `String(...)`. No `Number`/`parseInt` on the ID. |

Comment at `server.js` previously said “local Assets catalog”; the live comment now correctly says `zoho_catalog` only.

### Is the Zoho Product fetched / written / skipped?

| Condition | Result |
|-----------|--------|
| On page 1 of `getRecords` | Written to `zoho_catalog` (insert or update) |
| Not on page 1 | **Never fetched. Cache stays stale or empty.** |
| Cooldown window | **API skipped.** Operator sees “synced 0”. |
| After successful cache write | Still **no** Product row |

### Does the UI show the catalog row?

**Only on the Inventory catalog screen**, after a catalog reload.

- `GET /api/zoho/catalog` reads `zoho_catalog` ordered by name.
- `GET /api/zoho/catalog?unlinked=1` is the link wizard source (catalog minus mapped IDs).
- Products **Refresh** (`btnReloadProducts`) re-queries `/api/products` only. It does **not** call `/api/zoho/sync-products`.
- Catalog sync is the Inventory context-menu action `sync-zoho-catalog` / `window.syncZohoCatalog`. That path reloads catalog (`refreshInventoryCatalog`), not the Product list.

### Explicit “Create Product then Link”

| Piece | Status |
|-------|--------|
| Phase 8 plan | Optional wizard: “Link to existing” **or** “Create Product then link” (`origin=ZOHO`) |
| API | `POST /api/products/from-catalog` → `createProductFromCatalog`. Logistics roles. Copies name/description/make/model/HSN/SKU from catalog. **Price and unit stay NULL.** Creates mapping `link_origin=PULL`. Origin becomes **ZOHO**. |
| Verify | `zoho-product-phase8-verify.js` assertion 32 PASSES this path |
| Products UI | **Missing.** `products.js` only implements “Link selected” onto an **already existing** Product. There is no button that calls `/api/products/from-catalog` |
| Link existing | `POST /api/products/:id/external-refs`. Does **not** copy catalog fields onto the Product. Does **not** change `origin` |

So: if the business expectation is “new Zoho Product → one click → AE Product”, that workflow is **designed** but **not fully wired in the UI**. The pull itself is not supposed to do it.

### Does origin become ZOHO?

Only on **create-from-catalog**. Linking an `ASSETENGINE` Product keeps origin `ASSETENGINE`.

---

## FLOW B — EXISTING LINKED PRODUCT

```
product + product_external_ref
    ↓  POST /api/products/:id/refresh-zoho   (NOT catalog pull)
getProductRecord(external_id)     string → BigInt at SDK boundary
    ↓
upsertCatalogFromZoho             cache refresh for that ID only
    ↓
compareName(baseline, AE, Zoho)
    ↓
patch product: name (if ZOHO_WINS) + product_code (if AE SKU is null)
    ✗ description / make / model / hsn / unit / price / category
last_pulled_at = now()
```

### Proof refresh is implemented and has run in production

`zoho_sync_logs` id 17: `PULL_PRODUCT_REFRESH` SUCCESS, `PRD-0826-ELGTDI-0` / `1205624000001349001`, 29 Aug 07:28 UTC (Phase 8 close-out).  
Phase 8 verify: Description/Make pull cannot overwrite AE; null SKU is filled; true name conflict opens `product_name_conflict`.

### Field behaviour vs canonical rules

| Field | Canonical | Catalog pull | Explicit refresh | Publish |
|-------|-----------|--------------|------------------|---------|
| **Name** | Three-way baseline merge | Cache only | `compareName`: NOOP / AE_WINS / ZOHO_WINS / CONVERGE / NAME_CONFLICT | Sent unless OPEN conflict |
| **Description** | Zoho NEVER overwrites AE | Cache only | **Rejected** (not in patch) | AE → Zoho always |
| **Make** | Zoho NEVER overwrites AE | Cache only | **Rejected** | AE → Zoho if non-null |
| **Model** | Zoho NEVER overwrites AE | Cache only | **Rejected** | AE → Zoho if non-null |
| **HSN** | Zoho NEVER overwrites AE | Cache only | **Rejected** | AE → Zoho if non-null |
| **Unit** | Zoho NEVER overwrites AE | **Not fetched** | **Rejected** (no Zoho `Unit` in GET fields; `Usage_Unit` unmapped) | Not sent |
| **SKU** | Fill only if AE is NULL | Cache only | **Fill-null only** | Sent if AE non-null |
| **Price** | Never auto-overwrite | Cache `unit_price` | **Rejected** (`product.price` untouched) | Never sent (`Unit_Price` forbidden) |
| **Category** | Do not assume mapping | **Not fetched** | No mapping | `Product_Category` never sent |

If an operator edits **Make** in Zoho and clicks Sync catalog, the Inventory catalog card updates and the Product record does not. **That is field ownership (F), not a failed pull.**

If they click **Refresh from Zoho**, Make still does not move. Only Name (via merge) and empty SKU can move.

---

## Mandatory comparison table

### NEW UNLINKED ZOHO PRODUCT

| Observed behaviour | Expected behaviour | Actual code path | Status | Recommendation | Phase |
|--------------------|--------------------|------------------|--------|----------------|-------|
| New Zoho Product does not appear in Products list after Sync catalog | Cache only; no auto Product | `syncProductsFromZoho` → `zoho_catalog`; `GET /api/products` reads `product` | **ALIGNED (A)** | Keep. Add UI copy: “Catalog sync does not create Products.” | — |
| New Zoho Product may not appear in catalog either | Cache should eventually contain every Zoho Product | Single-page `getRecords`, default 200 | **GAP-108 (G)** | Paginate pull **only**. Still no auto-Product. | Catalog-freshness (not 9.1 procurement) |
| Sync twice in 5 minutes reports “synced 0” | Operator should see “skipped, recent sync” | Redis cooldown returns `fromCache` but API still says success with `syncCount: 0` | **UI/message** | Distinguish skip vs empty vs updates | UX |
| Successful refresh of 199 existing catalog rows reports “synced 0” | Message should include updated vs inserted | `syncCount++` on insert only | **UI/message** | Return `inserted` / `updated` / `totalFound` | UX |
| No “Create Product from catalog” on Products page | Explicit create+link is the approved path | API `POST /api/products/from-catalog` exists; `products.js` has Link only | **UI incomplete** | Wire the existing API. Do not auto-create on pull. | Small Product UX |
| Link wizard lists `ZP-SAMPLE-0001` and B-2 EVM | Sample must stay quarantined; EVM may be explicitly created | `listUnlinkedCatalog` is “catalog minus mappings” | **Data/UI** | Exclude non-numeric IDs from wizard. EVM create remains explicit. | UX / B-2 review |
| Inventory “Create Inventory” from catalog card | Must not be the receiving path; Product entity should be the type | `openInventoryFromCatalog` → `ZohoProductId` on `POST /api/inventory/items`; **no `product_id`** | **GAP-105** | Leave in place until a receiving/UI quarantine. Do not treat as Product create. | Later (not Phase 9) |

### LINKED ZOHO PRODUCT

| Observed behaviour | Expected behaviour | Actual code path | Status | Recommendation | Phase |
|--------------------|--------------------|------------------|--------|----------------|-------|
| Catalog sync does not change Product name/make/description | Catalog pull is cache-only; linked refresh is explicit | Pull never calls `refreshProductFromZoho` | **ALIGNED** | Keep. Optional: after pagination, still do not bulk-refresh all mappings unless the business asks. | — |
| Refresh from Zoho updates Name via baseline merge; not Make/Model/Description | Canonical field ownership | `refreshProductFromZoho` patch | **ALIGNED (F)** | Keep. Show “Zoho cannot overwrite Make/Model/Description” on the Refresh button. | UX copy |
| Null SKU filled from Zoho on refresh | Fill-only | `if (!product.product_code && remote.productCode)` | **ALIGNED** | Keep | — |
| Price never auto-copied | Manual Product.price vs document/catalog price | Refresh does not set `price`; publish never sends `Unit_Price` | **ALIGNED** | Keep | — |
| Sample Product AE fields diverge from catalog after Zoho edit | Cache updated; Product waits for Refresh; Make still AE-owned | Catalog pull 29 Aug vs `last_pulled_at` 27 Aug | **ALIGNED + operator gap** | Use Refresh for Name. Do not bulk-copy Make. | Operator |
| Set Product mapped but absent from catalog | Cache should include published Zoho IDs | Publish does not call `upsertCatalogFromZoho` | **Small cache gap** | Upsert catalog on publish/refresh only. Do not invent a second identity. | Catalog KEEP |
| Probe refresh wrote catalog and `last_pulled_at` | Linked refresh must work | Log id 17 SUCCESS | **ALIGNED** | Keep | — |
| 200 PULL mappings have never been “refreshed” since backfill | Not required unless operator asks | Catalog pull ≠ Product refresh | **Not a defect** | Do not run a bulk refresh in this audit’s follow-up | — |

---

## GAP-108 — pagination (do not fix in this audit)

**Still true.**

Evidence:

1. Code: one `getRecords`, no page loop (`zohoService.js` `syncProductsFromZoho`).
2. Logs: SUCCESS `totalFound` is **always 200** (20 Aug first fill `syncCount: 200`; 21 Aug and 29 Aug `syncCount: 1` with `totalFound: 200`).
3. Data: two real Zoho Products remain in `zoho_catalog` with `last_synced_at` on 20/21 Aug — they are **not** in the 29 Aug page.

Impact for this complaint: a **brand-new** Zoho Product that is not among the 200 records Zoho returns on page 1 will not enter the cache at all, so it cannot appear in catalog **or** in the link wizard.

`is_active` is part of the same gap: never written; no deletion detection.

**Do not** use pagination work as a pretext to auto-create Products.

---

## GAP-105 — Inventory picker (do not modify)

**Still true in code.**

`openInventoryFromCatalog` prefills the Inventory modal from a `zoho_catalog` row and stashes `form.dataset.catalogZohoProductId`. Submit sends `ZohoProductId` to `POST /api/inventory/items`. That insert writes `inventory_items.zoho_product_id` and **does not write `inventory_items.product_id`**.

Live data: **0** current inventory rows have `zoho_product_id`; **1** has `product_id` (`MIS-MUM-0826-ZN5BF4-G` → `PRD-0826-2FB5I8-2`, Receipt path). The bypass is live in the UI even if unused today.

Set requirements and Receipt Note typeaheads query `/api/products`, not `zoho_catalog`.

---

## UI and cache-busting

| Control | What it does |
|---------|----------------|
| Products **Refresh** | `GET /api/products?limit=200` |
| Products **New Product** | `POST /api/products` origin `ASSETENGINE` |
| Product **Refresh from Zoho** | `POST /api/products/:id/refresh-zoho` |
| Product **Link to Zoho Product** | Unlinked catalog dropdown → `POST .../external-refs` |
| Inventory context **Sync catalog** | `POST /api/zoho/sync-products` then `refreshInventoryCatalog` **if** `window.syncZohoCatalog` is defined |
| Context-menu fallback (if dashboard helper absent) | Syncs, then reloads asset kinds/sidebar — **does not reload catalog or Products** |

`products.js` is loaded with a cache-bust query (`main.js` `?v=7.22`). Stale browser cache is **not** the primary explanation. The Product list simply does not read `zoho_catalog`.

**Product UI window:** `limit=200` while `product` has **203** rows, ordered `created_at DESC, id ASC`. The two 29 Aug close-out Products appear; **three** of the 27 Aug backfill Products are omitted from the first paint. That can look like “missing Products” even for already-linked rows. Receipt/Set pickers use smaller limits with search, so they are less affected.

---

## Zoho sync logs (read-only)

Recent Product-related rows (newest first):

| id | Operation | Status | When (UTC) | Meaning |
|----|-----------|--------|------------|---------|
| 18 | `PUSH_PRODUCT_CREATE` | SUCCESS | 29 Aug 07:28 | Set Product `1205624000001350001` |
| 17 | `PULL_PRODUCT_REFRESH` | SUCCESS | 29 Aug 07:28 | Probe Product refresh (linked path works) |
| 16 | `PUSH_PRODUCT_CREATE` | SUCCESS | 29 Aug 07:28 | Probe Product `1205624000001349001` |
| 15 | `PULL_CATALOG` | SUCCESS | 29 Aug 04:46 | `{ syncCount: 1, totalFound: 200 }` — EVM inserted into cache |
| 9 | `PULL_CATALOG` | SUCCESS | 21 Aug 08:44 | `{ syncCount: 1, totalFound: 200 }` |
| 5 | `PULL_CATALOG` | SUCCESS | 20 Aug 12:16 | `{ syncCount: 200, totalFound: 200 }` first fill |
| 4–1 | `PULL_CATALOG` | ERROR | 18–20 Aug | Historical: OAuth scope, SDK init, `getFieldValue`, `REQUIRED_PARAM_MISSING` |

There is **no** failed `PULL_CATALOG` after the 20 Aug SDK field-access fix. Current pull is not in a failed-Zoho-pull state (not C).

Historical `PUSH_ASSET` BigInt errors are the contained legacy Asset path, not Product refresh.

---

## ID / type safety (H)

Zoho Product IDs remain **strings** through the Product path:

| Hop | Mechanism |
|-----|-----------|
| SDK `getId()` | `String(...)` on pull; `zohoIdToString` (bigint / decimal string; **rejects** unsafe JS numbers) on GET/CREATE/UPDATE |
| `zoho_catalog.zoho_product_id` | `character varying` PK |
| `product_external_ref.external_id` | `character varying` + not-blank check |
| API | `asExternalIdString`; JSON `zohoId: String(...)` |
| UI | `escapeHtml` / `String(...)` on data attributes |

`Number` / `parseFloat` in this path apply to **prices and list limits**, not Zoho IDs (`toUnitPrice`, catalog `unit_price`, `parseInt(limit)`).

`ZP-SAMPLE-0001` would fail `toZohoRecordBigInt` if anyone tried to GET/publish it. It must stay unlinked.

**H is not the cause of “new Zoho Products not updating.”**

---

## Live sample (no Zoho mutation)

Individual CRM GET was not re-issued from the production Node process in this audit. The following uses DB + Phase 8 close-out readback only.

| Sample | Zoho ID | Catalog | Mapping | Product | Conclusion |
|--------|---------|---------|---------|---------|------------|
| New / unlinked | `1205624000001313001` EVM | Yes (inserted 29 Aug 04:46) | No | No | **A.** Cache-only. Also B-2 on the HAR asset. |
| Linked + refreshed | `1205624000001349001` probe | Yes (`last_synced_at` 07:28) | PUSH + `last_pulled_at` set | `PRD-0826-ELGTDI-0` | **Refresh works.** Close-out readback: name/make/model/HSN/SKU strings; `unitPrice` null. |
| Linked, not in catalog | `1205624000001350001` Set | **No** | PUSH, `last_pulled_at` NULL | `PRD-0826-LKJBZ7-A` | Publish does not cache. Not a mapping failure. |
| Zoho-side field change vs AE | `1205624000001280003` Sample | Name `Sample Test` (synced 29 Aug) | PULL, last pulled 27 Aug | AE still `Sample` / Dell / Laptop | Catalog updated; Product waiting on Refresh; Make must not copy. |

---

## Classification against A–I

| Code | Applies? | Notes |
|------|----------|-------|
| **A. Intentional cache-only for NEW Zoho Products** | **Yes — primary** | Approved Phase 8 D8-3 / §12.1. Do not reclassify as a defect. |
| B. Broken linked-Product refresh | **No** | Implemented; production SUCCESS log; verify suite covers field rules. |
| C. Failed Zoho pull | **No** (currently) | Last catalog pull SUCCESS. Historical errors are old. |
| D. Failed Product mapping/link | **No** as a bulk failure | 203/203 Products mapped. Unlinked cache rows are sample + B-2. |
| **E. Stale / wrong UI** | **Yes — secondary** | Products Refresh ≠ catalog sync. No create-from-catalog button. List limit 200. Sync message counts inserts only. |
| **F. Field ownership preventing update** | **Yes, for Make/Model/Description/HSN/Unit/Price** | Even Refresh will not copy those. Name can move on Refresh. |
| **G. Pagination / `is_active`** | **Yes — GAP-108** | Page 1 only; two real IDs already stale; `is_active` never written. |
| H. ID / type issue | **No** | Strings throughout Product path. |
| I. Other | **Minor** | 5-minute cooldown; publish does not upsert catalog; cooldown/success messaging. |

---

## Concrete recommendations (do not implement here)

**Do not** auto-create AssetEngine Products from `syncProductsFromZoho`. The approved business rule has not changed.

1. **Operator messaging (highest leverage, lowest risk).** On Products and on catalog sync success: catalog cache ≠ Product entity; Refresh from Zoho ≠ Sync catalog; Make/Description are AE-owned.
2. **Wire create-from-catalog UI** to the existing `POST /api/products/from-catalog`. Exclude `ZP-SAMPLE-0001`. Keep confirmation. This is the missing half of the approved explicit workflow.
3. **GAP-108 — paginate catalog pull only.** Loop `page_token` / page until `more_records` is false. Still cache-only. Optionally write `is_active` and report (not delete) missing Zoho IDs. **Not** Phase 9 procurement.
4. **Return honest sync stats:** `inserted`, `updated`, `totalFound`, `fromCache`, `truncated`.
5. **Product list pagination** beyond 200, or raise the first-page limit now that 203 rows exist.
6. **Upsert `zoho_catalog` on Product publish/refresh** so PUSH-created Zoho IDs are not catalog-invisible. Already done on refresh; add the same on publish.
7. **GAP-105** remains a later receiving/UI quarantine. Inventory picker must not become the Product-create path.
8. **Do not bulk-refresh** all 200 PULL mappings. Explicit refresh stays explicit.
9. **B-2 EVM** (`1205624000001313001`) stays a mapping-health item, not an auto-create.

**Phase 9 procurement** should consume AssetEngine Product IDs, not `zoho_catalog` as identity. Closing GAP-108 and the create-from-catalog UI reduces “missing Product” noise before PO lines depend on mappings. Neither is a licence to auto-import Zoho Products.

**Phase 10: not started.**

---

## Files inspected (no edits)

- `web-app/asset-manager-backend/services/zohoService.js` (`syncProductsFromZoho`, `getProductRecord`, `zohoIdToString`, `toZohoRecordBigInt`)
- `web-app/asset-manager-backend/services/productService.js` (`refreshProductFromZoho`, `createProductFromCatalog`, `listUnlinkedCatalog`, `compareName`)
- `web-app/asset-manager-backend/server.js` (`POST /api/zoho/sync-products`, `GET /api/zoho/catalog`, `POST /api/products/from-catalog`, `POST /api/products/:id/refresh-zoho`, inventory insert)
- `web-app/asset-manager-frontend/js/products.js`, `main.js`, `inventory.js`, `dashboard.js`, `contextMenu.js`
- `web-app/asset-manager-backend/scripts/zoho-product-phase8-verify.js`
- Schema: `zoho_catalog`, `product`, `product_external_ref`, `product_name_conflict`, `zoho_sync_logs`

---

## Stop

No code, schema, production, Zoho, or OAuth changes.
