# AssetEngine Architecture Gap Analysis

**Status:** Analysis only — no code, schema, data, Zoho record, OAuth configuration or UI was modified
**Date:** 27 August 2026
**Reference architecture:** *AssetEngine Canonical Architecture* (business decisions locked through 2026-08-27), treated as the domain source of truth for this analysis
**Compared against:** production code at `web-app/`, live production schema and live production data (`asset_manager`)

**Supporting evidence:**
- [`docs/ASSETENGINE_COMPLETE_ARCHITECTURE_AUDIT.md`](./ASSETENGINE_COMPLETE_ARCHITECTURE_AUDIT.md)
- [`docs/PRODUCT_INTEGRATION_AUDIT.md`](./PRODUCT_INTEGRATION_AUDIT.md)
- [`docs/PRODUCT_ARCHITECTURE_DECISION.md`](./PRODUCT_ARCHITECTURE_DECISION.md)
- Fresh verification for this document (see §0.2)

---

## 0. How to read this document

### 0.1 Severity scale

| Severity | Meaning | Implication |
|----------|---------|-------------|
| **BLOCKER** | Working production code does something the canonical architecture forbids, and it destroys data, corrupts accounting, or must be rewritten rather than extended | Cannot be built on. Must be resolved or explicitly quarantined before the dependent phase |
| **STRUCTURAL** | The canonical concept has no representation at all — no table, no column, no route | Must be built. Not a defect, but scope |
| **BEHAVIOURAL** | The mechanism exists but behaves contrary to a locked rule, and is fixable in place | Fix inside the existing module |
| **LATENT** | A dormant contradiction that is currently masked by application code or by low data volume | Will surface later, often silently |
| **TERMINOLOGY** | The same word means different things in the canonical document and in production code | Guaranteed to cause implementation error |

### 0.2 Verification performed for this document

Every finding below carries `file:line`, table/column, constraint name, or a live row count. Freshly verified for this analysis:

- Full read of `web-app/asset-manager-backend/services/kitSetService.js` (534 lines)
- Live `\d` on `managed_sets`, `managed_set_components`, `asset_kinds`, `inventory_kinds`, `quotes`, `zoho_catalog`
- Live column inventory for quantity/reservation/QR/lineage columns on `assets` and `inventory_items`
- Live production counts (§0.3)
- Two parallel deep audits: quantity/break semantics, and physical-state/assignment modules

### 0.3 Live production data at time of analysis

| Metric | Value |
|--------|-------|
| `assets` | 4 |
| `inventory_items` | 1 |
| `managed_sets` | 7 (5 ACTIVE, 2 ARCHIVED, **0 DRAFT**) |
| `managed_set_components` | 12 total, **1 active** |
| Legacy sets (`assets.is_set = 1`) | 1 |
| Assets with `parentid` | 1 |
| Assets with `quantity_root_id` | 1 |
| `zoho_catalog` | 202 |
| `quotes` | 0 |
| `hsn_codes` | 0 |

The data volume is small, which matters: **most of the contradictions below have never been exercised at scale.** They are latent defects in code, not observed production incidents. Two exceptions are already visible in the data and are called out.

### 0.4 Headline result

Canonical §36 locked rules, assessed one by one in Part 2:

| Outcome | Count |
|---------|-------|
| Fully satisfied by production today | **13** |
| Partially satisfied | **12** |
| Contradicted by production behaviour | **18** |
| Not implemented at all | **18** |
| Process rule, not assessable against code | **1** |
| **Total assessed** | **62** |

The contradiction register in Part 1 holds **81 findings**: **67 contradictions** and **14 confirmed alignments** (11 clean, 3 with caveats) recorded so they are not disturbed during implementation. By severity the 67 contradictions break down as **27 BLOCKER**, **13 STRUCTURAL**, **21 BEHAVIOURAL**, **5 LATENT**, **1 TERMINOLOGY**.

The single most important structural finding: the canonical architecture is built on three foundations — **Product identity**, **quantity conservation**, and **reservation** — and *none of the three exists in production*. There is no Product entity, no reservation column or table anywhere, and no conservation check anywhere. Every Set, Receipt Note and conversion rule in the canonical document depends on at least one of them.

The single most important behavioural finding: **`parentid` on `assets` simultaneously encodes split lineage, legacy Set membership, and sub-assembly membership, with no discriminator.** Canonical §13 explicitly forbids exactly this. It is the one contradiction that cannot be fixed by addition alone.

---

# PART 1 — CONTRADICTION REGISTER

---

## 1.1 Product and Zoho identity (GAP-1xx)

### GAP-101 · BLOCKER · No AssetEngine Product entity
**Canonical:** §2, §3, §36 rule 1 — "Product is a first-class AssetEngine business entity."
**Production:** No `product` table. A live schema search for `%product%`, `%catalog%`, `%sku%`, `%item_master%` returns only `zoho_catalog`, whose **primary key is the Zoho record ID**, making the Zoho identifier the local product identity.
**Evidence:** `zoho_catalog` columns are `zoho_product_id` (PK), `product_name`, `unit_price`, `make`, `model`, `hsn_code`, `description`, `sku`, `is_active`, `last_synced_at`, `created_at`.
**Impact:** Blocks Phase 1 entirely, and Phases 3, 5, 6 transitively.

### GAP-102 · BLOCKER · `zoho_product_id` has inverted meanings by table
**Canonical:** §5, §36 rule 2 — Zoho Product is an external representation; the target uses explicit mapping, "rather than overloading `zoho_product_id` columns with opposite meanings."
**Production:** `assets.zoho_product_id` is written by exactly one place — the push write-back at `zohoService.js:901-903` — so it means *"this asset was published to Zoho."* `inventory_items.zoho_product_id` is written from a client-supplied catalogue value at `server.js:5029`, so it means *"this item was instantiated from that Zoho product."* Same column name, reversed causation, no discriminator.
**Impact:** Any Phase 1 backfill that reads `zoho_product_id` uniformly will assign provenance incorrectly.

### GAP-103 · BLOCKER · Product Name is unconditionally overwritten in Zoho
**Canonical:** §4, §36 rule 4 — "Product Name is co-managed with field-level conflict resolution… No silent last-write-wins."
**Production:** `syncAssetToZoho` rewrites `Product_Name`, `Description`, `Unit_Price`, `Make` and `Model` on every push with no `Modified_Time` comparison, no hash, and no field policy (`zohoService.js:520-589`, field mapping around 545-555).
**Impact:** A Sales edit in Zoho survives only until the next Logistics push. This is precisely the "silent last-write-wins" the canonical rule forbids.

### GAP-104 · BLOCKER · Description ownership is inverted, and clobbered in both directions
**Canonical:** §4, §36 rule 5 — "Product Description is AssetEngine/Logistics authoritative. Zoho changes do not overwrite AssetEngine."
**Production:** The pull writes Zoho's `Description` **into** the local row (`zohoService.js:764`), and the push writes the local description **into** Zoho (`zohoService.js:493-501`). Description is therefore overwritten in whichever direction ran last — the exact opposite of a one-way authoritative rule.
**Impact:** Locked rule 5 is not merely unimplemented, it is actively contradicted. Note also §4 as written accepts that AssetEngine *may* overwrite Zoho Description; confirm Sales understands their Description edits are expected to be discarded (see AMB-04).

### GAP-105 · BEHAVIOURAL · Unlinked Zoho Products can create physical records directly
**Canonical:** §6 and §36 rules 8, 9, 56 — "Unlinked standalone Zoho Products do nothing in AssetEngine", "Product links arise through explicit business workflows", "Physical creation occurs in the Receipt Note workflow." The mandated path is Zoho Product → Zoho PO → Receipt Note → physical receipt → create Asset/Inventory.
**Production:** Any of the 202 `zoho_catalog` rows can be turned straight into an Inventory item through the catalogue picker, with no PO and no Receipt Note. `openInventoryFromCatalog` prefills the item and stashes `form.dataset.catalogZohoProductId` (`inventory.js:1555-1582`); the create route accepts it at `server.js:5029`.
**Impact:** The only Product→physical link path in production is the one the canonical architecture excludes. §6 does permit a UI to "assist selection", so this is a workflow-gating gap rather than a wholly forbidden mechanism — but it bypasses receiving entirely.

### GAP-106 · BEHAVIOURAL · Product link is accepted unvalidated and silently destroyed on edit
**Canonical:** §6 — links must be created through an approved business workflow.
**Production:** `POST /api/inventory/items` accepts a client-supplied `ZohoProductId` with no validation of any kind (`server.js:5029`). `PUT /api/inventory/items/:id` writes `null` when the client omits the field (`server.js:5224`), and the shared modal clears `form.dataset.catalogZohoProductId` on open (`inventory.js:484-485`), so a routine edit silently unlinks the item.
**Impact:** Links are neither trustworthy nor durable. Backfill cannot assume an existing link is meaningful.

### GAP-107 · LATENT · Round-trip identity loop already present in production data
**Canonical:** §31, §36 rule 61 — "Zoho synchronization must be explicit, idempotent and provenance-aware."
**Production:** Asset `HAR-MUM-0726-55QOFA-R` was pushed on 20 August, became Zoho Product `1205624000001284002`, and the 21 August pull returned it into `zoho_catalog` as "Trimble Bullet 720". One physical asset is now offered in the catalogue picker as a purchasable product type. The pull matches only on `zoho_catalog.zoho_product_id` (`zohoService.js:781`) and cannot see `assets` at all.
**Impact:** **This is one of the two contradictions already visible in production data, not a hypothetical.** Backfill must special-case it or it will be mislabelled as Zoho-originated.

