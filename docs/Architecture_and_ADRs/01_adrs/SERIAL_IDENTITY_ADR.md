# Serial Identity — Architecture Decision Record

**Status:** ACCEPTED (2026-09-17). Rekeyed: no generated SER- ids. Purchase Book physical allocation + DC ship of linked serials in progress.
**Date:** 17 September 2026
**ID:** `ADR-SERIAL-IDENTITY-001`
**Related:** Purchase Book & DC ADR · Quantity / physical identity · Asset/Inventory research §7.3

---

## 1. Problem

Manufacturer serials were stored as free text on `assets.srno` / `inventory_items.srno` (often comma/newline lists for batch holdings). That cannot safely support:

- Purchase Book physical linkage to **specific** serials
- DC population of serial numbers per shipped unit
- Honest “where currently used” for one serial inside a multi-serial holding

---

## 2. Decision

Introduce a first-class table **`serial_identity`**: one row per manufacturer serial, charted against an Asset or Inventory holding.

| Field | Meaning |
|-------|---------|
| `resource_type` / `resource_id` | Holding (ASSET or INVENTORY). **`resource_id` is the asset or inventory primary key.** |
| `sort_order` | Notation index under that holding (0..n−1 from the serial input field) |
| `product_id` | Optional catalogue link (copied from holding when present) |
| `serial_value` | Plaintext manufacturer serial (searchable / unique) |
| `status` | `ACTIVE` \| `RETIRED` \| `LOST` \| `CONSUMED` |

**Primary key:** `(resource_type, resource_id, sort_order)` — notations under the holding. **No generated SER- serial row ids.**

**Uniqueness (ACTIVE only):**

- Per `(product_id, lower(serial_value))` when `product_id` is set
- Always per `(resource_type, resource_id, lower(serial_value))`

**Legacy mirrors:** keep writing `assets.srno` (encrypted) and `inventory_items.srno` (plaintext) as joined ACTIVE values until callers fully migrate. Do not drop those columns in this phase.

---

## 3. Non-goals (this phase)

- Container holder type
- Using `serial_identity` as Zoho push source
- Dropping encrypted `assets.srno`

---

## 4. Purchase Book / DC

- Purchase Book allocates holdings via `purchase_book_physical`, optionally pointing at a serial notation with `(resource_type, resource_id, serial_sort_order)` FK into `serial_identity`.
- DC Mode A2 expands those physical links into real Asset IDs + serial values (not synthetic `PB-LINE-*` when links exist).

---

## 5. Decision log

| Date | Decision |
|------|----------|
| 2026-09-17 | Serial becomes first-class `serial_identity` table |
| 2026-09-17 | Plaintext in table; legacy `srno` remains mirror |
| 2026-09-17 | Holder types: ASSET \| INVENTORY only for now |
| 2026-09-17 | **Rejected** generated `SER-…` ids; PK = holding + `sort_order` |
