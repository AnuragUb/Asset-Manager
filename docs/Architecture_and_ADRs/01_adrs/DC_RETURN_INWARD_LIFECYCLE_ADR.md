# ADR — Delivery Challan Return Inward and Return Log Lifecycle

**Status:** Accepted  
**Date:** 2026-09-25  
**Deciders:** AssetEngine product / engineering  

## Context

ADR *DC Dispatch Disposition* established DEMO / RENTAL / REPAIR / SALE physical outbound behaviour. Temporary dispositions left holdings outside Cineom with only an immediate `POST /api/dc/:id/return` restore path.

Operators need a full return lifecycle that:

- keeps the original DISPATCHED DC historically immutable
- supports zero, one, or many partial returns over time
- uses the existing Receipt Note engine (not a second Return Notes system)
- restores physical stock only when a Return Inward RN is **POSTED**
- rejects SALE through ordinary return

## Decision

1. **Returns are an add-on lifecycle attached to the originating DC.**  
   The DC remains `DISPATCHED`. Derived return position: `NO_RETURN | PARTIALLY_RETURNED | FULLY_RETURNED` (computed from disposition lines; not a DC lifecycle rewrite).

2. **Return Log (`RET-MMYY-XXXXXX-C`) + Return Inward Receipt Note.**  
   - Return Log N:1 DC, 1:1 Return Inward RN  
   - Creating a Return Log creates an **OPEN** RN with `inward_kind = RETURN_INWARD`  
   - No stock effect on create / OPEN / CANCEL  
   - **POST** is the sole physical commit (mirrors purchase Receipt Note)

3. **`receipt_note.inward_kind`:** `PURCHASE_INWARD` (default) | `RETURN_INWARD`.  
   RETURN_INWARD: originating document is DC; `po_id` may be null; PO accepted quantity and procurement receipt history are untouched.

4. **Returned By / Received By / Recorded By stay distinct.**  
   - Returned By → external party (`returned_by_party`, Account name when available)  
   - Received By → Cineom employee (`received_by_user`)  
   - Recorded By → authenticated actor (audit / `created_by`)

5. **Return Reason ≠ Dispatch Reason.**  
   Catalog: `DEMO_COMPLETED`, `RENTAL_COMPLETED`, `REPAIR_COMPLETED`, `CUSTOMER_RETURN`, `PROJECT_COMPLETED`, `UNUSED_RETURN`, `DAMAGED_RETURN`, `OTHER`.

6. **Asset identity fail-closed.** Same Asset ID; serial must match disposition snapshot or asset serial when known. No substitution.

7. **Inventory returns are quantity-bounded** against outstanding dispatched qty (posted + OPEN pending). Use reservation release primitives; do not invent a second quantity engine.

8. **Physical restore mapping**  
   - DEMO / RENTAL → prior eligible status (typically In Store)  
   - REPAIR → prior status, or `Under Inspection` if prior was out-for-repair  
   - Ownership totals unchanged for temporary dispositions  
   - SALE → no ordinary Return Inward

9. **Outbox** `dc_return_inward_outbox` / event `RETURN_INWARD_POSTED` — future integration only. **No Zoho Books / CRM / financial posting.**

10. **RBAC V2:** `return_log.view`, `return_log.create` plus existing `receipt_note.*` for RN post/cancel. No per-reason permissions.

## Rejected alternatives

- A separate Return Notes engine parallel to Receipt Notes  
- Mutating original DC lines / pretending DC was never dispatched  
- Restoring stock on Return Log create or RN OPEN  
- Collapsing Returned By / Received By / Recorded By  
- Reusing Dispatch Reason as Return Reason  
- Ordinary SALE return / sale reversal in this phase  

## Consequences

- Immediate restore via disposition `returnFromDispatch` is deprecated; it creates Return Log + OPEN RN instead  
- Historical DCs without returns remain `NO_RETURN` / unspecified — no fabricated Return Logs  
- Return Inward reverse is blocked (`RETURN_INWARD_REVERSE_BLOCKED`) pending a controlled corrective design  

## Schema

Migration: `20260925140000_dc_return_inward_lifecycle.js`  
Scratch DB: `asset_manager_dc_return_scratch`  
Production not migrated until scratch verification passes.
