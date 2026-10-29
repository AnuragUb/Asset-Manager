# DC Dispatch Disposition — Implementation Report

**Date:** 2026-09-25  
**Scratch DB:** `asset_manager_dc_disposition_scratch`  
**Production schema:** **unchanged** (migration not applied to `asset_manager`)

## 1. Files changed

| Path | Change |
|------|--------|
| `migrations/20260925120000_dc_dispatch_disposition_lifecycle.js` | Schema + RBAC grants |
| `services/dcDispositionService.js` | READY / DISPATCH / RETURN / reason |
| `services/reservationService.js` | Block Out on Demo/Rental/Repair |
| `services/permissionCatalog.js` | Promote dc.ready/dispatch/cancel |
| `services/deliveryChallanEventService.js` | (types extended via migration) |
| `server.js` | Create=DRAFT; routes; schema gate |
| `frontend/index.html` | Dispatch Reason + lifecycle buttons |
| `frontend/js/dashboard.js` | Create/ready/dispatch/return wiring |
| `frontend/js/dcDocumentView.js` | Print model status + reason |
| `frontend/templates/documents/dc/delivery-challan.html` | Dispatch Reason on print |
| `frontend/js/main.js` | Cache bump |
| `docs/.../DC_DISPATCH_DISPOSITION_ADR.md` | ADR |
| `docs/Architecture_and_ADRs/README.md` | Index |
| `scripts/dc-disposition-verify.js` | Scratch verify |

## 2. Migration

`20260925120000_dc_dispatch_disposition_lifecycle.js`

## 3. Schema changes

- `delivery_challans`: `lifecycle_status`, `dispatch_reason`, `ready_at/by`, `dispatched_at/by`, `returned_at/by`
- `dc_disposition_line` (per-line disposition + return)
- `dc_dispatch_outbox` (`DC_DISPATCHED`, PENDING — no Books sender)
- Event types: `READY`, `DISPATCHED`, `RETURNED`
- Permissions: `dc.ready`, `dc.dispatch`, `dc.cancel`

## 4. Lifecycle before → after

| Before | After |
|--------|--------|
| Create stamps `sentagainstdc`, status Pending | Create = **DRAFT**, no physical stamp |
| No READY/DISPATCH | **READY** (reserve) → **DISPATCH** (physical commit) |
| Void anytime | Void/cancel blocked after DISPATCH |
| No reason | DEMO / RENTAL / REPAIR / SALE |

Legacy rows: `lifecycle_status=LEGACY`, `dispatch_reason=LEGACY_UNSPECIFIED`

## 5–8. Reason / Asset / Inventory / Reservation

See ADR. Summary: DEMO/RENTAL/REPAIR retain ownership; SALE exits ownership via `Sold`+retire / inventory total↓.

## 9. Return

`POST /api/dc/:id/return` for DEMO/RENTAL/REPAIR. SALE → `SALE_NO_RETURN`.

## 10–11. Events / outbox

`delivery_challan_event` DISPATCHED with reason; `dc_dispatch_outbox` exactly once per DC.

## 12. RBAC

`dc.create`, `dc.ready`, `dc.dispatch`, `dc.cancel`/`dc.void` — no role-name checks.

## 13. API routes

- `POST /api/dc` (DRAFT)
- `PATCH /api/dc/:id/dispatch-reason`
- `POST /api/dc/:id/ready`
- `POST /api/dc/:id/dispatch`
- `POST /api/dc/:id/return`
- `POST /api/dc/:id/void` (pre-dispatch)

## 14–15. UI / print

Dispatch Reason required on form; READY/DISPATCH buttons; print shows Status + Dispatch Reason.

## 16–17. Tests / scratch

`DC_DISPOSITION_VERIFY_OK` on scratch: DEMO ready→dispatch→dup block→reason immutable→reserve block→outbox→event→return; SALE→no return.

## 18. Production schema

Confirmed: `asset_manager` has **no** `lifecycle_status` / `dispatch_reason` columns yet. Routes return `SCHEMA_PENDING` until migrate.

## 19. Zoho Books

**NONE** — outbox only.

## 20. ADR

`docs/Architecture_and_ADRs/01_adrs/DC_DISPATCH_DISPOSITION_ADR.md`

## 21. Unresolved future decisions

- When to migrate production
- Books mapping for SALE (SO vs Invoice)
- Sale reversal corrective lifecycle
- Inventory qty-event table column shape for SALE exit audit (best-effort insert)
- Whether READY should be skippable for non-physical DCs in one click

## Rollout

```bash
# After approval only:
npx knex migrate:up 20260925120000_dc_dispatch_disposition_lifecycle.js
# then reload permissions cache / restart
```
