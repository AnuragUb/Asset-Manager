# Asset / Inventory / Set Architecture Research

**Date:** 2026-08-25
**Environment inspected:** production `192.168.6.237:8080` (`asset-manager-prod`, canonical `https://api.spvtm.com`), PostgreSQL container `asset-manager-db`, database `asset_manager`
**Nature of this pass:** research, audit and design only. No schema change, no migration, no data change, no Zoho call, no OAuth change, no production restart. All database access was `SELECT` / `\d` only. One browser inspection ran read-only DOM/JS evaluation with no form submission.
**Status:** proposals in this document are **not implemented**.

---

## 1. Executive summary

Seven findings drive everything else in this document.

**1. The 400 is a category-identity collision, not a quantity problem.** Assets and Inventory use two different, incompatible category systems that share the same two HTML `<select>` elements. `asset_kinds` is keyed by **name** (`asset_kinds_pkey PRIMARY KEY (name)`, values like `Laptop`, `RAM`); `inventory_kinds` is keyed by **id** (`IK-MISC`, `IK-1786092075396-511`). The shared modal can end up submitting an asset-side *name* where the inventory API demands an inventory-side *id*, and `POST /api/inventory/items` rejects it at `server.js:4955` with exactly `Invalid inventory category.` Two such rejections are in the production log at `2026-08-25T09:38:02.546Z` and `09:38:04.424Z`, matching the reported incident. Nothing was written: the last quantity event on the item is still from 2026-08-07.

**2. Quantity increase has no dedicated write path.** The movement API exists (`POST /api/inventory/movements`) but only `CONSUME` is enabled; `RECEIVE` and `ADJUST` are `enabled: false` in `inventoryMovementService.js:37-50`. So "add 9" must be expressed as "set total = 10" through the whole-item save, which re-validates folder, category, and every other field. Quantity is therefore coupled to category **by endpoint design**, not by data model.

**3. The failing request was a create, not an update.** Create-vs-update is decided solely by `form.dataset.inventoryEditId` (`dashboard.js:7917`). When that attribute is missing the payload has no `ID`, the request goes to `POST`, and the backend mints a **new** inventory id (`server.js:4972-4975`). Had the category been valid, the intended "1 → 10" edit would have created a second inventory row instead of updating the original. The 400 prevented data corruption.

**4. There is no Product entity.** `zoho_product_id` on `assets` and `inventory_items`, plus the 202-row `zoho_catalog` cache, is the only product identity in the system. There is no internal product table, no shared product key between an asset and an inventory item, and `catalog_uuid` exists on `inventory_items` but **not** on `assets`. Product-level Sets cannot be built on this without introducing a product identity first. This is the single largest architectural gap.

**5. `quantity_precision` is decorative.** It is stored on both `assets` and `inventory_items`, echoed through APIs, copied onto split children and quantity-event lines — and never used to round, validate, or format anything. Meanwhile the inventory workspace quantity inputs are hard-coded `step="1"`, units are free text (`normalizeQtyUnit` at `server.js:1687` only trims), and the one feature that actually produces decimals — the browser-side "Apply Conversion" tool — rounds to a fixed four places regardless of the item's precision (`dashboard.js:1900-1904`). Industry practice puts precision on the **item–unit-of-measure combination** with an explicit rounding rule, which is not what we have.

**6. Serial and QR identity are asset-only and structurally single-valued.** `assets.qrcode` stores a generated PNG data URL and `assets.noqr` suppresses it; `inventory_items` has **no** QR column at all. Serials live in single `srno` / `serialno` text columns with no uniqueness constraint anywhere; multiple serials are stuffed into one field when `is_batch = 1`. "Quantity N with N serials" has no representation.

**7. Sets exist twice, and neither layer models requirements.** Legacy Sets are `assets.is_set = 1` plus `parentid` on children; Managed Sets are `managed_sets` + `managed_set_components`. Managed Sets store **allocations only** — there is no product-level requirement, no completeness computation, and no set-inside-set relationship. There is also no Inventory → Asset conversion feature anywhere in the codebase.

---

## 2. Current architecture

### 2.1 Tables in scope (production `asset_manager`, 51 tables total)

| Table | Role | Rows (2026-08-25) |
|---|---|---|
| `assets` | Individually identified items; also carries quantity, set and QR columns | 4 |
| `asset_kinds` | Asset category tree, **PK = `name`**, `parentname` self-reference | 11 |
| `folders` | Asset folder tree, keyed by `id`, referenced by **name** in the UI | 2 |
| `inventory_items` | Quantity-held items | 1 |
| `inventory_kinds` | Inventory category tree, **PK = `id`**, FK to `inventory_folders` | 2 |
| `inventory_folders` | Inventory folder tree | 1 |
| `inventory_components` | Sub-parts of an inventory item (`noqr` forced to 1) | 0 |
| `inventory_quantity_events` / `inventory_quantity_event_lines` | Inventory quantity history | 2 / — |
| `quantity_events` / `quantity_event_lines` | Legacy asset quantity history | 1 / — |
| `components` | Sub-parts of an asset, promotable to assets | 0 |
| `asset_hierarchy` | Separate parent/child hierarchy table | — |
| `managed_sets` / `managed_set_components` | Managed Set layer | 7 / 12 |
| `zoho_catalog` | Cached Zoho product catalog | 202 |

### 2.2 Entity relationships as they exist today

```
zoho_catalog (202 products, cache only)
   │  zoho_product_id (string, no FK)
   ├────────────► assets.zoho_product_id            (no catalog_uuid column)
   └────────────► inventory_items.zoho_product_id    + catalog_uuid

assets ──parentid──► assets            (sub-asset, split child, and legacy Set membership — all three)
assets ──is_set=1                       (legacy "this row is a Set")
assets ──quantity_parent_id/root_id──► assets   (quantity tree, separate from parentid)

inventory_items ──parentid──► inventory_items      (linked children, single parent only)
inventory_items ──quantity_root_id──► inventory_items

managed_sets ──► managed_set_components ──► assets.id  XOR  inventory_items.id
```

### 2.3 Relevant API surface

| Method | Path | Notes |
|---|---|---|
| POST | `/api/inventory/items` | Create. Requires `FolderID` + `KindID` valid in `inventory_kinds`. `server.js:4940` |
| PUT | `/api/inventory/items/:id` | Full-row overwrite, same category validation. `server.js:~5100` |
| GET | `/api/inventory/movements/types` | Lists movement registry including disabled types |
| POST | `/api/inventory/movements` | Apply movement — **only `CONSUME` enabled** |
| GET | `/api/inventory/quantity-events/:id` | Quantity history |
| POST | `/api/assets/make-set` / `break-set` | Legacy Set create / dismantle, `server.js:6653` / `6852` |
| GET/POST/PATCH/DELETE | `/api/managed-sets*` | Managed Set layer (`services/kitSetService.js`) |
| GET | `/api/zoho/catalog` | Catalog cache read; catalog product can be opened as a new inventory item |

---

## 3. Current error investigation

### 3.1 The trace

| Step | Location |
|---|---|
| Frontend file | `web-app/asset-manager-frontend/js/dashboard.js` (shared `addAssetItemForm` submit handler), with the modal opened by `web-app/asset-manager-frontend/js/inventory.js` |
| Frontend function | submit handler at `dashboard.js:7810` onward; inventory branch at `dashboard.js:7837`; payload built at `dashboard.js:7916`; modal opened by `openInventorySharedModal` (`inventory.js:425`) and hierarchy filled by `populateInventoryHierarchyInSharedModal` (`inventory.js:367`) |
| HTTP method / URL | `POST /api/inventory/items` (chosen at `dashboard.js:7982-7987` because `inventoryPayload.ID` was falsy) |
| Backend route | `server.js:4940` `app.post('/api/inventory/items', authenticateJWT, authorizeRoles('superuser','admin','manager'), …)` |
| Validation order | item name → folder present → category present → **category exists in `inventory_kinds`** → category belongs to folder |
| Failing condition | `server.js:4954-4955` |
| Database operation | none — the request fails before `db('inventory_items').insert(...)` at `server.js:4982` |

### 3.2 Exact backend validation

```4949:4961:web-app/asset-manager-backend/server.js
    const kindId = item.KindID || item.kindid || null;
    const folderId = item.FolderID || item.folderid || null;
    if (!folderId) return res.status(400).json({ error: 'Folder is required for inventory items.' });
    if (!kindId) return res.status(400).json({ error: 'Category is required for inventory items.' });

    const kindRow = await db('inventory_kinds').where('id', kindId).first();
    if (!kindRow) return res.status(400).json({ error: 'Invalid inventory category.' });

    const normalizedKind = normalizeResult(kindRow);
    const kindFolderId = normalizedKind?.FolderId || normalizedKind?.folderid || null;
    if (kindFolderId && String(kindFolderId) !== String(folderId)) {
      return res.status(400).json({ error: 'Selected category does not belong to the selected folder.' });
    }
```

