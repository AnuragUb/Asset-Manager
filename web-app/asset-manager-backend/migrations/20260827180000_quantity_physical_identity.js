/**
 * Phase 2 — Quantity conservation + physical identity foundation.
 *
 * Additive except the approved B-2 type change:
 *   quantity_total / quantity_available (and event-line deltas, conversion_factor)
 *   real / double precision → NUMERIC(18,6)
 *
 * Does NOT:
 *   - add quantity_reserved / quantity_converted
 *   - parse or copy srno into physical_marking
 *   - create sets / set_components
 *   - rewrite Asset QR blobs
 *   - run DML that guesses lineage on ambiguous Set rows
 *
 * Apply with:
 *   npx knex migrate:up --name 20260827180000_quantity_physical_identity.js
 * Never migrate:latest on production (abandoned 20260824120000 is still unapplied).
 *
 * @param { import("knex").Knex } knex
 */

const QTY_NUMERIC = 'NUMERIC(18,6)';
const LINEAGE_VALUES = "('ACTIVE', 'INACTIVE')";
const MARKING_KIND = "('MANUFACTURER_SERIAL', 'BOX_SERIAL', 'OTHER')";
const MARKING_STATUS = "('ACTIVE', 'INACTIVE')";
const HOLDING_TYPE = "('ASSET', 'INVENTORY')";

async function alterToNumeric(knex, table, column, { notNull = false, defaultZero = false } = {}) {
  const quoted = `"${column}"`;
  let sql = `ALTER TABLE ${table} ALTER COLUMN ${quoted} TYPE ${QTY_NUMERIC} USING ${quoted}::${QTY_NUMERIC}`;
  await knex.raw(sql);
  if (defaultZero) {
    await knex.raw(`ALTER TABLE ${table} ALTER COLUMN ${quoted} SET DEFAULT 0`);
  }
  if (notNull) {
    await knex.raw(`ALTER TABLE ${table} ALTER COLUMN ${quoted} SET NOT NULL`);
  }
}

async function addLineageStatus(knex, table) {
  const has = await knex.schema.hasColumn(table, 'lineage_status');
  if (has) return;
  await knex.schema.alterTable(table, (t) => {
    t.string('lineage_status', 16).notNullable().defaultTo('ACTIVE');
  });
  await knex.raw(`
    ALTER TABLE ${table}
    ADD CONSTRAINT ${table}_lineage_status_check
    CHECK (lineage_status IN ${LINEAGE_VALUES})
  `);
}

async function addQuantityOriginal(knex, table) {
  const has = await knex.schema.hasColumn(table, 'quantity_original');
  if (has) return;
  await knex.schema.alterTable(table, (t) => {
    t.specificType('quantity_original', QTY_NUMERIC).nullable();
  });
}

async function addFkIfMissing(knex, table, column, constraint) {
  const existing = await knex.raw(
    `SELECT 1 FROM pg_constraint WHERE conname = ?`,
    [constraint]
  );
  if (existing.rows && existing.rows.length) return;
  await knex.raw(`
    ALTER TABLE ${table}
    ADD CONSTRAINT ${constraint}
    FOREIGN KEY (${column}) REFERENCES ${table}(id)
    ON DELETE RESTRICT
  `);
}

