# Product / Zoho Product Integration Audit

**Audit date:** 26 August 2026
**Target:** Production AssetEngine — `192.168.6.237`, container `asset-manager-prod`, port `8080`, database `asset_manager` (container `asset-manager-db`, PostgreSQL 15)
**Scope:** Read-only. No application code, schema, migration, production data, Zoho record, OAuth credential, scope, redirect URI or token file was modified. Nothing was restarted. No Zoho API call was made.
**Purpose:** Establish the Product integration contract *before* any integration code is written.

> **Reading rule.** Where code, database, UI copy and documentation disagree, all positions are reported. Conclusions carry file, line, table, column or route evidence. Anything not established by evidence is marked **UNKNOWN**.

---

## 1. Executive Summary

**There is no Product entity in AssetEngine.** A live schema search for any table matching `%product%`, `%catalog%`, `%sku%` or `%item_master%` returns exactly one table: `zoho_catalog`. That table is a read-only mirror of one page of the Zoho CRM Products module. Everything the business calls "Product" is currently either a row in that mirror or a bare `varchar` on an item row.

The seven findings that determine the integration design:

1. **`zoho_catalog` is a cache, not a catalogue.** 202 rows, primary key `zoho_product_id`, written only by `zohoService.syncProductsFromZoho`. The UI renders it with every input `disabled` (`inventory.js:1490-1514`). No user can create, edit or delete a row. No foreign key points at it from `assets` or `inventory_items`.

2. **`zoho_product_id` means two opposite things depending on the table.** On `assets` it has exactly one writer in the entire codebase — the write-back after a push (`zohoService.js:901-903`) — so it means *"this asset was published into Zoho as a Product."* On `inventory_items` it has exactly one writer path — a client-supplied value from the catalogue picker (`server.js:5029`, `5224`) — so it means *"this stock item was created from that Zoho Product."* Same column name, reversed direction of causation.

3. **The round trip has already happened in production.** Asset `HAR-MUM-0726-55QOFA-R` was pushed on 20 Aug and became Zoho Product `1205624000001284002`. The catalogue pull on 21 Aug brought that record back as `zoho_catalog` row "Trimble Bullet 720". One physical asset is now offered in the catalogue picker as though it were a product type. This is loop **B** in §13, observed, not hypothetical.

4. **Zoho Product → Asset does not exist.** The catalogue detail modal offers only "Create Inventory" (`inventory.js:1519`), and the shared create modal *forces* itself into inventory mode whenever a catalogue product ID is present (`dashboard.js:7827-7835`). The asset payload never carries a product identifier — `ZohoProductId` appears in the inventory branch only (`dashboard.js:7967-7968`).

5. **Inventory → Zoho Product is NOT IMPLEMENTED.** No route, service method or UI control pushes an inventory item. `handleSyncResponse` hardcodes `db('assets')` (`zohoService.js:901`), so the existing write-back could not service any other entity even if a push were added.

6. **Set → Product is a reserved slot with no mechanism.** `managed_sets.zoho_product_id` exists and carries a partial unique index, but `createSet` writes `null` (`kitSetService.js:246`) and `updateSet` accepts only `name`, `description`, `set_code` (`kitSetService.js:270-276`). Nothing can populate it. More fundamentally, `managed_set_components` references physical rows only (FKs to `assets.id` and `inventory_items.id`) — there is no product-level component, so the composition described in the business requirement cannot be expressed.

7. **The BigInt fix is present and working.** `toZohoRecordBigInt` (`zohoService.js:105-123`) is called at the single SDK boundary (`557`). `zoho_sync_logs` shows the exact repair window: three `PUSH_ASSET` failures with `KEY: id EXPECTED TYPE: BigInt` on 21 and 24 Aug, then `PUSH_ASSET_UPDATE SUCCESS` from 24 Aug 06:27 onward. No change is needed or was made.

Production volume is tiny — 4 assets (2 with a Zoho product ID), 1 inventory item (no product ID), 7 managed sets (none with a product ID). **The integration is essentially unexercised, which is an advantage: the contract can still be set correctly.**

---

## 2. Current Zoho Product Architecture

### 2.1 Transport and configuration

| Aspect | Value | Evidence |
|--------|-------|----------|
| SDK | `@zohocrm/nodejs-sdk-8.0` | `package.json` |
| Data centre | India production | `INDataCenter.PRODUCTION()`, `zohoService.js:340` |
| Accounts host | `https://accounts.zoho.in/oauth/v2/auth` | `zohoService.js:29` |
| Token store | SDK `FileStore` → `zoho_tokens.txt` | `zohoService.js:28,281` |
| `oauthtoken` table | Exists, **unused** — SDK DBStore is MySQL-oriented | `zohoService.js:128-131` |
| Scopes | `products.ALL`, `deals.READ`, `settings.fields.READ`, `settings.modules.READ` | `zohoService.js:16-21` |
| Fields requested | `Product_Name,Unit_Price,Description,Product_Code,Make,Model,HSN_Code` | `zohoService.js:24` |
| Org for UI links | `ZOHO_CRM_ORG_ID`, default `60021949576` | `zohoService.js:239` |

`Make` and `Model` are **custom fields** in this Zoho org, read via `getKeyValue` rather than the typed `Field.Products` constants. All 202 catalogue rows have both populated, so the API names resolve correctly.

### 2.2 Route surface

All four Zoho routes require a valid JWT. None carries a role restriction at the route level.

| Route | Handler | Auth | Direction |
|-------|---------|------|-----------|
| `POST /api/zoho/sync-products` | `syncProductsFromZoho` | `authenticateJWT` (2749) | PULL |
| `POST /api/zoho/sync-asset/:id` | `syncAssetToZoho` | `authenticateJWT` (2701) | PUSH |
| `GET /api/zoho/catalog` | direct `db('zoho_catalog')` read | `authenticateJWT` (2774) | READ |
| `POST /api/zoho/sync-deals` | `syncDealsFromZoho` | `authenticateJWT` (2724) | PULL (inoperative, §4.5) |

The push button is gated to `admin`/`superuser`/`manager` **in the frontend only** (`asset-view.js:451-456`). Any authenticated user can call `POST /api/zoho/sync-asset/:id` directly.

### 2.3 Module coverage

| Zoho module | Status |
|-------------|--------|
| **Products** | PULL + PUSH, live |
| **Deals** | Code exists, inoperative (§4.5) |
| Settings (fields/modules) | SDK-internal metadata refresh only |
| Accounts, Contacts, Leads, Quotes, Sales Orders, Purchase Orders, Invoices, Vendors, Work Orders, custom modules | **NOT IMPLEMENTED** |

---

## 3. Current AssetEngine Product Representation

### 3.1 There is no product table

```
SELECT table_name FROM information_schema.tables
 WHERE table_schema='public'
   AND (table_name ILIKE '%product%' OR table_name ILIKE '%catalog%'
        OR table_name ILIKE '%sku%'   OR table_name ILIKE '%item_master%');
→ zoho_catalog          (1 row)
```

**NO INTERNAL PRODUCT ENTITY.**

### 3.2 Every product-shaped column in production

Verified against `information_schema.columns`:

| Table | Column | Type | Nullable | Populated in production |
|-------|--------|------|----------|-------------------------|
| `zoho_catalog` | `zoho_product_id` | varchar(255) | **NOT NULL** (PK) | 202 / 202 |
| `zoho_catalog` | `sku` | varchar(255) | yes | 3 / 202 |
| `zoho_catalog` | `hsn_code` | varchar(255) | yes | 2 / 202 |
| `assets` | `zoho_product_id` | varchar | yes | 2 / 4 |
| `assets` | `hsn_code` | varchar | yes | 0 / 4 |
| `inventory_items` | `zoho_product_id` | varchar | yes | **0 / 1** |
| `inventory_items` | `catalog_uuid` | varchar | yes | **0 / 1** |
| `inventory_items` | `hsn_code` | varchar | yes | 1 / 1 (local value `76541`) |
| `managed_sets` | `zoho_product_id` | varchar(255) | yes | **0 / 7** |
| `quotes` | `zoho_id` | text | yes | not a product reference |

There is **no foreign key** on any of these columns. `zoho_catalog` is referenced by nothing.

### 3.3 The closest current representations of "Product"

Ranked by how much product identity each actually carries:

1. **`zoho_catalog` row** — the only thing with product-like attributes (name, price, make, model, HSN, SKU, description). Read-only, partial, and it now contains at least two non-products (see §10.3).
2. **`assets.zoho_product_id`** — a Zoho record pointer meaning "published from here". Not a product classification.
3. **`inventory_items.zoho_product_id`** — a Zoho record pointer meaning "created from this catalogue entry". This *is* a product classification, and it is the only column in the system that carries that meaning. Never populated in production.
4. **`inventory_items.catalog_uuid`** — the string `ZCAT-` + `zoho_product_id` (`inventory.js:1565`). Derived, redundant, carries no information the previous column does not. Never populated in production.
5. **`assets.make` / `assets.model`** — de facto product typing, free text, no registry.
6. **`hsn_codes` table** — a local tax-code lookup (`server.js:3704`), not a product catalogue.

---

## 4. Zoho Product Pull

### 4.1 Actual flow

```
Zoho CRM Products module (India DC)
   │  RecordOperations('Products').getRecords(fields=PRODUCT_GET_FIELDS)
   │  single page, no PER_PAGE, no PAGE, no more_records loop
   ▼
zohoService.syncProductsFromZoho()          zohoService.js:709-813
   │  per record: getId() → String
   │  getKeyValue('Product_Name'|'Unit_Price'|'Description'
   │              |'Product_Code'|'Make'|'Model'|'HSN_Code')
   ▼
SELECT … WHERE zoho_product_id = ?          zohoService.js:781
   │
   ├── found  → UPDATE zoho_catalog          782-784   (syncCount NOT incremented)
   └── absent → INSERT zoho_catalog          785-791   (syncCount++)
   ▼
zoho_catalog                                 (PK zoho_product_id)
   ▼
GET /api/zoho/catalog → inventory.js catalog grid (read-only)
```

**The pull ends at `zoho_catalog`.** It never touches `assets`, `inventory_items` or `managed_sets`. A Product does **not** become a local Product entity — it becomes a cache row only.

### 4.2 Field transformation

| Zoho API name | Transform | `zoho_catalog` column |
|---------------|-----------|-----------------------|
| `id` (via `getId()`) | `String(...)`; skipped if null/empty (759) | `zoho_product_id` (PK) |
| `Product_Name` | `toNullString` → fallback `'Unnamed Product'` (771) | `product_name` |
| `Unit_Price` | `Number`, non-finite → `0` (750-754) | `unit_price` |
| `Description` | `toNullString` | `description` |
| `Product_Code` | `toNullString` | `sku` |
| `Make` | `toNullString` | `make` |
| `Model` | `toNullString` | `model` |
| `HSN_Code` | `toNullString` | `hsn_code` |
| — | `new Date().toISOString()` | `last_synced_at` |

### 4.3 Pagination — single page, proven empirically

There is no `PER_PAGE`, no `PAGE`, and no `more_records` loop (`zohoService.js:720-724`). The live data proves the consequence:

```
SELECT date_trunc('day', last_synced_at), count(*) FROM zoho_catalog GROUP BY 1;
 2026-08-06 →   1
 2026-08-20 →   1
 2026-08-21 → 200
```

The 21 Aug pull refreshed **exactly 200 rows** — one default page — and left two rows untouched. Any Zoho catalogue larger than one page is silently truncated, and rows past page 1 are never refreshed again.

### 4.4 Duplicate detection, updates, deletions

| Question | Answer | Evidence |
|----------|--------|----------|
| How are duplicates detected? | By Zoho record ID only. Two Zoho Products with identical name/SKU produce two catalogue rows. | 781 |
| How are updates applied? | Blind overwrite of all eight mapped columns. No change detection, no field-level merge. | 784 |
| Is the loop transactional? | **No.** Per-row `SELECT`+`UPDATE`/`INSERT` with no `db.transaction`. A mid-loop failure leaves a partially updated catalogue and logs one `PULL_CATALOG ERROR`. | 756-791 |
| What if a Zoho Product is deleted or archived? | **Nothing happens.** The pull never deletes and never sets `is_active`. The column defaults to `true` and is populated `true` for all 202 rows. A deleted Zoho Product remains selectable in AssetEngine forever. | 770-779; live: `count(is_active)=202` |
| Does the pull update local items referencing the product? | **No.** If Zoho renames or reprices a product, every asset and inventory item created from it keeps its stale copied values. | pull writes only `zoho_catalog` |
| Debounce | 5-minute cooldown via cache key `zoho:last_catalog_sync`; returns `{syncCount:0, fromCache:true}` without an API call. | 713-717, 794 |
| `syncCount` semantics | Counts **inserts only**. A successful pull that updated 200 existing rows reports "Successfully synced 0 products", which the UI shows verbatim. | 790, `server.js:2759` |

### 4.5 The Deals pull is inoperative — three independent breakages

Not a Products concern, but it establishes the reliability baseline and shares the same helper:

1. `deal.getFieldValue(...)` at `zohoService.js:849-850`. This is the exact call that produced the logged failure `product.getFieldValue is not a function` on 20 Aug before the Products path was migrated to `getKeyValue`. Deals was never migrated.
2. `dealId.substring(dealId.length - 6)` at `871`. `getId()` returns a BigInt in SDK 8; BigInt has no `substring`.
3. `projectData` writes `lastupdated` (`864`) — **`projects` has no `lastupdated` column** (verified against `information_schema.columns`; only `zoho_deal_id`, `zoho_project_id_key`, `sale_type` exist of the Zoho set).

Any invocation fails before writing. `syncDealsFromZoho` also never calls `logSync`, so failures leave no row in `zoho_sync_logs`.

---

## 5. Asset → Product → Zoho

### 5.1 Actual flow

```
asset-view.js  "Push to Zoho CRM" / "Update in Zoho"     asset-view.js:472, 667
   │  frontend gate: admin | superuser | manager          451-456
   ▼
POST /api/zoho/sync-asset/:id   (authenticateJWT, no role check)   server.js:2701
   ▼
zohoService.syncAssetToZoho(parentId)                     zohoService.js:520
   │  SELECT * FROM assets WHERE id = ?                   525
   │  buildAssetDescription(parentId)                     529 → 480-514
   │  mode = parent.zoho_product_id ? 'UPDATE' : 'CREATE' 554
   │
   ├─ UPDATE: record.setId(toZohoRecordBigInt(zoho_product_id))  557
   │          recordOperations.updateRecords(...)                559
   └─ CREATE: recordOperations.createRecords(...)                562
   ▼
handleSyncResponse(response, parentId, mode)              890-913
   │  zohoId = actionResponse.getDetails().get('id')      898
   ▼
UPDATE assets SET zoho_product_id = <zohoId> WHERE id = ? 901-903
   ▼
INSERT zoho_sync_logs (PUSH_ASSET_CREATE | PUSH_ASSET_UPDATE)  567-575
```

### 5.2 Field mapping, push direction

| AssetEngine source | Zoho Products field | Mechanism | Line |
|--------------------|---------------------|-----------|------|
| `assets.itemname` | `Product_Name` | typed `Field.Products.PRODUCT_NAME` | 545 |
| `buildAssetDescription()` | `Description` | typed constant | 546 |
| `parseFloat(assets.asset_value \|\| 0)` | `Unit_Price` | typed constant | 547 |
| `assets.make` | `Make` | `addKeyValue` (custom field) | 550 |
| `assets.model` | `Model` | `addKeyValue` (custom field) | 551 |

**Not sent, though columns exist:** `Product_Code`/SKU, `HSN_Code`, `assets.id`, `client_label`, serial number (except embedded in a kit description), quantity, location, status, `is_set`, `is_batch`.

**Consequence:** Zoho holds **no AssetEngine identifier of any kind.** The mapping is one-directional and lives only in the AssetEngine column. If `assets.zoho_product_id` is lost, the link cannot be rebuilt from Zoho — only guessed by name.

### 5.3 `Product_Name` generation

`Product_Name` is `assets.itemname` verbatim. There is no uniquification, no SKU, no make/model prefix, no collision check. Two assets named "MacBook 24 Air" pushed separately produce two Zoho Products with the same name.

### 5.4 Description generation — and the serial leak

`buildAssetDescription` (`zohoService.js:480-514`) branches on whether the asset has children (`parentid` = this asset, `is_deleted = 0`):

