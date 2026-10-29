# Procurement Reconciliation Lifecycle

**Related ADR:** [POST_COMMIT_COMMERCIAL_RECONCILIATION_ADR.md](./Architecture_and_ADRs/01_adrs/POST_COMMIT_COMMERCIAL_RECONCILIATION_ADR.md)

## Physical vs commercial

```text
Zoho PO ordered_qty          → commercial requirement (may change)
Receipt Note POSTED accepted → physical truth (immutable)
Purchase Book qty_booked     → vendor invoice commercial book (≠ stock)
```

When `accepted > ordered` after a commercial revision:

```text
difference = accepted − ordered − returned_to_vendor − retained
```

## States

| Status | Meaning |
|--------|---------|
| OPEN | Excess exists; no resolution yet |
| RESOLUTION_SELECTED / RETURN_PENDING | Vendor return in progress |
| RETURNED_TO_VENDOR | Partial/full physical vendor return applied |
| RETAINED | Partial retain applied; may still have residual difference |
| CLOSED | difference = 0 |

## Paths

### Return to Vendor

```text
PREC OPEN
  → create PRTN (OPEN)  — no stock effect
  → READY               — no stock effect
  → DISPATCH            — Asset → Returned to Vendor (retired)
                          Inventory owned/available ↓ via lineage
  → PREC closed / updated
  → outbox VENDOR_RETURN_DISPATCHED
```

### Retain in Cineom

```text
PREC OPEN
  → retain qty
  → physical stock unchanged
  → PREC CLOSED (or RETAINED if partial)
```

## Customer Return Inward (separate)

```text
DC DISPATCHED → Return Log → RETURN_INWARD RN → POST → restore to Cineom
```

Never use Vendor Return for customer→Cineom direction.

## Operator UX

Ask: “What happened to these N units?”  
Do **not** ask for JV / credit note / inventory adjustment.
