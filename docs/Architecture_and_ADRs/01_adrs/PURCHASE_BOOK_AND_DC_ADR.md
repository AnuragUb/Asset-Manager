# Purchase Book & Dual-Mode DC — Architecture Decision Record

**Status:** ACCEPTED as owner direction (2026-09-16); **amended 2026-09-17** (DC ↔ Purchase Book qty lock + Mode B pool rules). **Implemented:** Purchase Book module; DC Mode A2 multi-book select + partial consumption table; Mode B holdings exclusions; DC void releases book qty. Zoho Books sync remains deferred. Physical book↔holding link remains deferred.
**Date:** 16 September 2026 (amended 17 September 2026)
**IDs:** `ADR-PURCHASE-BOOK-001` · `ADR-DC-PO-LINK-001`
**Related:** Phase 9 procurement PO mirror · Phase 7 Receipt Notes · DC document design · Zoho Books research · presentation vs identity (commercial docs)

---

## Reading rule

- **Locked** means the owner has chosen the business meaning.
- **Not implemented** means tables, APIs, and UI do not exist yet (except existing DC / PO / Receipt paths).
- **Sync-ready** means schema and lifecycle must not block a later Zoho Books Bill sync; Books sync is **out of scope for v1**.

---

## 1. Problem

Vendor Tax Invoices often use different item names/descriptions than the AssetEngine Product catalogue or Zoho PO lines. Operators still need:

1. A **Purchase Book** entry (AE record of what was invoiced / booked commercially against a PO).
2. **Delivery Challans** that can either pull commercial context from a PO or pick holdings directly.
3. Stable **logical identity** (Product → Asset/Inventory) that never forks because a document was reworded for finance or a client.

---

## 2. Locked decisions (2026-09-16)

| # | Decision |
|---|----------|
| D1 | **One PO → many Purchase Books / invoices.** Partial invoices and return-related invoice adjustments are normal. |
| D2 | Purchase Book is designed with **solid identity + commercial fields** so it can later sync to **Zoho Books** (Bills). v1 is AE-only. |
| D3 | **DC has two modes:** (A) **PO-linked** — may take line/context data from the PO; (B) **No PO** — operator searches Asset / Inventory holdings. |
| D4 | **Book quantity ≤ PO ordered quantity** (per PO line, across all books for that line). Book carries the **priced commercial amount** for what was bought / invoiced. |
| D5 | For now, Purchase Book **lifecycle is managed by Logistics** (same operator class as Receipt / PO receiving). Finance-only ownership is deferred. |

---

## 3. Core invariant — presentation vs identity

Every Purchase Book line and every DC line has:

| Layer | Fields | Mutability |
|-------|--------|------------|
| **Identity** | `product_id`; when physical: `resource_type` + `resource_id`; when PO-linked: `procurement_po_line_id` | Set deliberately; not changed by renaming |
| **Presentation** | `display_name`, `display_description` (and later client/vendor-facing tax text) | Editable per document |

**Forbidden:** creating a second Product because the Tax Invoice or DC wording differs.  
**Forbidden:** matching stock by display name.  
**Forbidden:** Purchase Book creating or rewriting physical quantity (Receipt Note remains the receive path).

```text
Product ──► Holding (Asset / Inventory)
              ▲
PO line ──────┤ identity links only
Purchase Book ┤ presentation may differ
DC line ──────┘
```

---

## 4. Purchase Book — concrete logic

### 4.1 Role

Purchase Book = AE commercial book of a **vendor Tax Invoice** (or invoice slice) against a **procurement PO**.

It is **not**:

- A Receipt Note (no stock birth)
- A rewrite of Zoho CRM PO lines
- Zoho Books itself (v1)

### 4.2 Cardinality

```text
procurement_po
   ├── purchase_book (invoice #1, partial)
   ├── purchase_book (invoice #2, remainder / another shipment)
   └── purchase_book (credit / return-related adjustment — see §4.6)
```

- Many books per PO.
- Each book has header commercial meta (vendor invoice no, invoice date, currency, totals, tax).
- Each book line **must** reference a `procurement_po_line_id` and copy `product_id` from that PO line at create time.

### 4.3 Quantity rule (locked)

For each `procurement_po_line_id`:

```text
sum(purchase_book_line.qty_booked for non-void books)  ≤  po_line.ordered_qty
```