- **Kit / set parent** (`493-501`): emits `KIT INCLUDES:` followed by one numbered line per child — `<n>. <itemname> [make model] (S/N: <serial>)`. The serial is `child.serialno || child.srno || 'N/A'`. On `assets`, `srno` is **encrypted** and `serialno` is normally empty, so the string pushed to Zoho is typically **ciphertext**, not a readable serial.
- **Standalone** (`503-508`): `itemdescription` plus `\nSpecs: <make> <model>`, else `'Standalone Product'`.

Production confirms the standalone branch: catalogue row `1205624000001284002` has `description = 'Specs: Trimble Bullet 720'`.

This description is free text. It is the only place composition is expressed, it is not parsed on the way back, and it is overwritten wholesale on every update.

### 5.5 CREATE vs UPDATE — duplicate and failure analysis

The decision is `parent.zoho_product_id ? 'UPDATE' : 'CREATE'` (`554`). Nothing else participates: not `zoho_catalog`, not the product name, not a content hash.

| Scenario | Behaviour |
|----------|-----------|
| Asset already has a valid ID | UPDATE against that Zoho record. No duplicate. |
| Asset has no ID | CREATE. **No search for an existing Zoho Product with the same name** — a duplicate is created if one exists. |
| Asset's ID cleared manually | Next push CREATEs a second Zoho Product; the first is orphaned with no back-reference. |
| Zoho record deleted in Zoho, ID still stored | UPDATE fails with a Zoho API exception. **No fallback to CREATE.** The asset is permanently unpushable until the column is cleared by hand. |
| Stored ID non-numeric (e.g. `ZP-SAMPLE-0001`) | `toZohoRecordBigInt` throws `not a valid numeric ID` before any API call (`119-121`). Logged as `PUSH_ASSET ERROR`. Also unpushable. |
| Product already exists in `zoho_catalog` | **Irrelevant to the decision.** The catalogue is not consulted on push. A CREATE proceeds regardless. |
| Zoho Product later edited manually by Sales | The next push **overwrites** `Product_Name`, `Description`, `Unit_Price`, `Make`, `Model` unconditionally. Manual edits to those five fields are lost. Fields AssetEngine never sends (SKU, HSN, tax, category, vendor) survive. |
| Split child asset pushed | Split does not copy `zoho_product_id` to children (no writer exists outside `handleSyncResponse`), so each child CREATEs its own Zoho Product. Five split children ⇒ five new Zoho Products. |

### 5.6 Write-back is asset-only by construction

```901:903:web-app/asset-manager-backend/services/zohoService.js
                    await db('assets').where('id', parentId).update({
                        zoho_product_id: zohoId
                    });
```

The table name is hardcoded. `handleSyncResponse` is the sole write-back path, so any future inventory or set push would either write into `assets` under a foreign ID (silently affecting nothing) or need its own path. **This is the single most important structural constraint on the future design.**

The update is also unconditional: it does not compare the returned ID with the stored one, so a Zoho-side merge that returns a different ID would be adopted silently and without a log entry beyond the success row.

---

## 6. Inventory → Product → Zoho

**NOT IMPLEMENTED.**

Searches performed across `web-app/**/*.js` for `zoho_product_id`, `zohoProductId`, `catalog_uuid`, `catalogUuid`, `sync inventory`, `create product from inventory`, `Product_Code`, `Product_Name`, `commercial*`, `publish*`, `createProduct`:

| Candidate mechanism | Result |
|---------------------|--------|
| Route pushing inventory to Zoho | None. The only push route is `/api/zoho/sync-asset/:id`. |
| Service method accepting an inventory ID | None. `syncAssetToZoho` reads `db('assets')` only (`525`). |
| UI control | None. `inventory.js` calls `GET /api/zoho/catalog` only. |
| Write-back target | `handleSyncResponse` hardcodes `db('assets')` (`901`). |
| `inventory_items.zoho_product_id` writers | `server.js:5029` (POST) and `5224` (PUT) — both accept a **client-supplied** value; neither contacts Zoho. |

`inventory_items.zoho_product_id` is therefore **inbound-only**: it records which catalogue product an item was created from. It is never sent anywhere. In production it is empty for the single existing item, so this path has never been used against this database.

---

## 7. Zoho Product → Asset

**NOT IMPLEMENTED.** Three independent pieces of evidence:

1. **No UI entry point.** The catalogue product modal renders exactly three buttons: `Close`, `View in Zoho`, `Create Inventory` (`inventory.js:1517-1519`). There is no "Create Asset".

2. **The shared modal actively refuses.** `dashboard.js:7827-7835` switches `entityMode` to `'inventory'` whenever a catalogue product ID or catalogue UUID is present alongside a folder and kind:

```7827:7835:web-app/asset-manager-frontend/js/dashboard.js
                if (entityMode !== 'inventory'
                    && (hasInventoryEditId
                        || isInventoryFolderId
                        || isInventoryKindId
                        || window.__inventoryModalActive === true
                        || ((folderValue && kindValue) && (hasCatalogZohoProductId || hasCatalogUuid || onInventoryView)))) {
                    entityMode = 'inventory';
                    form.dataset.entity = 'inventory';
                }
```

3. **The asset payload has no product field.** `ZohoProductId` and `CatalogUUID` appear exactly twice in `dashboard.js` (7967, 7968), both inside `inventoryPayload`. The asset branch sends neither.

**Confirmed by exhaustion:** `assets.zoho_product_id` has exactly **one** writer in the whole codebase — `zohoService.js:901`. No create route, no update route, no bulk import, no catalogue selection can set it. (`normalizeDBData` only lowercases keys — `utils.js:93-103` — so `ZohoProductId` in a request body would become `zohoproductid`, which is not a column and cannot leak through.)

**Therefore:** an Asset can never be *classified* by a Zoho Product. It can only *become* one.

---

## 8. Zoho Product → Inventory

This is the **only** implemented Zoho → AssetEngine item path.

```
Inventory ▸ Zoho Reference Catalog          inventory.js:1381-1419
   │  GET /api/zoho/catalog  →  state.catalog
   │  card click → openCatalogProductModal(item)         1417
   ▼
Read-only detail modal (every input `disabled`)          1490-1514
   │  "Create Inventory"                                  1519, 1537
   ▼
openInventoryFromCatalog(catalogItem)                     1555
   │  form.dataset.catalogZohoProductId = zoho_product_id 1564
   │  form.dataset.catalogUuid = `ZCAT-${zoho_product_id}` 1565
   │  prefill: itemName, itemDescription, itemMake,
   │           itemModel, itemHsnCode, itemValue           1577-1582
   │  defaults: qty 1, unit 'Nos', precision 0,
   │            is_qty_tracked = FALSE                     1584-1587
   ▼
shared modal submit → entityMode forced 'inventory'       dashboard.js:7832
   │  ZohoProductId, CatalogUUID in payload               7967-7968
   ▼
POST /api/inventory/items                                 server.js:4940
   │  zoho_product_id: item.ZohoProductId || … || null    5029
   │  catalog_uuid:    item.CatalogUUID   || … || null    5030
   ▼
inventory_items
```

### 8.1 What is actually stored

| Concept | Stored? | Column | Note |
|---------|---------|--------|------|
| Zoho Product ID | **Yes** | `inventory_items.zoho_product_id` | The only genuine product reference in the system |
| Internal Product ID | **No** | — | No such identifier exists |
| Catalog UUID | Yes | `inventory_items.catalog_uuid` | `ZCAT-` + the same Zoho ID. Derived, redundant |
| SKU / Product Code | **No** | — | Shown in the modal, never persisted to the item |
| Name, description, make, model, HSN, price | Copied as **item** values | `itemname`, `itemdescription`, `make`, `model`, `hsn_code`, `asset_value` | Snapshot at creation; never refreshed from the catalogue |

The copy is a snapshot. No mechanism reconciles it afterwards, so an item's `make`/`model`/price can silently diverge from its catalogue product forever.

### 8.2 Trust boundary

`server.js:5029` accepts `ZohoProductId` from the request body with **no validation** — no existence check against `zoho_catalog`, no format check, no consistency check against `CatalogUUID`. An authenticated client can post any string, including an ID that does not exist in Zoho or a value inconsistent with `catalog_uuid`.

### 8.3 Does the relationship survive item operations?

