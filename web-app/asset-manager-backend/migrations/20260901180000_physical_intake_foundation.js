/**
 * Physical Intake foundation — controlled non-procurement physical birth.
 *
 * Additive:
 *   physical_intake
 *   physical_intake_output
 *   physical_intake_event
 *   physical_intake_idempotency
 *   assets.physical_intake_id
 *   inventory_items.physical_intake_id
 *
 * Does NOT:
 *   - reopen POST /api/assets or POST /api/inventory/items
 *   - migrate parentid / is_set / zoho_product_id / legacy POs
 *   - change quantity equations, reservation, conversion, or Set schema
 *   - create fake PO / Receipt Note rows
 *   - apply 20260824120000_create_managed_sets_tables.js
 *
 * Apply with named migrate only. Never migrate:latest.
 *
 * @param { import("knex").Knex } knex
 */

const QTY = 'NUMERIC(18,6)';
const HOLDING_TYPES = "('ASSET', 'INVENTORY')";
const INTAKE_TYPES = "('OPENING_BALANCE', 'LEGACY_EXISTING_STOCK', 'EXTERNAL_ACQUISITION', 'INTERNAL_TRANSFER', 'DONATION', 'NON_PO_ACQUISITION', 'OTHER_APPROVED')";
const EVENT_TYPES = "('PHYSICAL_INTAKE_CREATED', 'PHYSICAL_INTAKE_ASSET_CREATED', 'PHYSICAL_INTAKE_INVENTORY_CREATED')";

