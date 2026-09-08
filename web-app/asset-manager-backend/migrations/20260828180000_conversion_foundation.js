/**
 * Phase 4 — conversion foundation.
 *
 * Additive:
 *   assets.quantity_converted
 *   inventory_items.quantity_converted
 *   assets.conversion_source_type / conversion_source_id
 *   assets.conversion_root_type / conversion_root_id
 *   assets.conversion_id
 *   conversion
 *   conversion_line
 *   conversion_event
 *
 * Does NOT:
 *   - invent conversions from temporary_assets, components, parentid, or project_assets
 *   - alter Product, Zoho, Sets, QR of existing rows, or reservation rows
 *   - enable a CONVERT inventory movement type
 *   - rewrite promoteToAsset / make-permanent / split / unsplit
 *
 * Apply with:
 *   npx knex migrate:up 20260828180000_conversion_foundation.js --env production
 * Never migrate:latest on production (abandoned 20260824120000 is still unapplied).
 *
 * @param { import("knex").Knex } knex
 */

const QTY_NUMERIC = 'NUMERIC(18,6)';
const DIRECTIONS = "('INVENTORY_TO_ASSET', 'ASSET_TO_INVENTORY')";
const STATUSES = "('ACTIVE', 'RETURNED')";
const GRANULARITIES = "('GROUPED', 'INDIVIDUAL')";
const CONDITIONS = "('AVAILABLE', 'INSPECTION', 'DAMAGED')";
const HOLDING_TYPES = "('ASSET', 'INVENTORY')";
const LINE_ROLES = "('SOURCE', 'DESTINATION')";
const EVENT_TYPES = "('CONVERT_INVENTORY_TO_ASSET', 'RETURN_ASSET_TO_INVENTORY')";

async function constraintExists(knex, name) {
  const existing = await knex.raw(`SELECT 1 FROM pg_constraint WHERE conname = ?`, [name]);
  return !!(existing.rows && existing.rows.length);
}

async function addQuantityConverted(knex, table) {
  const has = await knex.schema.hasColumn(table, 'quantity_converted');
  if (!has) {
    await knex.schema.alterTable(table, (t) => {
      t.specificType('quantity_converted', QTY_NUMERIC).nullable();
    });
  }

  await knex.raw(`
    UPDATE ${table}
    SET quantity_converted = 0
    WHERE quantity_converted IS NULL
  `);

  await knex.raw(`ALTER TABLE ${table} ALTER COLUMN quantity_converted SET DEFAULT 0`);
  await knex.raw(`ALTER TABLE ${table} ALTER COLUMN quantity_converted SET NOT NULL`);

  const convertedCheck = `${table}_quantity_converted_nonneg_check`;
  if (!(await constraintExists(knex, convertedCheck))) {
    await knex.raw(`
      ALTER TABLE ${table}
      ADD CONSTRAINT ${convertedCheck}
      CHECK (quantity_converted >= 0)
    `);
  }
}

async function addAssetConversionLineage(knex) {
  const cols = [
    ['conversion_source_type', (t) => t.string('conversion_source_type', 16).nullable()],
    ['conversion_source_id', (t) => t.string('conversion_source_id', 255).nullable()],
    ['conversion_root_type', (t) => t.string('conversion_root_type', 16).nullable()],
    ['conversion_root_id', (t) => t.string('conversion_root_id', 255).nullable()],
    ['conversion_id', (t) => t.string('conversion_id', 255).nullable()]
  ];
  for (const [name, add] of cols) {
    if (!(await knex.schema.hasColumn('assets', name))) {
      await knex.schema.alterTable('assets', (t) => add(t));
    }
  }

  if (!(await constraintExists(knex, 'assets_conversion_source_type_check'))) {
    await knex.raw(`
      ALTER TABLE assets
      ADD CONSTRAINT assets_conversion_source_type_check
      CHECK (conversion_source_type IS NULL OR conversion_source_type IN ('INVENTORY'))
    `);
  }
  if (!(await constraintExists(knex, 'assets_conversion_root_type_check'))) {
    await knex.raw(`
      ALTER TABLE assets
      ADD CONSTRAINT assets_conversion_root_type_check
      CHECK (conversion_root_type IS NULL OR conversion_root_type IN ('INVENTORY'))
    `);
  }
}

