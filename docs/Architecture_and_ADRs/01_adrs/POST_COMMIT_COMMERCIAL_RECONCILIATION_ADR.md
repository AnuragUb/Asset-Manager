# ADR — Post-Commit Commercial Revision and Physical Reconciliation

**Status:** Accepted  
**Date:** 2026-09-25  
**Deciders:** AssetEngine product / engineering  

## Context

After Receipt Notes are POSTED, Zoho PO refreshes may lower `ordered_qty` below physically accepted quantity. Historically operators “fixed” this with Tally/JV mental mapping: edit RN, rewrite Purchase Book, or manually reduce Inventory.

AssetEngine already blocked further receiving (`RECONCILIATION_REQUIRED`) but had **no operator resolution path**.

### Audit facts (codebase)

| Concept | Actual meaning |
|---------|----------------|
| `procurement_po` | Zoho CRM mirror; **in-place refresh** (no family/version tables yet) |
| Purchase Book | Vendor **Tax Invoice** commercial book (`PBK-`); not stock birth |
| CREDIT Purchase Book | Commercial credit/capacity adjustment — **not** physical Vendor Return |
| Outward Purchase Book | **Does not exist** as a module |
| Receipt Note POSTED | Physical facts immutable; reverse is controlled |
| Customer Return Inward | `RET-` + `RETURN_INWARD` RN — Customer → Cineom |
| Vendor physical return | **Did not exist** — introduced here as `PRTN-` |

## Decision

1. **Commercial history may revise; committed physical history must not be rewritten.**  
   PO refresh may change commercial qty. POSTED RN / Asset / Inventory lineage stay intact.

2. **`procurement_reconciliation` (PREC-…)** opens when `accepted > ordered` on a PO line.  
   Stores commercial vs physical snapshots. `po_family_id` / `po_version_id` reserved nullable until PO versioning ships. Do **not** invent fake historical reconciliations.

3. **Operator answers physical questions only:**  
   - **RETURN TO VENDOR** → Vendor Purchase Return (`PRTN-…`) OPEN → READY → **DISPATCH** (sole physical commit)  
   - **RETAIN IN CINEOM** → retained qty recorded; physical stock unchanged  

4. **Vendor Return ≠ Customer Return Inward.** Opposite physical direction; separate identity and tables.

5. **Purchase Book CREDIT remains commercial.** It does not exit stock. Physical exit is only Vendor Return DISPATCH (or future dedicated paths).

6. **POSTED RN / POSTED Purchase Book commercial qty** stay non-editable. Corrections use reverse/void + new documents or reconciliation — never silent rewrite.

7. **Outbox** `VENDOR_RETURN_DISPATCHED` for future Zoho Books Purchase Return / credit mapping. **No Books API / OAuth in this phase.**

8. **RBAC V2:** `procurement_reconciliation.view|resolve`, `vendor_return.view|create|edit|ready|dispatch|cancel`. Logistics may operate Vendor Return; **resolve (retain)** is Manager/Admin class.

## Rejected alternatives

- Editing POSTED RN qty to match revised PO  
- Rewriting Inventory totals without lineage  
- Treating CREDIT Purchase Book as Vendor Return stock exit  
- Merging customer Return Inward with vendor return  
- Asking operators to create JVs / inventory adjustments / credit notes as the primary UX  

## Consequences

- Refresh/import that lowers ordered below accepted opens PREC records and surfaces UI: Return vs Retain  
- Physical owned qty drops only on Vendor Return DISPATCH  
- Retained excess remains physically real and counted owned  
- Full PO versioning remains a future enhancement; reconciliation already snapshots commercial qty at open  

## Schema

Migration: `20260925160000_procurement_reconciliation_post_commit_lifecycle.js`  
Scratch: `asset_manager_procurement_reconciliation_scratch`
