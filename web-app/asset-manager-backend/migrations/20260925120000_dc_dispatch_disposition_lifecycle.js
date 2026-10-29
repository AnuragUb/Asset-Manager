/**
 * DC Dispatch Reason + Physical Disposition Lifecycle
 *
 * - lifecycle_status: DRAFT | READY | DISPATCHED | VOID | LEGACY
 * - dispatch_reason: DEMO | RENTAL | REPAIR | SALE | LEGACY_UNSPECIFIED
 * - Physical stock moves only on DISPATCH (not create/ready)
 * - Outbox for future Zoho Books (no API calls)
 * - Extends delivery_challan_event types
 * - Promotes dc.ready / dc.dispatch / dc.cancel into live permissions
 */

const DISPATCH_REASONS = `('DEMO','RENTAL','REPAIR','SALE','LEGACY_UNSPECIFIED')`;
const LIFECYCLE_STATUSES = `('DRAFT','READY','DISPATCHED','VOID','LEGACY')`;
const OUTBOX_STATUSES = `('PENDING','SENT','FAILED','RETRY','SKIPPED')`;
const DC_EVENT_TYPES = `('CREATED','UPDATED','VOIDED','READY','DISPATCHED','RETURNED')`;

const NEW_PERMS = [
  { key: 'dc.ready', description: 'Mark Delivery Challan READY', category: 'action' },
  { key: 'dc.dispatch', description: 'Dispatch Delivery Challan (physical commit)', category: 'action' },
  { key: 'dc.cancel', description: 'Cancel Delivery Challan before dispatch', category: 'action' }
];

const GRANT_ROLES = ['admin', 'superuser', 'manager', 'Logistics Executive', 'logistics'];