### GAP-108 · BEHAVIOURAL · Catalogue pull is single-page, non-transactional, and never sets `is_active`
**Canonical:** §36 rule 61 (idempotent sync); §3 (transitional cache is acceptable).
**Production:** `syncProductsFromZoho` fetches one page (`zohoService.js:709-813`), upserts row by row with no transaction (756-791), never writes `is_active`, and has no deletion detection. Empirically 200 of 202 rows refreshed on 21 August; two are stale.
**Impact:** A Product backfill from this mirror would be truncated and would import deleted Zoho products as active.

### GAP-109 · BEHAVIOURAL · Push write-back is hardcoded to the `assets` table
**Canonical:** §3 — Product relates to many Assets and many Inventory holdings; §21 — Sets commercialize to Products.
**Production:** `handleSyncResponse` writes the returned Zoho ID with a hardcoded `db('assets')` (`zohoService.js:901-903`).
**Impact:** Any Inventory or Set push reusing this path writes into `assets` under a foreign ID — a silent no-op that leaves the record unlinked, so **every subsequent push creates another duplicate Zoho Product.** This must be fixed before any second entity is ever pushed.

### GAP-110 · BEHAVIOURAL · No duplicate prevention on push
**Canonical:** §36 rule 61 (idempotent).
**Production:** `syncAssetToZoho` decides CREATE vs UPDATE solely on the presence of `assets.zoho_product_id` (`zohoService.js:554-562`). No search by name, SKU or make/model precedes creation.
**Impact:** Every unlinked asset creates a new Zoho Product. Split children, which inherit no link, each create their own.

### GAP-111 · BLOCKER · Encrypted serials are pushed to Zoho as ciphertext
**Canonical:** §8 — manufacturer serial is separate from AssetEngine identity; §21 — Zoho receives a human-readable representation.
**Production:** `buildAssetDescription` embeds child asset `srno` values into the Zoho Description for kits (`zohoService.js:493-501`). Asset `srno` is encrypted deterministically, so **ciphertext is transmitted to and stored in Zoho.**
**Impact:** Data-protection concern and a garbage commercial description. Must be excluded before any Set commercialization ships.

### GAP-112 · ALIGNED-BY-ABSENCE · No fuzzy matching exists
**Canonical:** §6 — "No fuzzy name matching, Make/Model matching, SKU matching, or closest-match identity creation."
**Production:** No matching logic of any kind exists. The rule is satisfied because the capability is absent, not because it is enforced.
**Note:** This becomes a real decision the moment Phase 1 needs to reconcile 202 catalogue rows. Satisfaction today does not survive backfill design.

---

## 1.2 Identity conflation (GAP-15x)

Canonical §5 lists twelve identities that must never be conflated. Four are conflated today.

### GAP-151 · BLOCKER · Set ID is an Asset ID for legacy sets
**Canonical:** §5 — AssetEngine Set ID and AssetEngine Asset ID are distinct identities.
**Production:** Legacy sets are assets with `is_set = 1`. `kitSetService.listSets` surfaces them with `id: "legacy:" + a.id` and **`set_code: a.id`** — the asset's own ID used as the set code (`kitSetService.js:177-187`), and `getSet` resolves members by `parentid` (`kitSetService.js:205`).
**Impact:** One identifier is simultaneously an Asset ID and a Set ID. Production has 1 such set out of 4 assets.

### GAP-152 · STRUCTURAL · Asset ID and Inventory ID share one generator and one ID space
**Canonical:** §5 — AssetEngine Asset ID and AssetEngine Inventory ID are distinct identities.
**Production:** `generateModernAssetId` (`utils.js:495-515`) generates IDs for both tables using hardcoded location/type dictionaries (`utils.js:171`). No cross-table uniqueness guard exists; the only duplicate-check trigger, `trg_check_assets_dup`, protects `assets` ↔ `components`.
**Impact:** Collisions are possible, and a bare ID string cannot be resolved to an entity type without querying both tables. Conversion (Phase 3) makes this acute.

### GAP-153 · BLOCKER · AssetEngine Project ID is derived from the Zoho Deal ID
**Canonical:** §26, §36 — "Zoho Deal/Project ID is a supporting external reference and must not replace the AssetEngine Project ID."
**Production:** `syncDealsFromZoho` inserts projects with `id: projectIdKey || 'PROJ-' + dealId.substring(dealId.length - 6)` (`zohoService.js:854-876`). The AssetEngine primary key is taken from a Zoho custom field, or derived from the last six characters of the Zoho record ID.
**Impact:** Directly contradicts a locked rule. Mitigating fact: this path is currently inoperative (GAP-704), so no such rows have been created — but the code is live and would execute if the other bugs were fixed first.

### GAP-154 · TERMINOLOGY · "Superset" already means something different in production
**Canonical:** §2, §19 — a Super Set is an aggregate of existing Sets.
**Production:** "Superset" means a legacy asset box-set. The comment above the asset→Zoho push reads *"Pushes a Superset (Box Set) to Zoho CRM as a Product"* (`server.js:2697-2698`), and `server.js:6731` reads *"Sets/Supersets are tracked assets."*
**Impact:** Guaranteed implementer confusion. The word must be disambiguated before Phase 5.

---

## 1.3 Quantity architecture (GAP-2xx)

### GAP-201 · BLOCKER · No reservation representation exists anywhere
**Canonical:** §7 conservation equation (`received = available + reserved + converted + other`); §14 "Set membership creates reservations"; §36 rules 36-38.
**Production:** There is **no** `quantity_reserved`, `reserved`, `committed` or `held` column on `assets` or `inventory_items`, and no reservations table. Verified by live column inventory. `lifecycleModel.LIFECYCLE_STATES.RESERVED` exists but is annotated *"future module"* (`web-app/shared/lifecycleModel.js:67`), and the `RESERVE`/`UNRESERVE` movement types are `enabled: false` (`inventoryMovementService.js:76-88`).
**Impact:** The entire Set reservation model (§14) and the conservation equation (§7) are unrepresentable. This is the foundation for Phase 5 and it does not exist.

### GAP-202 · BLOCKER · Adding to a Managed Set reserves nothing
**Canonical:** §14, §36 rules 36-40 — inventory reservation is quantity-specific; available decreases and reserved increases on ADD; the inverse on REMOVE.
**Production:** `kitSetService.addComponent` writes only to `managed_set_components`. It never updates `assets` or `inventory_items` quantity columns (`kitSetService.js:301-412`). `removeComponent` only flips `is_active` (415-429).
**Impact:** Set membership has no effect on availability. An item can be in a Set and simultaneously fully available everywhere else.

### GAP-203 · BLOCKER · No availability check on Set addition
**Canonical:** §14, §36 rule 39 — "Insufficient available quantity rejects Set addition without partial reservation."
**Production:** `addComponent` validates only that the inventory quantity is an integer ≥ 1 (`kitSetService.js:357-359`). It never compares against `item.quantity_available`. `listEligibleInventory` selects `quantity_available` (509) but uses it for nothing.
**Impact:** You can reserve 10,000 units of an item holding 10. The rule is not weakly enforced; it is absent.

### GAP-204 · BLOCKER · The same Inventory item can be claimed by unlimited Sets
**Canonical:** §14, §19 — reservations are real and are never double-counted.
**Production:** The unique index is **per set**: `managed_set_components_set_inventory_active_unique (set_id, inventory_item_id) WHERE inventory_item_id IS NOT NULL AND is_active`. There is no global constraint and no aggregate quantity check across sets. (Contrast assets, which do have a global unique — see GAP-505.)
**Impact:** Unbounded double-reservation of inventory, with no detection.

### GAP-205 · BLOCKER · No quantity conservation check exists
**Canonical:** §7 — "The system must always be able to account for received quantity without double counting."
**Production:** Nothing verifies that a parent's quantity equals the sum of its children, or that available + reserved + converted equals total. `GET /api/quantity/replay/:rootId` sums event deltas (`server.js:7256-7273`) but never compares the result to the live columns. A code comment concedes the position: *"server/parent/child invariants break, the user fixes them manually via qty events UI. So instead of blocking, just warn and proceed"* (`server.js:9003-9004`).
**Impact:** Conservation is currently a manual, human activity. It cannot be asserted.

### GAP-206 · BLOCKER · Two incompatible split implementations with different lineage
**Canonical:** §12, §36 rules 26-30 — one break model, non-destructive, recursive, with ancestry to the original root.
**Production:** Two systems coexist.

| | `POST /api/assets/split` (11328) | `POST /api/quantity/split` (6524) |
|---|---|---|
| Creates child row | Yes (11496) | Yes (6607) |
| Decrements parent | Yes, direct write (11372-11377) | Yes, via event (6624-6627) |
| Sets `quantity_parent_id` | **No** | Yes (6598) |
| Sets `quantity_root_id` | **No** | Yes (6599) |
| Sets `parentid` | Yes (11473) | Yes (6584) |
| Writes quantity events | No | Yes |
| Requires `authenticateJWT` | **No** | **No** |

**Impact:** Which endpoint was used determines whether ancestry exists at all. Canonical §12's "every descendant retains ancestry to the original root" holds only on one of the two paths. Production has exactly 1 asset with a `quantity_root_id`.

### GAP-207 · BLOCKER · Unsplit hard-deletes child asset rows
**Canonical:** §12, §28, §36 rules 26-28 — "Break is non-destructive", "Parent records remain", "Assets with operational history are not casually hard-deleted."
**Production:** For batch/quantity parents, unsplit restores the parent quantity and then **hard-deletes** the child:

```11686:11687:web-app/asset-manager-backend/server.js
                await trx('assets').whereRaw('LOWER(id) = LOWER(?)', [id.toLowerCase()]).delete();
                await trx('components').whereRaw('LOWER(id) = LOWER(?)', [id.toLowerCase()]).delete();
```

The same pattern exists in project unassign (`server.js:8589`).
**Impact:** The child's ID, serials and history are destroyed, leaving orphaned `asset_history` rows. Historical physical reality becomes unreconstructable, contradicting §28 and §36 rule 60.

### GAP-208 · LATENT · Unsplit of a Set-member child will fail with a raw FK error
**Canonical:** §12 — "Merge… must not interfere with Set/Sub Set/Super Set relationships."
**Production:** `fk_managed_set_components_asset_id` is `ON DELETE RESTRICT`. The hard delete in GAP-207 will therefore throw a Postgres FK violation if the child is an active Set component, surfaced as an unhandled 500 rather than a business error.
**Impact:** Currently masked by low data volume (1 active component in production). It will appear as an opaque failure as soon as Sets are used.

### GAP-209 · BLOCKER · No separate quantity buckets for received, converted, dispatched or consumed
**Canonical:** §7 conservation equation; §10 worked example requiring *Total Received 10 / Available 8 / Converted to Assets 2*; §30 quantity state model.
**Production:** Only two buckets exist on each table: `quantity_total` and `quantity_available`. No `received`, `original`, `converted`, `dispatched` or `consumed` column exists. `EVENT_TYPES.RECEIVE` is defined but its movement is `enabled: false` (`inventoryMovementService.js:37-42`).
**Impact:** The §10 conversion example cannot be represented at all. Consume currently reduces total and available *together* (`inventoryMovementService.js:254-255`), which erases the fact that the quantity was ever received.

### GAP-210 · LATENT · Quantity columns are floats, with a type mismatch across the two tables
**Canonical:** §7 — quantity must always be accountable without double counting.
**Production:** Live `assets.quantity_total`/`quantity_available` are `real` (4-byte). Live `inventory_items.quantity_total`/`quantity_available` are `double precision` (8-byte). Both migrations use Knex `.float()` (`20260417060510_create_initial_schema.js:91-92`; `20260730090000_create_inventory_preview_tables.js:78-79`), which yields `real` — so the production inventory columns **do not match their migration**, another instance of the schema drift the architecture audit recorded for these tables.
**Impact:** Floating-point quantity cannot guarantee conservation, `real` gives roughly 7 significant digits, and conversion (Phase 3) must move values between two different float widths. Exact arithmetic requires `numeric`.

### GAP-211 · BEHAVIOURAL · Serials remain delimited text
**Canonical:** §7, §36 rule 15 — "Structured subordinate quantity/physical-identity records are the long-term replacement for comma-separated serial text."
**Production:** Batch assets store multiple serials in a single `srno` string, parsed with `split(/[\n,]+/)`. Asset `srno` is encrypted while `inventory_items.srno` is plaintext. No uniqueness constraint exists on any serial column.
**Impact:** Acknowledged by the canonical document as a known gap (§35). Confirmed accurate. Phase 2 scope.

### GAP-212 · BEHAVIOURAL · Nine of ten inventory movement types are disabled
**Canonical:** §29, §30 — RECEIVE, RETURN, RESERVE, DISPATCH, CONSUME are all first-class operations.
**Production:** In `inventoryMovementService.js` (`MOVEMENT_TYPES`, 36-111) only `CONSUME` is `enabled: true`. `RECEIVE`, `ADJUST`, `TRANSFER`, `RETURN`, `RESERVE`, `UNRESERVE`, `DISPOSE`, `LOST`, `FOUND` are all `enabled: false`.
**Impact:** The inventory movement framework exists as a skeleton. Phases 3, 4 and 6 all need types that are currently switched off.

### GAP-213 · BEHAVIOURAL · `quantity_precision` is decorative
**Canonical:** §7 — quantity tracking supports aggregate and unit-level representations with defined precision.
**Production:** `quantity_precision` is stored on both tables but is never used for rounding, validation or formatting on write. Frontend conversions hardcode `.toFixed(4)`.
**Impact:** Precision is declared per item and then ignored.

---

## 1.4 Asset ↔ Inventory boundary and conversion (GAP-3xx)

### GAP-301 · STRUCTURAL · Inventory → Asset conversion does not exist
**Canonical:** §10, §36 rules 19-24.
**Production:** No route, service or column implements it. A repo-wide search for conversion paths returns only unrelated matches (base64 conversion, Excel serial dates, and `CONVERT_TEMP` for temporary assets).
**Impact:** Phase 3 is greenfield. Note it also cannot be built until GAP-152 (shared ID space) and GAP-210 (float widths) are addressed, because conversion moves identity and quantity across the two tables.

### GAP-302 · STRUCTURAL · Asset → Inventory return does not exist, and there is no lineage column for it
**Canonical:** §11, §36 rules 22-24 — return always goes to the original Inventory lineage, with an operator-selected condition.
**Production:** Not implemented. There is also no `source_inventory_id` or equivalent column on `assets`, so even the lineage that §11 depends on has nowhere to live.
**Impact:** "Returns to original Inventory lineage" requires a new column, not just a new route.

### GAP-303 · BEHAVIOURAL · The Asset/Inventory boundary is already blurred in code
**Canonical:** §9, §36 rules 16-18 — Inventory is stock; Asset is internal-use equipment; no permanent hybrid.
**Production:** `GET /api/projects/:id/available-inventory` queries the **`assets`** table, not `inventory_items` (`server.js:11838-11850`), and selects a non-existent `a.unitprice` column. Separately, assets can be `is_quantity_tracked`/`is_batch`, i.e. an asset behaving as bulk stock.
**Impact:** "Inventory" already means two different things depending on the endpoint. The route is also broken as written.

### GAP-304 · ALIGNED · Inventory is not assignable
**Canonical:** §9, §36 rule 18.
**Production:** `inventory_items` has no `assignedto` column and no employee-assignment route. Correctly satisfied.

---

## 1.5 Sets (GAP-5xx)

This is the largest cluster. The Managed Set implementation is a *composition* system; the canonical architecture requires a *reservation and requirement* system.

### GAP-501 · BLOCKER · Set definition is fully mutable after creation
**Canonical:** §14, §36 rule 32 — "Set definition is immutable after creation." To change composition: disband/archive the old Set and create a new one.
**Production:** Three routes mutate a live ACTIVE Set:
- `PUT /api/managed-sets/:id` → `updateSet` changes `name`, `description`, `set_code` (`kitSetService.js:261-283`)
- `POST /api/managed-sets/:id/components` → `addComponent` (`server.js:2853`)
- `DELETE /api/managed-sets/:id/components/:componentId` → `removeComponent` (`server.js:2862`)

`assertMutableSet` blocks only ARCHIVED sets (`kitSetService.js:285-294`).
**Impact:** Working, role-protected, actively used code does exactly what the locked rule forbids. This is not a missing feature — it is a feature that must be removed or redefined. See AMB-01: the canonical document itself lists SET ADD and SET REMOVE as valid operations, so the intended boundary needs clarification before anything is changed.

### GAP-502 · STRUCTURAL · No requirement layer — completeness is not computable
**Canonical:** §15, §20, §36 rules 42, 48 — requirements and physical allocation are mandatory separate layers; completeness is EMPTY / INCOMPLETE / COMPLETE / OVERCOMPLETE.
**Production:** `managed_set_components` links only to physical rows: FKs to `assets.id` and `inventory_items.id`, with `managed_set_components_type_check` permitting only `'ASSET'` and `'INVENTORY'`. There is no product-level component, no requirement table, and no `satisfies_requirement_id`.
**Impact:** Completeness cannot be computed because there is nothing to compare against.

### GAP-503 · BEHAVIOURAL · `computeComposition` is mistaken for completeness and collides on `EMPTY`
**Canonical:** §15 — the four completeness values.
**Production:** `computeComposition` returns `EMPTY`, `MIXED`, `ASSET`, `INVENTORY` (`kitSetService.js:38-45`) — a description of *what kinds of things are in the set*, not of completeness. The API surfaces it as `composition`, and `listSets` filters on it (`kitSetService.js:161`).
**Impact:** `EMPTY` exists in both vocabularies with different meanings. Any implementer reading the API will assume completeness is already implemented.

### GAP-504 · BLOCKER · The asset quantity-1 constraint forces requirement/allocation conflation
**Canonical:** §20 — "Lens Product × 2" is a single requirement.
**Production:** `managed_set_components_asset_quantity_check CHECK (component_type <> 'ASSET' OR quantity = 1)`.
**Impact:** "Lens × 2" must be stored as two allocation rows, so the required quantity is implicit in the row count. Deallocating one lens silently changes the apparent requirement from 2 to 1 — the precise failure the two-layer model exists to prevent.

### GAP-505 · BLOCKER · The global unique on active `asset_id` forbids Super Sets
**Canonical:** §19, §36 rules 47, 49 — a Super Set aggregates existing Sets without double reservation.
**Production:** `managed_set_components_asset_id_active_unique UNIQUE (asset_id) WHERE asset_id IS NOT NULL AND is_active = true` is **global**, not per-set. One asset can be an active component of at most one Set anywhere in the system.
**Impact:** If a Super Set is implemented by re-adding the source sets' components, every insert fails. Combined with GAP-204 (inventory has no such constraint), the two component types have opposite semantics: assets are exclusive, inventory is unlimited.

