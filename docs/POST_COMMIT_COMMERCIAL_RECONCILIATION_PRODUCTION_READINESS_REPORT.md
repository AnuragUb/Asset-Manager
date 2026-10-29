# Post-Commit Commercial Reconciliation — Production Readiness Report

**Date:** 2026-09-25  
**Scratch DB:** `asset_manager_procurement_reconciliation_scratch`  
**Migrations exercised:**  
- `20260925160000_procurement_reconciliation_post_commit_lifecycle.js` (already applied)  
- `20260925161000_procurement_reconciliation_open_unique_hardening.js` (applied this pass)  
**Production DB:** `asset_manager` — **unchanged** (`procurement_reconciliation` / `vendor_return` absent)

---

## 1. Implementation audit

| Flow | Code path |
|------|-----------|
| PO refresh → recon | `procurementService.persistRemote` → `syncPoReconciliations` |
| Active PREC | `findActiveRecon` = single non-`CLOSED` row per PO line |
| Retain | `retainInCineom` — commercial only; no Asset/Inventory mutation |
| Vendor Return | `vendorReturnService` OPEN → READY → DISPATCH |
| Physical exit | DISPATCH only: Asset `Returned to Vendor` + retired; Inventory `quantity_total`/`quantity_available` reduced |
| Lineage | `VENDOR_RETURN_EXIT` on `quantity_events` / `inventory_quantity_events` (+ event lines) |
| Outbox | `vendor_return_outbox` `VENDOR_RETURN_DISPATCHED` (idempotency key); no Zoho Books call |
| RBAC | Exact action keys on `/api/procurement/reconciliations*` and `/api/vendor-returns*` |

**Invariant preserved:** commercial change opens/updates PREC; physical history is not rewritten; physical correction requires a new controlled Vendor Return.

---

## 2. Exact scenarios tested

Seeded via `scripts/procurement-reconciliation-readiness-verify.js` on scratch only:

- PO 10 → RN POSTED 10 → revise 6 / 5 / 8 / 10 (idempotent PREC)
- Partial inventory Vendor Return (qty 2)
- Full inventory Vendor Return (qty 4 → PREC CLOSED)
- Retain in Cineom (qty 4, physical unchanged)
- Serialized Asset return (correct/wrong/missing serial, duplicate, dispatch once)
- Reservation release on DISPATCH + redispatch
- Concurrent DISPATCH / READY twice / cancel-after-dispatch
- Cancelled VR then DISPATCH reject
- POSTED RN immutability; OPEN RN edit
- Purchase Book DRAFT + CREDIT (no stock mutation)
- Customer Return tables isolation
- Audit + outbox + RBAC catalog/DB/routes
- Forced DISPATCH failure after READY (rollback / no outbox)

---

## 3. Database / schema exercised

Scratch only:

- `procurement_reconciliation`, `procurement_reconciliation_event`
- `vendor_return`, `vendor_return_line`, `vendor_return_outbox`
- Unique index `idx_proc_recon_open_line` → `WHERE status <> 'CLOSED'`
- Seeded `product`, `procurement_po`/`_line`, POSTED `receipt_note` + lines + `receipt_physical_output`
- `inventory_items`, `assets`, `physical_marking`, `reservation`, `purchase_book`

Production: no tables created.

---

## 4. Idempotency findings

| Case | Result |
|------|--------|
| Repeated PO revision | Updates **one** active PREC; does not stack open rows |
| PO back to covering commercial | Auto-`CLOSED` |
| Partial VR then further PO revise | Same non-CLOSED PREC updated (unique index enforces) |
| READY twice | Idempotent |
| DISPATCH twice / concurrent | Physical + outbox once; second call returns DISPATCHED |
| Cancel after DISPATCH | Rejected |

---

## 5. Inventory quantity semantics

Documented from reservation conservation + dispatch code:

| Field | Meaning |
|-------|---------|
| `quantity_total` | **Owned** physical quantity currently on the holding |
| `quantity_available` | Unreserved owned quantity |
| `quantity_reserved` | Sum of ACTIVE reservations |

Vendor Return DISPATCH reduces **both** `quantity_total` and `quantity_available` by the return qty (after releasing reservation coverage). It does **not** treat `quantity_total` as cumulative received history.

---

## 6. Reservation findings

DISPATCH releases/reduces ACTIVE reservation covering the return qty before inventory exit. Redispatch does not release again. READY does not touch reservations.

---

## 7. Asset serial findings

**Defect fixed:** individual Assets from RN often store OEM serial in `physical_marking`, while `assets.srno` may be empty. Vendor Return previously only checked `srno` (fail-open).

**Now:** expected serial = `assets.srno` **or** ACTIVE `physical_marking` (`MANUFACTURER_SERIAL` / `SERIAL` / `OEM_SERIAL`). Wrong / missing serial fail-closed. Duplicate Asset on OPEN/READY VR rejected. DISPATCH → status `Returned to Vendor`, `is_retired=1`, once.

---

## 8. RN / Purchase Book immutability

- POSTED RN edit rejected; OPEN RN remains editable per existing lifecycle.
- RN accepted qty and physical outputs unchanged by PO revise / recon / retain.
- Purchase Book DRAFT editable; CREDIT creates commercial capacity only — **no** inventory mutation.

