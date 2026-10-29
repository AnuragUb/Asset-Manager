# ADR — Sets: commercial definition, not physical allocation

**Status:** Accepted as owner direction (2026-09-29). **Implementation:** partly in place on local 8080; the DC presentation in §5 differs from what is built today. See §7. Not on production.  
**Date:** 2026-09-29  
**Deciders:** AssetEngine product / engineering  
**Builds on:** [PHYSICAL_TALLY_AUTHORITY_ADR.md](./PHYSICAL_TALLY_AUTHORITY_ADR.md) §10, [PURCHASE_BOOK_AND_DC_ADR.md](./PURCHASE_BOOK_AND_DC_ADR.md)

## Context

A Set (kit) such as "Konvision 17.3 Inch Kit" is sold to customers as one commercial item, but it is bought and received as separate products (monitor, backlight board, cable, …).

- **Inward POs** (Cineom buying from vendors) and **outbound POs / quotes** (Cineom selling to customers) are separate documents. Turning inward purchases into outbound POs is done **manually** in Zoho. AssetEngine does not derive one from the other.
- AssetEngine used to let a Set hold physical units (Set allocation). Those units were locked to the Set even when nothing had been sold. It also raised the question of whether Zoho should learn which physical unit is in which kit.

## Decision

### 1. A Set is a product-level definition

A Set is a **commercial product** (origin `SET`) with a name, a description, and a recipe: `set_requirement` = Product × quantity. It is never a container of physical units.

### 2. Zoho gets the product definition only

Publishing a Set to Zoho sends the commercial product's **name and description** (a CRM Product). No physical allocation, asset ID or serial number is ever pushed.

### 3. Outbound line items are manual

When a Set is used to create a quote or outbound PO, the user decides the outbound line items manually in Zoho: the Set as one line, or broken into components, with their prices. AssetEngine does not generate or enforce outbound line items from the Set recipe.

### 4. Physical allocation happens per purchase line, never per Set

On the AssetEngine side, physical units are tied to the documents they arrived on, **line by line**:

- **Purchase Book:** each Purchase Book line item has its own physical / serial allocation (`purchase_book_physical`).
- **Receipt Note:** each Receipt Note line has its own physical output (`receipt_physical_output`).

A Set never receives a physical allocation. Set allocation was retired on 2026-09-29: new allocations are refused with 410 `SET_ALLOCATION_RETIRED`, and the existing ones were released ([PHYSICAL_TALLY_AUTHORITY_ADR.md](./PHYSICAL_TALLY_AUTHORITY_ADR.md) §10).

### 5. On a DC a kit is one line item

When a kit is dispatched on a Delivery Challan:

- The kit appears as **a single line item** on the DC.
- The DC **"＋ Add Set"** button brings in the Set's **product-level definition**: the Set **name** becomes the line item's name, and the Set **description** goes in the line's Description.
- Quantity = number of kits.

## Consequences

- Zoho and AssetEngine agree on what a Set *is* (a product), while AssetEngine alone knows where physical units came from (Purchase Book / Receipt Note lines).
- Customer-facing documents (quote, outbound PO, DC print) show the kit as the customer bought it, not as Cineom bought it.
- Nothing is reserved for a Set until it is actually used, so stock is never locked by a Set that has not been sold.

## 7. Implementation status and open items

| Item | Status on local 8080 |
|------|----------------------|
| §1 Set = product + recipe | In place |
| §2 Zoho gets name + description only | In place (`productService.publishProduct`; description frozen at commercialization) |
| §3 Outbound lines manual | In place (AssetEngine does not create outbound POs) |
| §4 No Set allocation; per-line allocation on Purchase Book / Receipt Note | In place (Set allocation retired 2026-09-29) |
| §5 Kit = one DC line (name + description) | In place (2026-09-29). Components are picked behind the line (see below). |

**§5 resolution: components are picked behind the line.** "＋ Add Set" still makes the user pick a physical unit for every component, and those units leave stock through the DC, so the Stock Tally sees them go. The printed DC collapses each kit into a single line:

- **Item:** the Set name.
- **Description:** the Set's commercial product description, without its first line when that line repeats the name, and with trailing zeros removed from quantities.
- **Make / Model / Asset ID:** the commercial product's make and model, with the product ID (`PRD-…`) in the Asset ID column. Serial No. prints "—".
- **Qty / Unit:** the number of kits, with unit `SET`.
- **HSN:** the commercial product's HSN code, or "—" when it is blank.
- **Rate / Amount:** the sum of the component amounts, divided by the number of kits to give the rate.

The on-screen DC form still lists the components. DCs saved before this change have no stored Set description, so they print the Set name only. The rejected alternative made the kit line presentation-only, with no components moved; the Stock Tally would then not have seen the kit leave.

## Decision log

| Date | Decision |
|------|----------|
| 2026-09-29 | Set = product-level commercial definition; Zoho receives name + description only |
| 2026-09-29 | Inward → outbound PO conversion and outbound line items for a Set are manual (Zoho) |
| 2026-09-29 | Physical allocation only per Purchase Book line and per Receipt Note line; never to a Set |
| 2026-09-29 | On a DC a kit is one line item: Set name as the item, Set description as the description |
| 2026-09-29 | §5 implemented by picking components behind the line: units are picked and moved, and the print shows one kit line (`dcDocumentView.js`, DC template) |