The identical block exists in the update route at `server.js:5119-5129`, so a legitimate `PUT` would have failed the same way.

### 3.3 Exact request payload (shape)

The payload is the object built at `dashboard.js:7916-7980`. Only the fields that decide the outcome matter:

```json
{
  "ID": undefined,                      // dashboard.js:7917 — absent ⇒ POST/create
  "FolderID": "<value of #itemFolder>",  // dashboard.js:7818
  "KindID":   "<value of #itemKind>",    // dashboard.js:7819  ← rejected
  "ItemName": "<item name>",
  "is_quantity_tracked": 1,
  "quantity_unit": "Nos",
  "quantity_total": 10,                  // the intended 1 + 9
  "quantity_available": <min(total, prior available)>,
  "quantity_precision": 0,
  "components": [], "linkedIds": []
}
```

Request bodies are not logged in production, so the literal `KindID` string from the incident is not recoverable from logs. The access log does confirm the requests: `2026-08-25T09:38:02.546Z - POST /api/inventory/items 400 12ms` and `09:38:04.424Z - POST /api/inventory/items 400 5ms` (two submit clicks).

### 3.4 Valid inventory categories currently supported

There is no enum in code; validity means "a row in `inventory_kinds`". Production contains exactly two:

| `id` | `name` | `folderid` |
|---|---|---|
| `IK-MISC` | Misc | `IF-INBOX` |
| `IK-1786092075396-511` | Korban | `IF-INBOX` |

Valid folders: `IF-INBOX` (Inbox) only. For comparison, the asset side offers eleven categories keyed by name (`Antivirus`, `Apple`, `Computing Devices`, `Hardware`, `Keyboard`, `Laptop`, `License`, `Mouse`, `Peripherals`, `RAM`, `Windows License`) inside folders named `Cineom Assets` and `Sample`.

### 3.5 Why the existing Inventory record is considered invalid

**It is not.** The stored row is valid and untouched:

```
id=MIS-MUM-0826-H4XVLL-W  itemname=Test  kindid=IK-MISC  folderid=IF-INBOX
type=Misc  category=Misc  is_quantity_tracked=1
quantity_total=3  quantity_available=1  quantity_precision=0  quantity_unit=Nos
```

`kindid` satisfies the foreign key `fk_inventory_items_kindid_inventory_kinds`. What failed validation was the **category value in the submitted payload**, not the stored record. Three mechanisms in the frontend can produce a truthy-but-invalid `KindID`, and all three are present in the current code:

**Mechanism A — sticky inventory routing (confirmed live).** `inventory.js:482` sets `window.__inventoryModalActive = true` and **nothing anywhere resets it to false**. `dashboard.js:7815` gives that flag precedence over `form.dataset.entity`, so after any inventory item has been opened once in a page session, every later submit of the shared modal is routed to the inventory API — including asset saves. I verified this in the live browser without submitting anything: after opening the inventory modal and then re-opening the asset modal, `form.dataset.entity` was back to `"asset"` while `window.__inventoryModalActive` was still `true`. An asset save in that state sends asset-side names (`FolderID: "Cineom Assets"`, `KindID: "Laptop"`) to the inventory route, producing exactly this 400.

**Mechanism B — asset hierarchy overwriting the inventory hierarchy (race).** `openInventorySharedModal` calls `window.openAddItemModal('Inventory')` and then immediately fills the two selects with inventory ids (`inventory.js:514`). But `openAddItemModal` starts `syncHierarchyData()` (`dashboard.js:6170-6236`), which may `await window.loadAssetKinds()` and re-schedules itself every 400 ms up to fifteen times until `window.allFolders` is populated. When it finally runs it **rewrites both selects with asset folder/kind names** (`dashboard.js:6198-6206`, `6127-6133`) and rebinds `folderSelect.onchange` to the asset logic. Any inventory save that happens after that lands with asset-side name values.

**Mechanism C — hierarchy never loaded.** The inventory selects are built from module state populated only by `loadInventoryWorkspace()` (`inventory.js:2156-2167`). When the modal is opened from a context that never loaded that state — for example an inventory item opened from the Sets view — `rebuildKinds` produces no options and `kindSelect.value = 'IK-MISC'` silently fails. I reproduced this empty state in the live browser: both selects contained a single empty option. This variant normally surfaces as the client-side toast "Category is required" (`dashboard.js:7841`) rather than the 400, but it is the same root defect.

A fourth, independent contributor explains why the request was a create: `ID: form.dataset.inventoryEditId || undefined` (`dashboard.js:7917`), and that attribute is deleted whenever the asset modal is reset (`dashboard.js:6020`).

### 3.6 Is quantity modification incorrectly coupled to inventory category?

Yes, though indirectly. The coupling is not in the data model — `inventory_items.quantity_total` has no dependency on `kindid` — it is in the **write API shape**:

- The only UI-reachable way to raise quantity is a full-item save, which re-validates folder and category (`server.js:4949-4961` and `5115-5129`).
- The purpose-built alternative is disabled: `RECEIVE` and `ADJUST` are registered but `enabled: false` (`inventoryMovementService.js:37-50`); only `CONSUME` is live and the UI calls it just for consumption (`inventory.js:2012`).
- The update route is also **destructive by omission**: it writes `srno: item.SrNo || null`, `zoho_product_id: item.ZohoProductId || null`, `catalog_uuid: … || null` (`server.js:5185`, `5224-5225`). A partial payload silently clears serial numbers and the product link. A quantity-only edit therefore carries risk far beyond quantity.

### 3.7 Classification

A combination, with the weight on data model and API design:

| Layer | Defect |
|---|---|
| **Data model** (primary) | Two category systems with different key strategies — `asset_kinds` keyed by name, `inventory_kinds` keyed by id — and no shared abstraction |
| **API design** (primary) | No enabled quantity-delta endpoint; quantity edits must pass whole-entity validation; `PUT` overwrites unspecified fields with defaults |
| **UI state** (trigger) | One form serving two entities, a never-reset global mode flag, an async hierarchy loader that overwrites the other entity's options, and create-vs-update inferred from a DOM dataset attribute |
| **Error reporting** (aggravating) | The message names the category but not the offending value, and no request body is logged, so the operator cannot see that an asset-side value was sent |

**Not fixed in this pass, as instructed.** Recommended fix sequence is in §22 (Phase 1).

---

## 4. Inventory quantity model

### 4.1 Columns on `inventory_items`

| Column | Type | Meaning in practice |
|---|---|---|
| `is_quantity_tracked` | integer | Master switch. When 0, both quantities are forced to 0 (`server.js:4966-4969`) |
| `quantity_total` | double precision | Nominal holding |
| `quantity_available` | double precision | Unconsumed / unreserved portion; clamped to `min(total, prior available)` by the frontend (`dashboard.js:7910-7914`) |
| `quantity_precision` | integer | Stored, never applied — see §5 |
| `quantity_unit` | varchar | Free text, only trimmed (`server.js:1687-1690`); default `Nos` |
| `quantity_note` | text | Free text |
| `conversion_unit`, `conversion_factor`, `conversion_mode` | varchar/double/varchar | Captured and persisted. The backend never converts anything; conversion happens **in the browser before save** — "Apply Conversion" (`dashboard.js:1873-1917`) rewrites the quantity field and the unit field, then the normal save persists the rewritten values. Default mode `multiply` (`server.js:6384`, `9077`) |
| `quantity_parent_id`, `quantity_root_id` | varchar | Quantity tree. On create, root is set to the row's own id (`server.js:5032`); parent is always `null` on create |
| `quantity_updated_at` | varchar | Touched on every save, including metadata-only saves |
| `is_batch` | integer | "This row represents multiple serials" — see §7 |

`assets` carries a parallel set (`quantity_total`/`quantity_available` as `real`, `quantity_precision`, `quantity_unit`, `is_quantity_tracked`, `is_batch`, `quantity_parent_id`, `quantity_root_id`), so quantity semantics are duplicated across two tables with different numeric types.

### 4.2 Write paths

**Create** (`server.js:4940-5034`): validates name, folder, category; defaults `quantity_total` to 1 when tracked and nothing supplied (`server.js:4968`); `quantity_available` falls back to total; `quantity_root_id` = own id.

**Update** (`server.js:~5100-5357`): same category validation, then a full-row `update()`. Quantity resolution is deliberately careful about zero (comment at `server.js:5140-5143`): explicit `undefined`/`null` checks rather than `||`, so `0` and `0.25` can be saved. Available is preserved unless explicitly sent, to avoid phantom `ADJUST` history.

**Events** (`server.js:5304-5355`): `detectInventoryMeaningfulChanges` compares previous and next, `resolvePrimaryInventoryEventType` picks one event type, and `recordInventoryQuantityEvent` writes one `inventory_quantity_events` row plus a line carrying `deltaTotal` / `deltaAvailable`. Production history for the only item is `INIT` (2026-08-07T04:11:11Z) and `ADJUST` (2026-08-07T08:41:45Z) — confirming the 2026-08-25 attempt never wrote.

