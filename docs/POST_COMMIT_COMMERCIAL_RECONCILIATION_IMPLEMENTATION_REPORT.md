# Post-Commit Commercial Reconciliation — Implementation Report

**Date:** 2026-09-25  
**Scratch:** `asset_manager_procurement_reconciliation_scratch`  
**Migration:** `20260925160000_procurement_reconciliation_post_commit_lifecycle.js`  
**Production:** `procurement_reconciliation` / `vendor_return` **absent** on `asset_manager`

## Audit summary

| Term | Actual meaning |
|------|----------------|
| Purchase Book | Vendor Tax Invoice commercial book (`PBK-`); independent of RN stock |
| Outward Purchase Book | **Does not exist** |
| CREDIT book | Commercial capacity credit — not physical vendor return |
| PO versioning | **Not implemented**; Zoho mirror refreshes in place |
| Existing recon | Flag `RECONCILIATION_REQUIRED` only (block receive) |

## Deliverables

1. **Files** — migration; `procurementReconciliationService.js`; `vendorReturnService.js`; hooks in `procurementService.js`; `server.js` routes; `permissionCatalog.js`; IdGenerator/utils; `purchase-orders.js` UI; verify script; ADR + lifecycle doc + this report.
2. **Migration** — `20260925160000_procurement_reconciliation_post_commit_lifecycle.js`
3. **Schema** — `procurement_reconciliation`, events; `vendor_return`, lines, outbox; RBAC keys
4. **PO revision** — in-place Zoho refresh; after refresh, auto-open PREC when accepted > ordered; snapshot commercial qty (version columns reserved null)
5. **Purchase Book** — unchanged: DRAFT editable, POSTED commercial qty locked; CREDIT still commercial-only
6. **Receipt Note** — POSTED immutable (existing); OPEN editable; not used to “fix” commercial revision
7. **Reconciliation model** — PREC-… per PO line; commercial vs physical vs returned vs retained
8. **States** — OPEN → RETURN_PENDING / RETAINED / RETURNED_TO_VENDOR → CLOSED
9. **Return to Vendor** — PRTN OPEN→READY→DISPATCH; stock exits on DISPATCH only
10. **Retain** — records retained qty; physical unchanged; closes difference
11. **Identity** — `PRTN-MMYY-XXXXXX-C` / lines `PRTL-…` / recon `PREC-…`
12. **Asset** — DISPATCH → status `Returned to Vendor`, retired; serial fail-closed
13. **Inventory** — available+total reduced with lineage event `VENDOR_RETURN_EXIT`
14. **Serial** — exact match required when known
15. **Reservation** — released before exit on DISPATCH
16. **RBAC** — `procurement_reconciliation.view|resolve`; `vendor_return.view|create|edit|ready|dispatch|cancel`
17. **Routes** — `/api/procurement/reconciliations*`, `/api/vendor-returns*` (JWT + action perms)
18. **Events** — `COMMERCIAL_RECONCILIATION_OPENED/RESOLVED`, `RESOLUTION_SELECTED`
19. **Outbox** — `VENDOR_RETURN_DISPATCHED` (no Zoho Books call)
20. **UI** — PO overview mismatch panel: Return to Vendor / Retain in Cineom
21. **Scratch** — C/E/F/G/H passed; D skipped (no eligible inventory on clone)
22. **Production** — schema unchanged
23. **Docs** — `POST_COMMIT_COMMERCIAL_RECONCILIATION_ADR.md`, `PROCUREMENT_RECONCILIATION_LIFECYCLE.md`, ADR index
24. **Future** — full PO family/versioning; richer holding picker UI; Books Purchase Return mapping; synthetic vendor-return verify path with seeded RN+inventory; DC commercial vs dispatched discrepancy panel

## Principle preserved

Physical truth → explicit reconciliation → controlled new transaction  
**not** commercial change → rewrite old physical record.
