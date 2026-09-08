/**
 * Phase 6 — canonical Set engine foundation.
 *
 * Additive:
 *   managed_sets.source_set_id
 *   managed_sets.absorbed_into_set_id
 *   managed_sets.product_id
 *   managed_set_components.requirement_id
 *   managed_set_components.reservation_id
 *   managed_set_components.released_at / released_by / created_by
 *   managed_set_components.quantity  integer → numeric(18,6)
 *   set_requirement
 *   set_event
 *   set_idempotency
 *
 * Does NOT:
 *   - invent requirements, Product links, or reservations for existing Managed Sets
 *   - rewrite managed_sets.id / set_code
 *   - alter assets.is_set / assets.parentid
 *   - touch Zoho columns
 *   - apply 20260824120000_create_managed_sets_tables.js
 *
 * Apply with:
 *   npx knex migrate:up 20260828200000_set_engine_foundation.js --env production
 * Never migrate:latest (abandoned 20260824120000 is still unapplied).
 *
 * @param { import("knex").Knex } knex
 */

const QTY_NUMERIC = 'NUMERIC(18,6)';
const SET_STATUSES = "('DRAFT', 'ACTIVE', 'ARCHIVED', 'DISBANDED', 'ABSORBED')";
const EVENT_TYPES = "('SET_CREATED', 'REQUIREMENT_CREATED', 'ALLOCATED', 'DEALLOCATED', 'SUBSTITUTED', 'DISBANDED', 'ARCHIVED', 'DISASSEMBLED', 'ABSORBED', 'RESERVATION_TRANSFERRED', 'COMMERCIALIZED', 'PRODUCT_PUBLISHED')";
const IDEMPOTENCY_OPS = "('ALLOCATE', 'DEALLOCATE', 'SUBSTITUTE', 'DISBAND', 'ARCHIVE')";

async function constraintExists(knex, name) {
  const existing = await knex.raw(`SELECT 1 FROM pg_constraint WHERE conname = ?`, [name]);
  return !!(existing.rows && existing.rows.length);
}