### GAP-506 · STRUCTURAL · Subsets are unrepresentable
**Canonical:** §18, §36 rules 46, 48.
**Production:** `managed_sets` has no `parent_set_id`. Live columns are `id`, `set_code`, `name`, `description`, `status`, `zoho_product_id`, `created_by`, `updated_by`, `created_at`, `updated_at`, `archived_at`. No set-hierarchy table exists.
**Impact:** Phase 5 Subset/Super Set work is greenfield and requires new schema.

### GAP-507 · BLOCKER · Sets have no history of any kind
**Canonical:** §28, §36 rule 60 — "Set membership history remains available when removed/disbanded/absorbed."
**Production:** `kitSetService` writes to no history, audit or event table on create, update, add, remove, archive or restore. The v2 migration states this explicitly at line 15. Removal is a bare `is_active = false` with **no actor, no reason and no removal timestamp** distinct from `updated_at` (`kitSetService.js:420-423`).
**Impact:** Partially satisfied at best — the inactive row survives, but who removed what, when and why does not. Commercializing a Set (§21) whose membership history cannot be reconstructed produces an unauditable commercial record.

### GAP-508 · BLOCKER · Archive deactivates components; restore does not reactivate them
**Canonical:** §17, §28 — disband releases reservations while preserving history; historical physical reality remains reconstructable.
**Production:** `archiveSet` deactivates all active components inside a transaction (`kitSetService.js:440-451`). `restoreSet` sets status back to `ACTIVE` and **does not touch components** (`kitSetService.js:454-468`).
**Impact:** Archive→restore silently empties a Set. Production shows **11 of 12 component rows inactive** — consistent with this having already happened.

### GAP-509 · BEHAVIOURAL · Eligibility ignores every operational relationship except Set membership
**Canonical:** §14, §36 rule 39 — "If an Asset or required Inventory quantity is already committed to another operational relationship, adding it to a new Set is rejected."
**Production:** `listEligibleAssets` excludes only deleted assets and assets already in an active Set (`kitSetService.js:476-501`). It does not consider project assignment, DC/dispatch state, employee assignment, or repair status. `addComponent` checks only Set membership and `is_deleted` (`kitSetService.js:312-325`).
**Impact:** An asset already assigned to a project, dispatched on a DC, or issued to an employee can be added to a Set. There is no cross-check in either direction — project assignment likewise does not consult Set membership.

### GAP-510 · LATENT · The schema default status is DRAFT while the service writes ACTIVE
**Canonical:** §14, §36 rule 31 — "Set creation means immediately active. No ordinary Draft → Active lifecycle."
**Production:** `createSet` explicitly writes `status: 'ACTIVE'` (`kitSetService.js:245`) — aligned. But the live column default is `'DRAFT'`, and `managed_sets_status_check` permits `DRAFT`. Production has 0 DRAFT rows.
**Impact:** Aligned only because application code overrides the schema. Any direct insert, bulk load or new code path produces a DRAFT set, which the canonical model says cannot exist.

### GAP-511 · BEHAVIOURAL · Substitution is unrestricted in effect
**Canonical:** §16, §36 rule 44 — "Product substitution is not allowed inside a Set", with no override mechanism.
**Production:** There is no requirement layer, so no *Product* substitution is possible — technically satisfying the letter of the rule. But `addComponent` + `removeComponent` allow arbitrary swapping of physical members of a live Set with no constraint at all.
**Impact:** The rule is satisfied vacuously while the underlying behaviour is fully permissive.

### GAP-512 · ALIGNED · Sets cannot be deleted
**Canonical:** §14, §36 rule 33.
**Production:** No `DELETE /api/managed-sets/:id` route exists, `kitSetService` exports no delete function, and all three FKs into `managed_sets`/`managed_set_components` are `ON DELETE RESTRICT`. Correctly satisfied at both layers.

### GAP-513 · ALIGNED · Sets may mix Assets and Inventory
**Canonical:** §14, §36 rule 34.
**Production:** `managed_set_components_xor_check` enforces exactly one of `asset_id`/`inventory_item_id` per row, and a Set may hold rows of both kinds. Satisfied.

### GAP-514 · ALIGNED · Archive does not reset unrelated operational state
**Canonical:** §17, §36 rule 41.
**Production:** `archiveSet` touches only `managed_set_components.is_active` and the set row. It does not modify project allocation, DC state, `assignedto`, location or repair state.
**Impact:** Satisfied — but only because Set membership currently has no side effects at all. Once reservations exist (GAP-201), this isolation must be deliberately preserved.

### GAP-515 · BLOCKER · Legacy and Managed Sets are merged in one API surface
**Canonical:** §13, §35 — lineage and Set composition are separate systems; legacy coexistence is a known gap.
**Production:** `listSets` concatenates managed sets with legacy `is_set = 1` assets into a single response (`kitSetService.js:165-197`), and `getSet` branches on a `legacy:` ID prefix to resolve members via `parentid` (`kitSetService.js:200-232`).
**Impact:** Two incompatible set models are presented as one list. Legacy entries are read-only and rejected by every mutation path with 409s (`kitSetService.js:262-263`, `286-287`, `432-433`, `455-456`), so the API is uniform in shape but not in behaviour.

### GAP-516 · BEHAVIOURAL · `managed_sets.zoho_product_id` is a reserved slot with no writer
**Canonical:** §21 — a commercialized Set links to a Product which maps to a Zoho Product.
**Production:** The column exists with a partial unique index (`managed_sets_zoho_product_id_unique … WHERE zoho_product_id IS NOT NULL AND btrim(...) <> ''`). `createSet` hardcodes `null` (`kitSetService.js:246`) and `updateSet` accepts only `name`, `description`, `set_code` (270-276). All 7 production sets have it null.
**Impact:** The intent is visible in the schema but unimplemented. Per the Product decision document this column is superseded by an explicit external mapping; the partial unique index does usefully encode "one Zoho Product per Set", which should be carried forward deliberately.

### GAP-517 · BLOCKER · The only Set → Zoho Product path runs through legacy assets
**Canonical:** §21, §36 rules 50-51 — Set → AssetEngine Product → Zoho Product, with structured composition retained in AssetEngine.
**Production:** The only implementation is `POST /api/zoho/sync-asset/:id`, whose own docstring reads *"Pushes a Superset (Box Set) to Zoho CRM as a Product"* (`server.js:2697-2701`). It pushes a legacy `is_set` **asset** directly to Zoho, with no AssetEngine Product, and embeds child serials as ciphertext (GAP-111).
**Impact:** Set commercialization exists today only in the exact form the canonical architecture rejects. The docstring for the pull route is similarly telling: *"Pulls Products from Zoho CRM and syncs them to the local Assets catalog"* (`server.js:2746-2747`).

---

## 1.6 Lineage versus Set composition (GAP-4xx)

### GAP-401 · BLOCKER · `parentid` encodes three unrelated relationships simultaneously
**Canonical:** §13 — "Do not use one mechanism to implement the others. In particular, do not reuse `parentid` or conversion ancestry as the primary Set hierarchy mechanism."
**Production:** `assets.parentid` is written by, and read as, all of the following:
- **Split lineage** — `/api/assets/split` sets `parentid: parentId` (`server.js:11473`), and `/api/quantity/split` sets it too (`server.js:6584`)
- **Legacy Set membership** — `make-set` sets `is_set = 1` on the parent and `parentid` on members; `kitSetService.getSet` resolves legacy set members with `WHERE LOWER(parentid) = LOWER(?)` (`kitSetService.js:205`); `break-set` clears `parentid` (`server.js:6852`)
- **Sub-assembly membership** — the `components` table and sub-asset relationships

There is no discriminator column. `updateAssetStatus` then propagates status recursively down `parentid` under the comment *"Recursive Propagation (for Sets/Supersets)"* (`server.js:475-477`).
**Impact:** This is the one contradiction that cannot be fixed by addition. Given a row with a `parentid`, the system cannot determine which of the three relationships it represents, so no migration can safely separate them without a per-row interpretation pass. It also means status changes propagate along what may be a *split* edge, not a set edge.

### GAP-402 · BEHAVIOURAL · Ancestry to the original root exists on only one split path
**Canonical:** §12, §36 rules 29-30 — break is recursive and every descendant retains ancestry to the original root.
**Production:** `/api/quantity/split` propagates `quantity_root_id` from the parent, so a grandchild correctly points to the original root (`server.js:6539`, `6598-6599`). `/api/assets/split` writes neither `quantity_parent_id` nor `quantity_root_id` (child insert at `server.js:11461-11494`).
**Impact:** Recursive lineage is real on one endpoint and absent on the other, and both are reachable. Production has 1 asset with a `quantity_root_id`.

### GAP-403 · ALIGNED-WITH-CAVEAT · Recursive break is permitted with no depth limit
**Canonical:** §12 — "Break is recursively allowed to any depth."
**Production:** No depth limit or "cannot split a child" guard exists on either path. `/api/quantity/split` accepts any quantity-tracked node; `/api/assets/split` checks only `quantity_available`.
**Impact:** Satisfied. The caveat is that unlimited recursion combined with no conservation check (GAP-205) and float quantities (GAP-210) compounds drift at every level.

### GAP-404 · STRUCTURAL · "Make Individual" does not exist
**Canonical:** §12, §29 — INDIVIDUALIZE is a first-class operation.
**Production:** No route or function implements it. `make-set` performs batch segmentation (`server.js:6653`, splits at 6696-6712 and 6779-6792) but that is set construction, not individualization.

### GAP-405 · STRUCTURAL · No merge operation, and no event-sourced unsplit
**Canonical:** §12, §29 — MERGE BACK is lineage-based aggregation.
**Production:** No `/api/quantity/unsplit` or merge endpoint exists. The only merge-like paths are the legacy `unsplit` and project-unassign, both of which hard-delete (GAP-207).

