# P0 Lifecycle Containment — Implementation

**Date:** 31 August 2026  
**Purpose:** Stop unsafe alternative writers so the Phase 1–9 lifecycle is the only safe public path for creating/mutating physical state. Not a redesign.

## Authority matrix

| Path | Status |
|------|--------|
| ReceiptService | CANONICAL |
| BreakService | CANONICAL |
| ConversionService | CANONICAL |
| ReservationService | NO PHYSICAL CREATE |
| SetService | NO DIRECT PHYSICAL CREATE |
| `POST /api/inventory/items` | CONTAINED |
| `POST /api/assets` | CONTAINED |
| `POST /api/assets/bulk` | CONTAINED |
| Catalog instantiate | CONTAINED (same Inventory POST) |
| `POST /api/assets/make-set` | CONTAINED |
| `POST /api/assets/split` quantity | DELEGATE to `breakService` only |
| `POST /api/assets/split` serial | CONTAINED |
| `POST /api/assets/unsplit` | CONTAINED (Phase 5 classification kept) |
| `POST /api/temporary-assets/:id/make-permanent` | CONTAINED |
| `POST /api/zoho/sync-asset/:id` | CONTAINED |
| `POST /api/external/sheets-sync` new insert | CONTAINED |

## Reason codes

| HTTP | reasonCode | Operator message |
|------|------------|------------------|
| 409 | `PHYSICAL_CREATION_VIA_RECEIPT_REQUIRED` | New Assets/Inventory must be created through a Receipt Note. |
| 409 | `LEGACY_SET_OPERATION_DISABLED` | Sets are assembled through Set Requirements and Allocation. |
| 410 | `LEGACY_SPLIT_CONTAINED` | Legacy serial Split is disabled. Use Break to individualize quantity. |
| 409 | `LEGACY_PHYSICAL_CREATE_CONTAINED` | Temporary assets cannot be promoted to physical stock. |
| 410 | `LEGACY_ASSET_ZOHO_PUSH_CONTAINED` | Products are published from the Product workspace. |

Auth on contained routes: unauthenticated **401**, Sales/`user` **403**, Logistics (superuser/admin/manager) then the 409/410 above. Stronger than before for `POST /api/assets`, `make-set`, `make-permanent`, and `bulk` (those last two were previously unauthenticated).

## Compatibility decisions

- Dead handler bodies were left in place after early `return` so rollback is a revert, not a rewrite.
- Quantity Split still returns `shimmedToBreak: true` and now `delegatedToBreak: true`. It does **not** auto-assign, write `project_assets`, or set `parentid`.
- Serial Split is not auto-delegated to Break.
- Make Set is **not** silently rewritten into Set allocation.
- Catalog “Create Inventory” is replaced with **Create Product** (`POST /api/products/from-catalog`). No physical row.
- Unsplit classification unchanged: canonical children **INACTIVATE**; ambiguous **409**; Set-like `parentid` **SET_CLEAR**. `LEGACY_UNSPLIT_HARD_DELETE` remains **OFF**.
- `promoteToAsset` remains INTERNAL for Projects component assignment (Projects redesign is out of scope).
- No schema changes. No OAuth/token/`.env` changes. No migration of `parentid` / `is_set` / `assets.zoho_product_id`.

## Rollback

Revert the listed files. Contained routes become live writers again. No DB down-migration is required.

## Test results

Scratch `asset_manager_p0_containment_scratch` (restored from production dump):

- P0 containment + Phase 1–9 regression: **57 / 57 PASS**
- Protected IDs unchanged during scratch mutations

Production `asset_manager`:

- Backup: `backups/8080_prod/p0_containment.dump`
- Baseline: `web-app/asset-manager-backend/scripts/reports/p0-prod-before.json`
- Restart `asset-manager-prod`: READY
- HTTP containment + checksum compare: **82 / 82 PASS**
- HTML cache: `main.js?v=7.26`, `asset-view.js?v=7.26`
- Existing business-row mutation count: **0**
- Protected records changed: **0**
- Schema / OAuth / token changes: **none**

Phase 1 product-count assertion now accepts production’s current 203 Products (200 ZOHO + 1 ASSET + later ASSETENGINE). Phase 7 “LOCAL only” also accepts `NOT_FOUND` when `poSource=ZOHO` against a local PO (Phase 9 procurement lookup). Neither change is an engine rewrite.

---

## Architectural refinement — Physical Intake (1 September 2026)

P0 containment remains intact. Direct `POST /api/assets`, `POST /api/inventory/items`, catalog physical create, Make Set, and serial Split stay contained.

The 31 August rule “Receipt Note is the only birth point for physical stock” was **too absolute**. The refined canonical rule:

> Receipt Notes are the canonical physical-birth path for **procurement** stock. Physical Intake is the controlled canonical path for **legitimate non-procurement** stock.

Physical Intake (`POST /api/physical-intakes`) is a first-class immutable operation (`INTAKE-MMYY-XXXXXX-C`). It requires an existing Product, an explicit intake type, and (where specified) a reason. It creates one Asset or one Inventory holding with provenance `physical_intake_id`. It does not create PO, Receipt Note, reservation, Set, conversion, or Break.

Do not restore general-purpose Asset/Inventory create routes.

See `docs/ASSETENGINE_CANONICAL_ARCHITECTURE.md` **ADR-INTAKE-001**.
