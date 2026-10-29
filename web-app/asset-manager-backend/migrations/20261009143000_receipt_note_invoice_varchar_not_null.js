/**
 * Match the live public.receipt_note invoice column.
 *
 * The app reads public.receipt_note, not receipt_note.receipt_note.
 * vendor_invoice_no is varchar and NOT NULL. Blank text is also rejected.
 * The earlier check that let Return Inward and two old notes stay blank
 * is removed. Those rows already have invoice numbers.
 *
 * Apply with (after a pg_dump backup):
 *   npx knex migrate:up 20261009143000_receipt_note_invoice_varchar_not_null.js --env production
 * Never migrate:latest.
 *
 * @param { import("knex").Knex } knex
 */

const NOT_BLANK = 'receipt_note_vendor_invoice_not_blank';

exports.up = async function up(knex) {
  const table = await knex.raw(`
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'receipt_note'
  `);
  if (!table.rows.length) throw new Error('STOP: public.receipt_note is missing');

  const blanks = await knex.raw(`
    SELECT id
    FROM public.receipt_note
    WHERE vendor_invoice_no IS NULL OR BTRIM(vendor_invoice_no::text) = ''
  `);
  if (blanks.rows.length) {
    throw new Error(`STOP: invoice still blank on ${blanks.rows.map((row) => row.id).join(', ')}`);
  }

  await knex.raw(`
    ALTER TABLE public.receipt_note
      ALTER COLUMN vendor_invoice_no TYPE varchar
  `);
  await knex.raw(`
    ALTER TABLE public.receipt_note
      ALTER COLUMN vendor_invoice_no SET NOT NULL
  `);
  await knex.raw(`
    ALTER TABLE public.receipt_note
      DROP CONSTRAINT IF EXISTS receipt_note_vendor_invoice_required
  `);
  const existing = await knex.raw('SELECT 1 FROM pg_constraint WHERE conname = ?', [NOT_BLANK]);
  if (!existing.rows.length) {
    await knex.raw(`
      ALTER TABLE public.receipt_note
        ADD CONSTRAINT ${NOT_BLANK}
        CHECK (BTRIM(vendor_invoice_no::text) <> '')
    `);
  }
};

exports.down = async function down(knex) {
  await knex.raw(`ALTER TABLE public.receipt_note DROP CONSTRAINT IF EXISTS ${NOT_BLANK}`);
  await knex.raw(`
    ALTER TABLE public.receipt_note
      ALTER COLUMN vendor_invoice_no DROP NOT NULL
  `);
};
