# DC Return Inward + Return Log — Implementation Report

**Date:** 2026-09-25  
**Scratch DB:** `asset_manager_dc_return_scratch`  
**Migration:** `20260925140000_dc_return_inward_lifecycle.js` (applied on scratch only)  
**Production schema:** untouched (`dc_return_log` absent; disposition columns absent on `asset_manager`)

## 1. Files changed

### Backend
- `migrations/20260925140000_dc_return_inward_lifecycle.js` (new)
- `services/dcReturnInwardService.js` (new)
- `services/dcDispositionService.js` — `returnFromDispatch` delegates to Return Log path
- `services/receiptService.js` — RETURN_INWARD post/cancel/reverse branch; public note/line fields
- `services/permissionCatalog.js` — `return_log.view` / `return_log.create`
- `IdGenerator.js` / `utils.js` — `RET-` IDs
- `server.js` — return APIs + DC GET return position/logs
- `scripts/dc-return-inward-verify.js` (new)

### Frontend
- `index.html` — Return Inward form on DC lifecycle panel
- `js/dashboard.js` — create return log flow; preview reload with return history
- `js/dcDocumentView.js` — RETURN HISTORY section (no-print)
- `js/receipts.js` — RETURN INWARD RN detail (not vendor PO UI)

### Docs
- `docs/Architecture_and_ADRs/01_adrs/DC_RETURN_INWARD_LIFECYCLE_ADR.md`
- `docs/Architecture_and_ADRs/README.md`
- `docs/Architecture_and_ADRs/01_adrs/DC_DISPATCH_DISPOSITION_ADR.md` (pointer)

## 2–4. Migration / schema / Return Log

| Object | Purpose |
|--------|---------|
| `receipt_note.inward_kind` | `PURCHASE_INWARD` \| `RETURN_INWARD` |
| `receipt_note.delivery_challan_id`, `return_log_id`, `return_reason`, `returned_by_party`, `received_by_user` | RETURN_INWARD context |
| `po_id` nullable when RETURN_INWARD | PO not required |
| `receipt_note_line.disposition_line_id`, `resource_*`, `serial_snapshot` | Link to DC disposition |
| `dc_disposition_line.quantity_returned` | Cumulative returned qty |
| `dc_return_log` / `dc_return_log_line` | Return Log RET-… |
| `dc_return_inward_outbox` | `RETURN_INWARD_POSTED` |
| permissions | `return_log.view`, `return_log.create` |

**Return Log:** id `RET-MMYY-XXXXXX-C`, status OPEN|POSTED|CANCELLED, links DC + RN, return reason, returned-by, received-by, account/project, notes, audit actors.

## 5–7. Return Inward RN / relationships / partial returns

- RN lifecycle unchanged: OPEN → POSTED | CANCELLED; reverse blocked for RETURN_INWARD
- DC 1 → N Return Logs; each Return Log 1 → 1 RN
- Partial returns accumulate on `quantity_returned`; OPEN returns reserve outstanding
- Derived DC position: NO_RETURN / PARTIALLY_RETURNED / FULLY_RETURNED

## 8–12. Asset / Inventory / Reason / Parties / State

- Asset: exact ID; serial fail-closed when known
- Inventory: qty ≤ outstanding (posted + OPEN pending); reservation release on POST
- Return Reason catalog distinct from Dispatch Reason
- Returned By / Received By / Recorded By distinct fields
- DEMO/RENTAL → prior eligible status; REPAIR → prior or `Under Inspection`

## 13–18. Reservation / UI / audit / outbox / RBAC

- Temporary inventory holds released via `reservationService.release` on POST
- DC preview: RETURN HISTORY + position; RN UI: RETURN INWARD banner (no PO vendor card)
- Events: `NOTE_OPENED` metadata `RETURN_INWARD_CREATED` / `RETURN_LOG_CREATED`; RN `POSTED` + outbox `RETURN_INWARD_POSTED`; DC event `RETURNED`
- Permissions: `return_log.view`, `return_log.create` (+ existing `receipt_note.post` etc.)

## 19–20. Scratch verification / production

Scratch verify passed:
- FULL ASSET RETURN (OPEN no effect → POST restores)
- PARTIAL + MULTIPLE
- DUPLICATE reject
- SALE reject
- CANCEL OPEN no physical

Production `asset_manager`: no `dc_return_log`; no disposition columns.

## 21–22. ADR / future

ADR created: `DC_RETURN_INWARD_LIFECYCLE_ADR.md`

**Unresolved / future**
- Inventory over-return / partial qty UI line picker
- Return Inward reverse / corrective lifecycle
- Sale reversal (high-risk, separate)
- Zoho Books consumer for `RETURN_INWARD_POSTED`
- Configurable return-reason catalog table (currently CHECK enum)
- Serial always present on disposition lines for fail-closed UI