**Movements** (`server.js:4810-4830` → `services/inventoryMovementService.js`): registry of ten movement types; only `CONSUME` is enabled; it decrements available and total, can set status `Consumed`, and records an event with negative deltas. For a non-tracked item it forces `amount = 1` and consumes the whole row by status change (`inventoryMovementService.js:244-247`).

### 4.2a Assets and Inventory apply quantity events differently

This asymmetry matters for any future reconciliation and is easy to miss because the two subsystems share field names and UI controls.

| | Assets | Inventory items |
|---|---|---|
| Event tables | `quantity_events` / `quantity_event_lines` | `inventory_quantity_events` / `inventory_quantity_event_lines` |
| Are events the mechanism of change? | **Yes.** `applyQuantityEvent` (`server.js:1996-2056`) inserts the line **and** applies `COALESCE(quantity_total,0) + delta` in the same transaction | **No.** `recordInventoryQuantityEvent` (`server.js:4560-4618`) only inserts audit rows; the row was already updated by the handler |
| Read API | `/api/quantity/events/:rootId` | `/api/inventory/quantity/events/:rootId` |
| Quantity edit via entity `PUT` | Updates columns directly and writes **no** quantity event (`server.js:9079-9110`, and the removed INIT block at `9182-9207`) | Updates columns, then writes one event with computed deltas (`server.js:5304-5355`) |
| Event-driven adjust | `POST /api/quantity/adjust`, admin-only, atomic via `applyQuantityEvent` (`server.js:7174-7199`) | none enabled |

Two consequences: inventory quantities **cannot be reconstructed by replaying events** (the deltas are descriptive, not authoritative), and asset quantity edits made through the normal edit modal leave no row in `quantity_events` at all. `quantity_note` also exists only on `inventory_items`; on assets the same form field becomes an event note and is never persisted (`server.js:6424`).

### 4.3 What "increase quantity by 9" does today

There is no delta operation. The UI sets an absolute total (`quantity_total: 10`), the backend computes `deltaTotal = next - prev` for history, and the whole item is re-validated and re-written. Concurrency is unguarded: two operators computing "1 + 9" from stale reads both send `10`, and the second write wins silently.

---

## 5. Quantity precision research

### 5.1 What it currently means in AssetEngine: nothing functional

Every occurrence, traced:

| Place | What happens |
|---|---|
| `migrations/20260417060510_create_initial_schema.js:93`, `migrations/20260730090000_create_inventory_preview_tables.js:80` | Column created, default 0 |
| `server.js:5008`, `5203` | Written on inventory create/update as `Number(... || 0)` |
| `server.js:6415`, `9030`, `9080` | Written on asset create/update; asset update rounds with `Math.max(0, Number(...))` |
| `server.js:6541/6603`, `6952/7022`, `7083/7127` | Copied from parent to child during asset splits |
| `server.js:2038`, `2048`, `3513`, `3941`, `7198` | Carried on quantity-event lines and back-filled with `COALESCE(quantity_precision, ?)` |
| `server.js:8995` | Compared, to decide whether a save is "meaningful" |
| `index.html:1853-1854` | Input `type=number min=0 max=6` |
| `dashboard.js:7881`, `7950`, `8175` | Read from DOM, floored, sent |
| `inventory.js:564`, `1586` | Echoed into the form |

No rounding, truncation, validation, or formatting anywhere uses it. Three details make the contradiction concrete:

- `parseQtyNumber` (`server.js:1682-1685`) accepts any finite number and never consults precision.
- The quantity inputs disagree with each other: the inventory workspace uses `step="1"` (`inventory.js:1797`, `1801`), the shared modal's total is `step="any"` (`index.html:1850`), and the consume dialog is `step="any"` (`inventory.js:1989`).
- The one place a decimal is actually produced — the "Apply Conversion" tool — **hard-codes four decimal places and ignores precision entirely**:

```1900:1904:web-app/asset-manager-frontend/js/dashboard.js
                    if (convMode === 'divide') {
                        newQty = (currentQty / convFactor).toFixed(4);
                    } else {
                        newQty = (currentQty * convFactor).toFixed(4);
```

Units are free text with no unit table and no conversion enforcement. So today `quantity_precision` is an unenforced, per-row integer hint: `quantity = 10.125` with `precision = 0` is accepted and stored as `10.125`, and a conversion on an item with `precision = 0` will happily write `3.3333`.

### 5.2 What it means in mainstream inventory systems

| System | Where precision lives | Behaviour |
|---|---|---|
| **PeopleSoft SCM** | Item + UOM combination, on the Units of Measure page | Whole-number or decimal (4 dp); whole-number precision **requires** an associated rounding rule; an "Automatic UOM Round" business-unit switch controls rounding during conversions |
| **Oracle Fusion SCM** | System profile `INV_QUANTITY_DECIMAL_PRECISION` (default 5, up to 30) | Truncates/rounds entered and converted quantities; lowering it permanently rounds existing values; drives receipt tolerance behaviour |
| **SAP S/4HANA** | Per unit of measure (decimal places + rounding), configured centrally | Custom UOMs recommended over editing delivered ones |
| **Dynamics 365 Business Central** | `Quantity Rounding Precision` on the item card, in base UOM | Rounds quantities after UOM conversion; UOM conversion itself capped at 5 dp |
| **Visma.net, IFS** | Inventory preference (decimal places) / `Qty Calc Rounding` per part | Guidance: choose the **smallest** unit as base unit so rounding cannot drift |

Two consistent principles: precision is a property of the **item–unit-of-measure pair**, not of a stock row; and precision is meaningless without a **rounding rule** applied at the point quantities are entered or converted.

Against that standard, our implementation is not consistent: precision is per stock row, per-row-editable, has no rounding rule, is not enforced on input, and is ignored by the only code that actually performs unit conversion — which rounds to a fixed four decimals in the browser and has no server-side counterpart.

### 5.3 Where precision should be associated

The options in the brief, assessed:

| Option | Verdict |
|---|---|
| **A. Product** | Partly — the product determines which units are sensible |
| **B. Inventory item (stock row)** | **No.** Per-row precision lets two rows of the same product disagree; this is the current defect |
| **C. Unit of measure** | **Yes, primary.** `Nos` is inherently 0 dp; `Metre`, `Kg`, `Litre` need 2–3 dp |
| **D. Stock quantity** | Derived — stored values must satisfy the rule, not define it |
| **E. Transaction quantity** | **Yes, enforcement point.** Every movement validates and rounds against the rule |

**Recommendation.** Precision belongs to a **product × unit-of-measure** definition (A × C), with a rounding rule, enforced at transaction time (E), and stock quantities (D) as a consequence. Keep the existing `quantity_precision` column as a compatibility shadow of the resolved rule; stop treating it as an editable per-row field. Definition to adopt:

> **quantity_precision** — the number of decimal places in which a quantity of a given product may be expressed in a given unit of measure, together with the rounding rule applied when a transaction or unit conversion produces more decimals than allowed.

Under that definition `Nos` → precision 0, and a 10.5 `Nos` entry is rejected rather than silently stored.

---

## 6. Product / Inventory / Asset distinction

### 6.1 Definitions

| Entity | Question answered | Identity | Quantity | Serialisation |
|---|---|---|---|---|
| **Product** | *What is the thing?* | Internal product id + optional `zoho_product_id` | none (a product has no stock of its own) | none |
| **Inventory item** | *How many units do we hold?* | Inventory id (e.g. `INV-MUM-HDMI-001`) | `quantity_total` / `quantity_available` in a unit | optional, at batch level |
| **Asset** | *Which individual physical object do we own?* | AssetEngine id (e.g. `CAM-MUM-001`) | conceptually exactly 1 | typically serialised |

Product is a catalogue concept; Inventory is a stock concept; Asset is an individual-object concept. Not every product becomes an asset (an HDMI cable never does), and not every inventory item has a serial.

### 6.2 Relationships that should hold

```
Product 1 ──── 0..N Inventory item      (same product may be held in several places/units)
Product 1 ──── 0..N Asset               (two Sony FX6 bodies are two assets of one product)
Asset   0..1 ─── 0..1 Inventory item    (only when an individual unit is drawn out of stock)
```

### 6.3 What exists today

| Required link | Present? |
|---|---|
| Internal product table | **No** |
| Asset → product | Only `assets.zoho_product_id`, nullable, no FK, no `catalog_uuid` |
| Inventory → product | `inventory_items.zoho_product_id` + `catalog_uuid`, nullable, no FK |
| Asset ↔ Inventory of the same product | **Not expressible** — nothing joins them |
| Product-level Set requirement | **Not expressible** |

`zoho_catalog` (202 rows) is a cache, not a master: it has no rows for products that were never in Zoho, and both `zoho_product_id` columns are plain nullable strings. Practically, "all our Sony FX6" is answerable only by string-matching `itemname`/`make`/`model` — which is exactly the name-based matching the Zoho design must avoid.

