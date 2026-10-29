# ADR — Delivery Challan Physical Dispatch Disposition and Ownership Lifecycle

**Status:** Accepted  
**Date:** 2026-09-25  
**Deciders:** AssetEngine product / engineering  

## Context

Delivery Challans previously soft-committed holdings on **create** (`assets.sentagainstdc`) with status `Initializing → Pending`, without a DRAFT / READY / DISPATCHED physical disposition workflow, without a Dispatch Reason, and without invoking reservation or ownership-exit primitives.

Operators need an explicit answer to: **why is this physical resource leaving Cineom?** and a correct physical consequence when the DC is actually dispatched.

## Decision

1. **Separate DC lifecycle status from Dispatch Reason.**  
   - Lifecycle: `DRAFT → READY → DISPATCHED` (or `VOID` before dispatch). Legacy rows: `LEGACY`.  
   - Reason: `DEMO | RENTAL | REPAIR | SALE` (historical: `LEGACY_UNSPECIFIED`).

2. **DC is not a stock ledger.** Create and READY do not permanently change owned quantity. DISPATCH is the sole physical commit point, using existing Asset / Inventory / Reservation / quantity-event primitives.

3. **Physical mutation mapping**

| Reason | Asset status | Inventory effect | Ownership |
|--------|--------------|------------------|-----------|
| DEMO | `Out on Demo` | Keep DC reservation (available↓, owned total unchanged) until return | Retained |
| RENTAL | `Out on Rental` | Same as DEMO | Retained |
| REPAIR | `Out for Repair` | Same as DEMO | Retained |
| SALE | `Sold` + `is_retired` | Release reservation; reduce `quantity_total` + `quantity_available` | Exit |

4. **READY reserves** holdings with `owner_type=DC`. On DEMO/RENTAL/REPAIR **asset** dispatch, reservation is **released** and status blocks re-reserve. On inventory temporary disposition, reservation **remains** until return. On SALE, reservation releases then ownership exits.

5. **Return foundation** for DEMO/RENTAL/REPAIR only — superseded by [DC_RETURN_INWARD_LIFECYCLE_ADR.md](./DC_RETURN_INWARD_LIFECYCLE_ADR.md) (Return Log + RETURN_INWARD RN; physical restore on RN POST). SALE has no ordinary return (future corrective lifecycle).

6. **Outbox** `dc_dispatch_outbox` emits `DC_DISPATCHED` once — **no Zoho Books API** in this phase.

7. **RBAC V2:** `dc.ready`, `dc.dispatch`, `dc.cancel` promoted to live action permissions (with `dc.void`).

## Rejected alternatives

- Decrementing quantity fields directly without lineage/reservation.
- Inferring reason from Project / PO / customer type.
- Treating create as dispatch (legacy soft-commit).
- Calling Zoho Books from DC dispatch.
- Inventing a parallel DC quantity ledger.

## Consequences

- New creates are DRAFT; operators must READY then DISPATCH.
- Existing Pending DCs are `LEGACY` + `LEGACY_UNSPECIFIED` — not retroactively assigned DEMO/RENTAL/REPAIR/SALE.
- Reservation eligibility blocks `Out on Demo|Rental|Repair` and `Sold`.
- Future Books adapter consumes `dc_dispatch_outbox` / `DC_DISPATCHED` payload; AE remains physical authority.

## Future (explicitly out of scope)

- Zoho Books Sales Order / Invoice mapping for SALE.
- Sale reversal corrective lifecycle.
- Full repair-ticket / rental billing modules.