- **≤ Ordered**, not “≤ Received”. Pricing / booking follows the commercial order ceiling.
- Partial invoices: first book may book qty 3 of ordered 10; second books up to 7 remaining.
- Over-book is rejected (`OVER_BOOKED` / `INSUFFICIENT_PO_QTY`).

Receipt accepted qty remains independent for **physical** truth. If book qty and received qty diverge, that is a **reconciliation signal**, not an automatic rewrite.

### 4.4 Presentation on book lines

| Field | Source default | Editable |
|-------|----------------|----------|
| `product_id` | PO line | No (except explicit remap + audit — out of v1) |
| `procurement_po_line_id` | PO line | No after create |
| `display_name` | Product name or Zoho / PO description | **Yes** (Tax Invoice wording) |
| `display_description` | PO / Product description | **Yes** |
| `unit_price`, tax, discounts | Invoice | Yes (logistics in v1) |
| `qty_booked` | Operator | Yes, within remaining ordered capacity |

### 4.5 Lifecycle (Logistics-owned, v1)

Suggested statuses (implementation may refine names):

| Status | Meaning |
|--------|---------|
| `DRAFT` | Editable; not sync-candidate |
| `POSTED` | Locked commercial book entry; eligible later for Books sync |
| `VOID` | Cancelled; qty released back to remaining book capacity |

Transitions owned by **Logistics** roles (same family as receipt/procurement operators). No separate Finance module gate in v1.

### 4.6 Returns / credit notes (direction only)

Because one PO may need return-related invoices:

- Prefer a **separate Purchase Book** typed as credit / adjustment (negative qty or `document_kind = CREDIT`), still linked to the same PO line / Product.
- Do not delete history of the original invoice book.
- Exact credit-note UX is **OPEN for implementation plan**; cardinality “many books per PO” already covers it.

### 4.7 Zoho Books sync-ready (future, not v1)

Design so a later sync can map without remodel:

| AE | Likely Books target |
|----|---------------------|
| `purchase_book` | Bill / Vendor Invoice |
| `purchase_book.vendor_invoice_no` | Bill number / reference |
| `purchase_book_line.product_id` + external Zoho Product ref | Bill line item |
| `display_name` / `display_description` | Bill line description (presentation) |
| `qty_booked`, rates, tax | Bill line amounts |
| `procurement_po.zoho_po_id` | Optional PO association on Bill |

Store nullable `external_system` / `external_id` / `sync_status` columns on book header from day one (unused until sync phase).

---

## 5. Delivery Challan — two modes (locked)

### 5.1 Mode A — PO-linked

After a procurement PO is selected, the operator may create a DC in either of these ways (both kept):

| Path | Behaviour |
|------|-----------|
| **A1 — PO without book** | Seed from PO lines / commercial context only (existing behaviour). No Purchase Book required. |
| **A2 — Against Purchase Book(s)** | Select **one or many** non-void books for that PO. One DC may reference multiple books. |

**A2 quantity lock (partial, per book line):**

```text
for each purchase_book_line:
  qty_dcable = qty_booked − sum(active DC lines consuming this book line)
```

- Only the **qty used** on active DCs is locked; **remainder stays DC-able**.
- Over-consume book remaining qty is rejected.
- Void / delete of a DC **releases** that DC’s consumption back to the book (book itself is not voided).
- Whole-book lock is **not** used.

Identity on each DC line: `product_id`; optional `procurement_po_line_id`; when A2, optional `purchase_book_id` / `purchase_book_line_id`; when a holding is attached, `resource_type` / `resource_id`.  
`display_name` / `display_description` may differ for the client-facing DC print.

**Physical pick:** Purchase Book owns first-class links in `purchase_book_physical` (holding `resource_type`/`resource_id`, optional `serial_sort_order` → `serial_identity`). DC Mode A2 ships those linked holdings/serials when present; commercial-only synthetic lines remain only when no physical is allocated yet.

**Serial identity:** Manufacturer serials are notations under a holding — PK `(resource_type, resource_id, sort_order)` ([SERIAL_IDENTITY_ADR.md](./SERIAL_IDENTITY_ADR.md)). Books allocate those notations; DC does not invent new serial ids.

### 5.2 Mode B — No PO linkage

- No PO required.
- Operator **searches Asset / Inventory** and adds holdings to the DC.
- Identity = holding (+ its `product_id`).
- Presentation fields still editable for the client document.