---

## 1.7 Receiving, POs and Work Orders (GAP-6xx)

### GAP-601 · STRUCTURAL · Receipt Note / GRN does not exist
**Canonical:** §22, §36 rules 52-56.
**Production:** A repo-wide case-insensitive search for `receipt note`, `goods receipt`, `GRN`, `work order` returns **zero** backend matches. Only `projects.js` (frontend, 12 matches for purchase-order UI) and one `index.html` string.
**Impact:** Phase 6 is entirely greenfield. Canonical §22 already states this is planned, not existing — confirmed accurate.

### GAP-602 · BLOCKER · Purchase Orders are local to AssetEngine, not consumed from Zoho
**Canonical:** §1, §23, §36 rule 57 — "Zoho is authoritative for commercial Purchase Orders"; AssetEngine consumes PO context.
**Production:** POs live **inside** AssetEngine as `project_orders` and `project_order_items` (with `qtyordered`), driven by the projects UI. There is no Zoho PO pull anywhere. `POST /api/dc` writes `project_order_items.status = 'Shipped'` (`server.js:4022-4027`), so AssetEngine is currently the PO system of record.
**Impact:** Directly contradicts the core boundary in §1. Migrating PO authority to Zoho is a data-ownership change affecting a working module, not an additive step — and it is not listed in any canonical phase.

### GAP-603 · BEHAVIOURAL · No Quote → PO back-link
**Canonical:** §23 — "Each PO retains a back-link to the originating Quote."
**Production:** The `quotes` table has four columns (`id`, `zoho_id`, `name`, `created_at`) and **0 rows**. No FK or reference connects `project_orders` to it.
**Impact:** The back-link has no representation on either side.

### GAP-604 · STRUCTURAL · Customer POs are not distinguished from vendor POs
**Canonical:** §24 — customer POs are distinct from vendor procurement POs.
**Production:** `project_orders` does not distinguish direction. Canonical defers this to a later phase, so this is scope confirmation rather than a defect.

### GAP-605 · STRUCTURAL · Work Orders do not exist
**Canonical:** §25 — Work Orders are siblings to POs; detailed lifecycle deferred.
**Production:** No table, route or column. Consistent with the canonical deferral.

### GAP-606 · NOTE · The closest existing analogue to receiving is unauthenticated
**Canonical:** §22 — physical creation occurs in the Receipt Note workflow.
**Production:** `temporary_assets` with `linked_po_item_id`, promoted by `POST /api/temporary-assets/:id/make-permanent` (`server.js:8790-8859`), is functionally a proto-receiving flow: it links a PO line to a newly created permanent asset. **It has no `authenticateJWT`.**
**Impact:** Worth studying as prior art for Phase 6 — and worth noting that the canonical document does not mention `temporary_assets` at all (see UNMAPPED-01).

---

## 1.8 Projects, DC and dispatch (GAP-7xx)

### GAP-701 · STRUCTURAL · Projects accept only Assets
**Canonical:** §26 — Projects will manage Assets, Inventory, Sets, logistics, rentals and DC.
**Production:** `project_assets(projectid, assetid)` with FKs to `projects.id` and `assets.id`. There is **no** `project_inventory` and **no** `project_sets` table. `GET /api/projects/:id/assets` unions `assets` and `temporary_assets` only (`server.js:8375-8394`).
**Impact:** Inventory and Sets cannot be attached to a project at all. Phase 8 scope.

### GAP-702 · BEHAVIOURAL · No cross-check between Project assignment and Set membership
**Canonical:** §14 eligibility; §17 — Set membership is one independent operational dimension.
**Production:** Neither direction checks the other. `assign-asset` (`server.js:8426`) does not consult `managed_set_components`; `listEligibleAssets` does not consult `project_assets`.
**Impact:** An asset can be simultaneously reserved by a Set and assigned to a project, double-committing the same physical item.

### GAP-703 · BEHAVIOURAL · DC moves no quantity and cannot dispatch Inventory
**Canonical:** §27, §29 — DISPATCH means "move physical quantity through DC/outbound transaction."
**Production:** `POST /api/dc` updates only `sentagainstdc` and `boughtagainstpo` inside its transaction (`server.js:3859-3864`). It changes no quantity. It loads members from `assets` only (`server.js:3808-3812`) — inventory cannot be dispatched. It performs no Set-reservation check. Status and location change only through a **string-match heuristic** on `payload.meta.referenceNo` against a project name (`server.js:3970-3996`).
**Impact:** DC is a document, not a physical movement. §29's DISPATCH semantics are unimplemented, and the project linkage is by name matching rather than by ID.

### GAP-704 · BEHAVIOURAL · The Zoho Deals → Projects sync is inoperative
**Canonical:** §26 — the Zoho Deal ID is a supporting external reference.
**Production:** `syncDealsFromZoho` (`zohoService.js:818-885`) has three independent breakages: it calls `deal.getFieldValue()` where SDK 8.0 requires `getKeyValue`; it calls `.substring()` on a BigInt ID; and it writes `projects.lastupdated`, which does not exist in production. It also never calls `logSync`.
**Impact:** No Zoho project data flows today. This masks GAP-153 — fixing these bugs without also fixing the ID derivation would immediately start writing Zoho-derived AssetEngine Project IDs.

### GAP-705 · ALIGNED · DC is not itself an Asset or Inventory record
**Canonical:** §27.
**Production:** `delivery_challans` is a separate table with its own QR. Satisfied.

### GAP-706 · ALIGNED · Projects have their own AssetEngine ID format
**Canonical:** §26.
**Production:** `IdGenerator.generateProjectId` produces `LOC-MMYY-RAND-P` (`IdGenerator.js:25-34`), used by `POST /api/projects` (`server.js:5683-5687`). Satisfied on the create path — but contradicted on the Zoho sync path (GAP-153).

---

## 1.9 Identity, QR and history (GAP-8xx)

### GAP-801 · STRUCTURAL · Inventory items have no QR representation
**Canonical:** §8, §36 rules 10-12 — "Every active AssetEngine-managed Asset or Inventory record has an AssetEngine identity and a QR representation."
**Production:** `inventory_items` has **no** `qrcode`, `noqr` or `client_label` column — verified against the live schema. No backend QR route serves inventory. The frontend "print QR" button calls `window.printAssetLabel` (`inventory.js:2117-2118`), a function that **does not exist anywhere in the repository**.
**Impact:** Half of locked rule 10 is unimplemented, and the UI advertises a capability that silently does nothing.

### GAP-802 · ALIGNED · Aggregated quantity does not produce per-unit QR codes
**Canonical:** §8, §36 rule 11.
**Production:** QR is generated per asset record, never per unit. Split children each receive their own ID and QR while the parent retains its own. Satisfied for assets.

### GAP-803 · BEHAVIOURAL · QR content is environment-dependent and partly unreachable
**Canonical:** §8 — QR belongs to the independently managed record.
**Production:** Stored `assets.qrcode` values encode absolute URLs captured at creation time, including an internal container IP (`172.18.0.4:8080`) unreachable from outside the Docker network. The dynamic endpoints `GET /api/qr/dynamic/asset/:id` (`server.js:6214`) correctly use `req.get('host')`. Separately, `GET /api/qr/d/:code` is referenced by `dynamic.html` but **has no handler**.
**Impact:** QR identity is sound in the dynamic path and broken in the stored path.

### GAP-804 · BLOCKER · No state machine is enforced anywhere
**Canonical:** §30, §36 — defined quantity/physical states with defined transformations.
**Production:** `web-app/shared/lifecycleModel.js` defines `LIFECYCLE_TRANSITIONS`, `canTransition` and `assertTransition` (133-196, 264-273). **Neither `assertTransition` nor `canTransition` is called anywhere in the backend.** The file's own comment concedes *"Does not rewrite every call site; gradual adoption"* (line 13). Asset status is a free-text column with at least 11 UI values plus additional literals in server code (`Issued`, `Warehouse`, `In Use` and `In-Use` both, `Project Assigned`, `Shipped`), and there is no CHECK constraint on `assets.status` or `inventory_items.status`.
**Impact:** §30's state model has no enforcement point. Canonical states like `RESERVED`, `IN_TRANSIT`, `RETIRED` and `WRITTEN_OFF` do not exist as values, and `In Use`/`In-Use` inconsistency means status comparisons are already unreliable.

### GAP-805 · STRUCTURAL · No narrative history for Inventory
**Canonical:** §28 — historical physical reality must remain reconstructable.
**Production:** Assets have `asset_history` (created lazily at runtime by `initializeHistory()`, `server.js:620-643`). Inventory has only `inventory_quantity_events` + `_lines` — quantity deltas, not a narrative log. There is no `inventory_history` table.
**Impact:** Inventory status changes, edits and link changes leave no auditable trail.

### GAP-806 · BEHAVIOURAL · Asset soft-delete is correct, but two paths hard-delete
**Canonical:** §28, §36 rule 59.
**Production:** `DELETE /api/assets/:id` is a soft delete and hard delete is disabled (`server.js:601-604`) — aligned. But unsplit (`server.js:11686`) and project unassign (`server.js:8589`) both hard-delete asset rows.
**Impact:** The principle is implemented in the obvious place and violated in two non-obvious ones.

### GAP-807 · ALIGNED · Original Inventory records are not deleted
**Canonical:** §36 rule 21.
**Production:** `POST /api/inventory/items/:id/delete` is a soft delete flag (`server.js:5365`). Satisfied — though untested against conversion, which does not exist.

