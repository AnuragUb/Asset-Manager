/**
 * Commercial provenance foundation — PO expected / not required / linked
 * for Physical Intake holdings.
 *
 * Additive:
 *   commercial_provenance
 *   physical_intake_event types PO_EXPECTED, PO_LINKED
 *
 * Does NOT:
 *   - backfill historical Intakes
 *   - change Asset / Inventory identity
 *   - alter Receipt Note or PO accepted/outstanding
 *   - introduce PO family/version engine
 *   - apply 20260824120000_create_managed_sets_tables.js
 *
 * Until PO versioning exists:
 *   procurement_po_id = version-level PO reference
 *   procurement_po_line_id = PO line reference
 *   po_family_id / po_version_id reserved nullable for later
 *
 * Apply with named migrate only. Never migrate:latest.
 *
 * @param { import("knex").Knex } knex
 */

const QTY = 'NUMERIC(18,6)';
const RESOURCE_TYPES = "('ASSET', 'INVENTORY')";
const STATES = "('NOT_REQUIRED', 'AWAITING_PO', 'PO_LINKED')";
const EVENT_TYPES = "('PHYSICAL_INTAKE_CREATED', 'PHYSICAL_INTAKE_ASSET_CREATED', 'PHYSICAL_INTAKE_INVENTORY_CREATED', 'PO_EXPECTED', 'PO_LINKED')";

async function constraintExists(knex, name) {
  const existing = await knex.raw('SELECT 1 FROM pg_constraint WHERE conname = ?', [name]);
  return !!(existing.rows && existing.rows.length);
}

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('physical_intake'))) {
    throw new Error('STOP: physical_intake is missing; Physical Intake foundation must be applied first');
  }
  if (!(await knex.schema.hasTable('physical_intake_output'))) {
    throw new Error('STOP: physical_intake_output is missing');
  }
  if (!(await knex.schema.hasTable('procurement_po'))) {
    throw new Error('STOP: procurement_po is missing; Phase 9 must be applied first');
  }
  if (!(await knex.schema.hasTable('procurement_po_line'))) {
    throw new Error('STOP: procurement_po_line is missing; Phase 9 must be applied first');
  }

  if (!(await knex.schema.hasTable('commercial_provenance'))) {
    await knex.schema.createTable('commercial_provenance', (table) => {
      table.bigIncrements('id').primary();
      table.string('resource_type', 16).notNullable();
      table.string('resource_id', 255).notNullable();
      table.specificType('quantity', QTY).notNullable();
      table.string('state', 24).notNullable();
      table.string('expected_po_number', 255).nullable();
      table.text('expected_vendor_ref').nullable();
      table.string('expected_zoho_po_id', 255).nullable();
      table.string('procurement_po_id', 255).nullable();
      table.string('procurement_po_line_id', 255).nullable();
      table.string('po_family_id', 255).nullable();
      table.string('po_version_id', 255).nullable();
      table.string('vendor_zoho_id', 255).nullable();
      table.text('vendor_name_snapshot').nullable();
      table.string('physical_intake_id', 255).nullable();
      table.bigInteger('physical_intake_output_id').nullable();
      table.string('created_by', 255).nullable();
      table.string('linked_by', 255).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('linked_at', { useTz: true }).nullable();
      table.timestamp('state_changed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table
        .foreign('physical_intake_id', 'fk_commercial_provenance_intake_id')
        .references('id')
        .inTable('physical_intake')
        .onDelete('RESTRICT');
      table
        .foreign('physical_intake_output_id', 'fk_commercial_provenance_output_id')
        .references('id')
        .inTable('physical_intake_output')
        .onDelete('RESTRICT');
      table
        .foreign('procurement_po_id', 'fk_commercial_provenance_po_id')
        .references('id')
        .inTable('procurement_po')
        .onDelete('RESTRICT');
      table
        .foreign('procurement_po_line_id', 'fk_commercial_provenance_po_line_id')
        .references('id')
        .inTable('procurement_po_line')
        .onDelete('RESTRICT');
    });

    await knex.raw(`
      ALTER TABLE commercial_provenance
      ADD CONSTRAINT commercial_provenance_resource_type_check
      CHECK (resource_type IN ${RESOURCE_TYPES})
    `);
    await knex.raw(`
      ALTER TABLE commercial_provenance
      ADD CONSTRAINT commercial_provenance_state_check
      CHECK (state IN ${STATES})
    `);
    await knex.raw(`
      ALTER TABLE commercial_provenance
      ADD CONSTRAINT commercial_provenance_quantity_positive_check
      CHECK (quantity > 0)
    `);
    await knex.raw(`
      ALTER TABLE commercial_provenance
      ADD CONSTRAINT commercial_provenance_linked_po_check
      CHECK (
        (state = 'PO_LINKED' AND procurement_po_id IS NOT NULL AND procurement_po_line_id IS NOT NULL)
        OR
        (state <> 'PO_LINKED' AND procurement_po_id IS NULL AND procurement_po_line_id IS NULL)
      )
    `);
    await knex.raw(`
      ALTER TABLE commercial_provenance
      ADD CONSTRAINT commercial_provenance_resource_unique UNIQUE (resource_type, resource_id)
    `);
    await knex.raw('CREATE INDEX idx_commercial_provenance_state ON commercial_provenance (state)');
    await knex.raw('CREATE INDEX idx_commercial_provenance_intake_id ON commercial_provenance (physical_intake_id)');
    await knex.raw('CREATE INDEX idx_commercial_provenance_po_id ON commercial_provenance (procurement_po_id)');
    await knex.raw('CREATE INDEX idx_commercial_provenance_po_line_id ON commercial_provenance (procurement_po_line_id)');
  }

  if (await knex.schema.hasTable('physical_intake_event')) {
    if (await constraintExists(knex, 'physical_intake_event_type_check')) {
      await knex.raw('ALTER TABLE physical_intake_event DROP CONSTRAINT physical_intake_event_type_check');
    }
    await knex.raw(`
      ALTER TABLE physical_intake_event
      ADD CONSTRAINT physical_intake_event_type_check
      CHECK (type IN ${EVENT_TYPES})
    `);
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('commercial_provenance');
  if (await knex.schema.hasTable('physical_intake_event')) {
    if (await constraintExists(knex, 'physical_intake_event_type_check')) {
      await knex.raw('ALTER TABLE physical_intake_event DROP CONSTRAINT physical_intake_event_type_check');
    }
    await knex.raw(`
      ALTER TABLE physical_intake_event
      ADD CONSTRAINT physical_intake_event_type_check
      CHECK (type IN ('PHYSICAL_INTAKE_CREATED', 'PHYSICAL_INTAKE_ASSET_CREATED', 'PHYSICAL_INTAKE_INVENTORY_CREATED'))
    `);
  }
};