> **Superseded 2026-09-28:** the pool exclusions below are withdrawn by [PHYSICAL_TALLY_AUTHORITY_ADR.md](./PHYSICAL_TALLY_AUTHORITY_ADR.md) §3 — any in-store holding is DC-able regardless of origin; PO / Purchase Book are optional references. Kept here for history.

**Excluded from the Mode B available pool (locked):**

- Holdings with procurement / PO commercial parentage (Sourced via PO / RN, or otherwise tied to a PO).
- Holdings already associated with a Purchase Book commercial path (once that link exists).
- Holdings **Awaiting PO** / **Awaiting Adoption**.

Mode B is for stock that is **not** on a procurement commercial path.

### 5.3 Shared DC rules

- Presentation never creates a new Product.
- PO-linked mode does **not** force every line to ship; it supplies commercial context and defaults.
- Existing `dc_item_mappings` (custom name/description per asset) may be reused or replaced by first-class line presentation fields — implementation choice; behaviour must match this ADR.

---

## 6. Boundary vs existing modules

| Module | Owns | Does not own |
|--------|------|--------------|
| Zoho CRM PO mirror | Ordered commercial qty, vendor, PO status | Tax Invoice book wording |
| Receipt Note | Physical receive → holdings | Invoice pricing book |
| **Purchase Book** | Invoiced / booked commercial qty & presentation; physical allocation to holdings/serials | Stock create/move (Receipt Note remains receive path) |
| **DC** | Outbound dispatch document + presentation; may consume book qty (A2) | PO authority / invoice booking |

```text
PO (ordered)
  ├─► Receipt Note (accepted → stock)
  ├─► Purchase Book × N (invoiced ≤ ordered; presentation free)
  │      └─► DC may consume book qty partially (A2); one DC → many books
  └─► DC also allowed PO-linked without book (A1)
       or Mode B free holding search (non-procurement pool only)
```

---

## 7. Explicit non-goals (current)

- Zoho Books Bill push/pull
- Finance-role ownership of Purchase Book
- Auto-creating Products from invoice OCR/names
- Replacing Receipt Note with Purchase Book
- Requiring PO on every DC
- Requiring a Purchase Book for every PO-linked DC (A1 remains)

---

## 8. Implementation gate (next)

Purchase Book v1 tables/UI exist. Landed / in flight:

1. DC ↔ `purchase_book_line` consumption (partial qty lock; multi-book per DC) — landed
2. Mode A UI: after PO select → optional multi-book picker + remaining DC-able qty — landed
3. Mode B holdings search exclusions (PO / awaiting adoption; book link when available) — landed
4. DC void/delete releases book consumption — landed
5. Purchase Book ↔ holding / serial physical link (`purchase_book_physical`) — landed
6. **Later:** deeper Receipt Note ↔ Purchase Book coherence. The invoice number on both is the same vendor invoice; a shared invoice record and hosted PDF come later — [VENDOR_INVOICE_IDENTITY_ADR.md](./VENDOR_INVOICE_IDENTITY_ADR.md).

---

## 9. Decision log

| Date | Decision |
|------|----------|
| 2026-09-16 | Multiple invoices/books per PO |
| 2026-09-16 | Schema sync-ready for Zoho Books; sync deferred |
| 2026-09-16 | DC: PO-linked **or** holding search |
| 2026-09-16 | Book qty ≤ PO ordered (per line, summed) |
| 2026-09-16 | Purchase Book lifecycle = Logistics for now |
| 2026-09-17 | DC may reference **multiple** Purchase Books |
| 2026-09-17 | Book lock is **partial** (qty used only); remainder stays DC-able |
| 2026-10-05 | Purchase Book and Receipt Note invoice numbers are the same vendor invoice. Shared invoice table and PDF hosting are later — [VENDOR_INVOICE_IDENTITY_ADR.md](./VENDOR_INVOICE_IDENTITY_ADR.md) |
| 2026-09-17 | **Keep** PO-linked DC without a book (A1) |
| 2026-09-17 | Mode B pool excludes PO-sourced / awaiting-PO (and book-linked when that exists) |
| 2026-09-17 | Purchase Book owns physical/serial allocation; DC ships linked serials |
| 2026-09-28 | Mode B pool exclusions withdrawn; Purchase Books are not the tally — see [PHYSICAL_TALLY_AUTHORITY_ADR.md](./PHYSICAL_TALLY_AUTHORITY_ADR.md) |