---

## 1.10 Cross-cutting (GAP-9xx)

### GAP-901 · BLOCKER · Critical mutating routes have no authentication
**Canonical:** The canonical document has **no security section at all**, yet every locked rule depends on operations being performed by authorised actors through approved workflows (§6, §22, §34).
**Production:** Unauthenticated mutating routes include:

| Route | Line | Effect |
|-------|------|--------|
| `POST /api/assets/split` | 11328 | Creates assets, moves quantity |
| `POST /api/quantity/split` | 6524 | Creates assets, writes quantity events |
| `POST /api/quantity/issue` | 6935 | Moves quantity, links to projects |
| `POST /api/quantity/consume` | 7067 | Consumes quantity |
| `POST /api/dc` | 3802 | Creates dispatch, links project assets |
| `POST /api/temporary-assets/:id/make-permanent` | 8790 | Creates a permanent asset |
| `POST /api/employees` | — | Creates employees |
| `POST /api/assets/bulk` | 7282 | Bulk asset creation |
| `GET /api/scan` | — | Asset lookup |

CORS is wide open with credentials enabled.
**Impact:** Any locked rule about "approved business workflows" is unenforceable while these routes are open. This should be treated as a prerequisite to Phase 1, not a Phase 8 concern.

### GAP-902 · BLOCKER · Production schema does not match its migrations
**Canonical:** §34 — controlled phases, migration discipline, rollback strategy.
**Production:** Documented drift includes: inventory tables present and populated in production despite test-gated migrations; `inventory_items` quantity columns are `double precision` in production but `.float()` (→ `real`) in the migration; `project_history` columns not matching migrations; `dc_remark_templates` and `asset_history` created at runtime by application code; `temporary_assets.name` and `quantity` absent from its initial migration; `projects.company_id` read by code but present in no migration and no production table; and `ZP-SAMPLE-0001` present in production `zoho_catalog` despite its seed migration being gated to `asset_manager_test` — **how it got there is UNKNOWN.**
**Impact:** Migrations are not a reliable description of production. Every phase's rollback plan is compromised until reconciled. §34's "do not blindly run migrations" is well-founded.

### GAP-903 · BEHAVIOURAL · Duplicate route registrations
**Production:** Several routes are registered more than once in `server.js`; the first registration wins and the later one is dead code.
**Impact:** Reading the file is not sufficient to know which handler serves a request. Relevant to any phase touching existing endpoints.

### GAP-904 · LATENT · `zoho_catalog` contains two rows that are not Zoho catalogue products
**Production:** `ZP-SAMPLE-0001` (a test seed, non-numeric key — `toZohoRecordBigInt` would reject it at `zohoService.js:119-121`, so nothing derived from it can ever be pushed) and `1205624000001284002` ("Trimble Bullet 720", the round-tripped asset from GAP-107). Separately, asset `HAR-MUM-0826-IEIZP5-U` holds `zoho_product_id = 1205624000001313001`, created in Zoho **after** the last pull, so it exists in `assets` but not in the mirror.
**Impact:** Phase 1 backfill must read `assets` and `inventory_items` as well as the mirror, and must special-case both anomalies.

### GAP-905 · ALIGNED · Zoho IDs are stored as strings, with BigInt only at the SDK boundary
**Canonical:** §5, §36 — "Zoho IDs are stored as strings… the existing Product UPDATE BigInt fix must not be regressed."
**Production:** `assets.zoho_product_id`, `inventory_items.zoho_product_id`, `managed_sets.zoho_product_id` and `zoho_catalog.zoho_product_id` are all `character varying`. `toZohoRecordBigInt` (`zohoService.js:105-123`) converts at the single `setId` call site (line 557) and rejects non-numeric IDs.
**Impact:** **Correctly satisfied.** Preserve this. Note one gap in the reverse direction: `handleSyncResponse` writes the returned ID into a varchar with no coercion or format assertion (`zohoService.js:901-903`).

### GAP-906 · ALIGNED · Zoho and AssetEngine do not share a database
**Canonical:** §1.
**Production:** All communication is through the Zoho SDK in `zohoService.js`. No cross-database connection exists. Satisfied.

### GAP-907 · ALIGNED · Product carries no physical quantity
**Canonical:** §3, §36 rule 3.
**Production:** `zoho_catalog` has no quantity column of any kind, and nothing writes Zoho's `Qty_in_Stock`. Satisfied — and worth locking in deliberately when the Product entity is created.

---

# PART 2 — LOCKED RULE COMPLIANCE MATRIX

Canonical §36, in order. **✅** satisfied · **◑** partial · **❌** contradicted · **⬜** not implemented

| # | Locked rule | Status | Gap |
|---|-------------|--------|-----|
| 1 | Product is a first-class AssetEngine entity | ⬜ | GAP-101 |
| 2 | Zoho Product is an external representation/mapping | ❌ | GAP-101, 102 |
| 3 | Product has no physical quantity | ✅ | GAP-907 |
| 4 | Product Name co-managed, field-level conflict resolution | ❌ | GAP-103 |
| 5 | Product Description AssetEngine-authoritative | ❌ | GAP-104 |
| 6 | SKU optional, open-ended, manually editable both ends | ◑ | GAP-112 |
| 7 | SKU is never the canonical identity | ✅ | GAP-112 |
| 8 | Unlinked standalone Zoho Products do nothing | ❌ | GAP-105 |
| 9 | Product links arise through explicit business workflows | ❌ | GAP-105, 106 |
| 10 | Every managed Asset/Inventory record has an AssetEngine identity | ◑ | GAP-801 |
| 11 | Aggregated quantity does not generate per-unit QR | ✅ | GAP-802 |
| 12 | QR belongs to the independently managed record | ◑ | GAP-801, 803 |
| 13 | Manufacturer serial rules deferred | ✅ | — |
| 14 | Quantity can remain aggregated | ✅ | — |
| 15 | Structured records replace delimited serial text | ⬜ | GAP-211 |
| 16 | Inventory is stock held for sale/project/consumption | ◑ | GAP-303 |
| 17 | Asset is company-owned internal-use equipment | ◑ | GAP-303 |
| 18 | Inventory not assignable while Inventory | ✅ | GAP-304 |
| 19 | Inventory → Asset conversion is allowed | ⬜ | GAP-301 |
| 20 | Operator chooses grouped vs individual conversion | ⬜ | GAP-301 |
| 21 | Original Inventory records never deleted | ✅ | GAP-807 |
| 22 | Asset retains original Inventory lineage | ⬜ | GAP-302 |
| 23 | Asset returns to original Inventory lineage | ⬜ | GAP-302 |
| 24 | Return condition operator-selected | ⬜ | GAP-302 |
| 25 | Converted quantity is not available Inventory | ⬜ | GAP-209 |
| 26 | Break is non-destructive | ❌ | GAP-207 |
| 27 | Parent records remain | ◑ | GAP-207 |
| 28 | Children represent separated quantity | ✅ | GAP-206 |
| 29 | Break is recursive | ✅ | GAP-403 |
| 30 | Conversion lineage independent from Set hierarchy | ❌ | GAP-401 |
| 31 | Set creation means immediately active | ◑ | GAP-510 |
| 32 | Set definition immutable after creation | ❌ | GAP-501 |
| 33 | Sets cannot be deleted | ✅ | GAP-512 |
| 34 | Sets can contain both Assets and Inventory | ✅ | GAP-513 |
| 35 | Set membership creates reservations | ❌ | GAP-202 |
| 36 | Inventory reservation is quantity-specific | ❌ | GAP-201, 202 |
| 37 | Assets reserved as whole records | ◑ | GAP-505 |
| 38 | Insufficient quantity rejects without partial reservation | ❌ | GAP-203 |
| 39 | Set removal releases only that Set's reservation | ❌ | GAP-202 |
| 40 | Set disband does not reset unrelated state | ✅ | GAP-514 |
| 41 | Completeness EMPTY/INCOMPLETE/COMPLETE/OVERCOMPLETE | ❌ | GAP-502, 503 |
| 42 | Product substitution not allowed inside a Set | ◑ | GAP-511 |
| 43 | Requirement changes occur upstream via PO/commercial | ⬜ | GAP-602 |
| 44 | Active Sets cannot become Subsets | ⬜ | GAP-506 |
| 45 | Active Sets cannot directly create Super Sets | ⬜ | GAP-506 |
| 46 | Subsets are independent Sets with source lineage | ⬜ | GAP-506 |
| 47 | Super Sets absorb Sets without double reservation | ❌ | GAP-505 |
| 48 | Set requirements and physical allocation separate | ⬜ | GAP-502 |
| 49 | Set composition structured in AssetEngine | ⬜ | GAP-502 |
| 50 | Zoho Description not authoritative for Set composition | ◑ | GAP-517 |
| 51 | Receipt Note is an AssetEngine receiving transaction | ⬜ | GAP-601 |
| 52 | Receipt Note compares receipt against Zoho PO | ⬜ | GAP-601, 602 |
| 53 | Partial receipts supported | ⬜ | GAP-601 |
| 54 | Physical creation occurs in Receipt Note workflow | ❌ | GAP-105 |
| 55 | Product identity inherited from PO/Receipt line | ⬜ | GAP-601 |
| 56 | Zoho authoritative for commercial POs | ❌ | GAP-602 |
| 57 | AssetEngine authoritative for physical records | ✅ | — |
| 58 | Historical physical lineage reconstructable | ❌ | GAP-207, 401, 507 |
| 59 | Zoho sync explicit, idempotent, provenance-aware | ❌ | GAP-107, 108, 110 |
| 60 | Implementation proceeds one controlled phase at a time | — | process |
| 61 | Set membership history remains available | ◑ | GAP-507, 508 |
| 62 | Assets with history not casually hard-deleted | ◑ | GAP-806 |

