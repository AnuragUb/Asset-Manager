/**
 * Managed Sets v2 — additive schema only.
 *
 * Creates:
 *   managed_sets
 *   managed_set_components
 *
 * Does NOT:
 *   - alter assets.is_set / assets.parentid
 *   - alter inventory_items
 *   - backfill legacy kits
 *   - seed rows
 *   - add PO / project columns
 *   - cascade into assets / inventory_items
 *   - touch asset_history or inventory quantity/event tables
 *
 * Archive-oriented:
 *   - set_id ON DELETE RESTRICT (Set row cannot be dropped while component rows exist)
 *   - asset_id / inventory_item_id ON DELETE RESTRICT
 *   - deactivate components with is_active=false; do not DELETE rows in application code
 *
 * Do not confuse with 20260824120000_create_managed_sets_tables.js
 * (draft tables `sets` / `set_components` — unused, must not be applied).
 *
 * Composition (ASSET / INVENTORY / MIXED / EMPTY) is computed from
 * active components. There is no stored set_type.
 *
 * @param { import("knex").Knex } knex
 */

exports.up = async function (knex) {
  const hasManagedSets = await knex.schema.hasTable('managed_sets');
  if (!hasManagedSets) {
    await knex.schema.createTable('managed_sets', (table) => {
      table.string('id', 255).primary();
      table.string('set_code', 255).notNullable();
      table.string('name', 255).notNullable();
      table.text('description').nullable();
      table.string('status', 32).notNullable().defaultTo('DRAFT');
      table.string('zoho_product_id', 255).nullable();
      table.string('created_by', 255).nullable();
      table.string('updated_by', 255).nullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('archived_at').nullable();
    });

    await knex.raw(`
      ALTER TABLE managed_sets
      ADD CONSTRAINT managed_sets_set_code_unique UNIQUE (set_code)
    `);

    await knex.raw(`
      ALTER TABLE managed_sets
      ADD CONSTRAINT managed_sets_status_check
      CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED'))
    `);

    await knex.raw(`
      ALTER TABLE managed_sets
      ADD CONSTRAINT managed_sets_archive_consistency_check
      CHECK (
        (status = 'ARCHIVED' AND archived_at IS NOT NULL)
        OR (status <> 'ARCHIVED' AND archived_at IS NULL)
      )
    `);

    await knex.raw(`
      CREATE UNIQUE INDEX managed_sets_zoho_product_id_unique
      ON managed_sets (zoho_product_id)
      WHERE zoho_product_id IS NOT NULL AND BTRIM(zoho_product_id) <> ''
    `);

    await knex.raw(`
      CREATE INDEX idx_managed_sets_status ON managed_sets (status)
    `);
  }

  const hasComponents = await knex.schema.hasTable('managed_set_components');
  if (!hasComponents) {
    await knex.schema.createTable('managed_set_components', (table) => {
      table.string('id', 255).primary();
      table.string('set_id', 255).notNullable();
      table.string('component_type', 32).notNullable();
      table.string('asset_id', 255).nullable();
      table.string('inventory_item_id', 255).nullable();
      table.integer('quantity').notNullable().defaultTo(1);
      table.integer('sort_order').notNullable().defaultTo(0);
      table.boolean('is_active').notNullable().defaultTo(true);
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

      table
        .foreign('set_id', 'fk_managed_set_components_set_id')
        .references('id')
        .inTable('managed_sets')
        .onDelete('RESTRICT');

      table
        .foreign('asset_id', 'fk_managed_set_components_asset_id')
        .references('id')
        .inTable('assets')
        .onDelete('RESTRICT');

      table
        .foreign('inventory_item_id', 'fk_managed_set_components_inventory_item_id')
        .references('id')
        .inTable('inventory_items')
        .onDelete('RESTRICT');
    });

    await knex.raw(`
      ALTER TABLE managed_set_components
      ADD CONSTRAINT managed_set_components_type_check
      CHECK (component_type IN ('ASSET', 'INVENTORY'))
    `);

    await knex.raw(`
      ALTER TABLE managed_set_components
      ADD CONSTRAINT managed_set_components_xor_check
      CHECK (
        (
          component_type = 'ASSET'
          AND asset_id IS NOT NULL
          AND inventory_item_id IS NULL
        )
        OR (
          component_type = 'INVENTORY'
          AND inventory_item_id IS NOT NULL
          AND asset_id IS NULL
        )
      )
    `);

    await knex.raw(`
      ALTER TABLE managed_set_components
      ADD CONSTRAINT managed_set_components_quantity_positive_check
      CHECK (quantity > 0)
    `);

    await knex.raw(`
      ALTER TABLE managed_set_components
      ADD CONSTRAINT managed_set_components_asset_quantity_check
      CHECK (component_type <> 'ASSET' OR quantity = 1)
    `);

    await knex.raw(`
      CREATE INDEX idx_managed_set_components_set_id_sort
      ON managed_set_components (set_id, sort_order)
    `);

    await knex.raw(`
      CREATE UNIQUE INDEX managed_set_components_asset_id_active_unique
      ON managed_set_components (asset_id)
      WHERE asset_id IS NOT NULL AND is_active = true
    `);

    await knex.raw(`
      CREATE UNIQUE INDEX managed_set_components_set_inventory_active_unique
      ON managed_set_components (set_id, inventory_item_id)
      WHERE inventory_item_id IS NOT NULL AND is_active = true
    `);

    await knex.raw(`
      CREATE INDEX idx_managed_set_components_inventory_item_id_active
      ON managed_set_components (inventory_item_id)
      WHERE inventory_item_id IS NOT NULL AND is_active = true
    `);
  }
};

exports.down = async function (knex) {
  // Schema rollback only (empty tables). Application lifecycle is archive, not DROP.
  await knex.schema.dropTableIfExists('managed_set_components');
  await knex.schema.dropTableIfExists('managed_sets');
};
