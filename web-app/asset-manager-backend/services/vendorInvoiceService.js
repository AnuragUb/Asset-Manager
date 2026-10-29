/**
 * Shared vendor invoice identity.
 *
 * One row per vendor + invoice number. Purchase Books and Receipt Notes
 * point at it. The PDF, when hosted, hangs off this row.
 * The typed number on the book and the note stays; this row is the link.
 */
const { db, generateVendorInvoiceId, verifyVendorInvoiceId } = require('../utils');

function keyOf(value) {
  return String(value || '').trim().toLowerCase();
}

function isUniqueViolation(err) {
  return err && (err.code === '23505' || /unique/i.test(String(err.message || '')));
}

async function allocateId(trx) {
  for (let i = 0; i < 8; i += 1) {
    const id = generateVendorInvoiceId();
    if (!verifyVendorInvoiceId(id)) throw new Error('ID generator produced an invalid vendor invoice id');
    const existing = await trx('vendor_invoice').where({ id }).first();
    if (!existing) return id;
  }
  throw new Error('Could not allocate a unique vendor invoice id');
}

/**
 * Find or create the invoice for this vendor and number.
 * Returns null when the vendor or the number is blank — nothing to identify.
 * Does not delete a row when a document later clears its number.
 */
async function ensureVendorInvoice(trx, { vendorName, invoiceNumber, invoiceDate } = {}) {
  const runner = trx || db;
  if (!(await runner.schema.hasTable('vendor_invoice'))) return null;
  const name = String(vendorName || '').trim();
  const number = String(invoiceNumber || '').trim();
  if (!name || !number) return null;
  const vendorKey = keyOf(name);
  const numberKey = keyOf(number);
  const date = invoiceDate == null || String(invoiceDate).trim() === '' ? null : String(invoiceDate).trim();

  const existing = await runner('vendor_invoice')
    .where({ vendor_key: vendorKey, invoice_number_key: numberKey })
    .first();
  if (existing) {
    if (!existing.invoice_date && date) {
      await runner('vendor_invoice').where({ id: existing.id }).update({
        invoice_date: date,
        updated_at: new Date().toISOString()
      });
    }
    return existing.id;
  }

  const now = new Date().toISOString();
  const id = await allocateId(runner);
  try {
    await runner('vendor_invoice').insert({
      id,
      vendor_name: name,
      vendor_key: vendorKey,
      invoice_number: number,
      invoice_number_key: numberKey,
      invoice_date: date,
      pdf_storage_key: null,
      created_at: now,
      updated_at: now
    });
    return id;
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const raced = await runner('vendor_invoice')
      .where({ vendor_key: vendorKey, invoice_number_key: numberKey })
      .first();
    return raced ? raced.id : null;
  }
}

module.exports = { ensureVendorInvoice };
