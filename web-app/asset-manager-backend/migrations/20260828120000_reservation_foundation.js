/**
 * Phase 3 — generic reservation foundation.
 *
 * Additive:
 *   assets.quantity_reserved
 *   inventory_items.quantity_reserved
 *   reservation
 *   reservation_event
 *
 * Does NOT:
 *   - invent reservations from Set membership, project_assets, or sentagainstdc
 *   - add CANCELLED as a lifecycle status
 *   - add quantity_converted
 *   - enable legacy RESERVE / UNRESERVE movement types
 *   - alter Sets, Projects, DC, Product, QR, or Zoho
 *
 * Apply with:
 *   npx knex migrate:up 20260828120000_reservation_foundation.js --env production
 * Never migrate:latest on production (abandoned 20260824120000 is still unapplied).
 *
 * @param { import("knex").Knex } knex
 */

const QTY_NUMERIC = 'NUMERIC(18,6)';
const RESOURCE_TYPES = "('ASSET', 'INVENTORY')";
const OWNER_TYPES = "('SET', 'PROJECT', 'DC', 'MANUAL', 'SYSTEM')";
const STATUSES = "('ACTIVE', 'RELEASED', 'TRANSFERRED')";
const EVENT_TYPES = "('RESERVE', 'PARTIAL_RELEASE', 'RELEASE', 'TRANSFER')";

async function constraintExists(knex, name) {
  const existing = await knex.raw(`SELECT 1 FROM pg_constraint WHERE conname = ?`, [name]);
  return !!(existing.rows && existing.rows.length);
}

async function addQuantityReserved(knex, table) {
  const has = await knex.schema.hasColumn(table, 'quantity_reserved');
  if (!has) {
    await knex.schema.alterTable(table, (t) => {
      t.specificType('quantity_reserved', QTY_NUMERIC).nullable();
    });
  }

  await knex.raw(`
    UPDATE ${table}
    SET quantity_reserved = 0
    WHERE quantity_reserved IS NULL
  `);

  await knex.raw(`ALTER TABLE ${table} ALTER COLUMN quantity_reserved SET DEFAULT 0`);
  await knex.raw(`ALTER TABLE ${table} ALTER COLUMN quantity_reserved SET NOT NULL`);

  const reservedCheck = `${table}_quantity_reserved_nonneg_check`;
  if (!(await constraintExists(knex, reservedCheck))) {
    await knex.raw(`
      ALTER TABLE ${table}
      ADD CONSTRAINT ${reservedCheck}
      CHECK (quantity_reserved >= 0)
    `);
  }

  const availableNeg = await knex.raw(
    `SELECT id FROM ${table} WHERE quantity_available IS NOT NULL AND quantity_available < 0 LIMIT 5`
  );
  if (availableNeg.rows && availableNeg.rows.length) {
    throw new Error(
      `STOP: ${table} has negative quantity_available: ${JSON.stringify(availableNeg.rows)}`
    );
  }

  const availableCheck = `${table}_quantity_available_nonneg_check`;
  if (!(await constraintExists(knex, availableCheck))) {
    await knex.raw(`
      ALTER TABLE ${table}
      ADD CONSTRAINT ${availableCheck}
      CHECK (quantity_available IS NULL OR quantity_available >= 0)
    `);
  }
}