| Operation | `zoho_product_id` survives? | Evidence |
|-----------|----------------------------|----------|
| Inventory create from catalogue | Yes | 5029 |
| Inventory edit (`PUT`) | Yes **if the client resends it**; the handler re-reads `item.ZohoProductId \|\| item.zoho_product_id \|\| null` (5224). The shared modal resends from `form.dataset`, which `openInventorySharedModal` **deletes** on open (`inventory.js:484-485`) and only `openInventoryFromCatalog` sets. **Editing an existing catalogue-derived item through the normal edit path therefore posts `null` and clears the link.** | 5224, `inventory.js:484-485,1564` |
| Inventory split / break | Not applicable — inventory has no split | §6 of the architecture audit |
| Inventory soft delete / restore | Yes — flags only | `server.js:5385,5424` |
| Asset created from an inventory item | Not applicable — no conversion exists | §11 |
| Asset split | Child inherits nothing; no writer exists | §7 |
| Asset copy / clone | No clone route exists | — |

The edit-path clearing in row 2 is a **confirmed data-loss path for product identity**, though it has never fired in production because no item carries the column yet.

---

## 9. `zoho_product_id` Audit

### 9.1 Complete inventory

**Tables and columns** (live schema):

| Table | Column | Role |
|-------|--------|------|
| `zoho_catalog` | `zoho_product_id` | **Primary key.** The Zoho record ID *is* the cache identity |
| `assets` | `zoho_product_id` | Published-to-Zoho pointer |
| `inventory_items` | `zoho_product_id` | Created-from-catalogue pointer |
| `inventory_items` | `catalog_uuid` | Derived alias of the above |
| `managed_sets` | `zoho_product_id` | Reserved, never written; partial unique index |
| `sets` (unapplied migration `20260824120000`) | `zoho_product_id` | Table does not exist in production |

### 9.2 Writers, classified

| # | Writer | Target | Value source | Class | Conflicts? |
|---|--------|--------|--------------|-------|-----------|
| 1 | `zohoService.js:786-789` | `zoho_catalog.zoho_product_id` | Zoho `getId()` | **SYNC** | Sole writer of the PK |
| 2 | `zohoService.js:901-903` | `assets.zoho_product_id` | Zoho create/update response ID | **MAPPING** (push write-back) | **Sole writer for `assets`** |
| 3 | `server.js:5029` | `inventory_items.zoho_product_id` | `req.body.ZohoProductId` (client) | **IMPORT** | Sole create writer |
| 4 | `server.js:5030` | `inventory_items.catalog_uuid` | `req.body.CatalogUUID` (client) | **DERIVED** | — |
| 5 | `server.js:5224` | `inventory_items.zoho_product_id` | `req.body.ZohoProductId`, else `null` | **IMPORT / destructive** | Can clear the value (§8.3) |
| 6 | `server.js:5225` | `inventory_items.catalog_uuid` | same | **DERIVED / destructive** | same |
| 7 | `kitSetService.js:246` | `managed_sets.zoho_product_id` | literal `null` | **CREATE** | Only ever writes null |
| 8 | migration `20260804090000` | `zoho_catalog` (`ZP-SAMPLE-0001`) | hardcoded literal | **SEED** | Test-gated, yet present in production (§10.3) |

There is **no writer** that sets `assets.zoho_product_id` from a catalogue selection, and **no writer** that sets `managed_sets.zoho_product_id` to a real value.

### 9.3 Readers

| Location | Reads | Purpose |
|----------|-------|---------|
| `zohoService.js:554,556,557` | `assets.zoho_product_id` | CREATE-vs-UPDATE decision and `setId` |
| `zohoService.js:781,784` | `zoho_catalog.zoho_product_id` | Upsert key |
| `kitSetService.js:172` | `assets.zoho_product_id` for legacy sets | Selected then **dropped** by the mapper at `177-187`; never surfaced |
| `kitSetService.js:509` | `inventory_items.zoho_product_id` | Set eligibility listing (display only) |
| `asset-view.js:459,650` | `asset.zoho_product_id` | Button label and "View in Zoho" link |
| `dashboard.js:4732,4748` | `item.zoho_product_id` | Catalogue card: last 8 chars + deep link |
| `inventory.js:998` | `zoho_product_id` or `catalog_uuid` | Derives a `fromCatalog` badge |
| `inventory.js:1399,1414,1415,1465,1541` | catalogue rows | Grid, click routing, modal |
| `contextMenu.js:397` | id argument | `buildZohoProductUiUrl` |

`normalizeResult` spreads the original row before adding aliases (`server.js:206`), so API responses carry both `zoho_product_id` and `ZohoProductId`. The snake_case reads above work.

### 9.4 Is the column overloaded?

Per table, provenance is unambiguous — each has exactly one writer. **Across tables, the semantics are inverted:**

| Table | Statement the column makes | Causal direction |
|-------|----------------------------|------------------|
| `assets` | "This asset was published into Zoho, creating that Product record." | AssetEngine → Zoho |
| `inventory_items` | "This stock item was instantiated from that Zoho Product." | Zoho → AssetEngine |
| `zoho_catalog` | "This *is* the Zoho Product." | identity |

A single query joining items to the catalogue by this column would therefore mix "is an instance of" with "is the source of" in one result set, with nothing to tell them apart. And because a pushed asset's product is pulled back into `zoho_catalog` (§10.3), the two meanings converge on the same value in production **today**: catalogue row `1205624000001284002` is simultaneously "a product you can create inventory from" and "the Zoho projection of asset `HAR-MUM-0726-55QOFA-R`".

**Conclusion: the column is not overloaded within a table, but the *concept* is. There is no provenance marker anywhere, so origin cannot be recovered from the data — only inferred from `zoho_sync_logs`, which is retained without limit today but is not a designed source of truth.**

---

## 10. `zoho_catalog` Audit

### 10.1 Answers

| Question | Answer | Evidence |
|----------|--------|----------|
| Is it a cache? | **Yes.** Populated only by the pull; nothing else writes it. | `zohoService.js:781-791` |
| Is it a local Product catalogue? | **No.** No create, no edit, no delete, no local rows by design. | UI read-only, `inventory.js:1490-1514` |
| Is it the Product entity? | **No.** No FK, no lifecycle, no local identity. | §3.2 |
| Is it authoritative? | **No.** Zoho is authoritative; this is a partial, stale mirror. | §4.3, §4.4 |
| Can users edit it? | **No.** Every input in the detail modal is `disabled`; no write route exists. | `inventory.js:1492-1513`; only `GET /api/zoho/catalog` |
| Only Zoho-originated products? | **No** — see §10.3. | live data |
| Contains AssetEngine-created products? | **Yes** — a pushed asset returned on the next pull. | §10.3 |
| Contains stale products? | **Yes.** Two rows not refreshed since 6 and 20 Aug; deleted Zoho products are never removed. | §4.3, §4.4 |
| What uniquely identifies a row? | `zoho_product_id` (PK). No unique constraint on name or SKU. | `\d zoho_catalog` |
| Does it retain the Zoho Product ID? | Yes — it *is* the primary key. | same |
| FK from assets or inventory? | **No.** Nothing references `zoho_catalog`. | `\d zoho_catalog` shows no inbound references |
| Does deleting a catalogue row affect items? | **No.** Items keep an orphan `zoho_product_id` string and their copied attribute snapshot. | no FK |

### 10.2 Live shape

```
zoho_catalog: 202 rows
  zoho_product_id varchar(255) NOT NULL  PK
  product_name    varchar(255) NOT NULL
  unit_price      numeric(15,2) DEFAULT 0     201 rows are 0.00; max 25000.00
  make/model      varchar(255)                202 / 202 populated
  hsn_code        varchar(255)                  2 / 202 populated
  sku             varchar(255)                  3 / 202 populated (3 distinct)
  description     text
  is_active       boolean DEFAULT true        202 true — never written by code
  last_synced_at  timestamptz DEFAULT now()
  created_at      timestamptz DEFAULT now()
Indexes: zoho_catalog_pkey only
```

Effectively the catalogue carries **name + make + model** and little else. SKU — the natural commercial key — is present on 1.5% of rows, so it cannot be used for matching. Pricing is absent from all but one row.

At least one `product_name` contains an embedded newline and quote characters (row `1205624000000979031`: `"Software Defined Production Engine\nNote: Add on to existing ULTRIX-FR5, SN# 30172647005."`). Any future scheme that parses names or descriptions must assume multi-line, quoted, punctuated text.

### 10.3 Two rows that are not Zoho catalogue products

**(a) A seeded fake product is live in production.**

