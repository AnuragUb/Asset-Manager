/**
 * Phase 7 — Receipt Note / GRN foundation.
 *
 * Additive:
 *   receipt_note
 *   receipt_note_line
 *   receipt_physical_output
 *   receipt_event
 *   receipt_projection_outbox
 *   receipt_idempotency
 *   assets.receipt_line_id
 *   inventory_items.receipt_line_id
 *
 * Does NOT:
 *   - convert existing project_orders / project_order_items
 *   - backfill assets.linked_po_item_id into receipt_line_id
 *   - touch temporary_assets
 *   - create Products, reservations, Sets, or conversions
 *   - apply 20260824120000_create_managed_sets_tables.js
 *
 * Apply with:
 *   npx knex migrate:up 20260828220000_receipt_note_foundation.js --env production
 * Never migrate:latest (abandoned 20260824120000 is still unapplied).
 *
 * @param { import("knex").Knex } knex
 */

const QTY_NUMERIC = 'NUMERIC(18,6)';
const NOTE_STATUSES = "('OPEN', 'POSTED', 'CANCELLED', 'REVERSED')";
const PO_SOURCES = "('LOCAL', 'ZOHO')";
const CREATION_MODES = "('INVENTORY', 'ASSET_GROUPED', 'ASSET_INDIVIDUAL')";
const RESOURCE_TYPES = "('ASSET', 'INVENTORY')";
const EVENT_TYPES = "('NOTE_OPENED', 'LINE_RECORDED', 'POSTED', 'CANCELLED', 'REVERSED', 'PROJECTION_ENQUEUED', 'PROJECTION_SENT', 'PROJECTION_FAILED')";
const OUTBOX_STATUSES = "('PENDING', 'SENT', 'FAILED', 'RETRY', 'SKIPPED')";
const IDEMPOTENCY_OPS = "('CREATE', 'POST', 'CANCEL', 'REVERSE')";

async function constraintExists(knex, name) {
  const existing = await knex.raw(`SELECT 1 FROM pg_constraint WHERE conname = ?`, [name]);
  return !!(existing.rows && existing.rows.length);
}