exports.up = async function (knex) {
  await addQuantityReserved(knex, 'assets');
  await addQuantityReserved(knex, 'inventory_items');

  const bounds = await knex.raw(`
    SELECT 'assets' AS table_name, id,
           quantity_total, quantity_available, quantity_reserved
    FROM assets
    WHERE COALESCE(quantity_available, 0) + COALESCE(quantity_reserved, 0)
          - COALESCE(quantity_total, 0) > 0.000001
    UNION ALL
    SELECT 'inventory_items', id,
           quantity_total, quantity_available, quantity_reserved
    FROM inventory_items
    WHERE COALESCE(quantity_available, 0) + COALESCE(quantity_reserved, 0)
          - COALESCE(quantity_total, 0) > 0.000001
  `);
  if (bounds.rows && bounds.rows.length) {
    throw new Error(
      `STOP: available + reserved exceeds total after reserved=0 backfill: ${JSON.stringify(bounds.rows)}`
    );
  }

  if (!(await knex.schema.hasTable('reservation'))) {
    await knex.schema.createTable('reservation', (table) => {
      table.string('id', 255).primary();
      table.string('resource_type', 16).notNullable();
      table.string('resource_id', 255).notNullable();
      table.specificType('quantity', QTY_NUMERIC).notNullable();
      table.specificType('quantity_original', QTY_NUMERIC).notNullable();
      table.string('owner_type', 16).notNullable();
      table.string('owner_id', 255).notNullable();
      table.string('status', 16).notNullable().defaultTo('ACTIVE');
      table.text('reason').nullable();
      table.string('reason_code', 32).nullable();
      table.string('reference', 255).nullable();
      table.string('idempotency_key', 64).nullable();
      table.string('parent_reservation_id', 255).nullable();
      table.string('transferred_to_id', 255).nullable();
      table.string('created_by', 255).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.string('released_by', 255).nullable();
      table.timestamp('released_at', { useTz: true }).nullable();
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });

    await knex.raw(`
      ALTER TABLE reservation
      ADD CONSTRAINT reservation_id_format_check
      CHECK (id ~ '^RSV-[0-9]{4}-[A-Z0-9]{6}-[A-Z0-9]$')
    `);
    await knex.raw(`
      ALTER TABLE reservation
      ADD CONSTRAINT reservation_resource_type_check
      CHECK (resource_type IN ${RESOURCE_TYPES})
    `);
    await knex.raw(`
      ALTER TABLE reservation
      ADD CONSTRAINT reservation_owner_type_check
      CHECK (owner_type IN ${OWNER_TYPES})
    `);
    await knex.raw(`
      ALTER TABLE reservation
      ADD CONSTRAINT reservation_status_check
      CHECK (status IN ${STATUSES})
    `);
    await knex.raw(`
      ALTER TABLE reservation
      ADD CONSTRAINT reservation_quantity_original_positive_check
      CHECK (quantity_original > 0)
    `);
    await knex.raw(`
      ALTER TABLE reservation
      ADD CONSTRAINT reservation_quantity_nonneg_check
      CHECK (quantity >= 0)
    `);
    await knex.raw(`
      ALTER TABLE reservation
      ADD CONSTRAINT reservation_quantity_lte_original_check
      CHECK (quantity <= quantity_original)
    `);
    await knex.raw(`
      ALTER TABLE reservation
      ADD CONSTRAINT reservation_active_quantity_positive_check
      CHECK (status <> 'ACTIVE' OR quantity > 0)
    `);
    await knex.raw(`
      ALTER TABLE reservation
      ADD CONSTRAINT reservation_transferred_has_successor_check
      CHECK (status <> 'TRANSFERRED' OR transferred_to_id IS NOT NULL)
    `);
    await knex.raw(`
      ALTER TABLE reservation
      ADD CONSTRAINT reservation_parent_fk
      FOREIGN KEY (parent_reservation_id) REFERENCES reservation(id)
      ON DELETE RESTRICT
    `);
    await knex.raw(`
      ALTER TABLE reservation
      ADD CONSTRAINT reservation_transferred_to_fk
      FOREIGN KEY (transferred_to_id) REFERENCES reservation(id)
      ON DELETE RESTRICT
      DEFERRABLE INITIALLY DEFERRED
    `);

    await knex.raw(`
      CREATE UNIQUE INDEX reservation_one_active_asset
      ON reservation (resource_id)
      WHERE resource_type = 'ASSET' AND status = 'ACTIVE'
    `);
    await knex.raw(`
      CREATE UNIQUE INDEX reservation_idempotency_key_unique
      ON reservation (idempotency_key)
      WHERE idempotency_key IS NOT NULL
    `);
    await knex.raw(`
      CREATE INDEX reservation_resource_status_idx
      ON reservation (resource_type, resource_id, status)
    `);
    await knex.raw(`
      CREATE INDEX reservation_owner_status_idx
      ON reservation (owner_type, owner_id, status)
    `);
  }

  if (!(await knex.schema.hasTable('reservation_event'))) {
    await knex.schema.createTable('reservation_event', (table) => {
      table.bigIncrements('id').primary();
      table.string('reservation_id', 255).notNullable();
      table.string('type', 32).notNullable();
      table.specificType('quantity', QTY_NUMERIC).notNullable();
      table.string('actor', 255).nullable();
      table.timestamp('timestamp', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.text('note').nullable();
      table.text('metadata_json').nullable();
    });

    await knex.raw(`
      ALTER TABLE reservation_event
      ADD CONSTRAINT reservation_event_type_check
      CHECK (type IN ${EVENT_TYPES})
    `);
    await knex.raw(`
      ALTER TABLE reservation_event
      ADD CONSTRAINT reservation_event_reservation_fk
      FOREIGN KEY (reservation_id) REFERENCES reservation(id)
      ON DELETE RESTRICT
    `);
    await knex.raw(`
      CREATE INDEX reservation_event_reservation_idx
      ON reservation_event (reservation_id)
    `);
  }
};

exports.down = async function (knex) {
  const leftover = await knex.raw(`
    SELECT id, status, quantity FROM reservation
    WHERE status = 'ACTIVE' OR COALESCE(quantity, 0) <> 0
    LIMIT 5
  `).catch(() => ({ rows: [] }));
  if (leftover.rows && leftover.rows.length) {
    throw new Error(
      `STOP: reservation down() refused while ACTIVE/nonzero rows exist: ${JSON.stringify(leftover.rows)}`
    );
  }

  for (const table of ['assets', 'inventory_items']) {
    if (await knex.schema.hasColumn(table, 'quantity_reserved')) {
      const nonzero = await knex.raw(
        `SELECT id, quantity_reserved FROM ${table} WHERE quantity_reserved <> 0 LIMIT 5`
      );
      if (nonzero.rows && nonzero.rows.length) {
        throw new Error(
          `STOP: cannot drop ${table}.quantity_reserved; nonzero values remain: ${JSON.stringify(nonzero.rows)}`
        );
      }
    }
  }

  await knex.schema.dropTableIfExists('reservation_event');
  await knex.schema.dropTableIfExists('reservation');

  for (const table of ['assets', 'inventory_items']) {
    if (await knex.schema.hasColumn(table, 'quantity_reserved')) {
      const reservedCheck = `${table}_quantity_reserved_nonneg_check`;
      const availableCheck = `${table}_quantity_available_nonneg_check`;
      if (await constraintExists(knex, reservedCheck)) {
        await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT ${reservedCheck}`);
      }
      if (await constraintExists(knex, availableCheck)) {
        await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT ${availableCheck}`);
      }
      await knex.schema.alterTable(table, (t) => {
        t.dropColumn('quantity_reserved');
      });
    }
  }
};