---

## 9. Customer Return isolation

`dc_return_log` present on scratch. Sampling / event scan: no PREC/VR coupling; no `VENDOR_RETURN_EXIT` notes tied to Return Inward. Families remain separate.

---

## 10. RBAC findings

| Role | `vendor_return.dispatch` | `procurement_reconciliation.resolve` |
|------|--------------------------|--------------------------------------|
| superuser / admin / manager | granted | granted |
| Logistics Executive | granted | **denied** (view + VR lifecycle only) |
| user | denied | denied |

Routes use exact keys; no legacy `purchase_order.reconcile` alias grants dispatch.

---

## 11. Audit / outbox findings

Events observed: `COMMERCIAL_RECONCILIATION_OPENED`, `RESOLUTION_SELECTED`, `COMMERCIAL_RECONCILIATION_RESOLVED`.  
Outbox: one `VENDOR_RETURN_DISPATCHED` per VR; written only after successful DISPATCH; failed DISPATCH emits none; payload is not a Zoho Books call.

---

## 12. Defects found

1. **Duplicate PREC after partial return** — unique index omitted `RETURNED_TO_VENDOR`/`RETAINED`; sync could insert a second open PREC.
2. **Sync stacked opens** — sync only treated early statuses as “active”.
3. **Pending OPEN/READY VR qty ignored** on create / retain over-return math.
4. **Duplicate Asset on active VR** allowed.
5. **Inventory `VENDOR_RETURN_EXIT` wrote wrong columns** (`inventory_id`/`event_type`) and was swallowed by `.catch` — lineage missing.
6. **Serial fail-open** when serial lived only in `physical_marking`.
7. **READY after CANCEL / cancel after DISPATCH** needed stricter guards.

---

## 13. Fixes made

| Fix | File |
|-----|------|
| Unique non-CLOSED PREC index | `migrations/20260925161000_procurement_reconciliation_open_unique_hardening.js` |
| Update-in-place sync; pending VR qty; retain/dispatch math | `services/procurementReconciliationService.js` |
| Pending qty, duplicate Asset, serial via marking, correct qty events, READY/CANCEL guards | `services/vendorReturnService.js` |
| Seeded matrix A–Q | `scripts/procurement-reconciliation-readiness-verify.js` |

---

## 14. Tests passing

```
A PASS  PO reduction below received
B PASS  Repeated PO revision (idempotent PREC)
C PASS  Partial serialized Asset Vendor Return
D PASS  Partial Inventory Vendor Return
E PASS  Full Vendor Return
F PASS  Retain in Cineom
G PASS  Reservation release
H PASS  Duplicate / concurrent dispatch
I PASS  Cancelled Vendor Return
J PASS  Posted RN immutability
K PASS  Purchase Book semantics
L PASS  Customer Return isolation
M PASS  Historical physical immutability
N PASS  Audit events
O PASS  Outbox idempotency
P PASS  RBAC
Q PASS  API transaction rollback
```

Script exit: `PROCUREMENT_RECONCILIATION_READINESS_OK`

---

## 15. Tests intentionally skipped

| Item | Why |
|------|-----|
| Live HTTP 403 with JWT per role | Covered via `ROLE_ACTION_GRANTS` + DB `role_permissions` + route `requirePermission` wiring (not a full Express login harness) |
| Real Zoho Books / Inventory call | Out of scope; outbox only |
| Full customer Return Inward end-to-end recreate | Isolation checked against existing `dc_return_log` + event coupling; full RET flow already verified on its own scratch |
| PO family/versioning | Explicitly out of scope |

None of A–Q were marked PASS by inference alone.

---

## 16. Production deployment status

| Environment | Status |
|-------------|--------|
| Scratch | Verified + hardened |
| Production `asset_manager` | **Unchanged** — do **not** run `migrate:latest`; apply named migrations only when approved |

### Exact next step for production

1. Change window + backup.
2. Apply **only**:
   - `20260925160000_procurement_reconciliation_post_commit_lifecycle.js`
   - `20260925161000_procurement_reconciliation_open_unique_hardening.js`
3. Deploy backend/frontend with recon + vendor-return services.
4. Smoke: PO revise below accepted → one PREC; Retain; partial inventory VR DISPATCH; serial Asset VR; RBAC 403 for `user`.
5. Do **not** introduce PO versioning / Outward PB / Zoho Books mapping in the same change.

---

## UI note (inspected)

PO overview mismatch panel shows commercial / physical / retained / difference with **Return to Vendor** and **Retain in Cineom**. No JV / “stock adjustment” language. Buttons call gated APIs (not cosmetic-only).

---

## Remaining risks

- In-place Zoho PO mirror without family/versioning remains the commercial source of truth until a later phase.
- Logistics Executive can DISPATCH but cannot Retain (`resolve`) — intentional; confirm with ops.
- Concurrent create of two VRs against the same open difference is mitigated by recon row locks + pending-qty check, not a dedicated advisory lock.
- Inventory eligible holdings list uses `quantity_available` only — reserved stock must be released (as DISPATCH does) before exit.

**Architectural invariant held:** commercial truth can change; historical physical truth is not rewritten; discrepancy creates reconciliation; physical correction requires a new controlled transaction.