async function triggerExists(knex, name) {
  const existing = await knex.raw(`SELECT 1 FROM pg_trigger WHERE tgname = ?`, [name]);
  return !!(existing.rows && existing.rows.length);
}

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('managed_sets'))) {
    throw new Error('STOP: managed_sets is missing; Set engine requires managed_sets v2');
  }
  if (!(await knex.schema.hasTable('managed_set_components'))) {
    throw new Error('STOP: managed_set_components is missing');
  }
  if (!(await knex.schema.hasTable('product'))) {
    throw new Error('STOP: product table is missing; Phase 1 must be applied first');
  }
  if (!(await knex.schema.hasTable('reservation'))) {
    throw new Error('STOP: reservation table is missing; Phase 3 must be applied first');
  }

  if (!(await knex.schema.hasColumn('managed_sets', 'source_set_id'))) {
    await knex.schema.alterTable('managed_sets', (t) => {
      t.string('source_set_id', 255).nullable();
    });
  }
  if (!(await knex.schema.hasColumn('managed_sets', 'absorbed_into_set_id'))) {
    await knex.schema.alterTable('managed_sets', (t) => {
      t.string('absorbed_into_set_id', 255).nullable();
    });
  }
  if (!(await knex.schema.hasColumn('managed_sets', 'product_id'))) {
    await knex.schema.alterTable('managed_sets', (t) => {
      t.string('product_id', 255).nullable();
    });
  }

  if (!(await constraintExists(knex, 'fk_managed_sets_source_set_id'))) {
    await knex.raw(`
      ALTER TABLE managed_sets
      ADD CONSTRAINT fk_managed_sets_source_set_id
      FOREIGN KEY (source_set_id) REFERENCES managed_sets(id)
      ON DELETE RESTRICT
    `);
  }
  if (!(await constraintExists(knex, 'fk_managed_sets_absorbed_into_set_id'))) {
    await knex.raw(`
      ALTER TABLE managed_sets
      ADD CONSTRAINT fk_managed_sets_absorbed_into_set_id
      FOREIGN KEY (absorbed_into_set_id) REFERENCES managed_sets(id)
      ON DELETE RESTRICT
    `);
  }
  if (!(await constraintExists(knex, 'fk_managed_sets_product_id'))) {
    await knex.raw(`
      ALTER TABLE managed_sets
      ADD CONSTRAINT fk_managed_sets_product_id
      FOREIGN KEY (product_id) REFERENCES product(id)
      ON DELETE RESTRICT
    `);
  }

  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_managed_sets_source_set_id ON managed_sets (source_set_id)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_managed_sets_absorbed_into_set_id ON managed_sets (absorbed_into_set_id)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_managed_sets_product_id ON managed_sets (product_id)`);

  if (await constraintExists(knex, 'managed_sets_status_check')) {
    await knex.raw(`ALTER TABLE managed_sets DROP CONSTRAINT managed_sets_status_check`);
  }
  await knex.raw(`
    ALTER TABLE managed_sets
    ADD CONSTRAINT managed_sets_status_check
    CHECK (status IN ${SET_STATUSES})
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION managed_sets_id_code_immutable()
    RETURNS trigger AS $$
    BEGIN
      IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'managed_sets.id is immutable';
      END IF;
      IF NEW.set_code IS DISTINCT FROM OLD.set_code THEN
        RAISE EXCEPTION 'managed_sets.set_code is immutable after create';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  if (!(await triggerExists(knex, 'trg_managed_sets_id_code_immutable'))) {
    await knex.raw(`
      CREATE TRIGGER trg_managed_sets_id_code_immutable
      BEFORE UPDATE ON managed_sets
      FOR EACH ROW
      EXECUTE FUNCTION managed_sets_id_code_immutable()
    `);
  }

  if (!(await knex.schema.hasTable('set_requirement'))) {
    await knex.schema.createTable('set_requirement', (table) => {
      table.string('id', 255).primary();
      table.string('set_id', 255).notNullable();
      table.string('product_id', 255).notNullable();
      table.specificType('quantity', QTY_NUMERIC).notNullable();
      table.string('unit', 64).notNullable();
      table.integer('sort_order').notNullable().defaultTo(0);
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.string('created_by', 255).nullable();

      table
        .foreign('set_id', 'fk_set_requirement_set_id')
        .references('id')
        .inTable('managed_sets')
        .onDelete('RESTRICT');
      table
        .foreign('product_id', 'fk_set_requirement_product_id')
        .references('id')
        .inTable('product')
        .onDelete('RESTRICT');
    });

    await knex.raw(`
      ALTER TABLE set_requirement
      ADD CONSTRAINT set_requirement_id_format_check
      CHECK (id ~ '^REQ-[0-9]{4}-[A-Z0-9]{6}-[A-Z0-9]$')
    `);
    await knex.raw(`
      ALTER TABLE set_requirement
      ADD CONSTRAINT set_requirement_quantity_positive_check
      CHECK (quantity > 0)
    `);
    await knex.raw(`
      ALTER TABLE set_requirement
      ADD CONSTRAINT set_requirement_set_product_unique UNIQUE (set_id, product_id)
    `);
    await knex.raw(`CREATE INDEX idx_set_requirement_set_id ON set_requirement (set_id, sort_order)`);
  }

  await knex.raw(`
    CREATE OR REPLACE FUNCTION set_requirement_immutability()
    RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'set_requirement rows cannot be deleted';
      END IF;
      IF NEW.id IS DISTINCT FROM OLD.id
         OR NEW.set_id IS DISTINCT FROM OLD.set_id
         OR NEW.product_id IS DISTINCT FROM OLD.product_id
         OR NEW.quantity IS DISTINCT FROM OLD.quantity
         OR NEW.unit IS DISTINCT FROM OLD.unit THEN
        RAISE EXCEPTION 'set_requirement set_id, product_id, quantity, and unit are immutable';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  if (!(await triggerExists(knex, 'trg_set_requirement_immutability'))) {
    await knex.raw(`
      CREATE TRIGGER trg_set_requirement_immutability
      BEFORE UPDATE OR DELETE ON set_requirement
      FOR EACH ROW
      EXECUTE FUNCTION set_requirement_immutability()
    `);
  }

  const qtyType = await knex.raw(`
    SELECT data_type
    FROM information_schema.columns
    WHERE table_name = 'managed_set_components' AND column_name = 'quantity'
  `);
  const currentQtyType = qtyType.rows && qtyType.rows[0] && qtyType.rows[0].data_type;
  if (currentQtyType && currentQtyType !== 'numeric') {
    await knex.raw(`
      ALTER TABLE managed_set_components
      ALTER COLUMN quantity TYPE NUMERIC(18,6) USING quantity::numeric
    `);
  }

  const componentCols = [
    ['requirement_id', (t) => t.string('requirement_id', 255).nullable()],
    ['reservation_id', (t) => t.string('reservation_id', 255).nullable()],
    ['released_at', (t) => t.timestamp('released_at', { useTz: true }).nullable()],
    ['released_by', (t) => t.string('released_by', 255).nullable()],
    ['created_by', (t) => t.string('created_by', 255).nullable()]
  ];
  for (const [name, add] of componentCols) {
    if (!(await knex.schema.hasColumn('managed_set_components', name))) {
      await knex.schema.alterTable('managed_set_components', (t) => add(t));
    }
  }

  if (!(await constraintExists(knex, 'fk_managed_set_components_requirement_id'))) {
    await knex.raw(`
      ALTER TABLE managed_set_components
      ADD CONSTRAINT fk_managed_set_components_requirement_id
      FOREIGN KEY (requirement_id) REFERENCES set_requirement(id)
      ON DELETE RESTRICT
    `);
  }
  if (!(await constraintExists(knex, 'fk_managed_set_components_reservation_id'))) {
    await knex.raw(`
      ALTER TABLE managed_set_components
      ADD CONSTRAINT fk_managed_set_components_reservation_id
      FOREIGN KEY (reservation_id) REFERENCES reservation(id)
      ON DELETE RESTRICT
    `);
  }
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_managed_set_components_requirement_id ON managed_set_components (requirement_id)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_managed_set_components_reservation_id ON managed_set_components (reservation_id)`);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION managed_set_components_forbid_delete()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'managed_set_components rows cannot be deleted; deactivate instead';
    END;
    $$ LANGUAGE plpgsql
  `);
  if (!(await triggerExists(knex, 'trg_managed_set_components_forbid_delete'))) {
    await knex.raw(`
      CREATE TRIGGER trg_managed_set_components_forbid_delete
      BEFORE DELETE ON managed_set_components
      FOR EACH ROW
      EXECUTE FUNCTION managed_set_components_forbid_delete()
    `);
  }

  if (!(await knex.schema.hasTable('set_event'))) {
    await knex.schema.createTable('set_event', (table) => {
      table.bigIncrements('id').primary();
      table.string('set_id', 255).notNullable();
      table.string('type', 32).notNullable();
      table.string('requirement_id', 255).nullable();
      table.string('product_id', 255).nullable();
      table.string('allocation_id', 255).nullable();
      table.string('resource_type', 16).nullable();
      table.string('resource_id', 255).nullable();
      table.specificType('quantity', QTY_NUMERIC).nullable();
      table.string('reservation_id', 255).nullable();
      table.string('actor', 255).nullable();
      table.timestamp('timestamp', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.text('note').nullable();
      table.text('metadata_json').nullable();

      table
        .foreign('set_id', 'fk_set_event_set_id')
        .references('id')
        .inTable('managed_sets')
        .onDelete('RESTRICT');
    });
    await knex.raw(`
      ALTER TABLE set_event
      ADD CONSTRAINT set_event_type_check
      CHECK (type IN ${EVENT_TYPES})
    `);
    await knex.raw(`CREATE INDEX set_event_set_id_timestamp_idx ON set_event (set_id, timestamp)`);
  }

  await knex.raw(`
    CREATE OR REPLACE FUNCTION set_event_append_only()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'set_event is append-only';
    END;
    $$ LANGUAGE plpgsql
  `);
  if (!(await triggerExists(knex, 'trg_set_event_append_only'))) {
    await knex.raw(`
      CREATE TRIGGER trg_set_event_append_only
      BEFORE UPDATE OR DELETE ON set_event
      FOR EACH ROW
      EXECUTE FUNCTION set_event_append_only()
    `);
  }

  if (!(await knex.schema.hasTable('set_idempotency'))) {
    await knex.schema.createTable('set_idempotency', (table) => {
      table.string('idempotency_key', 64).primary();
      table.string('operation', 32).notNullable();
      table.string('set_id', 255).notNullable();
      table.text('result_json').notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
    await knex.raw(`
      ALTER TABLE set_idempotency
      ADD CONSTRAINT set_idempotency_operation_check
      CHECK (operation IN ${IDEMPOTENCY_OPS})
    `);
    await knex.raw(`
      ALTER TABLE set_idempotency
      ADD CONSTRAINT fk_set_idempotency_set_id
      FOREIGN KEY (set_id) REFERENCES managed_sets(id)
      ON DELETE RESTRICT
    `);
  }
};

exports.down = async function (knex) {
  const reqCount = await knex.raw(`SELECT count(*)::int AS n FROM set_requirement`).catch(() => ({ rows: [{ n: 0 }] }));
  const eventCount = await knex.raw(`SELECT count(*)::int AS n FROM set_event`).catch(() => ({ rows: [{ n: 0 }] }));
  const linked = await knex.raw(`
    SELECT count(*)::int AS n FROM managed_set_components
    WHERE requirement_id IS NOT NULL OR reservation_id IS NOT NULL
  `).catch(() => ({ rows: [{ n: 0 }] }));
  const nReq = reqCount.rows && reqCount.rows[0] ? reqCount.rows[0].n : 0;
  const nEvt = eventCount.rows && eventCount.rows[0] ? eventCount.rows[0].n : 0;
  const nLinked = linked.rows && linked.rows[0] ? linked.rows[0].n : 0;
  if (nReq || nEvt || nLinked) {
    throw new Error(
      `STOP: set engine down() refused while canonical rows exist (requirements=${nReq}, events=${nEvt}, linked allocations=${nLinked})`
    );
  }

  await knex.raw(`DROP TRIGGER IF EXISTS trg_set_event_append_only ON set_event`);
  await knex.raw(`DROP TRIGGER IF EXISTS trg_set_requirement_immutability ON set_requirement`);
  await knex.raw(`DROP TRIGGER IF EXISTS trg_managed_set_components_forbid_delete ON managed_set_components`);
  await knex.raw(`DROP TRIGGER IF EXISTS trg_managed_sets_id_code_immutable ON managed_sets`);
  await knex.raw(`DROP FUNCTION IF EXISTS set_event_append_only()`);
  await knex.raw(`DROP FUNCTION IF EXISTS set_requirement_immutability()`);
  await knex.raw(`DROP FUNCTION IF EXISTS managed_set_components_forbid_delete()`);
  await knex.raw(`DROP FUNCTION IF EXISTS managed_sets_id_code_immutable()`);

  await knex.schema.dropTableIfExists('set_idempotency');
  await knex.schema.dropTableIfExists('set_event');

  if (await knex.schema.hasColumn('managed_set_components', 'requirement_id')) {
    await knex.raw(`ALTER TABLE managed_set_components DROP CONSTRAINT IF EXISTS fk_managed_set_components_requirement_id`);
    await knex.raw(`ALTER TABLE managed_set_components DROP CONSTRAINT IF EXISTS fk_managed_set_components_reservation_id`);
    await knex.schema.alterTable('managed_set_components', (t) => {
      t.dropColumn('requirement_id');
      t.dropColumn('reservation_id');
      t.dropColumn('released_at');
      t.dropColumn('released_by');
      t.dropColumn('created_by');
    });
  }

  await knex.schema.dropTableIfExists('set_requirement');

  if (await knex.schema.hasColumn('managed_sets', 'source_set_id')) {
    await knex.raw(`ALTER TABLE managed_sets DROP CONSTRAINT IF EXISTS fk_managed_sets_source_set_id`);
    await knex.raw(`ALTER TABLE managed_sets DROP CONSTRAINT IF EXISTS fk_managed_sets_absorbed_into_set_id`);
    await knex.raw(`ALTER TABLE managed_sets DROP CONSTRAINT IF EXISTS fk_managed_sets_product_id`);
    await knex.schema.alterTable('managed_sets', (t) => {
      t.dropColumn('source_set_id');
      t.dropColumn('absorbed_into_set_id');
      t.dropColumn('product_id');
    });
  }
};
