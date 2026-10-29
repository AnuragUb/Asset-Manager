/**
 * Hardening: unique open reconciliation is any non-CLOSED row for a PO line.
 * Partial unique index previously omitted RETURNED_TO_VENDOR / RETAINED with residual difference,
 * allowing duplicate PRECs on repeated PO revisions after partial vendor return.
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('procurement_reconciliation'))) return;

  await knex.raw(`DROP INDEX IF EXISTS idx_proc_recon_open_line`);
  await knex.raw(`
    CREATE UNIQUE INDEX idx_proc_recon_open_line
    ON procurement_reconciliation (procurement_po_line_id)
    WHERE status <> 'CLOSED'
  `);
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('procurement_reconciliation'))) return;
  await knex.raw(`DROP INDEX IF EXISTS idx_proc_recon_open_line`);
  await knex.raw(`
    CREATE UNIQUE INDEX idx_proc_recon_open_line
    ON procurement_reconciliation (procurement_po_line_id)
    WHERE status IN ('OPEN','RESOLUTION_SELECTED','RETURN_PENDING')
  `);
};