async function constraintExists(knex, name) {
  const existing = await knex.raw('SELECT 1 FROM pg_constraint WHERE conname = ?', [name]);
  return !!(existing.rows && existing.rows.length);
}

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('product'))) {
    throw new Error('STOP: product table is missing; Phase 1 must be applied first');
  }
  if (!(await knex.schema.hasTable('assets'))) {
    throw new Error('STOP: assets table is missing');
  }
  if (!(await knex.schema.hasTable('inventory_items'))) {
    throw new Error('STOP: inventory_items table is missing');
  }

  if (!(await knex.schema.hasTable('physical_intake'))) {
    await knex.schema.createTable('physical_intake', (table) => {
      table.string('id', 255).primary();
      table.string('status', 16).notNullable().defaultTo('POSTED');
      table.string('holding_type', 16).notNullable();
      table.string('intake_type', 32).notNullable();
      table.string('product_id', 255).notNullable();
      table.specificType('quantity', QTY).notNullable();
      table.string('unit', 64).notNullable();
      table.text('reason').nullable();
      table.jsonb('source_json').nullable();
      table.string('location', 255).nullable();
      table.string('folder_id', 255).nullable();
      table.string('kind_id', 255).nullable();
      table.string('actor', 255).nullable();
      table.string('approving_actor', 255).nullable();
      table.string('idempotency_key', 64).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table
        .foreign('product_id', 'fk_physical_intake_product_id')
        .references('id')
        .inTable('product')
        .onDelete('RESTRICT');
    });

    await knex.raw(`
      ALTER TABLE physical_intake
      ADD CONSTRAINT physical_intake_id_format_check
      CHECK (id ~ '^INTAKE-[0-9]{4}-[A-Z0-9]{6}-[A-Z0-9]$')
    `);
    await knex.raw(`
      ALTER TABLE physical_intake
      ADD CONSTRAINT physical_intake_status_check
      CHECK (status IN ('POSTED'))
    `);
    await knex.raw(`
      ALTER TABLE physical_intake
      ADD CONSTRAINT physical_intake_holding_type_check
      CHECK (holding_type IN ${HOLDING_TYPES})
    `);
    await knex.raw(`
      ALTER TABLE physical_intake
      ADD CONSTRAINT physical_intake_type_check
      CHECK (intake_type IN ${INTAKE_TYPES})
    `);
    await knex.raw(`
      ALTER TABLE physical_intake
      ADD CONSTRAINT physical_intake_quantity_positive_check
      CHECK (quantity > 0)
    `);
    await knex.raw(`
      ALTER TABLE physical_intake
      ADD CONSTRAINT physical_intake_idempotency_key_unique UNIQUE (idempotency_key)
    `);
    await knex.raw('CREATE INDEX idx_physical_intake_product_id ON physical_intake (product_id)');
    await knex.raw('CREATE INDEX idx_physical_intake_type ON physical_intake (intake_type)');
    await knex.raw('CREATE INDEX idx_physical_intake_holding_type ON physical_intake (holding_type)');
    await knex.raw('CREATE INDEX idx_physical_intake_created_at ON physical_intake (created_at DESC)');
  }

  if (!(await knex.schema.hasTable('physical_intake_output'))) {
    await knex.schema.createTable('physical_intake_output', (table) => {
      table.bigIncrements('id').primary();
      table.string('physical_intake_id', 255).notNullable();
      table.string('resource_type', 16).notNullable();
      table.string('resource_id', 255).notNullable();
      table.specificType('quantity', QTY).notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table
        .foreign('physical_intake_id', 'fk_physical_intake_output_intake_id')
        .references('id')
        .inTable('physical_intake')
        .onDelete('RESTRICT');
    });
    await knex.raw(`
      ALTER TABLE physical_intake_output
      ADD CONSTRAINT physical_intake_output_resource_type_check
      CHECK (resource_type IN ${HOLDING_TYPES})
    `);
    await knex.raw(`
      ALTER TABLE physical_intake_output
      ADD CONSTRAINT physical_intake_output_quantity_positive_check
      CHECK (quantity > 0)
    `);
    await knex.raw(`
      ALTER TABLE physical_intake_output
      ADD CONSTRAINT physical_intake_output_resource_unique UNIQUE (resource_type, resource_id)
    `);
    await knex.raw('CREATE INDEX idx_physical_intake_output_intake_id ON physical_intake_output (physical_intake_id)');
  }

  if (!(await knex.schema.hasTable('physical_intake_event'))) {
    await knex.schema.createTable('physical_intake_event', (table) => {
      table.bigIncrements('id').primary();
      table.string('physical_intake_id', 255).notNullable();
      table.string('type', 48).notNullable();
      table.string('product_id', 255).nullable();
      table.specificType('quantity', QTY).nullable();
      table.string('unit', 64).nullable();
      table.string('actor', 255).nullable();
      table.timestamp('timestamp', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.text('reason').nullable();
      table.string('resource_type', 16).nullable();
      table.string('resource_id', 255).nullable();
      table.text('metadata_json').nullable();

      table
        .foreign('physical_intake_id', 'fk_physical_intake_event_intake_id')
        .references('id')
        .inTable('physical_intake')
        .onDelete('RESTRICT');
    });
    await knex.raw(`
      ALTER TABLE physical_intake_event
      ADD CONSTRAINT physical_intake_event_type_check
      CHECK (type IN ${EVENT_TYPES})
    `);
    await knex.raw('CREATE INDEX idx_physical_intake_event_intake_id ON physical_intake_event (physical_intake_id, id)');
  }

  if (!(await knex.schema.hasTable('physical_intake_idempotency'))) {
    await knex.schema.createTable('physical_intake_idempotency', (table) => {
      table.string('idempotency_key', 64).primary();
      table.string('physical_intake_id', 255).notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table
        .foreign('physical_intake_id', 'fk_physical_intake_idempotency_intake_id')
        .references('id')
        .inTable('physical_intake')
        .onDelete('RESTRICT');
    });
  }

  if (!(await knex.schema.hasColumn('assets', 'physical_intake_id'))) {
    await knex.schema.alterTable('assets', (t) => {
      t.string('physical_intake_id', 255).nullable();
    });
  }
  if (!(await knex.schema.hasColumn('inventory_items', 'physical_intake_id'))) {
    await knex.schema.alterTable('inventory_items', (t) => {
      t.string('physical_intake_id', 255).nullable();
    });
  }
  if (!(await constraintExists(knex, 'fk_assets_physical_intake_id'))) {
    await knex.raw(`
      ALTER TABLE assets
      ADD CONSTRAINT fk_assets_physical_intake_id
      FOREIGN KEY (physical_intake_id) REFERENCES physical_intake(id)
      ON DELETE RESTRICT
    `);
  }
  if (!(await constraintExists(knex, 'fk_inventory_items_physical_intake_id'))) {
    await knex.raw(`
      ALTER TABLE inventory_items
      ADD CONSTRAINT fk_inventory_items_physical_intake_id
      FOREIGN KEY (physical_intake_id) REFERENCES physical_intake(id)
      ON DELETE RESTRICT
    `);
  }
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_assets_physical_intake_id ON assets (physical_intake_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_inventory_items_physical_intake_id ON inventory_items (physical_intake_id)');
};

exports.down = async function (knex) {
  if (await constraintExists(knex, 'fk_inventory_items_physical_intake_id')) {
    await knex.raw('ALTER TABLE inventory_items DROP CONSTRAINT fk_inventory_items_physical_intake_id');
  }
  if (await constraintExists(knex, 'fk_assets_physical_intake_id')) {
    await knex.raw('ALTER TABLE assets DROP CONSTRAINT fk_assets_physical_intake_id');
  }
  if (await knex.schema.hasColumn('inventory_items', 'physical_intake_id')) {
    await knex.schema.alterTable('inventory_items', (t) => t.dropColumn('physical_intake_id'));
  }
  if (await knex.schema.hasColumn('assets', 'physical_intake_id')) {
    await knex.schema.alterTable('assets', (t) => t.dropColumn('physical_intake_id'));
  }
  await knex.schema.dropTableIfExists('physical_intake_idempotency');
  await knex.schema.dropTableIfExists('physical_intake_event');
  await knex.schema.dropTableIfExists('physical_intake_output');
  await knex.schema.dropTableIfExists('physical_intake');
};