**This is the blocking gap for Product-level Sets** (§11) and for Zoho Set sync (§14).

---

## 7. Serial number model

### 7.1 Current facts

| Aspect | Assets | Inventory |
|---|---|---|
| Columns | `srno`, `serialno` | `srno`, `serialno` |
| Storage | `srno` written through `encryptionService.encryptDeterministic` (`server.js:6360`) | plaintext (`server.js:4990`, `5185`) |
| Uniqueness | no DB constraint. Exactly one application-level check exists, and only in the Google Sheets sync path (`server.js:11788-11790` looks up `assets.srno` by deterministic ciphertext). Normal create/update does not check | none |
| Multi-serial | `is_batch = 1` + newline/comma-separated list in one field (`dashboard.js:7846-7860`) | same convention |
| Per-unit rows | **yes, via serial split**: `/api/assets/split` in serial mode loops the serial list and inserts one asset row per serial with `is_quantity_tracked: 0`, `is_batch: 0` (`server.js:11539-11591`), rewriting the parent's remaining serials and dividing `asset_value` | none |
| `serialno` column | written on some asset paths (`server.js:7640-7641`) | column exists (`20260730090000` line 64) but **no handler ever writes it** |
| Wipe risk | — | `PUT` sets `srno` to `null` when omitted (`server.js:5185`) |

Batch counting is string parsing: `qtyTotalRaw = String(batchSerialCount)` at `dashboard.js:7858-7871` — the quantity is derived from how many lines the operator typed.

### 7.2 Scenario support matrix

| Scenario | Supportable today | How / why not |
|---|---|---|
| **A** — Qty 1, one serial, one AssetEngine id | Yes | Standard asset row |
| **B** — Qty 25, no serials | Yes | Inventory row, `is_quantity_tracked = 1`, `srno` null |
| **C** — Box serial + 10 contents | No | Nothing distinguishes "container identity" from "content quantity". Closest hacks: an asset with `is_set = 1` and children, or an inventory parent via `parentid` — both overloaded (§10) |
| **D** — Qty 5 with 5 serials | Assets: partly. Inventory: no | For assets, the batch row can be **split into five asset rows**, one per serial (`server.js:11539-11591`) — but that converts quantity into five separate records rather than representing "one holding of 5 with 5 serials", and it is a one-way operation. Before the split the serials are an unsearchable, non-unique text blob. Inventory has no split at all |
| **E** — No serial, no QR | Partly | Assets: `noqr = 1` works; serial simply empty. Inventory: no QR concept at all, so "non-QR" is the only state |

### 7.3 Proposed model (not implemented)

Introduce a serial as a **first-class row**, not a column:

```
serial_identity
  id                PK
  serial_value      text        -- unique per (product, serial_value)
  product_id        FK product
  holder_type       'ASSET' | 'INVENTORY' | 'CONTAINER'
  holder_id         asset id / inventory id / container id
  status            ACTIVE | RETIRED | LOST
  is_encrypted      boolean     -- preserves today's asset encryption behaviour
  created_at / created_by
```

Consequences:

- Scenario A: one `serial_identity` per asset (migrated from `assets.srno`).
- Scenario D: five `serial_identity` rows against one inventory item whose `quantity_total = 5`; a check that "serial count ≤ quantity" replaces string-splitting.
- Scenario C: the box becomes a **container** (§15) with its own serial; contents remain an inventory quantity referencing the container.
- Uniqueness becomes enforceable: partial unique index on `(product_id, serial_value)` where `status = 'ACTIVE'`.
- `assets.srno` / `inventory_items.srno` stay as compatibility mirrors during transition; nothing is dropped.

---

## 8. QR / non-QR model

### 8.1 Current QR logic

| Question | Answer |
|---|---|
| Where generated | `qrcode.toDataURL` in `server.js` — asset create (`6339`), child/split creation (`6567`, `6987`, `7092`), bulk create (`7467`), project QR (`5710`), delivery-challan QR (`4018`); plus three dedicated endpoints: `GET /api/qr/generate/:text` (`6192`), `GET /api/qr/dynamic/asset/:id` (`6214`, no DB write), `GET /api/qr/:id` (`9744`) |
| What is encoded | `http://${STATIC_IP or local IP}:${PORT}/asset/${id}` (`server.js:6336`) — an environment-specific URL containing the AssetEngine id. `/api/qr/:id` falls back to encoding the **raw id string** when no asset or project matches (`9744-9785`) |
| Where stored | `assets.qrcode`, `projects.qrcode`, `delivery_challans.qrcode` (all text, PNG data URL) |
| Must every asset have one? | No — `assets.noqr` (default 0) suppresses generation (`server.js:6328-6330`); components and inventory components are created with `noqr = 1` (`server.js:5051`, `5256`, `5272`, `6461`); `promoteToAsset` forces `noqr = 0` (`server.js:415`) |
| Can Inventory have QR? | **No column exists** on `inventory_items`. The inventory list has a `🖨️ QR` button (`inventory.js:1087`) that calls `window.printAssetLabel`, **a function that is not defined anywhere in the repository** — the feature is a stub. Note that inventory ids *are* URL-resolvable: `/inventory/:id` serves the asset view and `/api/asset-details/:id` falls back to `inventory_items` (`server.js:2596-2600`, `3388-3397`), so an inventory QR would work today if one were issued and stored |
| Identity or lookup? | **Lookup.** The identity is the id inside the URL; the QR is a rendered pointer to a view route |
| Regeneration | Yes — `GET /api/qr/:id` regenerates and **persists** into `assets.qrcode` when the stored value is missing or is not a data URL (`server.js:9763-9780`); `/api/qr/dynamic/asset/:id` regenerates without persisting. Creation-time generation still only fires when absent (`if (!qrCode && !noQR)`). A label printed while `PORT=9090` keeps pointing at 9090 forever |
| Can a QR point at a quantity? | Not today |
| Scanning | There is no working camera scanner. `#qrScannerModal` / `#qr-reader` markup exists and `html5-qrcode` is loaded (`index.html:20`, `2594-2604`) but nothing initialises it. "Link Existing Component (QR)" and bulk-assign "Scan QR" both resolve typed ids against `window.allAssets` — no scan involved (`dashboard.js:1802-1848`, `employees.js:209-217`) |

There are in fact **two parallel QR systems**, which the target model must reconcile rather than merge blindly:

| System | Payload | Reveals | Used for |
|---|---|---|---|
| Internal tag | `http://<host>/asset/<assets.id>` | the internal AssetEngine id | operations, stored in `assets.qrcode` |
| Client-facing label | `<origin>/public/asset/<client_label>` | only `client_label` (`Kind-Location-6Digit`, set at create, `server.js:6320-6325`) | customer-visible view; generated in the browser (`asset-view.js:501-502`), never stored; the public route explicitly rejects internal id patterns (`server.js:2649-2652`) |

### 8.2 Proposed model

Treat QR as a **label pointing at an identity**, never as an identity:

```
qr_label
  id              PK
  target_type     'ASSET' | 'INVENTORY' | 'CONTAINER' | 'SET'
  target_id
  payload_kind    'URL' | 'CODE'
  payload         text        -- canonical, environment-independent: https://api.spvtm.com/a/<id>
  status          ACTIVE | REPLACED | VOID
  issued_at / issued_by / replaced_by_id
```

All four combinations become valid and explicit:

| Combination | Example | Identity | QR |
|---|---|---|---|
| Serialised + QR | Sony FX6, serial `ABC123`, `CAM-MUM-001` | AssetEngine id | asset label |
| Serialised + no QR | leased camera the owner forbids labelling | AssetEngine id | none, `noqr = 1` |
| Non-serialised + QR | bin of 200 HDMI cables with a bin label | Inventory id | inventory label (points at the *holding*, not one cable) |
| Non-serialised + no QR | consumable gaffer tape | Inventory id | none |

Design rules to adopt: QR presence is never required for a record to exist; the payload is canonical (`https://api.spvtm.com/...`) so labels survive environment changes; replacing a label voids the old row rather than overwriting, giving a reprint audit trail; scanning resolves via `qr_label` → target, so a container label can legitimately resolve to a quantity holding.

---

## 9. Current Set architecture (Managed Sets)

`managed_sets`: `id` PK, `set_code` unique, `name`, `description`, `status ∈ {DRAFT, ACTIVE, ARCHIVED}`, `zoho_product_id` (partial unique index where non-blank), audit columns, `archived_at` with a check constraint tying it to `ARCHIVED`.

`managed_set_components`: `id` PK, `set_id` FK (`ON DELETE RESTRICT`), `component_type ∈ {ASSET, INVENTORY}`, `asset_id` XOR `inventory_item_id` (check constraint), `quantity` (positive; forced to 1 when `component_type = 'ASSET'`), `sort_order`, `is_active`, timestamps. Two partial unique indexes: one asset may be active in **at most one** set globally; an inventory item may appear **once per set** but in several sets.