```
zoho_product_id 'ZP-SAMPLE-0001'
product_name    'Sample Catalog Product (Hardcoded)'
unit_price      25000.00      make CINEOM      model SAMPLE-MODEL-1
sku             'SAMPLE-001'  created_at 2026-08-06 11:12:45
description     'Hardcoded sample catalog product for testing catalog → inventory conversion flow.'
```

Its migration `20260804090000_seed_sample_zoho_catalog_product_preview.js` is **gated to `asset_manager_test`** (lines 8-14) and is recorded as applied in production, where the guard would have made it a no-op. The row nevertheless exists, and its `created_at` (6 Aug) precedes nothing in the migration record that could explain it. **UNKNOWN:** how it was inserted. This is the same pattern as the production inventory tables documented in the architecture audit §3.4 — production DML occurring outside the migration system.

Consequences: it is selectable in the catalogue picker; no pull will ever refresh or remove it (Zoho has no such record); and because its ID is non-numeric, any item created from it could never be pushed — `toZohoRecordBigInt` would throw at `zohoService.js:119-121`.

**(b) A pushed AssetEngine asset came back as a catalogue product.**

```
zoho_sync_logs
  2026-08-20 12:48  PUSH_ASSET_CREATE  SUCCESS  local_id HAR-MUM-0726-55QOFA-R  zoho_id 1205624000001284002
  2026-08-21 08:44  PULL_CATALOG       SUCCESS

zoho_catalog
  1205624000001284002 | Trimble Bullet 720 | Trimble | Bullet 720 | 0.00 | 'Specs: Trimble Bullet 720'
  created_at 2026-08-21 08:44:35

assets
  HAR-MUM-0726-55QOFA-R | Trimble Bullet 720 | zoho_product_id 1205624000001284002
```

One physical asset is now presented in the Zoho Reference Catalog as a product type. A user who clicks it and chooses "Create Inventory" would create a stock item whose `zoho_product_id` points at the Zoho projection of a single specific asset.

**(c) For contrast, the second pushed asset is *not* in the catalogue.** Asset `HAR-MUM-0826-IEIZP5-U` holds `zoho_product_id = 1205624000001313001`, created in Zoho on 25 Aug — after the last pull. A join from `assets` to `zoho_catalog` on this column returns one hit and one miss. This proves both that no FK exists and that the two stores drift freely.

---

## 11. Current CREATE / UPDATE / PULL Behaviour

### 11.1 PRODUCT CREATE (AssetEngine → Zoho)

| Question | Answer |
|----------|--------|
| Who can create? | Any user with a valid JWT via `POST /api/zoho/sync-asset/:id`. UI shows the button to `admin`/`superuser`/`manager` only (`asset-view.js:451-456`). |
| From what source? | An `assets` row only. Not inventory, not sets, not a product definition. |
| Which fields? | `Product_Name`, `Description`, `Unit_Price`, custom `Make`, custom `Model` (5 fields). |
| Trigger condition | `assets.zoho_product_id` is empty (`zohoService.js:554`). |
| What ID is returned? | `actionResponse.getDetails().get('id')` (`898`). |
| Where is it stored? | `assets.zoho_product_id` (`901-903`) and `zoho_sync_logs.zoho_id` (`567-575`). |
| Duplicate protection | **None.** No name search, no catalogue check, no idempotency key. |
| Is the local catalogue updated? | **No.** `zoho_catalog` gains the row only on the next pull. |

### 11.2 PRODUCT UPDATE (AssetEngine → Zoho)

| Question | Answer |
|----------|--------|
| What identifies the Product? | `assets.zoho_product_id` alone. |
| Does `Record.setId()` require BigInt? | **Yes.** Confirmed empirically by three logged `PUSH_ASSET` failures reading `KEY: id EXPECTED TYPE: BigInt`. |
| Where is the conversion performed? | `toZohoRecordBigInt(value, fieldName)`, `zohoService.js:105-123`, called at the single SDK boundary, `557`. |
| Does the fix exist? | **Yes — present and working. Left untouched.** See §12. |
| Does UPDATE modify the existing record or create another? | Modifies the existing one — `updateRecords` with an explicit ID (`559`). It cannot create a duplicate. |
| Field-level merge? | **No.** All five mapped fields are overwritten on every push. |
| What if the Zoho record is gone? | API exception, logged as `PUSH_ASSET ERROR`. No fallback to CREATE; the asset becomes unpushable. |

### 11.3 PRODUCT PULL (Zoho → AssetEngine)

Covered in detail in §4. Summary: 7 fields plus the record ID; **no pagination** (one default page of 200, proven by the live sync-date distribution); local representation is a `zoho_catalog` cache row and nothing more.

---

## 12. Current BigInt Handling

**State: correct, in place, and confirmed only — not modified.**

```105:123:web-app/asset-manager-backend/services/zohoService.js
function toZohoRecordBigInt(value, fieldName = 'id') {
    if (typeof value === 'bigint') {
        return value;
    }
    if (value == null || value === '') {
        throw new Error(`Zoho record ${fieldName} is missing`);
    }
    if (typeof value === 'number') {
        if (!Number.isInteger(value) || !Number.isSafeInteger(value)) {
            throw new Error(`Zoho record ${fieldName} is not a safe integer; store and pass a decimal string`);
        }
        return BigInt(value);
    }
    const asString = String(value).trim();
    if (!/^\d+$/.test(asString)) {
        throw new Error(`Zoho record ${fieldName} is not a valid numeric ID`);
    }
    return BigInt(asString);
}
```

Properties worth recording for the future design:

- **Single boundary.** The only call site is `record.setId(...)` at `557`. Conversion happens at the SDK edge; stored values remain strings. The docblock states this explicitly (`97-99`).
- **19-digit IDs exceed `Number.MAX_SAFE_INTEGER`.** Production IDs such as `1205624000001284002` are 19 digits (`Number.MAX_SAFE_INTEGER` is 16). The safe-integer guard on the numeric branch is therefore load-bearing: any future path that reads a Zoho ID as a JS `number` will be rejected rather than silently corrupted.
- **Non-numeric IDs are rejected before the API call.** This is why `ZP-SAMPLE-0001` (§10.3) can never be pushed — correct behaviour, but it means the sample row is a permanent dead end for anything derived from it.
- **The reverse direction is unguarded.** `handleSyncResponse` writes `zohoId` straight into a `varchar` column (`901-903`) with no `String()` coercion and no format assertion. It works today, but any future entity that reuses this helper inherits an unvalidated write.

**Timeline reconstructed from `zoho_sync_logs` (read-only):**

| When | Operation | Result |
|------|-----------|--------|
| 20 Aug 12:48 | `PUSH_ASSET_CREATE` | SUCCESS → `1205624000001284002` (create path never needed `setId`) |
| 21 Aug 04:24 | `PUSH_ASSET` | ERROR `KEY: id EXPECTED TYPE: BigInt` |
| 21 Aug 04:26 | `PUSH_ASSET` | ERROR — same |
| 24 Aug 05:13 | `PUSH_ASSET` | ERROR — same |
| **24 Aug 06:27** | `PUSH_ASSET_UPDATE` | **SUCCESS** — fix effective |
| 24 Aug 07:19, 10:12 | `PUSH_ASSET_UPDATE` | SUCCESS |
| 25 Aug 04:44 | `PUSH_ASSET_CREATE` | SUCCESS → `1205624000001313001` |

The update path only ever failed *after* the first create, which is exactly what a missing `setId` coercion predicts.

---

## 13. Bidirectional Sync Risks

Present-tense analysis of the code as it stands.

### Loop A — Zoho Product → AssetEngine → Zoho Product

**Cannot currently close.** The pull writes only `zoho_catalog`, and nothing pushes a `zoho_catalog` row back. **Risk: none today.** It becomes live the moment anything can push a catalogue-derived record.

### Loop B — Asset → Product → Zoho Product → AssetEngine

**Already closed in production** (§10.3). Asset pushed 20 Aug → Zoho Product → pulled back 21 Aug as a catalogue row.

It does not *re-enter* the asset today, because a catalogue row can only become **inventory**, never an asset. So the loop terminates one step short of self-amplification. Concrete consequences already present:

- The catalogue is polluted with individual physical assets presented as product types.
- Creating inventory from that row produces a stock item pointing at the Zoho projection of one specific asset — an asset and an inventory item both claiming the same "product", meaning different things.
- Pushing that asset again overwrites the Zoho record; the catalogue row still shows the pre-push snapshot until the next pull, so the UI can display a product that no longer matches Zoho.

