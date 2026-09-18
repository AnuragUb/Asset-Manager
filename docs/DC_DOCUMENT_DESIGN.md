# Delivery Challan Document Design

Design language extracted from `QT_Test.pdf` (Cineom quotation) and applied to AssetEngine Delivery Challans.

This is a **printable A4 business document**, not a SaaS UI.

---

## 1. Design language (from QT_Test.pdf)

### Typography
| Role | Spec |
|------|------|
| Body | Arial / Helvetica, 12px, line-height 1.35, ink `#222` |
| Section labels | 10px, bold, uppercase, letter-spacing `0.12em`, muted `#8a8a8a` |
| Strong values | 13–15px bold; document number in primary red |
| Table header | 10px bold uppercase white on red |
| Footer / legal | 10px |

### Color palette
| Token | Value | Use |
|-------|-------|-----|
| `--dc-red` | `#c4161c` | Primary accent, table headers, legal number, footer band, section underlines |
| `--dc-ink` | `#222` | Body text |
| `--dc-muted` | `#8a8a8a` | Labels, secondary copy |
| `--dc-line` | `#d8d8d8` | Subtle row / block separators |
| `--dc-bar` | `#4a4a4a` | Footer secondary (website / name) band |
| White | `#fff` | Page ground, table body |

### Spacing & page
- A4 portrait `210mm × 297mm`
- Page margins ~10–12mm
- Generous whitespace between header / meta / parties / table
- Thin 1px separators; no card shadows or rounded SaaS panels

### Header
- Logo left (~52px height, max ~220px wide)
- Top-right grey→red accent bar (`linear-gradient`, ~86% grey / 14% red)
- Optional QR top-right under accent
- Large clean top whitespace

### Metadata block
- Uppercase muted labels above bold values (same as Quotation No. / Date / Stage pattern)
- DC uses: **DC No.**, **Date**, **Status**, **Reference / Project**, buyer order / dispatch refs when present

### Section headings
- Quotation “Terms & Conditions” red title + underline → reused for **Notes / Remarks** and logistics section titles
- Party blocks use muted label + bold name (Quotation For pattern), not quotation commercial labels

### Table
- Full-width red header row, white uppercase labels
- White body rows, subtle bottom borders
- Description bold; Asset ID monospace; qty / money right-aligned tabular nums
- **No** forced Unit Price / GST / Grand Total columns for a logistics DC  
  Commercial columns remain **optional** only when `meta.showRateAmount` / `meta.showTotalPrice` were stored on the snapshot

### Highlight band
- Quotation red “GRAND TOTAL” band → if commercial totals are shown, reuse that weight  
  Otherwise **do not** invent a financial total for a plain DC

### Footer
- Registration line (GSTIN / CIN / state) above footer
- Split footer pinned to page bottom: red address band + dark website band with red chevron join
- Computer-generated disclaimer (italic muted)
- No Authorized Signatory (disclaimer replaces issuer signature). Receiver signature omitted for the same reason.

### Print
- `@page { size: A4; margin: 10mm; }`
- `thead { display: table-header-group; }` for repeating headers
- Avoid fixed browser chrome; `body.print-dc` hides modal chrome

---

## 2. Field-mapping matrix

| Reference PDF field | DC equivalent | AE source | Display |
|---------------------|---------------|-----------|---------|
| Quotation No. | DC No. | `delivery_challans.challanno` | Meta (red) |
| Quote Stage | Status | `delivery_challans.status` | Meta |
| Date | Date | `payload.meta.deliveryDate` (fallback header `deliverydate`) | Meta |
| Valid Until | — | none | omit |
| Quotation For | Customer / Receiver | `payload.account.accountName` / `meta.customerName` | Party |
| Kind Attn | Kind Attn (when distinct) | derived from buyer/customer vs consignee | Party |
| Created By | Issued / Created By | `delivery_challans.createdby` | Meta / footer area |
| Amount in Words / Subtotal / GST / Grand Total | Optional commercial block | `payload.items[].amount` + `meta.showTotalPrice` | Only if toggled on snapshot |
| Description / Make / Model / Qty / Unit Price… | Items table | `payload.items[]` | Table |
| Terms & Conditions | Notes / Remarks | `meta.termsOfDelivery`, `meta.remarks` | Notes |
| Computer-generated statement | Same | static configurable string | Disclaimer |
| Logo / company identity | Issuing company | `payload.company` + `meta.logoUrl` | Header / footer |

### Reference fields with no DC equivalent
Valid Until, Quotation Stage (budgetary), GST amount, currency grand total, warranty, delivery lead-time columns.

### AE DC fields with no quotation equivalent
Consignee, Buyer (Bill To), Pick-Up, Destination, Place of Supply, Dispatched Through, Dispatch Doc No., Asset ID, Serial No., HSN/SAC, QR validation image, Project/Reference No., Buyer’s Order No.

---

## 3. Data / template / render separation

| Layer | Responsibility | Location |
|-------|----------------|----------|
| Document data | Snapshot already stored at create | `delivery_challans.payloadjson` + header columns |
| Document model | Map snapshot → print view-model (no lifecycle rules) | `js/dcDocumentView.js` → `buildDcDocumentModel` |
| Template | Editable HTML | `templates/documents/dc/delivery-challan.html` |
| Styles | Editable CSS | `templates/documents/dc/delivery-challan.css` |
| Rendering | Fill template + inject into `#printableDC`; print via `window.print` | `renderDcDocumentHtml` / `showDCPreview` |

No live Zoho calls during preview/reprint.

---

## 4. Gaps / limitations (do not invent)

| Gap | Notes |
|-----|-------|
| Company phone / email / website | Not on `company_templates`; footer uses name + address + GST/CIN |
| Inventory lines on DC | Current DC is asset-only |
| Make / Model first-class on historical lines | New creates may store `make`/`model` on items; old snapshots may only have them inside `description` |
| Legal number series | `YY/NNNN` in DB; not `CNE/DC/…` format unless product later changes generation |
| Status lifecycle | Only `Initializing` → `Pending` today |
| Server PDF | Browser print / Save as PDF only |
| `dc_item_mappings` | Unused by current create path |

---

## 5. Template paths

- HTML: `web-app/asset-manager-frontend/templates/documents/dc/delivery-challan.html`
- CSS: `web-app/asset-manager-frontend/templates/documents/dc/delivery-challan.css`
- Binder: `web-app/asset-manager-frontend/js/dcDocumentView.js`