Semantics today: removal sets `is_active = false` (membership history is retained, no row is ever deleted — `kitSetService.js:415-428`); archiving deactivates all components and stamps `archived_at` in one transaction (`431-451`); restoring returns `ACTIVE` without reactivating components (`454-467`); re-adding a previously removed component reactivates the same row rather than inserting a duplicate, and Postgres unique violations surface as HTTP 409 (`301-412`); `set_type` / composition (`EMPTY`, `ASSET`, `INVENTORY`, `MIXED`) is **computed**, not stored (`38-44`); the list endpoint unions managed sets with legacy `assets.is_set = 1` rows tagged `source = 'legacy_asset'` and synthetic ids of the form `legacy:<assetId>` (`165-225`).

Two implementation details to keep in mind when extending this layer. There are **two migrations**: `20260824120000_create_managed_sets_tables.js` created `sets` / `set_components` and is explicitly marked unused and not to be applied; `20260825120000_create_managed_sets_v2.js` is authoritative and matches the live schema above. And `createSet` inserts `status: 'ACTIVE'` (`kitSetService.js:234-258`), so the migration's `DRAFT` default is dead — `DRAFT` exists in the check constraint but no code path produces it.

Production: 7 sets (5 `ACTIVE`, 2 `ARCHIVED`), 12 component rows of which 1 is active.

The asset-uniqueness rule matches industry norms for physical kits (Cheqroom, Itefy: an item belongs to one kit at a time), and the looser inventory rule matches Shelf.nu, which deliberately lets quantity-tracked stock belong to several kits.

**What is missing:** a requirement layer, product references on components, completeness state, set-in-set, and any link between a component's `quantity` and the stock it draws from.

---

## 10. Legacy Set architecture

| Artefact | Where used | What it means | Recommendation |
|---|---|---|---|
| `assets.is_set` | `server.js:476`, `3073-3074`, `6699/6730/6741`, `6813`, `6896`, `9083`; `dashboard.js`, `projects.js`, `asset-view.js`; set badges | "This asset row is a Set parent" | **Deprecate as a Set concept**, keep the column. Stop writing it for new Sets once Managed Sets is authoritative; keep reading it for legacy rows |
| `assets.parentid` | hierarchy, children lists, status cascade, delete guards, split children, legacy Sets | Overloaded: sub-asset, split child, **and** legacy Set membership | **Retain for true physical parent/child**; do not treat as Set membership going forward |
| `inventory_items.parentid` | `server.js:5283-5302` (`linkedIds`) | Single-parent link between inventory rows | Retain as a physical/logical link; not a Set |
| `POST /api/assets/make-set` (`server.js:6653`) | dashboard + projects Make Set modals | Promotes an asset to Set parent, attaches children, may split quantity into new asset rows | **Keep working, freeze features.** Migrate the UI entry point to Managed Sets later |
| `POST /api/assets/break-set` (`server.js:6852`) | dashboard | Clears children's `parentid`, may promote components | Keep |
| `set_price_mode` | assets + inventory | Legacy set pricing (`SUM_OF_CHILDREN`) | Keep for legacy read; excluded from the new model until pricing is designed |
| `managed_sets` / `managed_set_components` | `services/kitSetService.js`, `/api/managed-sets*` | Managed Set layer | **Extend** with requirements + allocations (§11–12) |
| `components`, `inventory_components` | `promoteToAsset` (`server.js:394`), inventory save | Sub-parts; both currently 0 rows in production | Retain as accessory lists; not Sets |

Production evidence that `is_set` and `parentid` are not interchangeable (consistent with `docs/SET_ARCHITECTURE_AUDIT.md`): `HAR-MUM-0726-55QOFA-R` has `is_set = 0` but is a parent; `HAR-MUM-0826-IEIZP5-U` has `is_set = 1` with no children.

**Nothing should be removed.** The recommendation is: Managed Sets becomes the only way to create *logical* Sets, `parentid` remains the way to express *physical* containment, and the two stop competing.

---

## 11. Proposed Product-level Set model (Layer 1 — definition)

```
managed_set                      (exists; unchanged)
managed_set_requirement          (new)
  id                PK
  set_id            FK managed_sets ON DELETE RESTRICT
  product_id        FK product            -- internal product identity (§13)
  zoho_product_id   text                  -- denormalised for sync convenience
  required_quantity numeric CHECK > 0
  unit              text                  -- resolved from product × UOM
  sort_order        int
  notes             text
  is_active         boolean
  created_at / updated_at
```

`CAMERA KIT A` becomes four requirement rows (FX6 × 2, 24-70 × 2, HDMI × 3, Battery × 4), each pointing at a product, not at a physical record. This is the "virtual kit / BOM template" pattern (Circulio, IFS Kit Definition, WebCheckout Bundles): the definition names types and quantities, and physical instances are chosen later.

Constraints worth adopting: one active requirement row per `(set_id, product_id)`; `required_quantity` validated against the product's precision rule (§5); requirements are deactivated, never deleted, once allocations reference them.

---

## 12. Proposed physical allocation model (Layer 2 — realisation)

```
managed_set_allocation           (new)
  id                  PK
  set_id              FK managed_sets
  requirement_id      FK managed_set_requirement    -- nullable for unplanned extras
  allocation_type     'ASSET' | 'INVENTORY'
  asset_id            FK assets            -- XOR
  inventory_item_id   FK inventory_items   -- XOR
  allocated_quantity  numeric CHECK > 0    -- forced to 1 when type = ASSET
  is_active           boolean
  allocated_at / allocated_by / released_at / released_by
```

Relationship to the existing table: `managed_set_components` already *is* an allocation table without a requirement pointer. The cheapest migration is to add `requirement_id` (nullable) and `allocated_quantity` semantics to it rather than create a parallel table — existing rows become "unplanned allocations" and no data moves. That decision belongs to Phase 5.

Invariants to carry forward: reuse the existing partial unique index so a serialised asset is active in at most one set; keep inventory items allowed in several sets; allocations reference existing stock rows and **never create dummy rows**.

---

## 13. Sub-set / super-set analysis

Options, with trade-offs:

| Option | Pros | Cons |
|---|---|---|
| **No nesting** | Simplest; no cycles; no depth logic; matches today's zero nested usage | "Production Package" must be modelled as one flat set; duplicated definitions |
| **Controlled depth (recommended)** | Sub-sets where they matter (Camera Kit inside Production Package) with a hard depth cap (2–3) and cycle prevention; incremental | Completeness becomes recursive; UI must show a tree; archive/delete rules need care |
| **Full recursion** | Most expressive; matches Circulio's multi-level kits | Cycle detection, unbounded traversal cost, ambiguous allocation, hard Zoho flattening, hard UI |

**Recommendation for v1: no nesting, but schema-ready.** Add nothing now; when nesting is approved, express it as a requirement whose target is a **set** rather than a product:

```
managed_set_requirement.target_type  'PRODUCT' | 'SET'
managed_set_requirement.target_set_id FK managed_sets
```

With a depth cap enforced in application code, a materialised closure check to reject cycles, recursive completeness (a parent is `COMPLETE` only when child sets are), archive cascade rules stated explicitly (archiving a child set must not silently break parents — block or warn), and Zoho flattening to leaf products for any exported set.

---

## 14. Zoho integration model

Target Zoho shape is quotation-like: a Set with product lines and quantities — i.e. exactly Layer 1. AssetEngine adds Layer 2, which Zoho does not need to see.

| Concept | Zoho side | AssetEngine side |
|---|---|---|
| Set header | Product (or custom Set module record) | `managed_sets.zoho_product_id` (already unique where non-blank) |
| Set line | Product + quantity | `managed_set_requirement.zoho_product_id` + `required_quantity` |
| Product identity | Zoho Product id | `product.zoho_product_id` (§13) — one internal product per Zoho product |
| Physical allocation | **not synced** | `managed_set_allocation` (asset ids / inventory ids) |
| Serial numbers | **never sent** | `serial_identity`, AssetEngine only |

Rules to design in now: sync keys on ids only, never names — `managed_sets.zoho_product_id` for headers, `product.zoho_product_id` for lines; the requirement table is the sync boundary, so an inbound Zoho Set creates/updates requirements and leaves allocations untouched; an outbound push sends requirement lines only; a `sync_state` / `dirty` marker on `managed_sets` avoids the current overwrite-on-next-push behaviour noted in `docs/SET_ARCHITECTURE_AUDIT.md` §6; products in Zoho with no internal product row get one created on first sync, so ids exist before Sets reference them.

Nothing here is implemented; no Zoho call was made in this pass.

---

## 15. Identity model

Six distinct identities, deliberately not interchangeable:

| Identity | Scope | Format today | Purpose | Mutable? |
|---|---|---|---|---|
| **Product id** (proposed) | Product | `PRD-…` | "What is the thing" | No |
| **Zoho Product id** | Product, external | numeric string, e.g. `1205624000001284002` | External correlation | No (owned by Zoho) |
| **AssetEngine id** | Asset | `HAR-MUM-0726-55QOFA-R` | Individual physical object | No |
| **Inventory id** | Inventory holding | `MIS-MUM-0826-H4XVLL-W` | A quantity of a product | No |
| **Serial number** | Physical unit | manufacturer string, encrypted at rest for assets | Manufacturer identity, warranty, service | Correctable |
| **Client label** | Asset, customer-facing | `Kind-Location-6Digit`, e.g. `HAR-MUM-55QOFA` | Public identity that does not leak the internal id | Set at create, treated as stable |
| **QR label** | Printed label | URL containing an AssetEngine id (internal) or a client label (public) | Physical lookup | Yes — reprintable, voidable |

Container and Set add two more: **Container id** (a physical enclosure that can hold assets and quantities, e.g. `BOX-ABC123`) and **Set id / set code** (`SET-YYYYMMDD-XXXXXX`, already generated server-side and unique).

Explicitly: a QR is not an identity, a serial is not an AssetEngine id, an Inventory id is not a physical object, and a Product id is not stock.

---

## 16. Inventory → Asset conversion analysis

**There is no Inventory → Asset conversion in the codebase.** Searches for `promote`, `convert`, `toAsset` across the inventory module return only one string, about catalog products becoming inventory (`inventory.js:1383`). The three operations that resemble conversion:

| Operation | What it actually does |
|---|---|
| **Catalog → Inventory** (`openInventoryFromCatalog`, `inventory.js:1555`) | Opens the shared modal as a **new** inventory item, prefills name/description/make/model/HSN/value from `zoho_catalog`, stashes `catalogZohoProductId` and `catalog_uuid` (`ZCAT-<id>`) on the form, defaults quantity to 1. On save, `zoho_product_id` and `catalog_uuid` persist onto the inventory row |
| **Component → Asset** (`promoteToAsset`, `server.js:394`) | Moves a row from `components` to `assets` inside a transaction, sets `noqr = 0` (so a QR is generated), logs asset history, guards against duplicates. Applies to accessories, not inventory |
| **Asset split** (`server.js:6541-7127`, `11397-11583`) | Splits a quantity-tracked asset into additional asset rows, dividing `asset_value` and copying `quantity_precision`, linking via `quantity_parent_id` / `quantity_root_id` |
| **Temporary asset → permanent asset** (`POST /api/temporary-assets/:id/make-permanent`, `server.js:8790-8865`) | The closest existing precedent for a cross-table conversion: mints a **new** asset id rather than reusing the temp id, generates a QR, copies name/make/model/value, re-links the project via `project_assets`, logs `CREATE  Temporary → Permanent` history, and **retains the source row** with `ispermanent = 1`. Notably it does **not** carry `zoho_product_id` across |

Because the feature does not exist, the questions in the brief are answered as gaps: nothing decrements inventory quantity when an asset appears; a new asset gets a fresh AssetEngine id and its own QR; serial does not transfer (and would need decrypting/re-encrypting because inventory stores plaintext and assets store deterministic ciphertext); `zoho_product_id` would not be carried unless explicitly sent; inventory quantity events and asset history remain two unlinked histories; and the source inventory row is left untouched.

Proposed design (Phase 7 candidate, not implemented): a single transactional endpoint `POST /api/inventory/items/:id/convert-to-asset` taking `{ quantity: 1, serial?, location, noqr? }` which validates available quantity, decrements `quantity_total`/`quantity_available` by exactly the converted quantity, records an inventory quantity event of a new type `CONVERTED_TO_ASSET`, creates the asset carrying `product_id`/`zoho_product_id` forward, writes a `serial_identity` row moving the serial's holder from inventory to asset, generates a QR unless `noqr`, and writes cross-references in both histories (`converted_from_inventory_id`, `converted_to_asset_id`). Converting 1 of 10 must be first-class, not an edge case.

---

## 17. Hidden assumptions discovered

| # | Assumption | Evidence | Impact |
|---|---|---|---|
| 1 | An inventory create defaults quantity to 1 | `server.js:4968` `Number(... || 1)` | Sending `0` yields 1 |
| 2 | An asset's quantity is at least 1 | `server.js:6347` `Math.max(1, ...)`; asset tracking defaults on (`6342`) | Assets cannot hold 0; conflicts with the update path's deliberate zero-preservation at `9017` |
| 3 | New assets are quantity-tracked by default | `dashboard.js:6282` `isQtyTrackedToggle.checked = true` | Serialised single assets get quantity plumbing they don't need |
| 4 | One serial ⇒ one row; many serials ⇒ one text blob | `dashboard.js:7846-7871`; `srno` single column | Scenario D unrepresentable; serials unsearchable and non-unique |
| 5 | Quantity equals the number of serial lines typed | `dashboard.js:7858-7871` | A typo in the serial box silently changes stock |
| 6 | Every inventory item must have a folder **and** a category | `server.js:4951-4955`, `5119-5123` | Any inventory write, including quantity-only, fails without a valid category |
| 7 | Category ids are interchangeable between modules | `asset_kinds` PK `name` vs `inventory_kinds` PK `id`, one shared pair of selects | **Root cause of the 400** |
| 8 | Whichever entity opened the modal last owns every later submit | `inventory.js:482` sets `__inventoryModalActive = true`, never reset; `dashboard.js:7815` | Asset saves silently routed to the inventory API |
| 9 | A string starting `IK-` or containing `misc`/`inventory` proves an inventory entity | `dashboard.js:7823-7824` | Heuristic entity detection instead of explicit mode |
| 10 | A missing `inventoryEditId` means "the user wants a new item" | `dashboard.js:7917`, deleted at `6020` | Edits become creates; duplicate rows |
| 11 | An omitted field means "clear it" | `server.js:5185`, `5224-5225` in `PUT` | Partial saves wipe serial, `zoho_product_id`, `catalog_uuid` |
| 12 | `parentid` means Set membership | make-set (`6653`), children lists, delete guards | Sub-assets and split children misread as kit members |
| 13 | `is_set = 1` means a Set exists | `server.js:476`, `3073` | Production has an `is_set = 1` row with no children and a parent row with `is_set = 0` |
| 14 | Set membership implies exclusive ownership | `managed_set_components_asset_id_active_unique` | Correct for serialised assets, deliberately not for inventory — must stay a conscious rule |
| 15 | An asset component of a set has quantity 1 | check constraint `managed_set_components_asset_quantity_check` | Correct; document rather than change |
| 16 | Precision is per stock row and needs no rounding rule | §5 | Decimal quantities accepted regardless of precision |
| 17 | Units need no validation | `server.js:1687-1690` (trim only) | `Nos`, `nos`, `NOS`, `pcs` coexist; conversion unenforceable |
| 18 | Conversion factors are informational | `conversion_*` written, never applied | Silent no-op fields in the UI |
| 19 | QR generation is idempotent and environment-free | `server.js:6330-6339` embeds IP and `PORT` | Labels printed in one environment point at that environment forever |
| 20 | Inventory never needs a QR | no `qrcode`/`noqr` column on `inventory_items` | Bin/box labelling impossible |
| 21 | A row's own id is its quantity root | `server.js:5032` | Inventory quantity trees are effectively unused, unlike assets |
| 22 | Absolute quantity writes are safe | `PUT` sets totals, no optimistic concurrency | Concurrent "1 + 9" edits silently lose one |
| 23 | Asset value divides evenly across split quantity | `server.js:11397`, `11486`, `11583` | Financial rounding drift on splits |
| 24 | Four decimal places are right for every conversion | `dashboard.js:1900-1904` `.toFixed(4)` | Conversion output ignores the item's own precision |
| 25 | Quantity events can reconstruct quantity state | `server.js:4560-4618` writes audit rows only, after the row was updated | True for assets (`applyQuantityEvent`), false for inventory; a replay-based reconciliation would silently disagree |
| 26 | Asset quantity edits are visible in quantity history | asset `PUT` writes columns and no event (`server.js:9079-9110`, removed INIT block at `9182-9207`) | Only `POST /api/quantity/adjust` produces asset quantity events |
| 27 | `quantity_total > 1` plus tracking means "batch" | `server.js:8507`; `projects.js:2101`, `2807`, `3174` | A bulk holding of 10 identical unserialised items is treated as a serial batch |
| 28 | Inventory is a test-only preview | `server.js:375-387` gate on `FEATURE_INVENTORY_ENABLED`; the preview migrations are written to run against the `asset_manager_test` database | Production `asset_manager` nonetheless contains the inventory tables and a live item, so the gate and the deployed schema disagree — see `docs/PRODUCTION_RECONCILIATION_GAP.md`. Worth confirming before any inventory migration is planned |
| 29 | Break-out clears the child's parent | `server.js:6897` sets `parentid` to the **former parent** in the promotion payload, while the full-asset branch clears it (`6905-6912`) | Two different break-out semantics depending on whether the child was a no-QR component |

