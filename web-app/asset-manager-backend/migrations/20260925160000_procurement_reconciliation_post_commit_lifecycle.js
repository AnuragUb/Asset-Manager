/**
 * Post-commit commercial reconciliation + Vendor Purchase Return lifecycle.
 *
 * Audit findings (2026-09-25):
 * - No PO family/version tables yet (Zoho mirror is in-place). Reconciliation
 *   stores commercial_quantity snapshot; po_version_id reserved nullable.
 * - Purchase Book = vendor Tax Invoice commercial book (not stock).
 * - "Outward Purchase Book" does not exist; CREDIT books are commercial only.
 * - Customer Return Inward (RET-/RETURN_INWARD) remains separate.
 *
 * Physical Vendor Return (PRTN-…) is a NEW outbound physical transaction.
 * Stock exits only on DISPATCH — never on create/READY.
 */

const RECON_STATUSES = `('OPEN','RESOLUTION_SELECTED','RETURN_PENDING','RETURNED_TO_VENDOR','RETAINED','CLOSED')`;
const RECON_RESOLUTIONS = `('RETURN_TO_VENDOR','RETAIN_IN_CINEOM','MIXED','NONE')`;
const VR_STATUSES = `('OPEN','READY','DISPATCHED','CANCELLED')`;
const OUTBOX_STATUSES = `('PENDING','SENT','FAILED','RETRY','SKIPPED')`;

