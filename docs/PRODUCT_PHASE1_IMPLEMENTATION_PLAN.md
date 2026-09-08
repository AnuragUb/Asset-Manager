# Product Phase 1 — Implementation Plan

**Status:** PROPOSED — awaiting approval. No code written, no migration applied.
**Date:** 27 August 2026
**Scope:** Product Foundation only.
**Environment audited:** PRODUCTION `asset-manager-prod`, database `asset_manager`, container `asset-manager-db`, port 8080 (192.168.6.237). The 9090 test instance was not used.

**Authoritative inputs**

- `docs/ASSETENGINE_CANONICAL_ARCHITECTURE.md`
- `docs/ARCHITECTURE_GAP_ANALYSIS.md`
- `docs/PRODUCT_ARCHITECTURE_DECISION.md`
- `docs/PRODUCT_INTEGRATION_AUDIT.md`
- `docs/ASSETENGINE_COMPLETE_ARCHITECTURE_AUDIT.md`

**Deliberately out of scope:** Receipt Notes, GRN, Purchase Orders, Work Orders, Customer POs, DC, Project redesign, quantity redesign, conversion, Break/Individualize, Set redesign, Subset/Super Set, rental, serial restructuring, QR redesign, and the 67 gaps recorded in the gap analysis.

---

## Table of contents