Four latent defects surfaced during the audit that are not part of the reported incident and were **not** fixed here: the missing `await` on `getQuantityAsset(parentId)` at `server.js:6535` (an async call used as if synchronous, so parent validation in `/api/quantity/split` is likely ineffective); the inconsistent break-out `parentid` above; `window.printAssetLabel`, referenced by the inventory QR button (`inventory.js:1087`, `2117-2118`) but defined nowhere; and the QR scanner modal that loads `html5-qrcode` without ever initialising it.

---

## 18. Target architecture

```
                         ┌──────────────────────────┐
                         │        PRODUCT           │  internal id + zoho_product_id
                         │  (new; catalogue master) │  precision rule per UOM
                         └────────────┬─────────────┘
                     ┌───────────────┴────────────────┐
                     ▼                                ▼
            ┌────────────────┐                ┌────────────────────┐
            │     ASSET      │                │  INVENTORY ITEM    │
            │ AssetEngine id │                │  Inventory id      │
            │ quantity ≡ 1   │                │ quantity_total/avail│
            └───────┬────────┘                └─────────┬──────────┘
                    │                                    │
        ┌───────────┴───────────┐            ┌───────────┴──────────┐
        ▼                       ▼            ▼                      ▼
┌───────────────┐      ┌──────────────┐  ┌───────────────┐  ┌──────────────┐
│SERIAL IDENTITY│      │  QR LABEL    │  │SERIAL IDENTITY│  │  QR LABEL    │
│ 0..1 per asset│      │ 0..1 active  │  │ 0..N per item │  │ 0..1 active  │
└───────────────┘      └──────────────┘  └───────────────┘  └──────────────┘

            ┌──────────────────────────────────────────────┐
            │             MANAGED SET (exists)             │
            │  id / set_code / name / status / zoho id     │
            └───────────────┬──────────────────────────────┘
                            ▼
            ┌──────────────────────────────────────────────┐
            │   SET REQUIREMENT   (Layer 1 — product level)│
            │  product_id | required_quantity | unit       │
            │  (later: target_type PRODUCT | SET)          │
            └───────────────┬──────────────────────────────┘
                            ▼
            ┌──────────────────────────────────────────────┐
            │   SET ALLOCATION    (Layer 2 — physical)     │
            │  requirement_id → asset_id XOR inventory_id  │
            │  allocated_quantity (=1 for assets)          │
            └──────────────────────────────────────────────┘

            ┌──────────────────────────────────────────────┐
            │  CONTAINER (optional; physical enclosure)    │
            │  own serial + QR; holds assets and quantities│
            │  ≠ Set (logical grouping)                    │
            └──────────────────────────────────────────────┘

  Legacy, retained untouched:
    assets.parentid  →  physical parent/child and split lineage
    assets.is_set    →  legacy Set marker, read-only going forward
```

### Set completeness (computed, not stored)

Per requirement: `allocated = Σ allocated_quantity of active allocations`.

| Set state | Rule |
|---|---|
| `EMPTY` | no requirements, or every requirement has 0 allocated |
| `PARTIALLY ALLOCATED` | some requirement satisfied `0 < allocated < required` |
| `COMPLETE` | every requirement has `allocated = required` |
| `OVERALLOCATED` | any requirement has `allocated > required` |
| `ARCHIVED` | stored status, overrides the computed value |

Compute on read (the current code already computes composition this way); consider a cached column only if a set list becomes slow. `ARCHIVED` stays stored because it is an operator decision, not a derived fact. This matches IFS's kit states (Empty / Incomplete / Complete / Overcomplete).

### Set quantity semantics

Assets: each allocation is exactly 1, so "FX6 × 2" is two allocations — already enforced by `managed_set_components_asset_quantity_check`. Inventory: `required 3` may be satisfied by one item × 3 or by item X × 2 plus item Y × 1, which the proposed table supports naturally (multiple allocation rows per requirement) and the current table does **not** (one row per `(set_id, inventory_item_id)`).

Allocation stays **informational**: no reservation, no decrement of `quantity_available`. It can be compared against availability for warnings ("allocated 4 of an item with 1 available") without changing stock. Reservation, if ever wanted, is the existing disabled `RESERVE` movement type and should be a separate, explicit decision.

---

## 19. UI model

**Step 1 — Create Set.** Name (required) plus a locked, server-generated Set id, exactly as the current Create Set modal already works.

**Step 2 — Define requirements (Layer 1).** Search products (name, make/model, Zoho product id), add with a quantity and unit. Each row reads `Sony FX6 — required 2 (Nos)`. No physical record is chosen here.

**Step 3 — Allocate (Layer 2).** For each requirement, `Required: 2 · Allocated: 1` with an `[ALLOCATE]` action opening a search restricted to that product: assets by name / AssetEngine id / serial, inventory by name / inventory id / available quantity. Assets allocate one at a time; inventory takes a quantity.

Display rules: `REQUIRED` and `ALLOCATED` are always distinct columns, never merged into one count; per-requirement state chips (`0/2`, `1/2`, `2/2`, `3/2` over-allocated) and a set-level chip from the table above; a set with no requirements is `EMPTY` even if it has allocations, and those allocations render as "unplanned"; serial and QR status shown as explicit badges (`SERIALIZED` / `NON-SERIALIZED`, `QR ASSIGNED` / `QR NOT ASSIGNED`) rather than implied by a missing value; items already active in another set are excluded from asset search with the reason stated, as the current UI does.

**No-QR management.** A `QR NOT ASSIGNED` badge with an explicit "Generate QR" action for records that want one; nothing auto-generates for inventory; `noqr = 1` assets show `QR NOT REQUIRED` and are never nagged; a filter for "no QR" / "no serial" so operators can find unlabelled stock deliberately; printing a label writes a `qr_label` row so reprints are auditable.

---

## 20. Migration considerations

| Change | Nature | Notes |
|---|---|---|
| `product` table + `product_id` on `assets` / `inventory_items` | Additive | Backfill from `zoho_product_id` and `zoho_catalog` first; then a supervised name/make/model reconciliation for rows with no Zoho id. Nullable throughout — nothing becomes mandatory in one step |
| `serial_identity` | Additive | Copy `assets.srno` (keeping encryption) and `inventory_items.srno`; split `is_batch` blobs into rows in a reviewed script; keep the columns as mirrors |
| `qr_label` | Additive | Seed from `assets.qrcode` / `noqr`; canonicalise payloads to `https://api.spvtm.com/...` only for **newly issued** labels, since existing printed labels cannot be changed |
| `managed_set_requirement` | Additive | Empty at first. Existing sets are allocation-only and stay valid |
| `requirement_id` + `allocated_quantity` on `managed_set_components` | Additive, nullable | Preferred over a parallel allocation table; existing 12 rows become unplanned allocations |
| Precision / unit rules | Behavioural | Highest-risk item: enforcement can reject data that used to be accepted. Introduce as warn-only, then enforce |
| Legacy `is_set` / `parentid` | No change | Read paths keep working; only the *creation* entry point moves to Managed Sets |

Every migration must be a Knex file under `web-app/asset-manager-backend/migrations/` with a working `down()`, and must respect the inventory feature gate (`FEATURE_INVENTORY_ENABLED`, `server.js:375-387`).

## 21. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Product backfill mis-merges two distinct products | High | Match on `zoho_product_id` only; everything else needs human confirmation; keep the source columns |
| Enforcing precision/units rejects previously accepted data | High | Warn-only phase first, with a report of offending rows |
| Serial de-blobbing produces duplicates | Medium | Stage into a review table; enforce uniqueness only after cleanup |
| Two set models coexisting confuses operators | Medium | One creation path (Managed Sets); legacy rows badged `Legacy` as they already are |
| The sticky `__inventoryModalActive` flag causes further cross-entity writes before Phase 1 lands | **High, live today** | Fix early in Phase 1; until then any asset save after opening an inventory item is at risk |
| Create-instead-of-update duplicates inventory rows | **High, live today** | The 400 masked it this time; an explicit mode + server-side guard is needed |
| Requirement/allocation split doubles set write paths | Medium | Extend the existing table rather than adding a parallel one |
| QR payload canonicalisation invalidates printed labels | Medium | Never rewrite existing payloads; keep serving legacy URLs |
| Nested sets introduce cycles | Medium | Defer to a later phase; depth cap plus cycle check when it arrives |
| Zoho sync overwrites Set data | Medium | Requirement-level sync boundary plus a dirty flag before any push |
| Inventory migrations are gated to a test database name while production already carries the tables | Medium | Establish the actual provenance of the production inventory schema before writing further inventory migrations; cross-check `docs/PRODUCTION_RECONCILIATION_GAP.md` |
| Inventory quantity history cannot be replayed | Medium | Either make inventory events authoritative like `applyQuantityEvent`, or state explicitly that they are descriptive and never build reconciliation on them |

---

## 22. Recommended implementation phases

Recommendations only — none of this is implemented.