async function triggerExists(knex, name) {
  const existing = await knex.raw(`SELECT 1 FROM pg_trigger WHERE tgname = ?`, [name]);
  return !!(existing.rows && existing.rows.length);
}

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('project_orders'))) {
    throw new Error('STOP: project_orders is missing; Phase 7 consumes the local PO system');
  }
  if (!(await knex.schema.hasTable('project_order_items'))) {
    throw new Error('STOP: project_order_items is missing');
  }
  if (!(await knex.schema.hasTable('product'))) {
    throw new Error('STOP: product table is missing; Phase 1 must be applied first');
  }
  if (!(await knex.schema.hasTable('assets'))) {
    throw new Error('STOP: assets table is missing');
  }
  if (!(await knex.schema.hasTable('inventory_items'))) {
    throw new Error('STOP: inventory_items table is missing');
  }

  if (!(await knex.schema.hasTable('receipt_note'))) {
    await knex.schema.createTable('receipt_note', (table) => {
      table.string('id', 255).primary();
      table.string('status', 16).notNullable().defaultTo('OPEN');
      table.string('po_source', 16).notNullable().defaultTo('LOCAL');
      table.string('po_id', 255).notNullable();
      table.text('po_number').nullable();
      table.text('vendor_name').nullable();
      table.text('vendor_invoice_no').nullable();
      table.text('delivery_note_no').nullable();
      table.timestamp('received_at', { useTz: true }).nullable();
      table.string('received_at_location', 255).nullable();
      table.string('received_by', 255).nullable();
      table.string('created_by', 255).nullable();
      table.string('posted_by', 255).nullable();
      table.timestamp('posted_at', { useTz: true }).nullable();
      table.string('cancelled_by', 255).nullable();
      table.timestamp('cancelled_at', { useTz: true }).nullable();
      table.string('reversed_by', 255).nullable();
      table.timestamp('reversed_at', { useTz: true }).nullable();
      table.string('idempotency_key', 64).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });

    await knex.raw(`
      ALTER TABLE receipt_note
      ADD CONSTRAINT receipt_note_id_format_check
      CHECK (id ~ '^RN-[0-9]{4}-[A-Z0-9]{6}-[A-Z0-9]$')
    `);
    await knex.raw(`
      ALTER TABLE receipt_note
      ADD CONSTRAINT receipt_note_status_check
      CHECK (status IN ${NOTE_STATUSES})
    `);
    await knex.raw(`
      ALTER TABLE receipt_note
      ADD CONSTRAINT receipt_note_po_source_check
      CHECK (po_source IN ${PO_SOURCES})
    `);
    await knex.raw(`
      ALTER TABLE receipt_note
      ADD CONSTRAINT receipt_note_idempotency_key_unique UNIQUE (idempotency_key)
    `);
    await knex.raw(`CREATE INDEX idx_receipt_note_po_id ON receipt_note (po_source, po_id)`);
    await knex.raw(`CREATE INDEX idx_receipt_note_status ON receipt_note (status)`);
  }

  if (!(await knex.schema.hasTable('receipt_note_line'))) {
    await knex.schema.createTable('receipt_note_line', (table) => {
      table.string('id', 255).primary();
      table.string('receipt_note_id', 255).notNullable();
      table.string('po_line_id', 64).notNullable();
      table.string('product_id', 255).nullable();
      table.specificType('ordered_qty_snapshot', QTY_NUMERIC).notNullable().defaultTo(0);
      table.specificType('ordered_qty_current', QTY_NUMERIC).nullable();
      table.string('unit_snapshot', 64).nullable();
      table.text('item_description_snapshot').nullable();
      table.text('po_number_snapshot').nullable();
      table.text('vendor_name_snapshot').nullable();
      table.timestamp('fetched_at', { useTz: true }).nullable();
      table.string('source_hash', 64).nullable();
      table.specificType('qty_received', QTY_NUMERIC).notNullable().defaultTo(0);
      table.specificType('qty_accepted', QTY_NUMERIC).notNullable().defaultTo(0);
      table.specificType('qty_rejected', QTY_NUMERIC).notNullable().defaultTo(0);
      table.specificType('qty_damaged', QTY_NUMERIC).notNullable().defaultTo(0);
      table.string('unit', 64).nullable();
      table.string('creation_mode', 32).nullable();
      table.integer('sort_order').notNullable().defaultTo(0);
      table.text('notes').nullable();
      table.string('folder_id', 255).nullable();
      table.string('kind_id', 255).nullable();
      table.jsonb('physical_markings').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table
        .foreign('receipt_note_id', 'fk_receipt_note_line_note_id')
        .references('id')
        .inTable('receipt_note')
        .onDelete('RESTRICT');
      table
        .foreign('product_id', 'fk_receipt_note_line_product_id')
        .references('id')
        .inTable('product')
        .onDelete('RESTRICT');
    });

    await knex.raw(`
      ALTER TABLE receipt_note_line
      ADD CONSTRAINT receipt_note_line_id_format_check
      CHECK (id ~ '^RNL-[0-9]{4}-[A-Z0-9]{6}-[A-Z0-9]$')
    `);
    await knex.raw(`
      ALTER TABLE receipt_note_line
      ADD CONSTRAINT receipt_note_line_qty_nonneg_check
      CHECK (
        qty_received >= 0 AND qty_accepted >= 0 AND qty_rejected >= 0 AND qty_damaged >= 0
        AND ordered_qty_snapshot >= 0
      )
    `);
    await knex.raw(`
      ALTER TABLE receipt_note_line
      ADD CONSTRAINT receipt_note_line_received_equation_check
      CHECK (qty_received = qty_accepted + qty_rejected + qty_damaged)
    `);
    await knex.raw(`
      ALTER TABLE receipt_note_line
      ADD CONSTRAINT receipt_note_line_creation_mode_check
      CHECK (creation_mode IS NULL OR creation_mode IN ${CREATION_MODES})
    `);
    await knex.raw(`
      ALTER TABLE receipt_note_line
      ADD CONSTRAINT receipt_note_line_note_po_line_unique UNIQUE (receipt_note_id, po_line_id)
    `);
    await knex.raw(`CREATE INDEX idx_receipt_note_line_note_id ON receipt_note_line (receipt_note_id, sort_order)`);
    await knex.raw(`CREATE INDEX idx_receipt_note_line_po_line_id ON receipt_note_line (po_line_id)`);
    await knex.raw(`CREATE INDEX idx_receipt_note_line_product_id ON receipt_note_line (product_id)`);
  }

  if (!(await knex.schema.hasTable('receipt_physical_output'))) {
    await knex.schema.createTable('receipt_physical_output', (table) => {
      table.bigIncrements('id').primary();
      table.string('receipt_line_id', 255).notNullable();
      table.string('receipt_note_id', 255).notNullable();
      table.string('resource_type', 16).notNullable();
      table.string('resource_id', 255).notNullable();
      table.specificType('quantity', QTY_NUMERIC).notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table
        .foreign('receipt_line_id', 'fk_receipt_physical_output_line_id')
        .references('id')
        .inTable('receipt_note_line')
        .onDelete('RESTRICT');
      table
        .foreign('receipt_note_id', 'fk_receipt_physical_output_note_id')
        .references('id')
        .inTable('receipt_note')
        .onDelete('RESTRICT');
    });
    await knex.raw(`
      ALTER TABLE receipt_physical_output
      ADD CONSTRAINT receipt_physical_output_resource_type_check
      CHECK (resource_type IN ${RESOURCE_TYPES})
    `);
    await knex.raw(`
      ALTER TABLE receipt_physical_output
      ADD CONSTRAINT receipt_physical_output_quantity_positive_check
      CHECK (quantity > 0)
    `);
    await knex.raw(`
      ALTER TABLE receipt_physical_output
      ADD CONSTRAINT receipt_physical_output_resource_unique UNIQUE (resource_type, resource_id)
    `);
    await knex.raw(`CREATE INDEX idx_receipt_physical_output_line_id ON receipt_physical_output (receipt_line_id)`);
    await knex.raw(`CREATE INDEX idx_receipt_physical_output_note_id ON receipt_physical_output (receipt_note_id)`);
  }

  if (!(await knex.schema.hasColumn('assets', 'receipt_line_id'))) {
    await knex.schema.alterTable('assets', (t) => {
      t.string('receipt_line_id', 255).nullable();
    });
  }
  if (!(await knex.schema.hasColumn('inventory_items', 'receipt_line_id'))) {
    await knex.schema.alterTable('inventory_items', (t) => {
      t.string('receipt_line_id', 255).nullable();
    });
  }
  if (!(await constraintExists(knex, 'fk_assets_receipt_line_id'))) {
    await knex.raw(`
      ALTER TABLE assets
      ADD CONSTRAINT fk_assets_receipt_line_id
      FOREIGN KEY (receipt_line_id) REFERENCES receipt_note_line(id)
      ON DELETE RESTRICT
    `);
  }
  if (!(await constraintExists(knex, 'fk_inventory_items_receipt_line_id'))) {
    await knex.raw(`
      ALTER TABLE inventory_items
      ADD CONSTRAINT fk_inventory_items_receipt_line_id
      FOREIGN KEY (receipt_line_id) REFERENCES receipt_note_line(id)
      ON DELETE RESTRICT
    `);
  }
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_assets_receipt_line_id ON assets (receipt_line_id)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_inventory_items_receipt_line_id ON inventory_items (receipt_line_id)`);

  if (!(await knex.schema.hasTable('receipt_event'))) {
    await knex.schema.createTable('receipt_event', (table) => {
      table.bigIncrements('id').primary();
      table.string('receipt_note_id', 255).notNullable();
      table.string('receipt_line_id', 255).nullable();
      table.string('type', 32).notNullable();
      table.string('product_id', 255).nullable();
      table.specificType('qty_received', QTY_NUMERIC).nullable();
      table.specificType('qty_accepted', QTY_NUMERIC).nullable();
      table.specificType('qty_rejected', QTY_NUMERIC).nullable();
      table.specificType('qty_damaged', QTY_NUMERIC).nullable();
      table.string('actor', 255).nullable();
      table.timestamp('timestamp', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.text('note').nullable();
      table.string('received_at_location', 255).nullable();
      table.text('metadata_json').nullable();

      table
        .foreign('receipt_note_id', 'fk_receipt_event_note_id')
        .references('id')
        .inTable('receipt_note')
        .onDelete('RESTRICT');
    });
    await knex.raw(`
      ALTER TABLE receipt_event
      ADD CONSTRAINT receipt_event_type_check
      CHECK (type IN ${EVENT_TYPES})
    `);
    await knex.raw(`CREATE INDEX idx_receipt_event_note_id ON receipt_event (receipt_note_id, id)`);
  }

  if (!(await knex.schema.hasTable('receipt_projection_outbox'))) {
    await knex.schema.createTable('receipt_projection_outbox', (table) => {
      table.bigIncrements('id').primary();
      table.string('receipt_note_id', 255).notNullable();
      table.string('po_source', 16).notNullable().defaultTo('LOCAL');
      table.string('po_id', 255).nullable();
      table.string('zoho_po_id', 255).nullable();
      table.string('zoho_receipt_id', 255).nullable();
      table.string('status', 16).notNullable().defaultTo('SKIPPED');
      table.string('idempotency_key', 128).notNullable();
      table.integer('attempt_count').notNullable().defaultTo(0);
      table.timestamp('next_attempt_at', { useTz: true }).nullable();
      table.text('last_error').nullable();
      table.string('last_error_code', 64).nullable();
      table.text('request_fingerprint').nullable();
      table.string('skip_reason', 64).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('sent_at', { useTz: true }).nullable();

      table
        .foreign('receipt_note_id', 'fk_receipt_projection_outbox_note_id')
        .references('id')
        .inTable('receipt_note')
        .onDelete('RESTRICT');
    });
    await knex.raw(`
      ALTER TABLE receipt_projection_outbox
      ADD CONSTRAINT receipt_projection_outbox_status_check
      CHECK (status IN ${OUTBOX_STATUSES})
    `);
    await knex.raw(`
      ALTER TABLE receipt_projection_outbox
      ADD CONSTRAINT receipt_projection_outbox_note_unique UNIQUE (receipt_note_id)
    `);
    await knex.raw(`
      ALTER TABLE receipt_projection_outbox
      ADD CONSTRAINT receipt_projection_outbox_idempotency_unique UNIQUE (idempotency_key)
    `);
    await knex.raw(`CREATE INDEX idx_receipt_projection_outbox_status ON receipt_projection_outbox (status)`);
  }

  if (!(await knex.schema.hasTable('receipt_idempotency'))) {
    await knex.schema.createTable('receipt_idempotency', (table) => {
      table.string('idempotency_key', 64).primary();
      table.string('operation', 16).notNullable();
      table.string('receipt_note_id', 255).notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table
        .foreign('receipt_note_id', 'fk_receipt_idempotency_note_id')
        .references('id')
        .inTable('receipt_note')
        .onDelete('RESTRICT');
    });
    await knex.raw(`
      ALTER TABLE receipt_idempotency
      ADD CONSTRAINT receipt_idempotency_operation_check
      CHECK (operation IN ${IDEMPOTENCY_OPS})
    `);
  }

  await knex.raw(`
    CREATE OR REPLACE FUNCTION receipt_note_id_immutable()
    RETURNS trigger AS $$
    BEGIN
      IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'receipt_note.id is immutable';
      END IF;
      IF NEW.po_id IS DISTINCT FROM OLD.po_id OR NEW.po_source IS DISTINCT FROM OLD.po_source THEN
        RAISE EXCEPTION 'receipt_note PO reference is immutable';
      END IF;
      IF OLD.status IN ('POSTED', 'CANCELLED', 'REVERSED') THEN
        IF NEW.status IS DISTINCT FROM OLD.status
           AND NOT (OLD.status = 'POSTED' AND NEW.status = 'REVERSED') THEN
          RAISE EXCEPTION 'receipt_note status cannot change from %', OLD.status;
        END IF;
        IF OLD.status IN ('CANCELLED', 'REVERSED') AND NEW.status IS DISTINCT FROM OLD.status THEN
          RAISE EXCEPTION 'receipt_note status % is terminal', OLD.status;
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  if (!(await triggerExists(knex, 'trg_receipt_note_id_immutable'))) {
    await knex.raw(`
      CREATE TRIGGER trg_receipt_note_id_immutable
      BEFORE UPDATE ON receipt_note
      FOR EACH ROW
      EXECUTE FUNCTION receipt_note_id_immutable()
    `);
  }

  await knex.raw(`
    CREATE OR REPLACE FUNCTION receipt_note_no_delete()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'receipt_note rows cannot be deleted';
    END;
    $$ LANGUAGE plpgsql
  `);
  if (!(await triggerExists(knex, 'trg_receipt_note_no_delete'))) {
    await knex.raw(`
      CREATE TRIGGER trg_receipt_note_no_delete
      BEFORE DELETE ON receipt_note
      FOR EACH ROW
      EXECUTE FUNCTION receipt_note_no_delete()
    `);
  }

  await knex.raw(`
    CREATE OR REPLACE FUNCTION receipt_note_line_immutability()
    RETURNS trigger AS $$
    DECLARE
      parent_status text;
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'receipt_note_line rows cannot be deleted';
      END IF;
      IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'receipt_note_line.id is immutable';
      END IF;
      SELECT status INTO parent_status FROM receipt_note WHERE id = OLD.receipt_note_id;
      IF parent_status IN ('POSTED', 'CANCELLED', 'REVERSED') THEN
        RAISE EXCEPTION 'receipt_note_line is immutable after parent status %', parent_status;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  if (!(await triggerExists(knex, 'trg_receipt_note_line_immutability'))) {
    await knex.raw(`
      CREATE TRIGGER trg_receipt_note_line_immutability
      BEFORE UPDATE OR DELETE ON receipt_note_line
      FOR EACH ROW
      EXECUTE FUNCTION receipt_note_line_immutability()
    `);
  }

  await knex.raw(`
    CREATE OR REPLACE FUNCTION receipt_event_append_only()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'receipt_event is append-only';
    END;
    $$ LANGUAGE plpgsql
  `);
  if (!(await triggerExists(knex, 'trg_receipt_event_append_only'))) {
    await knex.raw(`
      CREATE TRIGGER trg_receipt_event_append_only
      BEFORE UPDATE OR DELETE ON receipt_event
      FOR EACH ROW
      EXECUTE FUNCTION receipt_event_append_only()
    `);
  }

  await knex.raw(`
    CREATE OR REPLACE FUNCTION receipt_physical_output_append_only()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'receipt_physical_output is append-only';
    END;
    $$ LANGUAGE plpgsql
  `);
  if (!(await triggerExists(knex, 'trg_receipt_physical_output_append_only'))) {
    await knex.raw(`
      CREATE TRIGGER trg_receipt_physical_output_append_only
      BEFORE UPDATE OR DELETE ON receipt_physical_output
      FOR EACH ROW
      EXECUTE FUNCTION receipt_physical_output_append_only()
    `);
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasTable('receipt_note')) {
    const posted = await knex('receipt_note').whereIn('status', ['POSTED', 'REVERSED']).first();
    if (posted) {
      throw new Error('STOP: cannot drop Receipt Note foundation while POSTED/REVERSED receipts exist');
    }
  }

  await knex.raw(`DROP TRIGGER IF EXISTS trg_receipt_physical_output_append_only ON receipt_physical_output`);
  await knex.raw(`DROP TRIGGER IF EXISTS trg_receipt_event_append_only ON receipt_event`);
  await knex.raw(`DROP TRIGGER IF EXISTS trg_receipt_note_line_immutability ON receipt_note_line`);
  await knex.raw(`DROP TRIGGER IF EXISTS trg_receipt_note_no_delete ON receipt_note`);
  await knex.raw(`DROP TRIGGER IF EXISTS trg_receipt_note_id_immutable ON receipt_note`);
  await knex.raw(`DROP FUNCTION IF EXISTS receipt_physical_output_append_only()`);
  await knex.raw(`DROP FUNCTION IF EXISTS receipt_event_append_only()`);
  await knex.raw(`DROP FUNCTION IF EXISTS receipt_note_line_immutability()`);
  await knex.raw(`DROP FUNCTION IF EXISTS receipt_note_no_delete()`);
  await knex.raw(`DROP FUNCTION IF EXISTS receipt_note_id_immutable()`);

  await knex.raw(`ALTER TABLE assets DROP CONSTRAINT IF EXISTS fk_assets_receipt_line_id`);
  await knex.raw(`ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS fk_inventory_items_receipt_line_id`);
  await knex.raw(`DROP INDEX IF EXISTS idx_assets_receipt_line_id`);
  await knex.raw(`DROP INDEX IF EXISTS idx_inventory_items_receipt_line_id`);
  if (await knex.schema.hasColumn('assets', 'receipt_line_id')) {
    await knex.schema.alterTable('assets', (t) => t.dropColumn('receipt_line_id'));
  }
  if (await knex.schema.hasColumn('inventory_items', 'receipt_line_id')) {
    await knex.schema.alterTable('inventory_items', (t) => t.dropColumn('receipt_line_id'));
  }

  await knex.schema.dropTableIfExists('receipt_idempotency');
  await knex.schema.dropTableIfExists('receipt_projection_outbox');
  await knex.schema.dropTableIfExists('receipt_event');
  await knex.schema.dropTableIfExists('receipt_physical_output');
  await knex.schema.dropTableIfExists('receipt_note_line');
  await knex.schema.dropTableIfExists('receipt_note');
};