---

# PART 3 — ALIGNMENTS TO PRESERVE

These are already correct. Protect them; do not "improve" them during implementation.

| Area | What is already right | Evidence |
|------|----------------------|----------|
| Zoho ID typing | Strings in storage, BigInt only at the single SDK boundary, non-numeric rejected | `zohoService.js:105-123`, 557 |
| System boundary | No shared database; all traffic via SDK | `zohoService.js` |
| Product has no quantity | No quantity column in the mirror; stock never pushed | `zoho_catalog` schema |
| Set deletion | No delete route; three FKs `ON DELETE RESTRICT` | `kitSetService.js` exports; live FKs |
| Set immediate activation | `createSet` writes `ACTIVE`; 0 DRAFT rows in production | `kitSetService.js:245` |
| Mixed Sets | XOR check permits both component kinds in one Set | `managed_set_components_xor_check` |
| Archive isolation | Archive touches only set + component rows | `kitSetService.js:440-451` |
| Asset exclusivity in Sets | Global unique on active `asset_id` (helps §14, blocks §19) | `managed_set_components_asset_id_active_unique` |
| Inventory non-assignability | No `assignedto` on `inventory_items` | live schema |
| Asset soft delete | Hard delete disabled; Recovery Center exists | `server.js:601-604` |
| Inventory soft delete | Delete is a flag | `server.js:5365` |
| DC as a document | `delivery_challans` is its own table | live schema |
| Project ID format | `LOC-MMYY-RAND-P` on the create path | `IdGenerator.js:25-34` |
| Managed Set authorisation | All 10 routes require JWT + role | `server.js:2789-2884` |
| Recursive break allowed | No depth limit on either path | GAP-403 |
| No fuzzy matching | No matching logic exists to remove | GAP-112 |
| Inventory kind FK | `inventory_items.kindid` FK `ON DELETE RESTRICT` — the only strongly-typed taxonomy link | live schema |

---

# PART 4 — INTERNAL CONTRADICTIONS IN THE CANONICAL DOCUMENT

These are ambiguities *within* the reference architecture. They cannot be resolved from code and must be settled before the affected phase. They are not production defects.

### AMB-01 · CRITICAL · Set immutability versus SET ADD / SET REMOVE
§14 locks "Set definition is immutable after creation" and requires disband-and-recreate to change composition. Yet §14 also specifies *"Set add/remove: ADD: available decreases and Set reservation increases. REMOVE: Set reservation decreases and available increases"*, and §29 lists **SET ADD** and **SET REMOVE** as first-class operations.

These cannot both be true as written. The most likely intent, consistent with §20, is that the **requirement layer is immutable** while the **physical allocation layer is mutable** — but §14 says "definition", not "requirements", and §20 separately states physical substitutions "are not silently allowed".
**Blocks:** GAP-501. Cannot decide whether to remove `updateSet`/`addComponent`/`removeComponent`, restrict them to the allocation layer, or keep them. **This is the single most important open question in Phase 5.**

### AMB-02 · HIGH · Super Set reservation accounting
§19 states source Sets are "absorbed/disbanded" and that the Super Set "does not independently reserve all physical children again. Existing reservations are not double-counted." But §17 states disband *releases* that Set's reservations, and §36 rule 35 states Set membership *creates* reservations.

If the source Sets are disbanded, their reservations are released; if the Super Set does not re-reserve, nothing is reserved. If instead the reservations transfer, that is a third operation neither §17 nor §19 defines.
**Blocks:** Phase 5 Super Set design, and the resolution of GAP-505.

### AMB-03 · HIGH · How an active Set "leaves its active managed state"
§18 and §19 both require that an active Set cannot directly become a Subset or feed a Super Set — it "must first leave its active managed state". But §14 states a Set is active immediately on creation and can never be deleted, and the only implemented transition is ARCHIVE.

If archiving is the intended mechanism, then Subset creation operates on an archived Set — which interacts with GAP-508 (archive deactivates components, restore does not restore them).
**Blocks:** Phase 5 Subset/Super Set lifecycle.

### AMB-04 · HIGH · Description ownership permits silent destruction of Sales edits
§4 locks Name as co-managed with *"No silent last-write-wins"*, but locks Description as AssetEngine-authoritative where *"AssetEngine may overwrite Zoho on its next authoritative update."* For Description, a Sales edit in Zoho will be destroyed with no conflict raised.

This may be exactly what is intended, given §21's requirement that Description carry the rendered Set composition. It should be confirmed explicitly, because it is the one place where the document knowingly accepts data loss in a co-managed field.
**Blocks:** Phase 1 field-ownership configuration (GAP-104).

### AMB-05 · MEDIUM · "Reserved" appears in the conservation equation but is denied for Break
§7's conservation equation includes a `reserved quantity` term. §12 states that for Break *"There is no separate 'reserved by break' quantity"* — the parent's available representation simply drops to 7 while children represent 3.

So Break reduces the parent's total representation while Set allocation reserves without reducing it. Two different quantity mechanics share one equation, and the equation does not say which term absorbs a Break.
**Blocks:** Phase 2 quantity model (GAP-201, GAP-209).

### AMB-06 · MEDIUM · Phase ordering: Product links require a workflow that arrives five phases later
§33 Phase 1 delivers `Product ↔ Asset` and `Product ↔ Inventory`. But §6 and §36 rule 54 state that links arise only through approved business workflows, and the only such workflow — Receipt Note — is Phase 6.

Phases 1 through 5 therefore have no sanctioned way to create a Product↔Asset link, which also means Phase 5's requirement layer has no Products to point at.
**Blocks:** Phase 1 scope definition. Either a transitional manual-link workflow must be sanctioned, or Phase 1 is limited to identity and backfill only.

### AMB-07 · MEDIUM · Phase ordering: Zoho PO pull is in both Phase 6 and Phase 7
§33 Phase 6 includes "Zoho PO pull" as a deliverable, while Phase 7 lists "Vendor PO" under Zoho modules. Additionally, migrating PO authority from AssetEngine's existing `project_orders` to Zoho (GAP-602) is a data-ownership change that appears in no phase at all.
**Blocks:** Phase 6/7 boundary.

### AMB-08 · LOW · Conversion return quantity semantics
§10 permits converting 2 units into either one quantity-tracked Asset or two individual Assets. §11 states an Asset always returns to the original Inventory lineage. The rules for returning *one* of two individual Assets, or a partial quantity of a grouped Asset, are unstated.
**Blocks:** Phase 3 detail design.

### AMB-09 · LOW · "Only accepted quantities normally enter physical representation"
§22's word *"normally"* leaves undefined whether rejected or damaged quantities can ever create physical records — which matters, because §11 has a "Damaged / Not Available" return condition, implying damaged goods are trackable.
**Blocks:** Phase 6 detail design.

### AMB-10 · EDITORIAL · "Assetori identity"
§8 is titled "Assetori identity and QR". The term "Assetori" appears nowhere in the codebase or in any prior audit. Presumed to mean "AssetEngine identity". Worth correcting so implementers do not search for a non-existent concept.

### AMB-11 · MEDIUM · No security or authorisation model
The canonical document defines no authentication, authorisation or role model, yet it repeatedly relies on "approved business workflows" and operator choices (§6, §10, §11, §22). Production has unauthenticated mutating routes (GAP-901).
**Blocks:** Every rule that depends on who may perform an operation.

---

# PART 5 — PRODUCTION ENTITIES NOT COVERED BY THE CANONICAL ARCHITECTURE

These exist in production and are unmapped. Each needs a decision: keep, absorb, or retire.

| # | Entity / mechanism | Reality | Question |
|---|--------------------|---------|----------|
| **UNMAPPED-01** | `temporary_assets` | A parallel asset-like entity with `projectid`, `estimatedprice`, `linked_po_item_id`, `ispermanent`, promoted via unauthenticated `make-permanent` (`server.js:8790`). Surfaced in the projects UI alongside real assets | Is this Receipt Note prior art, a third physical entity, or to be retired? It is the closest thing to receiving that exists |
| **UNMAPPED-02** | `components` table | A parallel table to `assets`; the only cross-table duplicate trigger, `trg_check_assets_dup`, protects `assets` ↔ `components`. Rows are hard-deleted alongside assets on unsplit (`server.js:11687`) | Sub-assembly? Legacy? It participates in the destructive unsplit path |
| **UNMAPPED-03** | `quotes` table | 4 columns, 0 rows, in AssetEngine — a commercial entity inside the physical system | Retire, or is a local quote mirror intended? |
| **UNMAPPED-04** | `project_orders` / `project_order_items` | AssetEngine's live PO module, currently the PO system of record (GAP-602) | Migrate authority to Zoho, keep as logistics-side receiving expectations, or dual-run? |
| **UNMAPPED-05** | `asset_kinds` / `inventory_kinds` | Two taxonomies. `asset_kinds` primary key is **`name`** (11 rows), so renaming a kind breaks references. `inventory_kinds` is id-keyed with an FK from items (2 rows) | How do Kind and Product coexist? Do Make/Model move to Product? |
| **UNMAPPED-06** | `assets.set_price_mode` | Legacy set pricing, default `SUM_OF_CHILDREN` (`server.js:6732`) | Does a commercialized Set derive price from components? §4 leaves Price ownership open |
| **UNMAPPED-07** | Location / warehouse model | `currentlocation` is free text; no location entity | §37 claims AssetEngine knows "where those resources are". Multi-location stock has no representation |
| **UNMAPPED-08** | Employee / team assignment | A single free-text `assets.assignedto` column. No team concept, no join table, no guards | §2 says an Asset "may be assigned to an employee/team". Team does not exist |
| **UNMAPPED-09** | Rentals | Mentioned in §26 and Phase 8; no model exists | Deferred — confirm |
| **UNMAPPED-10** | Serial encryption | Asset `srno` encrypted deterministically; `inventory_items.srno` plaintext; no uniqueness anywhere; ciphertext leaks to Zoho (GAP-111) | §8 defers serial rules, but the asymmetry blocks conversion |
| **UNMAPPED-11** | `dc_remark_templates` | Created lazily at runtime by `GET /api/dc-remarks`; production instead has an unused `remark_templates` table, so the feature has never been exercised | Retire or formalise |
| **UNMAPPED-12** | Recovery Center | An existing soft-delete restore surface across entity types | Should it govern Set restore, given GAP-508? |

