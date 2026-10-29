/**
 * Store the Zoho Outbound PO identity on the local mirror.
 *
 * procurement_po.id stays the internal PPO- row key. It is not the OPO id.
 * outbound_po_identifier, outbound_po_number, and po_version_number are the
 * values Zoho returned. A later Receipt Note push reads these columns.
 *
 * Apply with (after a pg_dump backup):
 *   npx knex migrate:up 20261008120000_store_outbound_po_identity.js --env production
 * Never migrate:latest.
 *
 * @param { import("knex").Knex } knex
 */

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('procurement_po'))) {
    throw new Error('STOP: procurement_po is missing');
  }
  const hasIdentifier = await knex.schema.hasColumn('procurement_po', 'outbound_po_identifier');
  if (!hasIdentifier) {
    await knex.schema.alterTable('procurement_po', (table) => {
      table.string('outbound_po_identifier', 255).nullable();
      table.string('outbound_po_number', 255).nullable();
      table.decimal('po_version_number', 18, 4).nullable();
    });
  }

  await knex.raw(`
    UPDATE procurement_po
    SET outbound_po_number = BTRIM(po_number)
    WHERE outbound_po_number IS NULL
      AND po_number IS NOT NULL
      AND BTRIM(po_number) ~ '^[0-9]+(\\.[0-9]+)?$'
  `);
  await knex.raw(`
    UPDATE procurement_po
    SET outbound_po_identifier = BTRIM(po_number)
    WHERE outbound_po_identifier IS NULL
      AND po_number IS NOT NULL
      AND BTRIM(po_number) !~ '^[0-9]+(\\.[0-9]+)?$'
      AND BTRIM(po_number) !~ '^PPO-[0-9]{4}-[A-Z0-9]{6}-[A-Z0-9]$'
  `);
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('procurement_po'))) return;
  if (await knex.schema.hasColumn('procurement_po', 'outbound_po_identifier')) {
    await knex.schema.alterTable('procurement_po', (table) => {
      table.dropColumn('po_version_number');
      table.dropColumn('outbound_po_number');
      table.dropColumn('outbound_po_identifier');
    });
  }
};
