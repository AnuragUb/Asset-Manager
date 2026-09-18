/**
 * Persist Zoho Product Name on procurement PO lines separately from Description.
 * Zoho Purchase_Items carry both Product_Name (lookup) and Description; AE previously
 * collapsed them into description and lost the commercial product name.
 *
 * Rollout: knex migrate, then refresh/import POs (or wait for next sync) to backfill names.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('procurement_po_line'))) return;
  if (!(await knex.schema.hasColumn('procurement_po_line', 'zoho_product_name'))) {
    await knex.schema.alterTable('procurement_po_line', (table) => {
      table.string('zoho_product_name', 512).nullable();
    });
  }
  if (await knex.schema.hasTable('zoho_catalog')) {
    await knex.raw(`
      UPDATE procurement_po_line AS l
      SET zoho_product_name = c.product_name
      FROM zoho_catalog AS c
      WHERE l.zoho_product_id IS NOT NULL
        AND btrim(l.zoho_product_id::text) <> ''
        AND c.zoho_product_id::text = l.zoho_product_id::text
        AND (l.zoho_product_name IS NULL OR btrim(l.zoho_product_name) = '')
        AND c.product_name IS NOT NULL
        AND btrim(c.product_name) <> ''
    `);
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('procurement_po_line'))) return;
  if (await knex.schema.hasColumn('procurement_po_line', 'zoho_product_name')) {
    await knex.schema.alterTable('procurement_po_line', (table) => {
      table.dropColumn('zoho_product_name');
    });
  }
};