exports.up = async function (knex) {
  const danglingAssets = await knex.raw(`
    SELECT id, quantity_parent_id, quantity_root_id
    FROM assets
    WHERE (quantity_parent_id IS NOT NULL AND BTRIM(quantity_parent_id) <> '' AND NOT EXISTS (
            SELECT 1 FROM assets p WHERE p.id = assets.quantity_parent_id
          ))
       OR (quantity_root_id IS NOT NULL AND BTRIM(quantity_root_id) <> '' AND NOT EXISTS (
            SELECT 1 FROM assets r WHERE r.id = assets.quantity_root_id
          ))
  `);
  if (danglingAssets.rows.length) {
    throw new Error(
      `STOP: dangling assets quantity lineage: ${JSON.stringify(danglingAssets.rows)}`
    );
  }

  const danglingInv = await knex.raw(`
    SELECT id, quantity_parent_id, quantity_root_id
    FROM inventory_items
    WHERE (quantity_parent_id IS NOT NULL AND BTRIM(quantity_parent_id) <> '' AND NOT EXISTS (
            SELECT 1 FROM inventory_items p WHERE p.id = inventory_items.quantity_parent_id
          ))
       OR (quantity_root_id IS NOT NULL AND BTRIM(quantity_root_id) <> '' AND NOT EXISTS (
            SELECT 1 FROM inventory_items r WHERE r.id = inventory_items.quantity_root_id
          ))
  `);
  if (danglingInv.rows.length) {
    throw new Error(
      `STOP: dangling inventory quantity lineage: ${JSON.stringify(danglingInv.rows)}`
    );
  }

  await knex.raw(`
    UPDATE assets SET quantity_parent_id = NULL
    WHERE quantity_parent_id IS NOT NULL AND BTRIM(quantity_parent_id) = ''
  `);
  await knex.raw(`
    UPDATE assets SET quantity_root_id = NULL
    WHERE quantity_root_id IS NOT NULL AND BTRIM(quantity_root_id) = ''
  `);
  await knex.raw(`
    UPDATE inventory_items SET quantity_parent_id = NULL
    WHERE quantity_parent_id IS NOT NULL AND BTRIM(quantity_parent_id) = ''
  `);
  await knex.raw(`
    UPDATE inventory_items SET quantity_root_id = NULL
    WHERE quantity_root_id IS NOT NULL AND BTRIM(quantity_root_id) = ''
  `);

  await alterToNumeric(knex, 'assets', 'quantity_total');
  await alterToNumeric(knex, 'assets', 'quantity_available');
  await alterToNumeric(knex, 'assets', 'conversion_factor');
  await alterToNumeric(knex, 'inventory_items', 'quantity_total', { defaultZero: true });
  await alterToNumeric(knex, 'inventory_items', 'quantity_available', { defaultZero: true });
  await alterToNumeric(knex, 'inventory_items', 'conversion_factor');
  await alterToNumeric(knex, 'quantity_event_lines', 'delta_total', { notNull: true, defaultZero: true });
  await alterToNumeric(knex, 'quantity_event_lines', 'delta_available', { notNull: true, defaultZero: true });
  await alterToNumeric(knex, 'inventory_quantity_event_lines', 'delta_total', { notNull: true, defaultZero: true });
  await alterToNumeric(knex, 'inventory_quantity_event_lines', 'delta_available', { notNull: true, defaultZero: true });

  await addLineageStatus(knex, 'assets');
  await addLineageStatus(knex, 'inventory_items');
  await addQuantityOriginal(knex, 'assets');
  await addQuantityOriginal(knex, 'inventory_items');

  if (!(await knex.schema.hasColumn('inventory_items', 'qrcode'))) {
    await knex.schema.alterTable('inventory_items', (t) => {
      t.text('qrcode').nullable();
    });
  }
  if (!(await knex.schema.hasColumn('inventory_items', 'noqr'))) {
    await knex.schema.alterTable('inventory_items', (t) => {
      t.integer('noqr').notNullable().defaultTo(0);
    });
  }
  if (!(await knex.schema.hasColumn('inventory_items', 'client_label'))) {
    await knex.schema.alterTable('inventory_items', (t) => {
      t.string('client_label', 255).nullable();
    });
  }

  await knex.raw(`
    UPDATE assets
    SET quantity_original = quantity_total
    WHERE is_quantity_tracked = 1
      AND quantity_root_id IS NOT NULL
      AND quantity_root_id = id
      AND quantity_original IS NULL
  `);
  await knex.raw(`
    UPDATE inventory_items
    SET quantity_original = quantity_total
    WHERE is_quantity_tracked = 1
      AND quantity_root_id IS NOT NULL
      AND quantity_root_id = id
      AND quantity_original IS NULL
  `);

  await addFkIfMissing(knex, 'assets', 'quantity_parent_id', 'fk_assets_quantity_parent_id');
  await addFkIfMissing(knex, 'assets', 'quantity_root_id', 'fk_assets_quantity_root_id');
  await addFkIfMissing(knex, 'inventory_items', 'quantity_parent_id', 'fk_inventory_items_quantity_parent_id');
  await addFkIfMissing(knex, 'inventory_items', 'quantity_root_id', 'fk_inventory_items_quantity_root_id');

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_assets_quantity_parent_id ON assets (quantity_parent_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_assets_quantity_root_id ON assets (quantity_root_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_assets_lineage_status ON assets (lineage_status)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_inventory_items_quantity_parent_id ON inventory_items (quantity_parent_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_inventory_items_quantity_root_id ON inventory_items (quantity_root_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_inventory_items_lineage_status ON inventory_items (lineage_status)');

  const hasMarking = await knex.schema.hasTable('physical_marking');
  if (!hasMarking) {
    await knex.schema.createTable('physical_marking', (t) => {
      t.string('id', 255).primary();
      t.string('holding_type', 16).notNullable();
      t.string('holding_id', 255).notNullable();
      t.string('kind', 32).notNullable();
      t.text('value').notNullable();
      t.string('status', 16).notNullable().defaultTo('ACTIVE');
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    });
    await knex.raw(`
      ALTER TABLE physical_marking
      ADD CONSTRAINT physical_marking_holding_type_check
      CHECK (holding_type IN ${HOLDING_TYPE})
    `);
    await knex.raw(`
      ALTER TABLE physical_marking
      ADD CONSTRAINT physical_marking_kind_check
      CHECK (kind IN ${MARKING_KIND})
    `);
    await knex.raw(`
      ALTER TABLE physical_marking
      ADD CONSTRAINT physical_marking_status_check
      CHECK (status IN ${MARKING_STATUS})
    `);
    await knex.raw(`
      CREATE INDEX idx_physical_marking_holding
      ON physical_marking (holding_type, holding_id)
    `);
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('physical_marking');

  await knex.raw('ALTER TABLE assets DROP CONSTRAINT IF EXISTS fk_assets_quantity_parent_id');
  await knex.raw('ALTER TABLE assets DROP CONSTRAINT IF EXISTS fk_assets_quantity_root_id');
  await knex.raw('ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS fk_inventory_items_quantity_parent_id');
  await knex.raw('ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS fk_inventory_items_quantity_root_id');

  await knex.raw('DROP INDEX IF EXISTS idx_assets_quantity_parent_id');
  await knex.raw('DROP INDEX IF EXISTS idx_assets_quantity_root_id');
  await knex.raw('DROP INDEX IF EXISTS idx_assets_lineage_status');
  await knex.raw('DROP INDEX IF EXISTS idx_inventory_items_quantity_parent_id');
  await knex.raw('DROP INDEX IF EXISTS idx_inventory_items_quantity_root_id');
  await knex.raw('DROP INDEX IF EXISTS idx_inventory_items_lineage_status');

  if (await knex.schema.hasColumn('inventory_items', 'client_label')) {
    await knex.schema.alterTable('inventory_items', (t) => t.dropColumn('client_label'));
  }
  if (await knex.schema.hasColumn('inventory_items', 'noqr')) {
    await knex.schema.alterTable('inventory_items', (t) => t.dropColumn('noqr'));
  }
  if (await knex.schema.hasColumn('inventory_items', 'qrcode')) {
    await knex.schema.alterTable('inventory_items', (t) => t.dropColumn('qrcode'));
  }

  if (await knex.schema.hasColumn('assets', 'quantity_original')) {
    await knex.schema.alterTable('assets', (t) => t.dropColumn('quantity_original'));
  }
  if (await knex.schema.hasColumn('inventory_items', 'quantity_original')) {
    await knex.schema.alterTable('inventory_items', (t) => t.dropColumn('quantity_original'));
  }

  await knex.raw('ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_lineage_status_check');
  await knex.raw('ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS inventory_items_lineage_status_check');
  if (await knex.schema.hasColumn('assets', 'lineage_status')) {
    await knex.schema.alterTable('assets', (t) => t.dropColumn('lineage_status'));
  }
  if (await knex.schema.hasColumn('inventory_items', 'lineage_status')) {
    await knex.schema.alterTable('inventory_items', (t) => t.dropColumn('lineage_status'));
  }

  await knex.raw('ALTER TABLE assets ALTER COLUMN quantity_total TYPE real USING quantity_total::real');
  await knex.raw('ALTER TABLE assets ALTER COLUMN quantity_available TYPE real USING quantity_available::real');
  await knex.raw('ALTER TABLE assets ALTER COLUMN conversion_factor TYPE real USING conversion_factor::real');
  await knex.raw('ALTER TABLE inventory_items ALTER COLUMN quantity_total TYPE double precision USING quantity_total::double precision');
  await knex.raw('ALTER TABLE inventory_items ALTER COLUMN quantity_available TYPE double precision USING quantity_available::double precision');
  await knex.raw('ALTER TABLE inventory_items ALTER COLUMN conversion_factor TYPE double precision USING conversion_factor::double precision');
  await knex.raw('ALTER TABLE quantity_event_lines ALTER COLUMN delta_total TYPE real USING delta_total::real');
  await knex.raw('ALTER TABLE quantity_event_lines ALTER COLUMN delta_available TYPE real USING delta_available::real');
  await knex.raw('ALTER TABLE inventory_quantity_event_lines ALTER COLUMN delta_total TYPE real USING delta_total::real');
  await knex.raw('ALTER TABLE inventory_quantity_event_lines ALTER COLUMN delta_available TYPE real USING delta_available::real');
};