exports.up = async function up(knex) {
  const hasDc = await knex.schema.hasTable('delivery_challans');
  if (hasDc) {
    const cols = await knex('information_schema.columns')
      .where({ table_name: 'delivery_challans', table_schema: 'public' })
      .select('column_name');
    const have = new Set(cols.map((c) => c.column_name));

    await knex.schema.alterTable('delivery_challans', (table) => {
      if (!have.has('lifecycle_status')) {
        table.string('lifecycle_status', 32).nullable();
      }
      if (!have.has('dispatch_reason')) {
        table.string('dispatch_reason', 32).nullable();
      }
      if (!have.has('ready_at')) table.timestamp('ready_at', { useTz: true }).nullable();
      if (!have.has('ready_by')) table.string('ready_by', 255).nullable();
      if (!have.has('dispatched_at')) table.timestamp('dispatched_at', { useTz: true }).nullable();
      if (!have.has('dispatched_by')) table.string('dispatched_by', 255).nullable();
      if (!have.has('returned_at')) table.timestamp('returned_at', { useTz: true }).nullable();
      if (!have.has('returned_by')) table.string('returned_by', 255).nullable();
    });

    // Backfill: voided → VOID; existing Pending/Initializing with stamps → LEGACY
    await knex.raw(`
      UPDATE delivery_challans
      SET lifecycle_status = CASE
        WHEN voided_at IS NOT NULL OR UPPER(COALESCE(status,'')) = 'VOID' THEN 'VOID'
        WHEN UPPER(COALESCE(status,'')) IN ('DISPATCHED') THEN 'DISPATCHED'
        WHEN UPPER(COALESCE(status,'')) IN ('READY') THEN 'READY'
        WHEN UPPER(COALESCE(status,'')) IN ('DRAFT') THEN 'DRAFT'
        ELSE 'LEGACY'
      END
      WHERE lifecycle_status IS NULL
    `);

    await knex.raw(`
      UPDATE delivery_challans
      SET dispatch_reason = 'LEGACY_UNSPECIFIED'
      WHERE lifecycle_status = 'LEGACY' AND dispatch_reason IS NULL
    `);

    await knex.raw(`
      DO $$ BEGIN
        ALTER TABLE delivery_challans
          ADD CONSTRAINT delivery_challans_lifecycle_status_check
          CHECK (lifecycle_status IS NULL OR lifecycle_status IN ${LIFECYCLE_STATUSES});
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await knex.raw(`
      DO $$ BEGIN
        ALTER TABLE delivery_challans
          ADD CONSTRAINT delivery_challans_dispatch_reason_check
          CHECK (dispatch_reason IS NULL OR dispatch_reason IN ${DISPATCH_REASONS});
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await knex.raw(`CREATE INDEX IF NOT EXISTS idx_dc_lifecycle_status ON delivery_challans (lifecycle_status)`);
    await knex.raw(`CREATE INDEX IF NOT EXISTS idx_dc_dispatch_reason ON delivery_challans (dispatch_reason)`);
  }

  // Extend DC event types
  if (await knex.schema.hasTable('delivery_challan_event')) {
    await knex.raw(`
      ALTER TABLE delivery_challan_event DROP CONSTRAINT IF EXISTS delivery_challan_event_type_check
    `);
    await knex.raw(`
      ALTER TABLE delivery_challan_event
      ADD CONSTRAINT delivery_challan_event_type_check
      CHECK (type IN ${DC_EVENT_TYPES})
    `);
  }

  // Disposition line audit (return foundation references)
  if (!(await knex.schema.hasTable('dc_disposition_line'))) {
    await knex.schema.createTable('dc_disposition_line', (table) => {
      table.string('id', 255).primary();
      table.string('delivery_challan_id', 255).notNullable();
      table.string('resource_type', 16).notNullable(); // ASSET | INVENTORY
      table.string('resource_id', 255).notNullable();
      table.string('product_id', 255).nullable();
      table.specificType('quantity', 'numeric(18,6)').notNullable().defaultTo(1);
      table.string('dispatch_reason', 32).notNullable();
      table.string('disposition_status', 32).notNullable(); // OUT_ON_DEMO | OUT_ON_RENTAL | OUT_FOR_REPAIR | SOLD | RETURNED
      table.string('prior_asset_status', 64).nullable();
      table.string('reservation_id', 255).nullable();
      table.string('serial_snapshot', 255).nullable();
      table.timestamp('dispatched_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('returned_at', { useTz: true }).nullable();
      table.string('returned_by', 255).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table
        .foreign('delivery_challan_id', 'fk_dc_disp_line_dc')
        .references('id')
        .inTable('delivery_challans')
        .onDelete('RESTRICT');
    });
    await knex.raw(`
      ALTER TABLE dc_disposition_line
      ADD CONSTRAINT dc_disposition_line_resource_type_check
      CHECK (resource_type IN ('ASSET','INVENTORY'))
    `);
    await knex.raw(`
      ALTER TABLE dc_disposition_line
      ADD CONSTRAINT dc_disposition_line_reason_check
      CHECK (dispatch_reason IN ('DEMO','RENTAL','REPAIR','SALE'))
    `);
    await knex.raw(`
      ALTER TABLE dc_disposition_line
      ADD CONSTRAINT dc_disposition_line_status_check
      CHECK (disposition_status IN ('OUT_ON_DEMO','OUT_ON_RENTAL','OUT_FOR_REPAIR','SOLD','RETURNED'))
    `);
    await knex.raw(`CREATE INDEX idx_dc_disp_line_dc ON dc_disposition_line (delivery_challan_id)`);
    await knex.raw(`CREATE INDEX idx_dc_disp_line_resource ON dc_disposition_line (resource_type, resource_id)`);
  }

  // Future Zoho Books boundary — no sender in this phase
  if (!(await knex.schema.hasTable('dc_dispatch_outbox'))) {
    await knex.schema.createTable('dc_dispatch_outbox', (table) => {
      table.bigIncrements('id').primary();
      table.string('delivery_challan_id', 255).notNullable();
      table.string('event_type', 48).notNullable().defaultTo('DC_DISPATCHED');
      table.string('status', 16).notNullable().defaultTo('PENDING');
      table.string('idempotency_key', 128).notNullable();
      table.text('payload_json').notNullable();
      table.integer('attempt_count').notNullable().defaultTo(0);
      table.text('last_error').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('sent_at', { useTz: true }).nullable();

      table
        .foreign('delivery_challan_id', 'fk_dc_dispatch_outbox_dc')
        .references('id')
        .inTable('delivery_challans')
        .onDelete('RESTRICT');
    });
    await knex.raw(`
      ALTER TABLE dc_dispatch_outbox
      ADD CONSTRAINT dc_dispatch_outbox_status_check
      CHECK (status IN ${OUTBOX_STATUSES})
    `);
    await knex.raw(`
      ALTER TABLE dc_dispatch_outbox
      ADD CONSTRAINT dc_dispatch_outbox_idempotency_unique UNIQUE (idempotency_key)
    `);
    await knex.raw(`CREATE INDEX idx_dc_dispatch_outbox_status ON dc_dispatch_outbox (status)`);
  }

  // Promote dc.ready / dc.dispatch / dc.cancel
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
      for (const role of GRANT_ROLES) {
        const roleRow = await knex('roles').where({ name: role }).first().catch(() => null);
        if (!roleRow && !(await knex('role_permissions').where({ role_name: role }).first())) {
          // role may only exist as role_name in role_permissions
        }
        for (const perm of NEW_PERMS) {
          const has = await knex('role_permissions')
            .where({ role_name: role, permission_key: perm.key })
            .first();
          if (!has) {
            // Only grant if role already has dc.create (logistics-capable)
            const canCreate = await knex('role_permissions')
              .where({ role_name: role, permission_key: 'dc.create' })
              .first();
            const isElevated = role === 'admin' || role === 'superuser' || role === 'manager';
            if (canCreate || isElevated) {
              await knex('role_permissions').insert({
                role_name: role,
                permission_key: perm.key
              });
            }
          }
        }
      }
    }
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasTable('dc_dispatch_outbox')) {
    await knex.schema.dropTable('dc_dispatch_outbox');
  }
  if (await knex.schema.hasTable('dc_disposition_line')) {
    await knex.schema.dropTable('dc_disposition_line');
  }
  if (await knex.schema.hasTable('delivery_challan_event')) {
    await knex.raw(`ALTER TABLE delivery_challan_event DROP CONSTRAINT IF EXISTS delivery_challan_event_type_check`);
    await knex.raw(`
      ALTER TABLE delivery_challan_event
      ADD CONSTRAINT delivery_challan_event_type_check
      CHECK (type IN ('CREATED','VOIDED','UPDATED'))
    `);
  }
  if (await knex.schema.hasTable('delivery_challans')) {
    await knex.raw(`ALTER TABLE delivery_challans DROP CONSTRAINT IF EXISTS delivery_challans_lifecycle_status_check`);
    await knex.raw(`ALTER TABLE delivery_challans DROP CONSTRAINT IF EXISTS delivery_challans_dispatch_reason_check`);
    await knex.schema.alterTable('delivery_challans', (table) => {
      table.dropColumn('lifecycle_status');
      table.dropColumn('dispatch_reason');
      table.dropColumn('ready_at');
      table.dropColumn('ready_by');
      table.dropColumn('dispatched_at');
      table.dropColumn('dispatched_by');
      table.dropColumn('returned_at');
      table.dropColumn('returned_by');
    });
  }
};