exports.up = async function (knex) {
  await addQuantityConverted(knex, 'assets');
  await addQuantityConverted(knex, 'inventory_items');

  const bounds = await knex.raw(`
    SELECT 'assets' AS table_name, id,
           quantity_total, quantity_available, quantity_reserved, quantity_converted
    FROM assets
    WHERE COALESCE(quantity_available, 0) + COALESCE(quantity_reserved, 0)
          - COALESCE(quantity_total, 0) > 0.000001
    UNION ALL
    SELECT 'inventory_items', id,
           quantity_total, quantity_available, quantity_reserved, quantity_converted
    FROM inventory_items
    WHERE COALESCE(quantity_available, 0) + COALESCE(quantity_reserved, 0)
          - COALESCE(quantity_total, 0) > 0.000001
  `);
  if (bounds.rows && bounds.rows.length) {
    throw new Error(
      `STOP: available + reserved exceeds total after converted=0 backfill: ${JSON.stringify(bounds.rows)}`
    );
  }

  if (!(await knex.schema.hasTable('conversion'))) {
    await knex.schema.createTable('conversion', (table) => {
      table.string('id', 255).primary();
      table.string('direction', 32).notNullable();
      table.string('status', 16).notNullable().defaultTo('ACTIVE');
      table.string('source_type', 16).notNullable();
      table.string('source_id', 255).notNullable();
      table.specificType('quantity', QTY_NUMERIC).notNullable();
      table.specificType('quantity_original', QTY_NUMERIC).notNullable();
      table.string('granularity', 16).nullable();
      table.string('condition', 16).nullable();
      table.string('product_id', 255).nullable();
      table.text('reason').nullable();
      table.string('reason_code', 32).nullable();
      table.string('reference', 255).nullable();
      table.string('idempotency_key', 64).nullable();
      table.string('parent_conversion_id', 255).nullable();
      table.string('created_by', 255).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });

    await knex.raw(`
      ALTER TABLE "conversion"
      ADD CONSTRAINT conversion_id_format_check
      CHECK (id ~ '^CONV-[0-9]{4}-[A-Z0-9]{6}-[A-Z0-9]$')
    `);
    await knex.raw(`
      ALTER TABLE "conversion"
      ADD CONSTRAINT conversion_direction_check
      CHECK (direction IN ${DIRECTIONS})
    `);
    await knex.raw(`
      ALTER TABLE "conversion"
      ADD CONSTRAINT conversion_status_check
      CHECK (status IN ${STATUSES})
    `);
    await knex.raw(`
      ALTER TABLE "conversion"
      ADD CONSTRAINT conversion_source_type_check
      CHECK (source_type IN ${HOLDING_TYPES})
    `);
    await knex.raw(`
      ALTER TABLE "conversion"
      ADD CONSTRAINT conversion_granularity_check
      CHECK (granularity IS NULL OR granularity IN ${GRANULARITIES})
    `);
    await knex.raw(`
      ALTER TABLE "conversion"
      ADD CONSTRAINT conversion_condition_check
      CHECK (condition IS NULL OR condition IN ${CONDITIONS})
    `);
    await knex.raw(`
      ALTER TABLE "conversion"
      ADD CONSTRAINT conversion_quantity_original_positive_check
      CHECK (quantity_original > 0)
    `);
    await knex.raw(`
      ALTER TABLE "conversion"
      ADD CONSTRAINT conversion_quantity_nonneg_check
      CHECK (quantity >= 0)
    `);
    await knex.raw(`
      ALTER TABLE "conversion"
      ADD CONSTRAINT conversion_quantity_lte_original_check
      CHECK (quantity <= quantity_original)
    `);
    await knex.raw(`
      ALTER TABLE "conversion"
      ADD CONSTRAINT conversion_active_quantity_positive_check
      CHECK (status <> 'ACTIVE' OR quantity > 0)
    `);
    await knex.raw(`
      ALTER TABLE "conversion"
      ADD CONSTRAINT conversion_parent_fk
      FOREIGN KEY (parent_conversion_id) REFERENCES "conversion"(id)
      ON DELETE RESTRICT
    `);

    await knex.raw(`
      CREATE UNIQUE INDEX conversion_idempotency_key_unique
      ON "conversion" (idempotency_key)
      WHERE idempotency_key IS NOT NULL
    `);
    await knex.raw(`
      CREATE INDEX conversion_source_status_idx
      ON "conversion" (source_type, source_id, status)
    `);
    await knex.raw(`
      CREATE INDEX conversion_direction_status_idx
      ON "conversion" (direction, status)
    `);
  }

  await addAssetConversionLineage(knex);

  if (!(await constraintExists(knex, 'assets_conversion_id_fk'))) {
    await knex.raw(`
      ALTER TABLE assets
      ADD CONSTRAINT assets_conversion_id_fk
      FOREIGN KEY (conversion_id) REFERENCES "conversion"(id)
      ON DELETE RESTRICT
    `);
  }

  if (!(await knex.schema.hasTable('conversion_line'))) {
    await knex.schema.createTable('conversion_line', (table) => {
      table.bigIncrements('id').primary();
      table.string('conversion_id', 255).notNullable();
      table.string('holding_type', 16).notNullable();
      table.string('holding_id', 255).notNullable();
      table.string('role', 16).notNullable();
      table.specificType('quantity', QTY_NUMERIC).notNullable();
    });
    await knex.raw(`
      ALTER TABLE conversion_line
      ADD CONSTRAINT conversion_line_holding_type_check
      CHECK (holding_type IN ${HOLDING_TYPES})
    `);
    await knex.raw(`
      ALTER TABLE conversion_line
      ADD CONSTRAINT conversion_line_role_check
      CHECK (role IN ${LINE_ROLES})
    `);
    await knex.raw(`
      ALTER TABLE conversion_line
      ADD CONSTRAINT conversion_line_conversion_fk
      FOREIGN KEY (conversion_id) REFERENCES "conversion"(id)
      ON DELETE RESTRICT
    `);
    await knex.raw(`
      CREATE INDEX conversion_line_conversion_idx
      ON conversion_line (conversion_id)
    `);
    await knex.raw(`
      CREATE INDEX conversion_line_holding_idx
      ON conversion_line (holding_type, holding_id)
    `);
  }

  if (!(await knex.schema.hasTable('conversion_event'))) {
    await knex.schema.createTable('conversion_event', (table) => {
      table.bigIncrements('id').primary();
      table.string('conversion_id', 255).notNullable();
      table.string('type', 32).notNullable();
      table.specificType('quantity', QTY_NUMERIC).notNullable();
      table.string('actor', 255).nullable();
      table.timestamp('timestamp', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.text('note').nullable();
      table.text('metadata_json').nullable();
    });
    await knex.raw(`
      ALTER TABLE conversion_event
      ADD CONSTRAINT conversion_event_type_check
      CHECK (type IN ${EVENT_TYPES})
    `);
    await knex.raw(`
      ALTER TABLE conversion_event
      ADD CONSTRAINT conversion_event_conversion_fk
      FOREIGN KEY (conversion_id) REFERENCES "conversion"(id)
      ON DELETE RESTRICT
    `);
    await knex.raw(`
      CREATE INDEX conversion_event_conversion_idx
      ON conversion_event (conversion_id)
    `);
  }
};

exports.down = async function (knex) {
  const leftover = await knex.raw(`
    SELECT id, status, quantity FROM "conversion"
    WHERE status = 'ACTIVE' OR COALESCE(quantity, 0) <> 0
    LIMIT 5
  `).catch(() => ({ rows: [] }));
  if (leftover.rows && leftover.rows.length) {
    throw new Error(
      `STOP: conversion down() refused while ACTIVE/nonzero rows exist: ${JSON.stringify(leftover.rows)}`
    );
  }

  for (const table of ['assets', 'inventory_items']) {
    if (await knex.schema.hasColumn(table, 'quantity_converted')) {
      const nonzero = await knex.raw(
        `SELECT id, quantity_converted FROM ${table} WHERE quantity_converted <> 0 LIMIT 5`
      );
      if (nonzero.rows && nonzero.rows.length) {
        throw new Error(
          `STOP: cannot drop ${table}.quantity_converted; nonzero values remain: ${JSON.stringify(nonzero.rows)}`
        );
      }
    }
  }

  if (await constraintExists(knex, 'assets_conversion_id_fk')) {
    await knex.raw(`ALTER TABLE assets DROP CONSTRAINT assets_conversion_id_fk`);
  }

  await knex.schema.dropTableIfExists('conversion_event');
  await knex.schema.dropTableIfExists('conversion_line');
  await knex.schema.dropTableIfExists('conversion');

  if (await knex.schema.hasTable('assets')) {
    for (const col of [
      'conversion_id',
      'conversion_source_type',
      'conversion_source_id',
      'conversion_root_type',
      'conversion_root_id'
    ]) {
      if (await knex.schema.hasColumn('assets', col)) {
        await knex.schema.alterTable('assets', (t) => t.dropColumn(col));
      }
    }
  }

  for (const table of ['assets', 'inventory_items']) {
    if (await knex.schema.hasColumn(table, 'quantity_converted')) {
      const convertedCheck = `${table}_quantity_converted_nonneg_check`;
      if (await constraintExists(knex, convertedCheck)) {
        await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT ${convertedCheck}`);
      }
      await knex.schema.alterTable(table, (t) => {
        t.dropColumn('quantity_converted');
      });
    }
  }
};