### Loop C — Inventory → Product → Zoho Product → AssetEngine

**Half-open.** Zoho → inventory works; inventory → Zoho does not exist (§6). No loop today. If an inventory push were added and reused `handleSyncResponse`, it would write into `db('assets')` — a silent no-op for inventory IDs, leaving the item permanently un-linked and every subsequent push creating **another** duplicate Zoho Product. This is the single highest-risk consequence of the hardcoded write-back.

### Loop D — Set → Product → Zoho Product → AssetEngine

**Not possible.** No writer for `managed_sets.zoho_product_id`, no set push, no set-shaped pull.

### Cross-cutting risk register

| Risk | Live today? | Mechanism |
|------|-------------|-----------|
| **Duplicate Zoho Products** | **Yes** | CREATE fires whenever `zoho_product_id` is empty, with no name or SKU search (`554-562`). Split children, restored assets and cleared columns all trigger it. |
| **Overwriting manual Zoho edits** | **Yes** | UPDATE unconditionally rewrites `Product_Name`, `Description`, `Unit_Price`, `Make`, `Model`. No timestamp comparison, no field ownership, no `Modified_Time` check. |
| **Overwriting AssetEngine fields** | No | The pull never writes to `assets` or `inventory_items`. |
| **Mistaking an Asset for a Product** | **Yes, observed** | §10.3(b). |
| **Mistaking Inventory for a Product** | Latent | Would occur as soon as inventory push exists, since no provenance marker distinguishes item-derived Zoho Products from real ones. |
| **Infinite sync loop** | No | Both directions are manual, and neither triggers the other. There is no cron, no webhook, no queue. |
| **Loss of provenance** | **Yes** | No column records whether a `zoho_product_id` was received or produced. Only `zoho_sync_logs` distinguishes them, and it is an unbounded, unindexed log — not a designed source of truth. |
| **Stale local copies** | **Yes** | Item attributes are snapshots; the pull never propagates changes to items. |
| **Silent truncation of the catalogue** | **Yes** | Single-page pull; two rows already stale (§4.3). |
| **Orphaned references** | **Yes** | No FK. Asset `HAR-MUM-0826-IEIZP5-U` already points at a product with no catalogue row. |
| **Unvalidated inbound product ID** | **Yes** | `server.js:5029` trusts `req.body.ZohoProductId` completely. |
| **Product link cleared on edit** | **Yes (latent)** | `server.js:5224` writes `null` when the client omits the field, and the edit path clears `form.dataset` (`inventory.js:484-485`). |
| **Encrypted serials shipped to Zoho** | **Yes** | Kit descriptions embed `srno`, which is ciphertext on `assets` (`zohoService.js:497`). |
| **Non-transactional pull** | **Yes** | Per-row upserts, no transaction (`756-791`). |

---

## 14. Set → Product Future Architecture

### 14.1 What exists today

| Capability | Status | Evidence |
|------------|--------|----------|
| Set header with a product slot | **Exists, unusable** | `managed_sets.zoho_product_id` + partial unique index `managed_sets_zoho_product_id_unique`; no writer |
| Set composition | Exists — **physical only** | `managed_set_components` FKs to `assets.id` and `inventory_items.id` |
| Product-level composition | **Does not exist** | `component_type` CHECK allows only `'ASSET'` and `'INVENTORY'`; no product column |
| Quantity per component | Exists, with a constraint | `quantity integer NOT NULL DEFAULT 1`; `managed_set_components_asset_quantity_check` forces asset quantity = 1 |
| One asset in many sets | **Forbidden** | `managed_set_components_asset_id_active_unique` is a **global** partial unique on `asset_id WHERE is_active` |
| Set push to Zoho | **Does not exist** | No route, no service method, no UI |
| Set history | **Does not exist** | No history/audit/event writer in `kitSetService.js` |

Two structural facts dominate the design:

1. **Composition is an allocation list, not a bill of materials.** The requirement in the brief — `Camera × 1`, `Lens × 2`, `Battery × 10` — is expressed in *products*. `managed_set_components` can only name specific physical rows. There is no place to record "2 lenses" without naming which two, and asset components are additionally pinned to quantity 1, so "2 lenses" must be two separate component rows.

2. **The global unique on `asset_id` blocks Super Sets.** If two sets need the same asset, or a Super Set is modelled as a set containing sets, the constraint refuses. Any nesting design must address this constraint explicitly.

### 14.2 Identity required to keep a commercialized Set updatable

Given the requirement that the Zoho description be **human-readable only** while AssetEngine retains the structured composition, the following must be durable. None of it exists today.

| # | Requirement | Exists? | Why it is needed |
|---|-------------|---------|------------------|
| 1 | Stable Set → Zoho Product mapping | Column yes, writer **no** | Without it, re-commercializing creates a duplicate Zoho Product, exactly as §13 describes for assets. |
| 2 | Stable identity per composition line | **No** — `managed_set_components.id` exists but is not exposed to any external mapping | To know whether a changed line is an edit or a replacement when regenerating the description. |
| 3 | Product identity per line | **No** | The description must read "1 × Camera"; today a line can only name asset `AST-CAMERA-001`. A product-level line is required to render a product-level description. |
| 4 | Composition version or content hash | **No** | To decide whether a Zoho update is needed at all, and to avoid overwriting a Sales edit with an unchanged payload. |
| 5 | Separation of requirement from allocation | **No** (§15) | "2 lenses required" must survive re-allocation from `LENS-001`/`002` to `LENS-003`/`004` without a Zoho update. |
| 6 | Membership history | **No** | To answer "what did this Product contain when it was quoted in March?" — a quote references a Zoho Product whose composition has since changed. |
| 7 | Provenance marker on the resulting Product | **No** | So the next catalogue pull does not re-present a commercialized Set as a purchasable component product (loop D). |
| 8 | Field ownership policy | **No** | Sales will edit price and tax on the commercialized Product; AssetEngine must not overwrite those on the next composition change. |

### 14.3 Change-propagation matrix for a commercialized Set

What *should* happen when something changes, and what the current codebase could detect:

| Change | Should Zoho be updated? | Detectable today? |
|--------|------------------------|-------------------|
| Component **quantity** changes (2 lenses → 3) | Yes — description changes | Only by diffing `managed_set_components`; no version, no hash, no history |
| Component **product** changes (Lens A → Lens B) | Yes — description changes | No product-level line exists to change |
| **Asset allocation** changes (`LENS-001` → `LENS-003`), same product and quantity | **No** — commercially identical | **Not distinguishable.** Today the component *is* the allocation, so any reallocation looks like a composition change |
| Set renamed | Yes | `managed_sets.updated_at` exists |
| Set archived | Business decision (deactivate the Zoho Product?) | `status`/`archived_at` exist; no push |
| Component removed | Yes | `is_active=false` retained on the row |

Row 3 is the decisive one: **until requirement and allocation are separate, AssetEngine cannot tell a commercially meaningful change from routine warehouse substitution**, and will either over-push (rewriting Zoho on every swap) or under-push (missing real changes).

---

## 15. Required Identity Chain

Assessed against the chain in the brief.

### 15.1 Link-by-link

| Chain link | Exists? | Implementation | Gap |
|------------|---------|----------------|-----|
| **AssetEngine Set ID ↔ Zoho Set Custom Module ID** | **NO** | `managed_sets.id` exists (`SET-YYYYMMDD-XXXXXX`). No Zoho custom Set module is referenced anywhere. | Both the Zoho-side module and the mapping are absent. `managed_sets.zoho_product_id` targets the **Products** module, not a Set module. |
| **AssetEngine Product ID ↔ Zoho Product ID** | **NO** | No AssetEngine Product ID exists. Zoho side is `zoho_catalog.zoho_product_id`. | The entire left-hand side is missing. |
| **AssetEngine Asset ID ↔ AssetEngine Product ID** | **NO** | `assets.id` exists. No product FK. | No column can express "this asset is an instance of this product". |
| **AssetEngine Asset ID ↔ Zoho Product ID** | **Partial, wrong direction** | `assets.zoho_product_id` — one writer, meaning "published as". | Records publication, not classification. Zoho holds no asset ID, so the link is single-sided and unrecoverable if lost. |
| **AssetEngine Inventory ID ↔ AssetEngine Product ID** | **NO** | `inventory_items.id` exists. | Missing. |
| **AssetEngine Inventory ID ↔ Zoho Product ID** | **YES** | `inventory_items.zoho_product_id` (+ redundant `catalog_uuid`). | Unvalidated, no FK, clearable on edit, never populated in production. |
| **AssetEngine Project ID ↔ Zoho Deal ID** | Columns only | `projects.zoho_deal_id`, `zoho_project_id_key`. | Writer is inoperative (§4.5). |

