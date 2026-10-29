# Vendor Invoice identity

**Status:** Accepted (2026-10-05). The `vendor_invoice` table and the references from Purchase Book and Receipt Note are in place (`20261005120000_vendor_invoice.js`). Hosting the PDF is still later: `pdf_storage_key` is reserved and empty.

**Relates to:** [PURCHASE_BOOK_AND_DC_ADR.md](./PURCHASE_BOOK_AND_DC_ADR.md), Receipt Note `vendor_invoice_no`.

## Decision

The invoice number on a Purchase Book and the invoice number on a Receipt Note are the **same vendor invoice**.

One commercial document from the vendor. The Purchase Book records what was invoiced against the PO. The Receipt Note records what physically arrived. They may be created at different times, and one invoice may relate to more than one book or note, but they do not each invent their own invoice number.

## Today

The number is copied into two nullable text columns. Nothing ties them together.

| Place | Column |
|-------|--------|
| Purchase Book | `purchase_book.vendor_invoice_no` |
| Receipt Note | `receipt_note.vendor_invoice_no` |

Return Inward notes leave the Receipt Note number empty. That is a return document, not a vendor invoice.

## The invoice record

`vendor_invoice` is the identity. A Purchase Book and a Receipt Note that share a vendor and an invoice number point at the same row. The typed `vendor_invoice_no` on each document stays, so posted books and notes are not rewritten.

- Vendor name plus invoice number is unique. The same digits from a different vendor are a different invoice.
- `pdf_storage_key` is where a hosted PDF will be stored. Nothing is uploaded yet.
- Saving a book or a receipt with a vendor and a number finds or creates the row and stores `vendor_invoice_id`.
- Clearing the number unlinks that document. The invoice row stays, because another document may still point at it.
- Numbers already on the books and notes were linked where both the vendor name and the number were present. A blank vendor or a blank number stays unlinked. Return Inward notes stay unlinked.

## What this does not change

- A Purchase Order may still have many Purchase Books (partial invoices).
- A book’s quantity, price, and serial allocation stay on the book.
- A receipt’s accepted quantity stays on the Receipt Note.
- Zoho Books sync remains deferred.