const NEW_PERMS = [
  { key: 'procurement_reconciliation.view', description: 'View commercial vs physical reconciliation', category: 'page' },
  { key: 'procurement_reconciliation.resolve', description: 'Resolve commercial reconciliation (return/retain)', category: 'action' },
  { key: 'vendor_return.view', description: 'View Vendor Purchase Returns', category: 'page' },
  { key: 'vendor_return.create', description: 'Create Vendor Purchase Return', category: 'action' },
  { key: 'vendor_return.edit', description: 'Edit Vendor Purchase Return (OPEN)', category: 'action' },
  { key: 'vendor_return.ready', description: 'Mark Vendor Return READY', category: 'action' },
  { key: 'vendor_return.dispatch', description: 'Dispatch Vendor Return (physical exit)', category: 'action' },
  { key: 'vendor_return.cancel', description: 'Cancel Vendor Return before dispatch', category: 'action' }
];

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('procurement_reconciliation'))) {
    await knex.schema.createTable('procurement_reconciliation', (table) => {
      table.string('id', 255).primary();
      table.string('source_type', 32).notNullable().defaultTo('PROCUREMENT_PO_LINE');
      table.string('source_id', 255).notNullable();
      table.string('po_family_id', 255).nullable();
      table.string('po_version_id', 255).nullable();
      table.string('procurement_po_id', 255).notNullable();
      table.string('procurement_po_line_id', 255).notNullable();
      table.string('product_id', 255).nullable();
      table.string('po_number_snapshot', 255).nullable();
      table.string('vendor_name_snapshot', 255).nullable();
      table.specificType('commercial_quantity', 'numeric(18,6)').notNullable();
      table.specificType('physical_received_quantity', 'numeric(18,6)').notNullable();
      table.specificType('physically_returned_quantity', 'numeric(18,6)').notNullable().defaultTo(0);
      table.specificType('retained_quantity', 'numeric(18,6)').notNullable().defaultTo(0);
      table.specificType('difference_quantity', 'numeric(18,6)').notNullable();
      table.string('status', 32).notNullable().defaultTo('OPEN');
      table.string('resolution_type', 32).notNullable().defaultTo('NONE');
      table.text('resolution_reason').nullable();
      table.string('created_by', 255).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.string('resolved_by', 255).nullable();
      table.timestamp('resolved_at', { useTz: true }).nullable();
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table
        .foreign('procurement_po_id', 'fk_proc_recon_po')
        .references('id')
        .inTable('procurement_po')
        .onDelete('RESTRICT');
      table
        .foreign('procurement_po_line_id', 'fk_proc_recon_po_line')
        .references('id')
        .inTable('procurement_po_line')
        .onDelete('RESTRICT');
    });
    await knex.raw(`
      ALTER TABLE procurement_reconciliation
      ADD CONSTRAINT procurement_reconciliation_id_format_check
      CHECK (id ~ '^PREC-[0-9]{4}-[A-Z0-9]{6}-[A-Z0-9]$')
    `);
    await knex.raw(`
      ALTER TABLE procurement_reconciliation
      ADD CONSTRAINT procurement_reconciliation_status_check
      CHECK (status IN ${RECON_STATUSES})
    `);
    await knex.raw(`
      ALTER TABLE procurement_reconciliation
      ADD CONSTRAINT procurement_reconciliation_resolution_check
      CHECK (resolution_type IN ${RECON_RESOLUTIONS})
    `);
    await knex.raw(`
      CREATE UNIQUE INDEX idx_proc_recon_open_line
      ON procurement_reconciliation (procurement_po_line_id)
      WHERE status IN ('OPEN','RESOLUTION_SELECTED','RETURN_PENDING')
    `);
    await knex.raw(`CREATE INDEX idx_proc_recon_po ON procurement_reconciliation (procurement_po_id)`);
    await knex.raw(`CREATE INDEX idx_proc_recon_status ON procurement_reconciliation (status)`);
  }

  if (!(await knex.schema.hasTable('vendor_return'))) {
    await knex.schema.createTable('vendor_return', (table) => {
      table.string('id', 255).primary();
      table.string('status', 16).notNullable().defaultTo('OPEN');
      table.string('procurement_po_id', 255).notNullable();
      table.string('procurement_reconciliation_id', 255).nullable();
      table.string('vendor_name', 255).nullable();
      table.string('vendor_zoho_id', 255).nullable();
      table.string('return_reason', 64).notNullable().defaultTo('COMMERCIAL_REVISION');
      table.text('notes').nullable();
      table.string('created_by', 255).nullable();
      table.timestamp('ready_at', { useTz: true }).nullable();
      table.string('ready_by', 255).nullable();
      table.timestamp('dispatched_at', { useTz: true }).nullable();
      table.string('dispatched_by', 255).nullable();
      table.timestamp('cancelled_at', { useTz: true }).nullable();
      table.string('cancelled_by', 255).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table
        .foreign('procurement_po_id', 'fk_vendor_return_po')
        .references('id')
        .inTable('procurement_po')
        .onDelete('RESTRICT');
    });
    await knex.raw(`
      ALTER TABLE vendor_return
      ADD CONSTRAINT vendor_return_id_format_check
      CHECK (id ~ '^PRTN-[0-9]{4}-[A-Z0-9]{6}-[A-Z0-9]$')
    `);
    await knex.raw(`
      ALTER TABLE vendor_return
      ADD CONSTRAINT vendor_return_status_check
      CHECK (status IN ${VR_STATUSES})
    `);
    await knex.raw(`CREATE INDEX idx_vendor_return_po ON vendor_return (procurement_po_id)`);
    await knex.raw(`CREATE INDEX idx_vendor_return_recon ON vendor_return (procurement_reconciliation_id)`);
  }

  if (await knex.schema.hasTable('procurement_reconciliation') && await knex.schema.hasTable('vendor_return')) {
    await knex.raw(`
      DO $$ BEGIN
        ALTER TABLE vendor_return
          ADD CONSTRAINT fk_vendor_return_recon
          FOREIGN KEY (procurement_reconciliation_id)
          REFERENCES procurement_reconciliation(id) ON DELETE RESTRICT;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
  }

  if (!(await knex.schema.hasTable('vendor_return_line'))) {
    await knex.schema.createTable('vendor_return_line', (table) => {
      table.string('id', 255).primary();
      table.string('vendor_return_id', 255).notNullable();
      table.string('procurement_po_line_id', 255).notNullable();
      table.string('procurement_reconciliation_id', 255).nullable();
      table.string('receipt_note_id', 255).nullable();
      table.string('receipt_line_id', 255).nullable();
      table.string('product_id', 255).nullable();
      table.string('resource_type', 16).notNullable();
      table.string('resource_id', 255).notNullable();
      table.specificType('quantity', 'numeric(18,6)').notNullable();
      table.string('serial_snapshot', 255).nullable();
      table.string('prior_asset_status', 64).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table
        .foreign('vendor_return_id', 'fk_vendor_return_line_vr')
        .references('id')
        .inTable('vendor_return')
        .onDelete('CASCADE');
    });
    await knex.raw(`
      ALTER TABLE vendor_return_line
      ADD CONSTRAINT vendor_return_line_qty_pos_check CHECK (quantity > 0)
    `);
    await knex.raw(`
      ALTER TABLE vendor_return_line
      ADD CONSTRAINT vendor_return_line_resource_check
      CHECK (resource_type IN ('ASSET','INVENTORY'))
    `);
    await knex.raw(`CREATE INDEX idx_vendor_return_line_vr ON vendor_return_line (vendor_return_id)`);
  }

  if (!(await knex.schema.hasTable('vendor_return_outbox'))) {
    await knex.schema.createTable('vendor_return_outbox', (table) => {
      table.bigIncrements('id').primary();
      table.string('vendor_return_id', 255).notNullable();
      table.string('event_type', 48).notNullable().defaultTo('VENDOR_RETURN_DISPATCHED');
      table.string('status', 16).notNullable().defaultTo('PENDING');
      table.string('idempotency_key', 128).notNullable();
      table.text('payload_json').notNullable();
      table.integer('attempt_count').notNullable().defaultTo(0);
      table.text('last_error').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.unique(['idempotency_key'], { indexName: 'uq_vendor_return_outbox_idem' });
    });
    await knex.raw(`
      ALTER TABLE vendor_return_outbox
      ADD CONSTRAINT vendor_return_outbox_status_check
      CHECK (status IN ${OUTBOX_STATUSES})
    `);
  }

  if (!(await knex.schema.hasTable('procurement_reconciliation_event'))) {
    await knex.schema.createTable('procurement_reconciliation_event', (table) => {
      table.bigIncrements('id').primary();
      table.string('procurement_reconciliation_id', 255).notNullable();
      table.string('type', 48).notNullable();
      table.string('actor', 255).nullable();
      table.timestamp('timestamp', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.text('note').nullable();
      table.text('metadata_json').nullable();
      table
        .foreign('procurement_reconciliation_id', 'fk_proc_recon_event')
        .references('id')
        .inTable('procurement_reconciliation')
        .onDelete('CASCADE');
    });
  }

  if (await knex.schema.hasTable('permissions')) {
    for (const perm of NEW_PERMS) {
      const exists = await knex('permissions').where({ key: perm.key }).first();
      if (!exists) {
        await knex('permissions').insert({
          key: perm.key,
          description: perm.description,
          category: perm.category
        });
      }
    }
    if (await knex.schema.hasTable('role_permissions')) {
      const roles = ['admin', 'superuser', 'manager'];
      for (const role of roles) {
        for (const perm of NEW_PERMS) {
          const has = await knex('role_permissions')
            .where({ role_name: role, permission_key: perm.key })
            .first();
          if (!has) {
            await knex('role_permissions').insert({
              role_name: role,
              permission_key: perm.key
            });
          }
        }
      }
      // Logistics: view + create vendor return / view recon — not resolve (high-risk retain/return resolve for managers)
      for (const role of ['Logistics Executive', 'logistics']) {
        for (const key of [
          'procurement_reconciliation.view',
          'vendor_return.view',
          'vendor_return.create',
          'vendor_return.edit',
          'vendor_return.ready',
          'vendor_return.dispatch',
          'vendor_return.cancel'
        ]) {
          const has = await knex('role_permissions')
            .where({ role_name: role, permission_key: key })
            .first();
          if (!has) {
            const can = await knex('role_permissions')
              .where({ role_name: role, permission_key: 'receipt_note.create' })
              .first();
            if (can) {
              await knex('role_permissions').insert({ role_name: role, permission_key: key });
            }
          }
        }
      }
    }
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('procurement_reconciliation_event');
  await knex.schema.dropTableIfExists('vendor_return_outbox');
  await knex.schema.dropTableIfExists('vendor_return_line');
  await knex.raw(`ALTER TABLE vendor_return DROP CONSTRAINT IF EXISTS fk_vendor_return_recon`);
  await knex.schema.dropTableIfExists('vendor_return');
  await knex.schema.dropTableIfExists('procurement_reconciliation');
  if (await knex.schema.hasTable('permissions')) {
    for (const p of NEW_PERMS) {
      const perm = await knex('permissions').where({ key: p.key }).first();
      if (perm) {
        await knex('role_permissions').where({ permission_id: perm.id }).del();
        await knex('permissions').where({ id: perm.id }).del();
      }
    }
  }
};