### 15.2 Verdict

Of the seven links, **one works** (Inventory ↔ Zoho Product, inbound), **one exists in reverse** (Asset → Zoho Product as publication), and **five are entirely absent** — every link that would pass through an AssetEngine Product ID, plus the whole Set-module chain.

The missing middle is the same in every case: **there is no AssetEngine Product ID.** Every chain in the brief routes through it.

---

## 16. Field Mapping Table

Direction key: **→Z** push to Zoho · **Z→** pull from Zoho · **—** no mapping.

| Concept | AssetEngine source | Zoho field | Current? | Direction | Notes |
|---------|--------------------|------------|----------|-----------|-------|
| Product Name (push) | `assets.itemname` | `Product_Name` | **Yes** | →Z | Verbatim; no uniquification (`zohoService.js:545`) |
| Product Name (pull) | `zoho_catalog.product_name` | `Product_Name` | **Yes** | Z→ | Fallback `'Unnamed Product'` (771). May contain newlines |
| Product Code / SKU (push) | — | `Product_Code` | **No** | — | Never sent, though `zoho_catalog.sku` is pulled |
| Product Code / SKU (pull) | `zoho_catalog.sku` | `Product_Code` | **Yes** | Z→ | Populated on 3 of 202 rows — unusable as a match key |
| Description (push) | `buildAssetDescription()` | `Description` | **Yes** | →Z | Kit form embeds child serials as ciphertext (497) |
| Description (pull) | `zoho_catalog.description` | `Description` | **Yes** | Z→ | |
| Make (push) | `assets.make` | `Make` (custom) | **Yes** | →Z | `addKeyValue` (550) |
| Make (pull) | `zoho_catalog.make` | `Make` (custom) | **Yes** | Z→ | 202/202 populated |
| Model (push) | `assets.model` | `Model` (custom) | **Yes** | →Z | `addKeyValue` (551) |
| Model (pull) | `zoho_catalog.model` | `Model` (custom) | **Yes** | Z→ | 202/202 populated |
| HSN Code (push) | `assets.hsn_code` | `HSN_Code` | **No** | — | Column exists on `assets`; never sent |
| HSN Code (pull) | `zoho_catalog.hsn_code` | `HSN_Code` | **Yes** | Z→ | 2/202 populated |
| Unit Price (push) | `parseFloat(assets.asset_value \|\| 0)` | `Unit_Price` | **Yes** | →Z | Sends `0` when null — can zero a Zoho price |
| Unit Price (pull) | `zoho_catalog.unit_price` | `Unit_Price` | **Yes** | Z→ | 201/202 are `0.00` |
| **Zoho Product ID** | `assets.zoho_product_id` | record `id` | **Yes** | Z→ (write-back) | Sole writer `zohoService.js:901` |
| **Zoho Product ID** | `inventory_items.zoho_product_id` | record `id` | **Yes** | Z→ (client-supplied) | `server.js:5029`, unvalidated |
| **Zoho Product ID** | `managed_sets.zoho_product_id` | record `id` | **Column only** | — | No writer (`kitSetService.js:246`) |
| **AssetEngine Product ID** | — | — | **Does not exist** | — | No product entity |
| **AssetEngine Asset ID** | `assets.id` | — | **No** | — | Never sent. Zoho holds no AE identifier |
| **AssetEngine Inventory ID** | `inventory_items.id` | — | **No** | — | Never sent |
| **AssetEngine Set ID** | `managed_sets.id` | — | **No** | — | Never sent |
| Catalog UUID | `inventory_items.catalog_uuid` | — | Local only | — | `ZCAT-` + Zoho ID (`inventory.js:1565`) |
| Serial number | `assets.srno` (encrypted) | inside `Description` | **Yes, unintended** | →Z | Kit branch only; ciphertext |
| Quantity | `quantity_total` / `quantity_available` | — | **No** | — | Zoho `Qty_in_Stock` never touched |
| Status / condition | `assets.status` | — | **No** | — | |
| Tax, category, vendor, currency | — | Zoho fields | **No** | — | Untouched by AssetEngine; survive pushes |
| `is_active` | `zoho_catalog.is_active` | — | **Column only** | — | Never written; always `true` |

**UNKNOWNs.** The Zoho-side API names of `Make`, `Model` and `HSN_Code` are inferred from `getKeyValue`/`addKeyValue` string literals and the fact that all 202 rows resolve. Their Zoho field labels, data types, picklist status and whether `HSN_Code` is standard or custom in this org were **not** verified, because that would require a live Zoho metadata call. `inspectModuleFields` (`zohoService.js:918`) exists for exactly this purpose but is not routed and was not executed.

---

## 17. Recommended Conceptual Architecture

**No implementation. This is a proposed contract for review.**

### 17.1 Is the model in the brief sufficient?

The brief proposes:

```
Product → external mapping → Zoho Product
Asset → Product
Inventory → Product
Set → Product composition → commercialized Product
```

This is **directionally right and close to sufficient**, but three additions are required or the risks in §13 reappear immediately:

1. **Provenance is not optional.** Without an origin marker on Product, loop B (§13) cannot be broken: a Product created from an asset will be pulled back and offered as a purchasable catalogue product, indistinguishable from a real one. Provenance must be a first-class column, not inferable from logs.
2. **"Set → Product composition" must split in two.** Product-level *requirement* and physical *allocation* are different lifetimes (§14.3). Collapsing them means every warehouse substitution looks like a commercial change.
3. **Field ownership must be explicit.** Products are declared co-managed by Sales and Logistics. Without a per-field owner, the existing unconditional overwrite (§11.2) will destroy Sales edits.

### 17.2 Proposed conceptual model

```
                    ┌──────────────────────────────────────────┐
                    │  product                                  │
                    │  ── AssetEngine-owned commercial identity │
                    │  id            (AE-generated, immutable)  │
                    │  name, make, model, hsn_code, sku         │
                    │  origin        ZOHO | ASSET | INVENTORY   │
                    │                | SET  | MANUAL           │
                    │  origin_ref    source AE id, nullable     │
                    │  status        ACTIVE | ARCHIVED          │
                    └───────┬──────────────────────────┬─────────┘
                            │                          │
        ┌───────────────────▼──────────┐   ┌───────────▼─────────────────┐
        │ product_external_ref          │   │ referenced BY items          │
        │  product_id                   │   │  assets.product_id       FK  │
        │  system        'ZOHO_CRM'      │   │  inventory_items.product_id  │
        │  module        'Products'      │   │  managed_sets.product_id     │
        │  external_id   Zoho record id  │   │     (commercialized set)     │
        │  sync_direction PULL|PUSH|BOTH │   └──────────────────────────────┘
        │  content_hash  last pushed     │
        │  last_pulled_at/last_pushed_at │
        │  UNIQUE (system, module, ext)  │
        └───────────────────────────────┘

  SET, in two layers
  ─────────────────────────────────────────────────────────────────
  managed_sets                     the set header
     │
     ├── set_requirement           PRODUCT level  — "what the set is"
     │      product_id, quantity, unit
     │      → this is what renders the Zoho description
     │
     └── managed_set_components    PHYSICAL level — "what is in it now"
            asset_id | inventory_item_id, quantity
            satisfies_requirement_id  (nullable link upward)
```

### 17.3 How each origin flows through the model

| Origin | Flow |
|--------|------|
| **Zoho-originated** | Pull creates/updates `product` with `origin='ZOHO'` and a `product_external_ref`. Sales owns commercial fields. |
| **AssetEngine-originated (manual)** | Logistics creates `product` with `origin='MANUAL'`; push creates the Zoho record and records the external ref. |
| **Asset-originated** | `product` with `origin='ASSET'`, `origin_ref = assets.id`; the asset also gets `product_id`. On the next pull, `origin='ASSET'` prevents it being re-presented as a purchasable catalogue product. |
| **Inventory-originated** | Same with `origin='INVENTORY'`. The write-back must not be `handleSyncResponse` (§5.6). |
| **Set-originated** | `product` with `origin='SET'`, `origin_ref = managed_sets.id`; description rendered from `set_requirement`; `content_hash` decides whether a push is needed. |

