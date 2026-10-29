/**
 * Purchase Receipt Notes must store a vendor invoice number.
 *
 * receipt_note.vendor_invoice_no stays nullable because Return Inward notes
 * have no vendor invoice. The check rejects NULL and blank values on every
 * other receipt.
 *
 * Two purchase notes were saved before this rule and have no invoice:
 *   RN-0926-7SHY0G-V (CANCELLED)
 *   RN-1026-1ZC788-0 (POSTED)
 * They are named in the check so this migration does not invent an invoice
 * for them. Every new purchase receipt, and every edit of any other note,
 * must have a non-blank invoice number.
 *
 * Apply with (after a pg_dump backup):
 *   npx knex migrate:up 20261009123000_receipt_note_invoice_not_null.js --env production
 * Never migrate:latest.
 *
 * @param { import("knex").Knex } knex
 */

const CONSTRAINT = 'receipt_note_vendor_invoice_required';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('receipt_note'))) {
    throw new Error('STOP: receipt_note is missing');
  }
  const existing = await knex.raw('SELECT 1 FROM pg_constraint WHERE conname = ?', [CONSTRAINT]);
  if (existing.rows && existing.rows.length) return;

  await knex.raw(`
    ALTER TABLE receipt_note
      ADD CONSTRAINT ${CONSTRAINT}
      CHECK (
        inward_kind = 'RETURN_INWARD'
        OR (
          vendor_invoice_no IS NOT NULL
          AND BTRIM(vendor_invoice_no) <> ''
        )
        OR id IN ('RN-0926-7SHY0G-V', 'RN-1026-1ZC788-0')
      )
  `);
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('receipt_note'))) return;
  await knex.raw(`ALTER TABLE receipt_note DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`);
};