1. [Current Product-related architecture](#1-current-product-related-architecture)
2. [Exact production schema findings](#2-exact-production-schema-findings)
3. [Proposed Product schema](#3-proposed-product-schema)
4. [Product ID generation design](#4-product-id-generation-design)
5. [External mapping design](#5-external-mapping-design)
6. [Provenance design](#6-provenance-design)
7. [Name-conflict foundation](#7-name-conflict-foundation)
8. [Asset / Inventory linking](#8-asset--inventory-linking)
9. [Backfill strategy](#9-backfill-strategy)
10. [Known anomalies and handling](#10-known-anomalies-and-handling)
11. [Product API](#11-product-api)
12. [Product UI](#12-product-ui)
13. [Compatibility strategy](#13-compatibility-strategy)
14. [Files that will change](#14-files-that-will-change)
15. [Files that will NOT change](#15-files-that-will-not-change)
16. [Migration plan](#16-migration-plan)
17. [Rollback plan](#17-rollback-plan)
18. [Tests planned](#18-tests-planned)
19. [Blockers and decisions required before implementation](#19-blockers-and-decisions-required-before-implementation)
20. [Open decisions closed by this phase brief](#20-open-decisions-closed-by-this-phase-brief)

---

## 1. Current Product-related architecture

There is no Product entity in production. What exists is a Zoho mirror and two overloaded foreign-key-like columns.

**`zoho_catalog`** is the only product-shaped table. Its **primary key is the Zoho record ID**, which makes the Zoho identifier the local product identity — the exact condition `GAP-101` records as a blocker. It is written in one place, `zohoService.js:781-788` (upsert during catalogue pull), and read by `GET /api/zoho/catalog` (`server.js:2774`, `authenticateJWT`).

**`assets.zoho_product_id`** has exactly one writer: the push write-back at `zohoService.js:901-903`, which is hardcoded to `db('assets')`. It therefore means *"this asset was published into Zoho."*

**`inventory_items.zoho_product_id`** has exactly one writer path: a client-supplied value from the catalogue picker at `server.js:5029` and `server.js:5224`. It therefore means *"this item was instantiated from that Zoho product."*

Same column name, reversed causation, no discriminator — `GAP-102`. Any backfill that reads the two columns uniformly will assign provenance backwards.

**Push decision logic** lives at `zohoService.js:554-557`: `mode = parent.zoho_product_id ? 'UPDATE' : 'CREATE'`, and on UPDATE the ID passes through `toZohoRecordBigInt` (`zohoService.js:105-123`) at the single `setId` boundary. That BigInt conversion is correct and must not be regressed.

**Frontend consumers of the legacy columns:** `js/asset-view.js:459,650`; `js/dashboard.js:4732,4748`; `js/inventory.js:998,1399-1415,1465,1541,1564-1565`; `js/contextMenu.js:397`. All read `zoho_product_id` directly. None of them changes in this phase.

**`managed_sets.zoho_product_id`** exists (migration `20260825120000`, unique partial index) but `kitSetService.js:246` writes `null` and nothing ever updates it. It is dead weight, and Set commercialization is out of scope here.

**Confirmed absent from production:** `products`, `product`, `product_external_ref`, `sets`, `set_components` — all five return NULL from `to_regclass`.

---

## 2. Exact production schema findings

### 2.1 Migration state

`knex_migrations` holds **32 rows**, latest `20260825120000_create_managed_sets_v2.js`. The migrations directory holds **33 files**.

The one unapplied file is **`20260824120000_create_managed_sets_tables.js`** — the abandoned draft that creates `sets` / `set_components`, which its successor's header explicitly says "must not be applied."

**Consequence: `knex migrate:latest` is unsafe today.** It would apply the draft and create two unwanted tables in production. This is independent of Product work but it gates how the Product migration is applied (see [§16](#16-migration-plan) and blocker **B-3**).

Secondary observation: the max `knex_migrations.id` is 64 against 32 rows, so roughly half the recorded migrations were rolled back and re-applied at some point. Not a Phase 1 problem, recorded for accuracy.

### 2.2 `zoho_catalog` — actual definition

| Column | Type | Null | Default |
|---|---|---|---|
| `zoho_product_id` | varchar(255) **PK** | NO | — |
| `product_name` | varchar(255) | NO | — |
| `unit_price` | numeric | YES | `0` |
| `make` | varchar(255) | YES | — |
| `model` | varchar(255) | YES | — |
| `hsn_code` | varchar(255) | YES | — |
| `description` | text | YES | — |
| `sku` | varchar(255) | YES | — |
| `is_active` | boolean | YES | `true` |
| `last_synced_at` | timestamptz | YES | `CURRENT_TIMESTAMP` |
| `created_at` | timestamptz | YES | `CURRENT_TIMESTAMP` |

There is **no `manufacturer` column and no `unit` column**. Neither can be backfilled from Zoho; both will be NULL on every backfilled Product.

### 2.3 `zoho_catalog` — actual data quality (202 rows)

| Measure | Count |
|---|---|
| Total rows | 202 |
| Distinct `zoho_product_id` | 202 |
| Distinct `product_name` | 202 (no duplicate names) |
| Non-numeric external ID | 1 (`ZP-SAMPLE-0001`) |
| External ID also present in `assets.zoho_product_id` | 1 |
| Rows with a SKU | 3 |
| Rows with an HSN code | 2 |
| Rows with a non-zero price | 1 |
| Rows with a description | 2 |
| `is_active = true` | 202 (never written false) |

**This matters for expectations:** the backfill will create ~200 Products carrying a name, make and model and almost nothing else. That is the honest state of the Zoho catalogue, not a defect in the backfill.

It also confirms SKU cannot be a matching key (3/202) — consistent with the brief's instruction that SKU is not canonical identity.

### 2.4 Physical rows carrying a Zoho product reference

`assets` (4 rows total, all `is_deleted = 0`):

| Asset ID | Name | Make / Model | `zoho_product_id` | `is_set` |
|---|---|---|---|---|
| `APP-MUM-0526-MMKBX9-W` | Apple MacBook Air 24 | Apple / 24 Air | *(null)* | 0 |
| `APP-MUM-0526-PZ2J6E-8` | MacBook 24 Air | Apple / 24 Air | *(null)* | 0 |
| `HAR-MUM-0726-55QOFA-R` | Trimble Bullet 720 | Trimble / Bullet 720 | `1205624000001284002` | 0 |
| `HAR-MUM-0826-IEIZP5-U` | EVM 16 GB DDR4 | EVM / EVMT16G2666U88P | `1205624000001313001` | **1** |

`inventory_items` (1 row): `MIS-MUM-0826-H4XVLL-W`, `zoho_product_id` NULL, `catalog_uuid` NULL, `kindid` `IK-MISC`. **No inventory row has a Zoho product reference**, so there is nothing to backfill on the inventory side.

**New finding not present in the earlier documents:** `HAR-MUM-0826-IEIZP5-U` has `is_set = 1`. The prior analysis (`PRODUCT_ARCHITECTURE_DECISION.md` §15.3) treated it as a plain asset. It is a **legacy Set asset**, which changes its provenance question from "ASSET?" to "ASSET or SET?" — see anomaly **A-2** and blocker **B-2**.

### 2.5 Column types relevant to the migration

| Table.column | Type |
|---|---|
| `assets.id` | varchar(**255**) NOT NULL |
| `inventory_items.id` | varchar(**no length limit**) NOT NULL |
| `assets.zoho_product_id` | varchar(255) NULL |
| `inventory_items.zoho_product_id` | varchar (unbounded) NULL |
| `assets.itemname` | text NOT NULL |
| `assets.asset_value` | **real** |
| `assets.is_set` | integer |
| `users` | **no `id` column — primary key is `username` varchar(255)**; `role` varchar(255) |

Two consequences. First, `assets` and `inventory_items` disagree on varchar length for their own IDs, so the new `product_id` columns will be typed from `product.id` (varchar(255)) on both sides rather than copied from the local ID column. Second, `created_by` / `updated_by` must store a **username string with no foreign key**, matching `managed_sets` (`created_by` varchar(255) nullable) — there is no numeric user ID to reference.

### 2.6 Established conventions to follow

- **Migration style** (`20260825120000_create_managed_sets_v2.js`): `hasTable` guard before create; Knex builder for columns; `knex.raw` `ALTER TABLE ... ADD CONSTRAINT` for CHECK and UNIQUE; `knex.raw CREATE UNIQUE INDEX ... WHERE` for partial uniqueness; `onDelete('RESTRICT')` on foreign keys; `down()` drops tables in dependency order.
- **Auth** (`server.js:2789-2889`): reads use `authenticateJWT`; mutations use `authenticateJWT, authorizeRoles('superuser', 'admin', 'manager')`. Literal sub-paths are registered **before** `/:id`.
- **Service layer** (`services/kitSetService.js`): plain module exporting async functions, Knex passed via the shared `db` handle.
- **Frontend module** (`js/kitSets.js` + `js/main.js:13,875-879`): `export function initXView()`, imported with a `?v=` cache-buster, registered in the nav map as `{ view: 'dashboardView', subView: '<name>-view', init: … }`.
- **ID namespace is free:** no route matching `/api/products` exists anywhere; no `nav-products`, `products-view` or `productService` identifier exists anywhere in the codebase.

---

## 3. Proposed Product schema

Four objects. All additive. Nothing renamed, nothing dropped.

### 3.1 `product`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | varchar(255) **PK** | NO | `PRD-MMYY-XXXXXX-C`, immutable |
| `name` | varchar(255) | NO | co-managed with Zoho |
| `description` | text | YES | AssetEngine authoritative |
| `make` | varchar(255) | YES | AssetEngine authoritative |
| `model` | varchar(255) | YES | AssetEngine authoritative |
| `manufacturer` | varchar(255) | YES | AssetEngine authoritative; **no Zoho source** |
| `hsn_code` | varchar(255) | YES | AssetEngine authoritative |
| `unit` | varchar(64) | YES | AssetEngine authoritative; **no Zoho source** |
| `product_code` | varchar(255) | YES | SKU; **not unique, not required, not an identity key** |
| `price` | numeric(14,2) | YES | manual; no system owner |
| `status` | varchar(32) | NO | default `ACTIVE`; CHECK in (`ACTIVE`,`ARCHIVED`) |
| `origin` | varchar(32) | NO | CHECK in (`ZOHO`,`ASSETENGINE`,`ASSET`,`INVENTORY`,`SET`); **immutable** |
| `origin_ref` | varchar(255) | YES | source AssetEngine ID; **immutable** |
| `archived_at` | timestamptz | YES | consistency CHECK against `status` |
| `created_at` | timestamptz | NO | `now()` |
| `updated_at` | timestamptz | NO | `now()` |
| `created_by` | varchar(255) | YES | username, no FK |
| `updated_by` | varchar(255) | YES | username, no FK |

Constraints:

- `CHECK (status IN ('ACTIVE','ARCHIVED'))`
- `CHECK ((status = 'ARCHIVED' AND archived_at IS NOT NULL) OR (status <> 'ARCHIVED' AND archived_at IS NULL))` — mirrors `managed_sets`
- `CHECK (origin IN ('ZOHO','ASSETENGINE','ASSET','INVENTORY','SET'))`
- `CHECK (origin_ref IS NULL OR origin IN ('ASSET','INVENTORY','SET'))` — `origin_ref` is meaningless for `ZOHO`/`ASSETENGINE`
- `CHECK (id ~ '^PRD-[0-9]{4}-[A-Z0-9]{6}-[A-Z0-9]$')` — format enforced in the database, not only in code
- Indexes: `status`, `origin`, `lower(name)`, `(make, model)`

Deliberately **absent** per the brief: quantity, quantity_available, location, serial, QR, employee, project, set allocation, vendor/supplier, and `is_serialised` (serial policy is a later phase; adding the flag now would invite premature use).

### 3.2 `product_external_ref`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | varchar(255) **PK** | NO | |
| `product_id` | varchar(255) | NO | FK → `product.id` `ON DELETE RESTRICT` |
| `system` | varchar(32) | NO | default `ZOHO_CRM` |
| `module` | varchar(64) | NO | default `Products` |
| `external_id` | varchar(255) | NO | **string, never numeric/bigint** |
| `link_origin` | varchar(16) | NO | CHECK in (`PULL`,`PUSH`); **immutable** |
| `baseline_name` | varchar(255) | YES | last value both sides agreed on |
| `baseline_captured_at` | timestamptz | YES | |
| `last_pushed_hash` | varchar(64) | YES | hash over AssetEngine-owned fields only |
| `last_pulled_at` | timestamptz | YES | |
| `last_pushed_at` | timestamptz | YES | |
| `created_at` / `updated_at` | timestamptz | NO | `now()` |

### 3.3 `product_name_conflict`

| Column | Type | Null |
|---|---|---|
| `id` | varchar(255) **PK** | NO |
| `product_id` | varchar(255) FK → `product.id` RESTRICT | NO |
| `external_ref_id` | varchar(255) FK → `product_external_ref.id` RESTRICT | YES |
| `baseline_name` | varchar(255) | YES |
| `ae_name` | varchar(255) | NO |
| `zoho_name` | varchar(255) | NO |
| `status` | varchar(16) CHECK in (`OPEN`,`RESOLVED`) | NO |
| `detected_at` | timestamptz | NO |
| `resolved_at` | timestamptz | YES |
| `resolved_by` | varchar(255) | YES |
| `final_value` | varchar(255) | YES |

- Partial unique index: one `OPEN` conflict per `product_id`.
- `CHECK ((status = 'RESOLVED' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND final_value IS NOT NULL) OR (status = 'OPEN' AND resolved_at IS NULL))`

Phase 1 creates the structure only. No detector runs, no resolution UI, and **neither name value is ever overwritten** by anything in this phase.

### 3.4 Additive columns on existing tables

```
assets.product_id           varchar(255) NULL  FK → product.id ON DELETE RESTRICT  + index
inventory_items.product_id  varchar(255) NULL  FK → product.id ON DELETE RESTRICT  + index
```

Nullable, no default, no `NOT NULL`, no cascade, no backfill of the 3 unlinked physical rows.

**`managed_sets.product_id` is deliberately excluded.** The authoritative decision document lists it, but adding it here would be the first step of Set commercialization, which this brief excludes. Deferred to the Set phase.

---

## 4. Product ID generation design

### 4.1 The honest finding about "checksum"

**AssetEngine has no checksum convention.** There is no check-digit, Luhn, mod-97, `validateId` or `verifyId` implementation anywhere in `web-app` — verified by a case-insensitive search across the whole tree.

`IdGenerator.generateAssetId` produces `TYPE-LOC-MMYY-RAND6-EXTRA`, and its own comment at `IdGenerator.js:18` calls the final character **`"Extra random" - 1 char`**. It is a second random character, not a derived one. Nothing validates it.

The example ID in the brief, `PRD-0526-MMKBX9-W`, is character-identical in its tail to the live production asset `APP-MUM-0526-MMKBX9-W` — same `MMKBX9`, same trailing `W`. The example was therefore derived from an existing asset ID whose last character is random.

So "reuse the existing checksum convention" cannot be satisfied: there is nothing to reuse. Phase 1 must **define** a checksum for the first time, and because Product IDs are immutable forever, the algorithm needs explicit sign-off (**B-1**). What *can* be reused is the 36-character alphabet and the MMYY date component.

### 4.2 Proposed algorithm

```
ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"      // 36 chars, identical to IdGenerator.js:12
WEIGHTS  = [1, 5, 7, 11, 13, 17]                        // all coprime with 36, cycled

payload  = "PRD" + MMYY + XXXXXX                        // 13 significant characters
sum      = Σ index(payload[i]) * WEIGHTS[i % 6]
checksum = ALPHABET[sum mod 36]

id = "PRD-" + MMYY + "-" + XXXXXX + "-" + checksum      // 17 characters
```

Properties, stated precisely:

- **Every single-character substitution is detected.** Each weight is coprime with 36, so `delta * weight mod 36 ≠ 0` for any non-zero `delta` under 36.
- **Adjacent transpositions are detected** whenever the two positions carry different weights, which holds for all adjacent pairs except those straddling the 6-character weight cycle boundary.
- The namespace `PRD` is inside the payload, so a checksum computed for a different future namespace will not validate as a Product ID.
- Including the ambiguous glyph pairs `O`/`0` and `I`/`1` is a deliberate consistency choice with existing AssetEngine IDs; the checksum catches a single-glyph transcription error. The alternative — a reduced alphabet such as Crockford base32 — would make Product IDs look visibly unlike every other ID in the system. Recommendation: keep the 36-character alphabet (part of **B-1**).

### 4.3 Independence and collision handling

`MMYY` is the creation month, which never changes, so it does not violate immutability. The ID depends on **nothing else** — not make, model, manufacturer, location, SKU, kind, or Zoho ID. There is no location segment and no type segment, so Product IDs deliberately do **not** join the shared `assets`/`inventory_items` ID space produced by `generateModernAssetId`.

`XXXXXX` gives 36^6 ≈ 2.18 billion values per month bucket. Generation is nevertheless **generate-then-insert with retry on unique violation**, capped at 5 attempts, so a collision is a retry rather than a corrupted row.

Implementation: `computeProductChecksum()`, `generateProductId()` and `verifyProductId()` added to `IdGenerator.js` as new static methods, with thin re-exports from `utils.js` following the existing wrapper pattern. No existing generator is touched.

---

## 5. External mapping design

`product_external_ref` carries the Zoho relationship. `product` itself has **no** `zoho_product_id` column — that would re-create the overloading being corrected.

The brief specifies **STRICT 1:1**, which closes open decision OD-05. Both uniqueness constraints are therefore created:

```sql
-- one AssetEngine Product per Zoho record  (loop guard)
ALTER TABLE product_external_ref
  ADD CONSTRAINT product_external_ref_external_unique
  UNIQUE (system, module, external_id);

-- one Zoho record per AssetEngine Product
ALTER TABLE product_external_ref
  ADD CONSTRAINT product_external_ref_product_unique
  UNIQUE (product_id, system, module);
```

Both directions are enforced by the database, not by application logic. Identity is established **only** by `external_id`. Name, SKU, make/model and description are never used for matching — no fuzzy matching exists anywhere in the plan.

`external_id` is `varchar(255)`. Production Zoho IDs are 19 digits (`1205624000001284002`) against a `Number.MAX_SAFE_INTEGER` of 16, so they must stay strings in the database and in the API. BigInt conversion happens only at the SDK boundary, and Phase 1 does not touch `zohoService.js`, so the existing `Record.setId` / `toZohoRecordBigInt` fix is untouched by construction.

---

## 6. Provenance design

Two independent facts, as established in `PRODUCT_ARCHITECTURE_DECISION.md` §7.2:

| Fact | Column | Question answered |
|---|---|---|
| Product provenance | `product.origin` + `product.origin_ref` | How did this Product come to exist? |
| Link provenance | `product_external_ref.link_origin` | How did this Product come to be connected to that Zoho record? |

`origin` vocabulary is taken from the authoritative documents unchanged: `ZOHO`, `ASSETENGINE`, `ASSET`, `INVENTORY`, `SET`. (The decision document writes `MANUAL` for AssetEngine-user creation while the phase brief writes `ASSETENGINE`; the brief is the later instruction, so `ASSETENGINE` is used and `MANUAL` is recorded as its synonym here for cross-reading.) `link_origin` is `PULL` or `PUSH`.

**Immutability enforcement.** `product.id`, `product.origin`, `product.origin_ref` and `product_external_ref.link_origin` are protected by `BEFORE UPDATE` triggers that raise an exception when the value changes. Reasons for choosing a trigger over service-layer enforcement: the codebase already uses triggers (`trg_check_assets_dup`), the guarantee then holds against ad-hoc SQL as well as application code, and the rollback is a clean `DROP TRIGGER` / `DROP FUNCTION` in `down()`. A deliberate correction process would drop the trigger, correct, and restore it — visible and auditable rather than silent. This is decision **B-4**.

---

## 7. Name-conflict foundation

The brief requires that a name conflict be *representable*, not detected or resolved yet.

One design consequence must be flagged now: detecting "both sides changed since the last common baseline" is impossible from a hash alone. `last_pushed_hash` answers "did AssetEngine's owned fields change since the last push" but cannot reconstruct what Zoho was last known to hold. Conflict detection needs the **baseline value**, which is why `baseline_name` and `baseline_captured_at` are on `product_external_ref` (§3.2) and `baseline_name` is copied onto the conflict row.

Phase 1 behaviour: the columns exist, the backfill sets `baseline_name` to the Zoho name for pulled rows, and nothing else reads or writes them. No detector, no resolution endpoint, no UI. Confirming these three columns is decision **B-6**.

---

## 8. Asset / Inventory linking

Target shape, unchanged from the brief:

```
Asset      → product.id → product_external_ref.external_id → Zoho Product
Inventory  → product.id → product_external_ref.external_id → Zoho Product
```

Cardinality: one Product may have many Assets and many Inventory holdings; one Asset and one Inventory holding each have at most one Product. Enforced by the nullable single-valued `product_id` column plus its foreign key — no join table, and no unique constraint on `product_id` in either table.

Why the relationship survives future operations without further schema work: `product_id` is a plain attribute of the holding, so split, break, conversion and merge all propagate it by copying the value to the produced rows, and Set allocation references the holding rather than the Product. None of those operations is implemented here; the model simply does not obstruct them.

`ON DELETE RESTRICT` means a Product cannot be hard-deleted while any holding references it. Product lifecycle is archive, matching the `managed_sets` precedent.

---

## 9. Backfill strategy

### 9.1 Delivery mechanism

A **separate script**, not logic embedded in the schema migration: `web-app/asset-manager-backend/scripts/product-backfill.js`.

Rationale: the schema migration stays purely structural and therefore cleanly reversible; the backfill can be dry-run, reviewed, and re-run without touching migration state; and its classification report is the artefact needed for anomaly sign-off. Default mode is `--dry-run`; `--apply` is required to write. This is decision **B-5**.

### 9.2 Sources

Exactly two, both read by explicit ID:

1. `zoho_catalog` — 202 rows.
2. `assets.zoho_product_id` — 2 distinct non-null values.

`inventory_items.zoho_product_id` is read for completeness and currently yields nothing.

### 9.3 Classification

Every candidate external ID is placed in exactly one class. Nothing is guessed.

| Class | Rule | `origin` | `origin_ref` | `link_origin` | Expected count |
|---|---|---|---|---|---|
| **A — Zoho catalogue product** | numeric external ID in `zoho_catalog`, not referenced by any asset or inventory row | `ZOHO` | NULL | `PULL` | **200** |
| **B — round-tripped, mirrored** | external ID in `zoho_catalog` **and** in `assets.zoho_product_id` | `ASSET` | asset ID | `PUSH` | **1** |
| **C — round-tripped, not mirrored** | external ID in `assets.zoho_product_id`, absent from `zoho_catalog` | **ESCALATE** | asset ID | `PUSH` | **1** |
| **D — quarantine** | external ID fails `^[0-9]+$` | none — no Product created | — | — | **1** |

Class B and C fields are sourced from the **asset** row, not the catalogue, because AssetEngine authored those records. Class A fields come from `zoho_catalog`. `manufacturer` and `unit` are NULL in every class (no source column exists). `price` is copied from `unit_price` only when non-zero, otherwise NULL — a stored `0.00` would assert a price of zero rather than an unknown price. That choice is part of **B-5**.

### 9.4 Idempotency

Per candidate, inside one transaction:

1. `SELECT` from `product_external_ref` on `(system, module, external_id)`. If found → skip, count as `already_linked`.
2. If the class is `ESCALATE` or `QUARANTINE` → skip, add to the report.
3. Generate a Product ID, insert `product`, insert `product_external_ref`, and for classes B/C set `assets.product_id`.
4. Commit.

Re-running is a no-op because step 1 short-circuits and, independently, `UNIQUE (system, module, external_id)` makes a duplicate insert impossible even under a race. Idempotency is therefore both procedural and structural.

A `--apply` run prints and writes a report: counts per class, every created Product ID with its external ID, every skip with its reason, and every escalation.

### 9.5 Writes to existing tables

The backfill writes exactly one column on existing tables: `assets.product_id`, on **at most 2 rows** (`HAR-MUM-0726-55QOFA-R`, and `HAR-MUM-0826-IEIZP5-U` only if its escalation is resolved). No other column on `assets` is touched. `inventory_items` receives no writes. `zoho_catalog` receives no writes. Nothing is written to Zoho.

Note that this is slightly wider than the "safe first increment" described in `PRODUCT_ARCHITECTURE_DECISION.md` §1432, which wrote nothing at all to `assets`. The phase brief requires the Asset → Product relationship, so linking the two known round-tripped assets is in scope — but it is called out explicitly for approval rather than assumed (**B-7**).

---

## 10. Known anomalies and handling

### A-1 · `1205624000001284002` — AssetEngine asset round-tripped into the catalogue

Catalogue row "Trimble Bullet 720", make `Trimble`, model `Bullet 720`, created 21 Aug 2026. Asset `HAR-MUM-0726-55QOFA-R` carries the same ID with the same name, make and model, and `assets.zoho_product_id` is written only by the push write-back — so this Zoho record was **created by AssetEngine**, then pulled back into the mirror.

**Handling:** Class B. One Product, `origin = 'ASSET'`, `origin_ref = 'HAR-MUM-0726-55QOFA-R'`, `link_origin = 'PUSH'`, fields sourced from the asset. `assets.product_id` is set to the new Product.

**Explicitly not** treated as `origin = 'ZOHO'`. Because the mirror also contains it, a catalogue-only backfill would create a ZOHO-origin Product and the asset-side pass would create a second one — the duplicate the brief forbids. The single-pass classification on external ID prevents both the mislabelling and the duplicate.

### A-2 · `1205624000001313001` — asset reference absent from the catalogue, and the asset is a legacy Set

Held by asset `HAR-MUM-0826-IEIZP5-U` ("EVM 16 GB DDR4", EVM / EVMT16G2666U88P). Not in `zoho_catalog`, so the Zoho record was created after the last successful pull. This is why the backfill must read both tables.

**The new complication:** this asset has **`is_set = 1`**. It is a legacy Set represented as an asset row, and `syncAssetToZoho` is the "push a Superset/Box Set to Zoho as a Product" path. So the Zoho Product it produced is Set-derived, not plain-asset-derived. The earlier documents treated it as a normal asset.

**Handling: ESCALATE, no Product created until the origin is chosen.** The candidate answers:

- `origin = 'ASSET'` — literally true (the row lives in `assets`), keeps Phase 1 free of Set semantics, but permanently records a Set-derived Product as asset-derived.
- `origin = 'SET'` — semantically truer, but `origin_ref` would point at an `assets.id` rather than a `managed_sets.id`, and the brief excludes Set work from this phase.

Both are defensible and the brief forbids silent classification, so this is blocker **B-2**. Everything else in the backfill proceeds regardless; this is a single skipped row.

### A-3 · `ZP-SAMPLE-0001` — seeded test row in production

"Sample Catalog Product (Hardcoded)", make `CINEOM`, model `SAMPLE-MODEL-1`, SKU `SAMPLE-001`, HSN `9987`, price `25000.00`, created 6 Aug 2026. Its migration `20260804090000_seed_sample_zoho_catalog_product_preview.js` **is recorded as applied** in production, and it contains an internal `dbName !== 'asset_manager_test'` guard, yet the row is present in `asset_manager`. How it was inserted remains **UNKNOWN**.

**Handling: quarantine — no Product created.** It is not a Zoho record: the non-numeric ID would be rejected by `toZohoRecordBigInt` (`zohoService.js:119-121`), so any Product derived from it could never be pushed or reconciled. The row stays in `zoho_catalog` untouched; the backfill reports it as quarantined. Deleting it is a separate cleanup decision, not Product Foundation work.

### A-4 · Catalogue rows are commercially near-empty

200 of 202 rows have no description, 199 have no SKU, 200 have no HSN, 201 have no price, and none has a manufacturer or unit because those columns do not exist. The backfilled catalogue will look sparse. This is inherited data state, disclosed so it is not read as a migration fault. Part of **B-5**.

---

## 11. Product API

New routes in `server.js`, registered adjacent to the managed-sets block (around line 2789) and following its exact middleware conventions. Literal sub-paths precede `/:id`.

| Method | Path | Middleware |
|---|---|---|
| GET | `/api/products` | `authenticateJWT` |
| GET | `/api/products/:id` | `authenticateJWT` |
| GET | `/api/products/:id/external-refs` | `authenticateJWT` |
| POST | `/api/products` | `authenticateJWT`, `authorizeRoles('superuser','admin','manager')` |
| PUT | `/api/products/:id` | `authenticateJWT`, `authorizeRoles(…)` |
| POST | `/api/products/:id/archive` | `authenticateJWT`, `authorizeRoles(…)` |
| POST | `/api/products/:id/restore` | `authenticateJWT`, `authorizeRoles(…)` |
| POST | `/api/products/:id/external-refs` | `authenticateJWT`, `authorizeRoles(…)` |

There are **no unauthenticated Product routes**, and no existing route is modified or shadowed — `/api/products` is confirmed unused.

Behavioural rules:

- `GET /api/products` supports `q`, `status`, `origin`, `limit`, `offset`; returns each Product with its resolved Zoho external ID as a string.
- `POST /api/products` sets `origin = 'ASSETENGINE'`, ignores any client-supplied `id`, `origin`, `origin_ref`, `created_at` or `created_by`, and records `created_by` from the JWT.
- `PUT /api/products/:id` accepts only `name`, `description`, `make`, `model`, `manufacturer`, `hsn_code`, `unit`, `product_code`, `price` — an explicit allow-list. `id`, `origin`, `origin_ref`, `status` and `created_*` are rejected, with the triggers as the backstop.
- `POST /api/products/:id/external-refs` returns **409** when either uniqueness direction is violated, distinguishing "this Product already maps to a Zoho record" from "that Zoho record already maps to another Product". It performs **no Zoho API call** — it records a mapping only.
- Archive sets `status = 'ARCHIVED'` and `archived_at = now()`; restore reverses both. No hard delete, and no Zoho write either way.
- All Zoho IDs cross the API as JSON strings.

Service layer: new `services/productService.js`, following the `kitSetService.js` shape, holding all validation, ID generation with retry, and mapping-conflict detection. `server.js` handlers stay thin.

---

## 12. Product UI

One new module, proving the seven required points and nothing more.

- **`js/products.js`** — `export function initProductsView()`, plus `window.initProductsView` for parity with `kitSets.js`.
- **`index.html`** — a `nav-products` sidebar entry and a `products-view` container inside `dashboardView`.
- **`js/main.js`** — the import with a `?v=` cache-buster and a nav-map entry `'nav-products': { view: 'dashboardView', subView: 'products-view', init: … }`.

List columns: **Product ID**, Name, Make, Model, Manufacturer, Status, Origin, **Zoho Product ID** (external reference, shown as such and clearly labelled as external). Clicking a row opens a read-only detail panel showing every core field, `origin` / `origin_ref`, and the external mapping with `link_origin`.

Editing is limited to the allow-listed fields via `PUT`, and only for users whose role passes the same check as the API. No Product creation flow is required to prove the phase, though `POST` exists behind the API.

Explicitly **not** built: conflict-resolution UI, Zoho push buttons, asset/inventory linking controls, catalogue-picker changes, and any Sales-facing screen. No existing frontend module is modified beyond the two wiring lines in `main.js` and `index.html`, so no cross-domain dependency is created. Styling reuses existing classes; `static/style.css` is not expected to change.

---

## 13. Compatibility strategy

Phase 1 changes **no existing behaviour**. Nothing in the current Zoho path reads or writes the new tables.

- `zoho_catalog` remains the catalogue mirror and the source for `GET /api/zoho/catalog` and the inventory catalogue picker. Not replaced, not deleted, not written by this phase.
- `assets.zoho_product_id`, `inventory_items.zoho_product_id`, `inventory_items.catalog_uuid` and `managed_sets.zoho_product_id` all remain, keep their current meanings, and keep their current readers and writers.
- `zohoService.js` is not modified, so the pull, the push, the CREATE/UPDATE decision and the BigInt boundary are untouched.
- **No dual-write.** Introducing one now would mean changing the Zoho push, which the brief forbids. Phase 2 owns it.

### 13.1 Documented migration path for the `assets.zoho_product_id` assumptions

Every place that currently assumes `assets.zoho_product_id`, and where it must go. Recorded now so no ambiguity is left for later.

| # | Site | Current assumption | Target |
|---|---|---|---|
| 1 | `zohoService.js:554-557` | `mode = parent.zoho_product_id ? 'UPDATE' : 'CREATE'`; the same value is fed to `toZohoRecordBigInt` for `setId` | Resolve the asset's `product_id`, then look up `product_external_ref` on `(ZOHO_CRM, Products, product_id)`. Present → UPDATE with that `external_id`; absent → CREATE. BigInt conversion stays at the same single boundary. |
| 2 | `zohoService.js:901-903` | Write-back hardcoded to `db('assets')`, so a push originating from anything else would silently update the wrong table | Insert or update `product_external_ref` with `link_origin = 'PUSH'`. During transition, also mirror into `assets.zoho_product_id` for the legacy readers. Fixing the hardcoded-table defect belongs with this change, not before it. |
| 3 | `zohoService.js:781-788` | Catalogue pull upserts `zoho_catalog` only | Additionally resolve or create the Product and upsert `product_external_ref` with `link_origin = 'PULL'`, refreshing `baseline_name` and `last_pulled_at`. This is where the ongoing (non-backfill) import rule gets implemented, subject to the brief's "unlinked Zoho Products do nothing" constraint. |
| 4 | `server.js:5029` and `server.js:5224` | Inventory create copies client-supplied `zoho_product_id` / `catalog_uuid` from the picker | Resolve the Product from the picked catalogue row and set `inventory_items.product_id`; keep writing the legacy columns until the frontend readers move. |
| 5 | `js/asset-view.js:459,650`; `js/dashboard.js:4732,4748`; `js/inventory.js:998,1399-1415,1465,1541,1564-1565`; `js/contextMenu.js:397` | Read `zoho_product_id` directly off asset/inventory/catalogue payloads | Read the Zoho ID from the Product's external ref once the API exposes it on asset/inventory payloads. Purely a read-path change, safe to do last. |
| 6 | `kitSetService.js:246` and `managed_sets.zoho_product_id` | Written as `null`, never updated | Superseded by `managed_sets.product_id` plus the Product's external ref when Set commercialization is built. The legacy column is then dead and can be dropped. |

Deletion of the legacy columns is **not** proposed for any phase in this plan; it becomes possible only after site 5 is complete.

---

## 14. Files that will change

Nine files. Six new, three modified — and the three modifications are additive.

**New**

1. `web-app/asset-manager-backend/migrations/20260827120000_create_product_foundation.js` — the only schema change.
2. `web-app/asset-manager-backend/services/productService.js` — Product and mapping logic.
3. `web-app/asset-manager-backend/scripts/product-backfill.js` — dry-run-by-default backfill.
4. `web-app/asset-manager-frontend/js/products.js` — Product list and detail view.
5. `docs/PRODUCT_PHASE1_IMPLEMENTATION_PLAN.md` — this document.
6. *(optional, on request)* `web-app/asset-manager-backend/scripts/product-phase1-verify.js` — the §18.4 verification queries as one runnable check.

**Modified**

7. `web-app/asset-manager-backend/IdGenerator.js` — add `computeProductChecksum`, `generateProductId`, `verifyProductId`. No existing method touched.
8. `web-app/asset-manager-backend/utils.js` — re-export the three new helpers alongside the existing wrappers.
9. `web-app/asset-manager-backend/server.js` — `require` the service and add the eight routes near line 2789. No existing route or handler modified.
10. `web-app/asset-manager-frontend/js/main.js` — one import line, one nav-map entry.
11. `web-app/asset-manager-frontend/index.html` — one sidebar entry, one view container.

---

## 15. Files that will NOT change

Stated explicitly because the brief requires that nothing else be opportunistically fixed.

- `services/zohoService.js` — no push, pull, OAuth, scope, SDK, token or BigInt change. The hardcoded `db('assets')` write-back at 901-903 is documented in §13.1 and **left in place**.
- `services/kitSetService.js` and everything about `managed_sets` / `managed_set_components`.
- `zoho_tokens.txt`, `.env`, OAuth configuration, SDK version, `zoho_resources/`.
- Every existing migration, including the unapplied draft `20260824120000_create_managed_sets_tables.js` (see **B-3**).
- `zoho_catalog` — no schema change, no data change, no deletion.
- `assets.zoho_product_id`, `inventory_items.zoho_product_id`, `inventory_items.catalog_uuid`, `managed_sets.zoho_product_id` — all retained.
- All asset, inventory, quantity, split/unsplit, DC, project, employee, serial, QR and history code.
- `js/dashboard.js`, `js/inventory.js`, `js/asset-view.js`, `js/contextMenu.js`, `js/kitSets.js`, `js/projects.js`, `static/style.css`.
- Production ports, compose overrides, replication and backup scripts.

---

## 16. Migration plan

### 16.1 Pre-flight

1. `pg_dump` of `asset_manager` into `backups/8080_prod/` using the existing naming convention. **Mandatory.**
2. Record the baseline snapshot (§18.4 "before" column): row counts for `assets`, `inventory_items`, `zoho_catalog`, `managed_sets`, `managed_set_components`, `asset_history`, inventory quantity events; and a checksum over the asset and inventory ID/quantity/`zoho_product_id` triples.
3. Confirm `knex_migrations` still has 32 rows with `20260825120000_create_managed_sets_v2.js` last. If it does not, stop — something changed since this audit.
4. Confirm `to_regclass` for `product`, `product_external_ref`, `product_name_conflict`, `sets` and `set_components` is NULL.

### 16.2 Dry run before touching production

Restore the dump into a scratch database on the same server and run the whole sequence there first: the migration, the backfill in `--dry-run`, the backfill in `--apply`, and every §18 test. Also capture the generated DDL via Knex's `toSQL()` for line-by-line review. Production is touched only after this passes and the plan is approved.

### 16.3 Apply — single named migration, never `migrate:latest`

```
npx knex migrate:up --name 20260827120000_create_product_foundation.js
```

`migrate:up --name` runs **only** the named file (Knex 3.2.x). This is what keeps the unapplied draft `20260824120000_create_managed_sets_tables.js` from being applied. **`knex migrate:latest` must not be run on production until that draft is resolved** — see **B-3**.

Migration internals, in order, each guarded by `hasTable` / `hasColumn` so a partial re-run is safe:

1. `CREATE TABLE product` + CHECK constraints + indexes.
2. `CREATE TABLE product_external_ref` + FK + both UNIQUE constraints + CHECK.
3. `CREATE TABLE product_name_conflict` + FKs + CHECK + partial unique index.
4. `ALTER TABLE assets ADD COLUMN product_id` + FK RESTRICT + index.
5. `ALTER TABLE inventory_items ADD COLUMN product_id` + FK RESTRICT + index.
6. Immutability trigger functions and triggers on `product` and `product_external_ref`.

No `UPDATE`, no `INSERT`, no `DROP` anywhere in `up()`. The migration is structural only, which is what makes §17 clean.

### 16.4 Backfill, in two steps

```
node scripts/product-backfill.js --dry-run     # review the classification report
node scripts/product-backfill.js --apply       # after the report is signed off
```

Expected `--apply` result: **200 Products created**, 1 quarantined (`ZP-SAMPLE-0001`), 1 escalated (`1205624000001313001`), 1 asset linked (`HAR-MUM-0726-55QOFA-R`), 0 duplicates. If **B-2** is resolved beforehand, 201 Products and 2 assets linked.

### 16.5 Post-apply

Run §18.4 verification, restart the application only if required to load the new routes, then confirm the Zoho path still works using the existing `scripts/zoho-oauth-runtime-regression.js` and `scripts/zoho-filestore-oauth-smoke.js`.

---

## 17. Rollback plan

**Schema.** `down()` reverses `up()` exactly, in dependency order: drop the triggers and their functions, drop `product_name_conflict`, drop `product_external_ref`, drop `inventory_items.product_id`, drop `assets.product_id`, drop `product`. Because `up()` is purely additive and writes no data, the rollback restores the pre-migration schema exactly.

```
npx knex migrate:down --name 20260827120000_create_product_foundation.js
```

**Data.** The backfill's only write to a pre-existing table is `assets.product_id` on at most 2 rows. Two options, in order of preference:

1. `UPDATE assets SET product_id = NULL WHERE product_id IS NOT NULL;` then roll the migration down — the column is dropped anyway, so this is belt-and-braces.
2. Restore the §16.1 dump. Only warranted if something outside the plan's scope was affected.

Note the FK is `ON DELETE RESTRICT`, so dropping `product` while `assets.product_id` still holds values would fail; the `down()` sequence drops the referencing columns first, which is why the order matters.

**Application.** Removing the nav entry and the `main.js` import disables the UI with no other module affected — `products.js` is imported by nothing else. The API routes are additive, so reverting `server.js` cannot affect an existing endpoint.

**What rollback cannot undo.** Nothing. No Zoho write, no `zoho_catalog` write, no quantity change, no history write, and no legacy column change occurs anywhere in this phase.

---

## 18. Tests planned

### 18.1 Pre-migration review (no execution)

Generated DDL read line by line; every CHECK and UNIQUE confirmed against §3; `down()` confirmed to reverse `up()` object for object; confirmation that `up()` contains no DML.

### 18.2 Unit — ID generation and checksum

1. 100,000 generated IDs all match `^PRD-[0-9]{4}-[A-Z0-9]{6}-[A-Z0-9]$` and are 17 characters.
2. `verifyProductId(generateProductId())` is true for all of them.
3. Every single-character substitution in the payload of a sample of IDs is rejected — the property claimed in §4.2, tested exhaustively over all 13 positions × 35 wrong characters.
4. Adjacent transpositions rejected, with the weight-cycle boundary exception documented rather than asserted away.
5. `MMYY` matches the current month; two IDs generated in the same month differ in `XXXXXX`.
6. The generator takes no arguments and its output is unaffected by make, model, manufacturer, location, SKU or Zoho ID.
7. The database format CHECK rejects a well-formed-looking ID with a bad checksum only if checksum validation is inside the service — the CHECK covers shape, the service covers the checksum. Both are tested at their own level.

### 18.3 Integration — constraints and service behaviour

8. Duplicate `(system, module, external_id)` insert → unique violation, surfaced as HTTP 409.
9. Second mapping for the same `product_id` → unique violation, surfaced as HTTP 409 with a distinct message.
10. `UPDATE product SET origin = …` → trigger exception. Same for `origin_ref`, `id`, and `link_origin`.
11. `status = 'ARCHIVED'` with `archived_at IS NULL` → CHECK violation.
12. `origin_ref` set while `origin = 'ZOHO'` → CHECK violation.
13. Archive then restore round-trips `status` and `archived_at` correctly.
14. `PUT` with `id`, `origin` or `created_by` in the body → those fields ignored or rejected; no silent write.
15. Every mutating route without a token → 401; with an out-of-role token → 403.
16. A 19-digit `external_id` survives create → read as an identical string, with no precision loss anywhere in the JSON path.
17. `DELETE`/drop attempts against a Product referenced by an asset → RESTRICT violation.

### 18.4 Backfill and post-apply verification

18. `--dry-run` writes nothing: row counts in all three new tables unchanged.
19. `--apply` then `--apply` again: identical row counts, zero new Products, all candidates reported as `already_linked`.
20. Class assignment matches §9.3 exactly, including `origin = 'ASSET'` for `1205624000001284002` and **not** `ZOHO`.
21. `ZP-SAMPLE-0001` produces no Product row.
22. `1205624000001313001` produces no Product row until **B-2** is resolved.
23. No fuzzy matching path exists — asserted by test, by inserting two catalogue-like rows with identical names and confirming two distinct Products.

Then the brief's 15 verification points, each as an explicit before/after query:

| # | Check | Method |
|---|---|---|
| 1 | Product rows created | `COUNT(*) FROM product` = expected |
| 2 | IDs match `PRD-MMYY-XXXXXX-C` | `COUNT(*) WHERE id !~ '^PRD-[0-9]{4}-[A-Z0-9]{6}-[A-Z0-9]$'` = 0 |
| 3 | No duplicate Product IDs | primary key + `COUNT(*) = COUNT(DISTINCT id)` |
| 4 | No duplicate Zoho mappings | `COUNT(*) = COUNT(DISTINCT external_id)` in `product_external_ref` |
| 5 | Zoho Product IDs unchanged | `zoho_catalog` full-table checksum identical to baseline |
| 6 | Asset IDs unchanged | `assets.id` set identical to baseline |
| 7 | Inventory IDs unchanged | `inventory_items.id` set identical to baseline |
| 8 | Asset quantities unchanged | checksum over asset quantity columns identical |
| 9 | Inventory quantities unchanged | checksum over `quantity_total` / `quantity_available` identical |
| 10 | Asset history unchanged | `asset_history` count and max timestamp identical |
| 11 | Inventory quantity events unchanged | event table count and max timestamp identical |
| 12 | Set data unchanged | `managed_sets` and `managed_set_components` checksums identical |
| 13 | Zoho records unchanged | no Zoho write occurs in this phase; confirmed by absence of new `zoho_sync_logs` PUSH rows |
| 14 | BigInt handling intact | `zohoService.js` byte-identical; `toZohoRecordBigInt` unit test passes on `1205624000001284002` |
| 15 | Existing Zoho functionality works | catalogue pull run and compared; existing OAuth regression scripts pass |

### 18.5 UI

24. The Product list renders, paginates, and shows the AssetEngine Product ID and the Zoho ID as separate labelled columns.
25. A Product opens and shows name, description, make, model, manufacturer, HSN, unit, code, price, status, origin.
26. Every other view — dashboard, inventory, sets, projects, DC — still loads, confirming the `main.js` module graph did not break. This matters: `main.js:17` records a previous dead import aborting the whole ES module graph.

---

## 19. Blockers and decisions required before implementation

Ordered by how hard they are to reverse.

**B-1 · The checksum algorithm does not exist and must be defined — HARD BLOCKER.**
There is no check-digit implementation anywhere in AssetEngine; the trailing character of every existing ID is random by design (`IdGenerator.js:18`). Product IDs are immutable forever, so the algorithm cannot be changed after the first row is created. Needs approval of: the §4.2 weighted mod-36 scheme, and whether to keep the ambiguous-glyph 36-character alphabet for visual consistency with existing IDs or adopt a reduced alphabet.

**B-2 · Anomaly A-2 provenance: `ASSET` or `SET`? — HARD BLOCKER for one row.**
`HAR-MUM-0826-IEIZP5-U` is `is_set = 1`, so Zoho Product `1205624000001313001` is Set-derived. `origin` is immutable, and the brief forbids silent classification. Everything else can proceed; this single Product is skipped until the owner chooses. A third option exists: leave it permanently unbackfilled and handle it in the Set phase.

**B-3 · `knex migrate:latest` is unsafe on production — BLOCKER for the apply step, not the design.**
The unapplied `20260824120000_create_managed_sets_tables.js` would create the abandoned `sets` / `set_components` tables. The plan avoids it with `migrate:up --name`, which is sufficient for Phase 1, but the file remains a live hazard for anyone who runs `migrate:latest` later. Options: accept `migrate:up --name` for now; or delete/rename the draft file; or record it as applied without running it. The latter two are repo or migration-state changes outside Product scope and need explicit approval.

**B-4 · Enforce immutability with database triggers?**
Recommended, with `trg_check_assets_dup` as precedent. The alternative is service-layer-only enforcement, which leaves ad-hoc SQL unguarded. Confirm, since it adds two trigger functions to the schema.

**B-5 · Backfill shape and defaults.**
Three sub-decisions: the backfill ships as a script rather than inside the migration (recommended); `price` is NULL rather than `0.00` when the Zoho price is zero (recommended — do not assert a zero price); and it is accepted that ~200 Products will carry no description, SKU, HSN, price, manufacturer or unit because §2.3 shows no source data exists.

**B-6 · Add `baseline_name` / `baseline_captured_at` to `product_external_ref`.**
Conflict detection is impossible from `last_pushed_hash` alone; the baseline value must be stored. Three columns total across two tables, all nullable, unread in Phase 1.

**B-7 · Write `assets.product_id` on the round-tripped assets in Phase 1?**
The brief requires the Asset → Product relationship; the earlier "safe first increment" wrote nothing to `assets`. This is the only write to a pre-existing table in the whole phase: one column, at most two rows. Confirm.

**B-8 · Table naming: `product` / `product_external_ref` (singular).**
Taken verbatim from the authoritative decision document. Existing house style is plural (`assets`, `inventory_items`, `managed_sets`, `zoho_catalog`). Following the authoritative document, but flagging the inconsistency now because renaming later is a breaking change.

**Not blockers, recorded so they are not forgotten:** there is no `product_history` table in this plan (`managed_sets` has none either, and the brief does not require one — recommend Phase 2); `is_serialised` is deferred with the serial work; `managed_sets.product_id` is deferred with the Set work; and the `zohoService.js:901-903` hardcoded-table defect is documented in §13.1 and deliberately left unfixed.

---

## 20. Open decisions closed by this phase brief

Recorded so the earlier documents can be read correctly against this plan.

| ID | Question | Resolution from this brief |
|---|---|---|
| OD-01 | Who owns `name` and `description`? | `name` co-managed, with an explicit conflict state and no last-write-wins. `description` AssetEngine-authoritative, no conflict mechanism. |
| OD-02 / OD-03 | Is `code`/SKU mandatory, unique, the commercial key? | No, no, and no. Not required, not unique, not identity, not a matching key. The AssetEngine ID is sufficient. |
| OD-04 | Match policy when a pull finds no ref? | Explicit external ID only. No name, SKU, make/model or inferred matching. Unlinked Zoho Products do nothing. |
| OD-05 | 1:1 or 1:N to Zoho? | **Strict 1:1**, both directions — so both UNIQUE constraints are created. |
| OD-07 | Auto-create Products for all mirror rows? | Not as an ongoing rule. A one-time approved Phase 1 backfill only. |
| OD-14 | Push stock quantity to Zoho? | No. Product carries no quantity at all. |
| OD-16 | Who owns `unit_price`? | Manual field, no system owner in this phase, and not a historical purchase cost. |
| — | Is Vendor a Product attribute? | No. Vendor belongs to the Purchase Order. |

Still open and out of scope here: OD-06, OD-08, OD-09, OD-10, OD-11, OD-12, OD-13, OD-15, OD-17, OD-18, OD-19.

---

## STOP

No application code has been written and no migration has been applied. Awaiting review of this plan and decisions **B-1** through **B-8**.