| Phase | Scope | Depends on |
|---|---|---|
| **0 — Architecture approval** | Agree §6, §15, §11–12, and the precision definition in §5. No code | — |
| **1 — Fix the quantity/category bug** | Reset `__inventoryModalActive` when the modal closes or switches entity; pass an explicit `entity` instead of heuristics; make create-vs-update explicit and reject a `POST` that duplicates an existing item; include the offending value in the error; log request bodies for inventory writes; give the two modes separate folder/category selects (or namespace the options) so asset names can never be submitted as inventory ids | 0 |
| **2 — Quantity write path** | Enable `RECEIVE`/`ADJUST` movements and drive quantity changes through `POST /api/inventory/movements` with a delta and a reason, so quantity edits stop depending on category. Make `PUT` non-destructive for omitted fields | 1 |
| **3 — Normalise Product identity** | `product` table, `product_id` on assets and inventory, backfill from Zoho ids, `catalog_uuid` parity | 0 |
| **4 — Precision and units** | Product × UOM precision with a rounding rule; unit table; enforce at transaction time; warn-only first | 3 |
| **5 — Serialisation and QR model** | `serial_identity` and `qr_label`; de-blob `is_batch`; scenarios C and D become representable; explicit no-QR/no-serial states | 3 |
| **6 — Product-level Set requirements** | `managed_set_requirement`; computed completeness; API + minimal UI | 3 |
| **7 — Physical Set allocations** | `requirement_id` / `allocated_quantity` on the existing component table; multi-item satisfaction of one requirement | 6 |
| **8 — Set UI redesign** | The three-step flow in §19, with `REQUIRED` vs `ALLOCATED` throughout | 6, 7 |
| **9 — Inventory → Asset conversion** | The transactional endpoint in §16, carrying product, serial, QR and both histories | 3, 5 |
| **10 — Nested Sets (only if approved)** | `target_type` on requirements, depth cap, cycle check, recursive completeness | 6, 7 |
| **11 — Zoho Custom Set integration** | Push requirement lines by product id; never send serials; dirty flag | 6 |
| **12 — Bidirectional sync** | Inbound Zoho Sets create/update requirements; conflict rules; allocations never touched | 11 |

Phases 1 and 2 are independent of the architectural work and are the only ones that address a live operator-facing failure.

---

## 23. Architecture decisions — direct answers

| # | Question | Recommendation |
|---|---|---|
| 1 | Should Set creation be the only supported way to create logical Sets? | **Yes.** Managed Sets becomes the only creation path; `make-set` keeps working for legacy rows but its UI entry point is retired |
| 2 | Should legacy Asset → child Asset relationships remain? | **Yes**, as physical parent/child and split lineage — not as Sets |
| 3 | Should physical parent/child containers be separate from Sets? | **Yes.** A container is a physical enclosure with its own serial and QR; a Set is a logical grouping. Different tables, different lifecycles |
| 4 | Should Sets contain Products first, physical records second? | **Yes** — requirements (Layer 1) then allocations (Layer 2) |
| 5 | Separate tables for requirements and allocations? | **Requirements: new table. Allocations: extend `managed_set_components`** with `requirement_id` and quantity semantics — cheaper and non-breaking |
| 6 | Should inventory quantity remain informational in Sets? | **Yes.** No reservation or consumption; compare against availability for warnings only |
| 7 | Should asset quantity always be 1? | **Yes** for allocation (already enforced). For asset *rows*, quantity plumbing should be phased out in favour of inventory holdings; do not default new assets to quantity-tracked |
| 8 | How should serialised quantities work? | One inventory row with `quantity_total = N` plus N `serial_identity` rows; enforce `serial count ≤ quantity` |
| 9 | How should box/container serials work? | A `container` record carrying the box serial and QR; contents are inventory quantities (or assets) referencing the container. The box is not a Set |
| 10 | How should non-QR items work? | First-class: no QR row means no label. Explicit `QR ASSIGNED` / `QR NOT ASSIGNED` / `QR NOT REQUIRED` badges; never auto-generate for inventory |
| 11 | Should Sets support nested Sets? | **Not in v1.** Design the requirement table so `target_type = 'SET'` can be added later with a depth cap and cycle check |
| 12 | How should Zoho Product ids map into Set requirements? | Requirement rows carry `product_id` with `zoho_product_id` denormalised; sync joins on ids only, never names |
| 13 | How should AssetEngine ids map into physical allocations? | Allocations reference `assets.id` XOR `inventory_items.id` by foreign key, as the current component table already does; these ids are never sent to Zoho |
| 14 | What should "quantity precision" mean? | The decimal places allowed for a product in a given unit of measure, with a rounding rule enforced on every transaction and conversion. Today it is stored and ignored |
| 15 | What is causing the "Invalid inventory category" error? | The submitted `KindID` was not a row in `inventory_kinds` (`server.js:4955`). Asset categories are keyed by **name** and inventory categories by **id**, and the two share one pair of `<select>` elements; a never-reset `__inventoryModalActive` flag and an async asset-hierarchy loader that overwrites the inventory options both let asset-side names reach the inventory API. The stored inventory record is valid; the payload was not. The request was also a create rather than an update, because create-vs-update is inferred from `form.dataset.inventoryEditId` |

---

## Appendix A — files inspected

Backend: `web-app/asset-manager-backend/server.js` (inventory CRUD `4776-5400`, `recordInventoryQuantityEvent` `4560-4618`, `applyQuantityEvent` `1996-2056`, asset create `6320-6420`, asset update `9000-9210`, quantity adjust/split/issue/consume `6524-7199`, make-set/break-set `6653-6923`, splits `11372-11591`, unsplit `11621-11713`, temp→permanent `8790-8865`, `promoteToAsset` `394-427`, QR endpoints `6192-6250` and `9744-9785`, public asset route `2649-2652`, helpers `1682-1690`, feature gate `375-387`), `services/inventoryMovementService.js`, `services/kitSetService.js`, `web-app/shared/inventoryEventSystem.js`, `web-app/shared/lifecycleModel.js`.

Migrations: `20260417060510_create_initial_schema.js`, `20260527120000_add_set_logic_to_assets.js`, `20260717063620_add_zoho_mapping_fields.js`, `20260717081322_create_zoho_catalog_table.js`, `20260723114500_expand_components_schema.js`, `20260730090000_create_inventory_preview_tables.js`, `20260730094500`, `20260730101500_inventory_components_and_qty_events_preview.js`, `20260730112000`, `20260730123000_inventory_fk_hardening_preview.js`, `20260824120000_create_managed_sets_tables.js` (superseded, not applied), `20260825120000_create_managed_sets_v2.js` (authoritative).

Frontend: `js/inventory.js` (shared-modal hierarchy `367-423`, `openInventorySharedModal` `425-620`, catalog `1379-1590`, workspace load `2156-2170`, consume `1980-2030`, QR print stub `1087`/`2117-2118`), `js/dashboard.js` (conversion tool `1873-1917`, component linking `1802-1848`, modal open/hierarchy `6017-6300`, asset prefill `6460-6470`, batch serial UI `6618-6642`, print preview `5817-5847`, submit handler `7810-8180`), `js/kitSets.js`, `js/asset-view.js`, `js/qr.js`, `js/projects.js`, `js/employees.js`, `js/main.js`, `index.html` (`20`, `1850-1854`, `2588-2604`, `2974-3010`).

Docs: `docs/SET_ARCHITECTURE_AUDIT.md`, `docs/MANAGED_SETS_ARCHITECTURE.md`, `docs/architecture/INVENTORY_MOVEMENT_SYSTEM.md`.

## Appendix B — tables inspected

`assets`, `asset_kinds`, `folders`, `inventory_items`, `inventory_kinds`, `inventory_folders`, `inventory_components`, `inventory_quantity_events`, `inventory_quantity_event_lines`, `quantity_events`, `quantity_event_lines`, `components`, `asset_hierarchy`, `managed_sets`, `managed_set_components`, `zoho_catalog` — via `\d` and `SELECT` only.

## Appendix C — external sources for §5 and §13

Oracle PeopleSoft SCM, "Understanding Rules used when Rounding" (quantity precision at item–UOM level, rounding rules, automatic UOM rounding). Oracle Fusion SCM, "Configure Decimal Precision for Quantity and Yield" and the receiving-tolerance note (`INV_QUANTITY_DECIMAL_PRECISION`). Microsoft Dynamics 365 Business Central community guidance on `Quantity Rounding Precision` and the 5-decimal UOM conversion limit. Visma.net ERP, "About units of measure and conversions" (choose the smallest unit as base unit). IFS Cloud, "Kits" (kit definition as a global template; Empty / Incomplete / Complete / Overcomplete states). Circulio, "Virtual Kits" (virtual vs physical kits; dynamic availability). Itefy, "What Vendors Actually Mean When They Say Kits" (one item per kit; template vs specific-item kits; Shelf.nu's split rule for quantity-tracked stock). Odoo and NetSuite documentation on lots versus serial numbers (serial = one unit, lot = a group).