---

# PART 6 — PHASE READINESS ASSESSMENT (§33)

| Phase | Canonical scope | Readiness | Blocking items |
|-------|-----------------|-----------|----------------|
| **1 — Product foundation** | Product entity, Zoho mapping, provenance, field ownership, Product↔Asset/Inventory, coexistence with `zoho_catalog` | **Not ready** | AMB-04, AMB-06 (no sanctioned link workflow before Phase 6), GAP-108 (single-page pull), GAP-109 (hardcoded write-back), GAP-904 (backfill anomalies), GAP-902 (migration drift), plus the five open business decisions in the Product decision document |
| **2 — Quantity / physical identity** | Structured quantity records, IDs, QR, aggregate vs unit | **Not ready** | GAP-206 (two split systems must be reconciled first), GAP-210 (float → numeric), GAP-152 (shared ID space), GAP-801 (inventory QR), AMB-05. **Reservation columns are needed here, not in Phase 5** |
| **3 — Conversion** | Inventory→Asset, Asset→Inventory, grouped vs individual, conservation, lineage | **Not ready** | Depends on Phase 1 (`product_id` as the invariant) and Phase 2. GAP-209 (no converted bucket), GAP-302 (no lineage column), GAP-205 (no conservation check), AMB-08 |
| **4 — Break / Individualize** | Break, Make Individual, recursive lineage, quantity accounting, parent retention | **Not ready** | GAP-207 (**hard delete must be fixed first — it is actively destructive**), GAP-401 (`parentid` overloading), GAP-402 (root propagation on one path only), GAP-208 |
| **5 — Set engine** | Immutable Sets, reservation, requirement + allocation layers, completeness, disband, Subset, Super Set | **Not ready** | **AMB-01 is a hard stop.** Also GAP-501, 502, 504, 505, 507, 508, 201-204, AMB-02, AMB-03 |
| **6 — Receipt Note / GRN** | Zoho PO pull, Receipt Note, partial receiving, accepted/rejected, Product inheritance, Asset/Inventory creation, Zoho projection | **Not ready** | GAP-602 (PO authority currently local — an ownership migration in no phase), GAP-601, AMB-07, AMB-09, UNMAPPED-01, UNMAPPED-04 |
| **7 — Zoho modules** | Product sync, Set custom module, commercialization, Vendor/Customer PO, Work Order, Projects | **Not ready** | GAP-103, 104, 110, 111, 517 (legacy push must be retired, not extended), GAP-153 + GAP-704 (Project ID derivation), GAP-901 |
| **8 — DC / Projects / Rentals** | After physical foundations are stable | **Not ready** | GAP-701 (no inventory or set attachment), GAP-703 (DC moves no quantity), GAP-702, UNMAPPED-07, UNMAPPED-09 |

**No phase is ready to begin as scoped.** Phase 1 is the closest, and the safe first increment identified in the Product decision document — create `product` and `product_external_ref`, backfill identity and provenance, change no behaviour — remains viable and is unaffected by any contradiction in this analysis.

---

# PART 7 — RECOMMENDED SEQUENCING CORRECTIONS

Offered for consideration, not as decisions. Each states the reason from evidence.

**1. Insert a Phase 0 for containment.** Three production behaviours actively destroy or corrupt the data the later phases depend on, and none is a feature: the hard deletes in unsplit and project-unassign (GAP-207), archive/restore losing Set membership (GAP-508), and the unauthenticated mutating routes (GAP-901). Fixing these does not require any architectural decision and protects everything built afterwards.

**2. Move reservation from Phase 5 to Phase 2.** Reservation is a quantity concern, not a Set concern — §7's conservation equation contains a `reserved` term. Projects and DC will need it too. Building it inside Phase 5 makes it Set-shaped and guarantees a second implementation when Projects reach Phase 8.

**3. Resolve the two split implementations before Phase 2, not during it.** GAP-206 means "structured quantity records" has two incompatible starting points. Migrating both simultaneously is materially harder than converging them first.

**4. Treat `parentid` disambiguation as its own tracked workstream.** GAP-401 is the only contradiction that cannot be fixed additively. Every row with a `parentid` needs interpretation as split lineage, legacy set membership, or sub-assembly. Production has 1 such row today — this is the cheapest it will ever be.

**5. Decide PO authority before Phase 6 is scoped.** GAP-602 is an ownership migration of a working module, and it appears in no canonical phase. Phase 6 cannot be estimated without it.

**6. Design requirement/allocation separation as a shared pattern, not a Set feature.** §20's two-layer model is exactly what Projects need (§26). Building it Set-specific guarantees a second implementation in Phase 8.

**7. Add a security phase, or fold authorisation into every phase.** AMB-11: the canonical document has no security model, and "approved business workflow" is unenforceable without one.

---

# PART 8 — WHAT MUST BE ANSWERED BEFORE ANY IMPLEMENTATION

Ordered by how much they block.

| # | Question | Source | Blocks |
|---|----------|--------|--------|
| 1 | Does Set immutability apply to the requirement layer only, with allocation mutable? If so, what happens to `updateSet`, `addComponent`, `removeComponent`? | AMB-01 | All of Phase 5 |
| 2 | Confirm Description is AssetEngine-authoritative and Sales edits to it are expected to be lost | AMB-04 | Phase 1 field ownership |
| 3 | Is a transitional manual Product↔Asset/Inventory link workflow sanctioned before Receipt Note exists? | AMB-06 | Phase 1 scope |
| 4 | Where does PO authority live during transition — Zoho, AssetEngine, or both? | GAP-602, AMB-07 | Phase 6 |
| 5 | How do Super Set reservations transfer without double counting and without being released? | AMB-02 | Phase 5 |
| 6 | Is ARCHIVE the mechanism by which a Set "leaves its active managed state"? | AMB-03 | Phase 5 |
| 7 | Which quantity term absorbs a Break in the conservation equation? | AMB-05 | Phase 2 |
| 8 | Do Make/Model move to Product, and how do Product and Kind coexist? | UNMAPPED-05 | Phase 1 |
| 9 | What happens to `temporary_assets` — Receipt Note prior art, third entity, or retire? | UNMAPPED-01 | Phase 6 |
| 10 | Ownership of Product Name, SKU, Price and Status (still open from the Product decision document) | §4 | Phase 1 |
| 11 | Is quantity migrated from float to `numeric`, and when? | GAP-210 | Phase 2 |
| 12 | Is the legacy `parentid` set model migrated to Managed Sets, or frozen and read-only? | GAP-401, GAP-515 | Phases 4 and 5 |

---

# PART 9 — SUMMARY

**Contradictions:** 67 (27 BLOCKER, 13 STRUCTURAL, 21 BEHAVIOURAL, 5 LATENT, 1 TERMINOLOGY) · **Confirmed alignments:** 14 · **Internal ambiguities in the canonical document:** 11 · **Unmapped production entities:** 12 · **Locked rules contradicted:** 18 of 62

**The three foundations the canonical architecture rests on are all absent.** There is no Product entity, no reservation representation of any kind, and no quantity conservation check. Every Set, conversion and receiving rule depends on at least one of them.

**The Managed Set module is a composition tracker, not a reservation engine.** It records what is grouped; it does not reserve, does not check availability, does not know requirements from allocations, and writes no history. Adding to a Set has no effect on availability anywhere in the system, and an inventory item can be claimed by unlimited Sets simultaneously.

**Three production behaviours are actively destructive today** and should be contained before anything is built on them: unsplit and project-unassign hard-delete asset rows, and archive/restore silently empties a Set. Production already shows 11 of 12 component rows inactive.

**One contradiction cannot be fixed by addition.** `assets.parentid` encodes split lineage, legacy Set membership and sub-assembly membership with no discriminator, which §13 explicitly forbids. Any separation requires per-row interpretation. With one such row in production today, this is the cheapest it will ever be to fix.

**The canonical document contradicts itself on the single most important Set rule.** §14 locks Set definitions as immutable while §14 and §29 both define SET ADD and SET REMOVE as operations. Phase 5 cannot start until that is reconciled.

**What is already right is worth protecting:** Zoho ID string storage with BigInt confined to one SDK boundary, the clean system boundary, Set non-deletability, soft-delete discipline on the main paths, and full JWT plus role protection on all ten Managed Set routes.

**Nothing here prevents the safe first increment** identified in the Product architecture decision: create `product` and `product_external_ref`, backfill identity and provenance from `zoho_catalog` plus `assets.zoho_product_id`, and change no behaviour. It is additive, reversible, and independent of every contradiction above.

---

*End of analysis. No code, schema, migration, production data, Zoho record, OAuth configuration or UI was modified in producing this document.*
