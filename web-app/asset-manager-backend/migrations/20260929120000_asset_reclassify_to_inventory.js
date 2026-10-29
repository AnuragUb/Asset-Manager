/**
 * Asset → Inventory reclassification (PHYSICAL_TALLY_AUTHORITY_ADR §11).
 *
 * Additive:
 *   conversion.status            + 'RECLASSIFIED'
 *   conversion_event.type        + 'RECLASSIFY_ASSET_TO_INVENTORY'
 *   inventory_items.conversion_source_type / conversion_source_id / conversion_id
 *     (set only on an inventory item created by a reclassification)
 *
 * Apply with (after a pg_dump backup):
 *   npx knex migrate:up 20260929120000_asset_reclassify_to_inventory.js --env production
 * Never migrate:latest.
 *
 * @param { import("knex").Knex } knex
 */

async function constraintExists(knex, name) {
  const existing = await knex.raw('SELECT 1 FROM pg_constraint WHERE conname = ?', [name]);
  return !!(existing.rows && existing.rows.length);
}

async function replaceCheck(knex, table, name, definition) {
  if (await constraintExists(knex, name)) {
    await knex.raw(`ALTER TABLE "${table}" DROP CONSTRAINT ${name}`);
  }
  await knex.raw(`ALTER TABLE "${table}" ADD CONSTRAINT ${name} CHECK (${definition})`);
}

const INVENTORY_COLUMNS = [
  ['conversion_source_type', (t) => t.string('conversion_source_type', 16).nullable()],
  ['conversion_source_id', (t) => t.string('conversion_source_id', 255).nullable()],
  ['conversion_id', (t) => t.string('conversion_id', 255).nullable()]
];

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('conversion'))) {
    throw new Error('STOP: conversion tables are missing; apply 20260828180000_conversion_foundation first');
  }

  await replaceCheck(knex, 'conversion', 'conversion_status_check',
    "status IN ('ACTIVE', 'RETURNED', 'RECLASSIFIED')");
  await replaceCheck(knex, 'conversion_event', 'conversion_event_type_check',
    "type IN ('CONVERT_INVENTORY_TO_ASSET', 'RETURN_ASSET_TO_INVENTORY', 'RECLASSIFY_ASSET_TO_INVENTORY')");

  for (const [name, add] of INVENTORY_COLUMNS) {
    if (!(await knex.schema.hasColumn('inventory_items', name))) {
      await knex.schema.alterTable('inventory_items', (t) => add(t));
    }
  }
  if (!(await constraintExists(knex, 'inventory_items_conversion_source_type_check'))) {
    await knex.raw(`
      ALTER TABLE inventory_items
      ADD CONSTRAINT inventory_items_conversion_source_type_check
      CHECK (conversion_source_type IS NULL OR conversion_source_type IN ('ASSET'))
    `);
  }
  if (!(await constraintExists(knex, 'inventory_items_conversion_id_fk'))) {
    await knex.raw(`
      ALTER TABLE inventory_items
      ADD CONSTRAINT inventory_items_conversion_id_fk
      FOREIGN KEY (conversion_id) REFERENCES "conversion"(id)
      ON DELETE RESTRICT
    `);
  }
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS inventory_items_conversion_source_idx
    ON inventory_items (conversion_source_id)
    WHERE conversion_source_id IS NOT NULL
  `);
};

exports.down = async function down(knex) {
  const used = await knex.raw(`SELECT id FROM "conversion" WHERE status = 'RECLASSIFIED' LIMIT 5`);
  if (used.rows && used.rows.length) {
    throw new Error(`STOP: reclassifications exist and would lose their record: ${JSON.stringify(used.rows)}`);
  }

  await knex.raw('DROP INDEX IF EXISTS inventory_items_conversion_source_idx');
  if (await constraintExists(knex, 'inventory_items_conversion_id_fk')) {
    await knex.raw('ALTER TABLE inventory_items DROP CONSTRAINT inventory_items_conversion_id_fk');
  }
  if (await constraintExists(knex, 'inventory_items_conversion_source_type_check')) {
    await knex.raw('ALTER TABLE inventory_items DROP CONSTRAINT inventory_items_conversion_source_type_check');
  }
  for (const [name] of INVENTORY_COLUMNS) {
    if (await knex.schema.hasColumn('inventory_items', name)) {
      await knex.schema.alterTable('inventory_items', (t) => t.dropColumn(name));
    }
  }

  await replaceCheck(knex, 'conversion_event', 'conversion_event_type_check',
    "type IN ('CONVERT_INVENTORY_TO_ASSET', 'RETURN_ASSET_TO_INVENTORY')");
  await replaceCheck(knex, 'conversion', 'conversion_status_check',
    "status IN ('ACTIVE', 'RETURNED')");
};