### 17.4 Minimum viable subset

If only part of this is built, the ordering that avoids rework:

1. `product` + `product_external_ref` + backfill from `zoho_catalog`. `zoho_catalog` stays as the raw mirror.
2. `assets.product_id` and `inventory_items.product_id`, nullable, additive. Keep `zoho_product_id` untouched for compatibility.
3. Route the existing push through `product` so `handleSyncResponse` stops being asset-only.
4. `set_requirement` + the link column on components.
5. Set commercialization, last — it depends on all of the above.

Steps 1-2 are additive and reversible. Nothing above should be started before the decisions in §18 are settled.

---

## 18. Open Decisions

These are business and architectural choices this audit cannot make.

| # | Decision | Why it blocks implementation |
|---|----------|-----------------------------|
| 1 | **Is `product` AssetEngine-owned or is Zoho master?** | Determines whether AE generates product IDs at all, and therefore whether §15's chains can ever exist. |
| 2 | **What happens to the two assets already pushed as Zoho Products?** | `1205624000001284002` is in the catalogue as a product; `1205624000001313001` is not. Do they become `origin='ASSET'` products, get retired in Zoho, or stay as-is? |
| 3 | **What is the product match key?** | SKU is present on 3 of 202 rows. Without a key, dedupe falls back to name, which is not unique and contains newlines. |
| 4 | **Who owns which field?** | Sales edits price/tax; Logistics owns make/model/HSN. Until agreed, every push risks destroying the other side's data. |
| 5 | **Can one Product map to several Zoho Products?** | Affects whether `product_external_ref` is 1:1 or 1:N. |
| 6 | **Can one asset be an instance of several products?** | Determines whether `assets.product_id` is a column or a join table. |
| 7 | **Should the pull propagate to items?** | Today item attributes are frozen snapshots. Propagating changes historical records; not propagating guarantees drift. |
| 8 | **What happens when a Zoho Product is deleted?** | `is_active` exists and is never written. Soft-deactivate, hard-delete, or ignore? |
| 9 | **Is `catalog_uuid` retained or retired?** | It is a derived duplicate of `zoho_product_id`. Keeping it means maintaining two encodings of one fact. |
| 10 | **Does a Set commercialize to Products, or to a Zoho Set custom module?** | The brief's identity chain names a Zoho Set module that does not exist. Creating it is a Zoho-side decision. |
| 11 | **Is `managed_set_components_asset_id_active_unique` (one active set per asset) intended?** | It blocks Super Sets and shared assets (§14.1). |
| 12 | **Should serials be removed from kit descriptions?** | Documented policy says no serials; code sends ciphertext (§5.4). |
| 13 | **Should push require a role?** | The route is JWT-only; the restriction is cosmetic (§2.2). |
| 14 | **Is the Deals path repaired or retired?** | Three independent breakages; it has never worked (§4.5). |
| 15 | **What is the pull scope?** | Full pagination, incremental by `Modified_Time`, or webhooks. Today: one page, manual, no scheduler. |

---

## 19. Implementation Phases

Sequenced so each phase is independently reviewable and reversible. **Nothing here has been executed.**

| Phase | Content | Precondition | Reversible? |
|-------|---------|--------------|-------------|
| **0. Decide** | Settle §18 items 1-6 at minimum. No code. | — | n/a |
| **1. Read-only hardening** | Pagination + `more_records` on the pull; wrap the loop in a transaction; write `is_active`; make `syncCount` report inserts *and* updates. No schema change. | Decision 15 | Yes |
| **2. Product entity** | Migration adding `product` + `product_external_ref`; backfill from `zoho_catalog`. Read paths only; no behaviour change. | Decisions 1, 3, 5 | Yes — additive |
| **3. Item linkage** | Nullable `product_id` on `assets` and `inventory_items`; dual-write alongside `zoho_product_id`; validate inbound IDs at `server.js:5029`; stop the edit path clearing the link. | Phase 2, decisions 6, 9 | Yes |
| **4. Push refactor** | Replace the asset-only `handleSyncResponse` with a product-centric write-back keyed on `product_external_ref`. Add pre-create dedupe. Implement field ownership. | Phase 3, decisions 2, 4 | Behaviour change — needs a test plan |
| **5. Inventory push** | Enable Inventory → Product → Zoho on the Phase 4 path. | Phase 4 | Yes |
| **6. Requirement layer** | `set_requirement` (product + quantity) plus `satisfies_requirement_id` on components. Set UI shows both layers. | Phase 3, decision 11 | Yes — additive |
| **7. Set commercialization** | Set → Product with `origin='SET'`; description rendered from requirements; `content_hash` gating; membership history. | Phase 6, decision 10 | Behaviour change |

### REQUIRED FUTURE CHANGES

Documented, **not made**. Each is a prerequisite for the phase shown.

| # | Change required | Phase | Reason |
|---|-----------------|-------|--------|
| 1 | Catalogue pull must paginate | 1 | One page today; two rows already stale (§4.3) |
| 2 | Pull must be transactional | 1 | Partial catalogue on mid-loop failure (§4.4) |
| 3 | `zoho_catalog.is_active` must be written | 1 | Deleted Zoho products stay selectable forever (§4.4) |
| 4 | `handleSyncResponse` must stop hardcoding `db('assets')` | 4 | Blocks every non-asset push; silent no-op risk (§5.6, §13-C) |
| 5 | CREATE must dedupe before insert | 4 | Duplicate Zoho Products today (§5.5) |
| 6 | UPDATE needs a fallback when the Zoho record is gone | 4 | Asset becomes permanently unpushable (§5.5) |
| 7 | Field-level ownership on push | 4 | Manual Sales edits are overwritten (§11.2) |
| 8 | An internal Product ID must exist | 2 | Five of seven identity chains route through it (§15.2) |
| 9 | Provenance/origin marker on Product | 2 | Only way to break loop B (§13) |
| 10 | Inbound `ZohoProductId` must be validated | 3 | Unvalidated client input (§8.2) |
| 11 | Inventory edit must stop clearing the product link | 3 | `server.js:5224` + `inventory.js:484-485` (§8.3) |
| 12 | Requirement/allocation separation | 6 | Substitution is indistinguishable from commercial change (§14.3) |
| 13 | Composition version or content hash | 7 | No way to decide whether a Zoho update is needed (§14.2) |
| 14 | Set membership history | 7 | Cannot reconstruct what a quoted Product contained (§14.2) |
| 15 | Resolve the `ZP-SAMPLE-0001` production row | 2 | Non-Zoho row with a non-numeric key, unpushable, unrefreshable (§10.3) |
| 16 | Decide on serials in kit descriptions | 4 | Ciphertext serials reach Zoho against documented policy (§5.4) |

---

## Change Report

```
FILES CHANGED:   Exactly one file — docs/PRODUCT_INTEGRATION_AUDIT.md (new)
DATABASE:        NO CHANGES   (read-only SELECT / information_schema / \d only)
ZOHO:            NO CHANGES   (no API call of any kind was made)
OAUTH:           NO CHANGES   (no credential, scope, redirect URI or token file touched)
PRODUCTION:      NO CHANGES
MIGRATIONS:      NONE created, NONE run
RESTARTS:        NONE
API WRITES:      NONE
ZOHO WRITES:     NONE
```

**Read-only commands used:** `docker exec asset-manager-db psql -U postgres -d asset_manager -c "<SELECT | \d | information_schema query>"`. Tables read: `information_schema.tables`, `information_schema.columns`, `zoho_catalog`, `assets`, `inventory_items`, `managed_sets`, `managed_set_components`, `projects`, `zoho_sync_logs`, `knex_migrations`.

**Source read:** `services/zohoService.js` (complete), `server.js` (Zoho routes 2695-2781, alias map 201-311, inventory write paths 5018-5030 / 5213-5225), `services/kitSetService.js` (160-330, 500-520), `utils.js` (93-123), `js/inventory.js` (1380-1600), `js/dashboard.js` (7805-7990, 4728-4750), `js/asset-view.js` (444-500, 640-680), `js/contextMenu.js` (397), migrations `20260717063620`, `20260717081322`, `20260720071943`, `20260730090000`, `20260804090000`, `20260824120000`, `20260825120000`.
