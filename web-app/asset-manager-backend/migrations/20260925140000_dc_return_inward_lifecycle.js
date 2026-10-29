/**
 * DC Return Inward + Return Log lifecycle.
 *
 * - receipt_note.inward_kind: PURCHASE_INWARD | RETURN_INWARD
 * - po_id nullable only for RETURN_INWARD
 * - dc_return_log (RET-…) 1:1 with Return Inward RN, N:1 with DC
 * - Physical restore only when RETURN_INWARD RN is POSTED
 * - SALE remains non-returnable
 */

const RETURN_REASONS = `('DEMO_COMPLETED','RENTAL_COMPLETED','REPAIR_COMPLETED','CUSTOMER_RETURN','PROJECT_COMPLETED','UNUSED_RETURN','DAMAGED_RETURN','OTHER')`;
const INWARD_KINDS = `('PURCHASE_INWARD','RETURN_INWARD')`;
const RETURN_LOG_STATUSES = `('OPEN','POSTED','CANCELLED')`;
const OUTBOX_STATUSES = `('PENDING','SENT','FAILED','RETRY','SKIPPED')`;

const NEW_PERMS = [
  { key: 'return_log.view', description: 'View DC Return Logs', category: 'page' },
  { key: 'return_log.create', description: 'Create DC Return Log + Return Inward RN', category: 'action' }
];

exports.up = async function up(knex) {
  // --- receipt_note inward_kind + DC link ---
  if (await knex.schema.hasTable('receipt_note')) {
    const cols = await knex('information_schema.columns')
      .where({ table_schema: 'public', table_name: 'receipt_note' })
      .select('column_name');
    const have = new Set(cols.map((c) => c.column_name));

    await knex.schema.alterTable('receipt_note', (table) => {
      if (!have.has('inward_kind')) {
        table.string('inward_kind', 32).notNullable().defaultTo('PURCHASE_INWARD');
      }
      if (!have.has('delivery_challan_id')) {
        table.string('delivery_challan_id', 255).nullable();
      }
      if (!have.has('return_log_id')) {
        table.string('return_log_id', 255).nullable();
      }
      if (!have.has('return_reason')) {
        table.string('return_reason', 48).nullable();
      }
      if (!have.has('returned_by_party')) {
        table.string('returned_by_party', 255).nullable();
      }
      if (!have.has('received_by_user')) {
        table.string('received_by_user', 255).nullable();
      }
    });

    await knex.raw(`
      UPDATE receipt_note SET inward_kind = 'PURCHASE_INWARD' WHERE inward_kind IS NULL OR btrim(inward_kind) = ''
    `);

    await knex.raw(`
      DO $$ BEGIN
        ALTER TABLE receipt_note
          ADD CONSTRAINT receipt_note_inward_kind_check
          CHECK (inward_kind IN ${INWARD_KINDS});
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    // Allow NULL po_id for RETURN_INWARD only
    await knex.raw(`ALTER TABLE receipt_note ALTER COLUMN po_id DROP NOT NULL`);
    await knex.raw(`
      DO $$ BEGIN
        ALTER TABLE receipt_note
          ADD CONSTRAINT receipt_note_po_required_for_purchase_check
          CHECK (inward_kind = 'RETURN_INWARD' OR po_id IS NOT NULL);
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await knex.raw(`
      DO $$ BEGIN
        ALTER TABLE receipt_note
          ADD CONSTRAINT receipt_note_return_requires_dc_check
          CHECK (inward_kind <> 'RETURN_INWARD' OR delivery_challan_id IS NOT NULL);
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    if (await knex.schema.hasTable('delivery_challans')) {
      await knex.raw(`
        DO $$ BEGIN
          ALTER TABLE receipt_note
            ADD CONSTRAINT fk_receipt_note_delivery_challan
            FOREIGN KEY (delivery_challan_id) REFERENCES delivery_challans(id) ON DELETE RESTRICT;
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      `);
    }
    await knex.raw(`CREATE INDEX IF NOT EXISTS idx_receipt_note_inward_kind ON receipt_note (inward_kind)`);
    await knex.raw(`CREATE INDEX IF NOT EXISTS idx_receipt_note_dc_id ON receipt_note (delivery_challan_id)`);
  }

  // --- receipt_note_line: link to disposition line ---
  if (await knex.schema.hasTable('receipt_note_line')) {
    const cols = await knex('information_schema.columns')
      .where({ table_schema: 'public', table_name: 'receipt_note_line' })
      .select('column_name');
    const have = new Set(cols.map((c) => c.column_name));
    await knex.schema.alterTable('receipt_note_line', (table) => {
      if (!have.has('disposition_line_id')) {
        table.string('disposition_line_id', 255).nullable();
      }
      if (!have.has('resource_type')) {
        table.string('resource_type', 16).nullable();
      }
      if (!have.has('resource_id')) {
        table.string('resource_id', 255).nullable();
      }
      if (!have.has('serial_snapshot')) {
        table.string('serial_snapshot', 255).nullable();
      }
    });
    await knex.raw(`ALTER TABLE receipt_note_line ALTER COLUMN po_line_id DROP NOT NULL`);
    await knex.raw(`
      DO $$ BEGIN
        ALTER TABLE receipt_note_line
          ADD CONSTRAINT receipt_note_line_po_or_disposition_check
          CHECK (po_line_id IS NOT NULL OR disposition_line_id IS NOT NULL);
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
  }

  // --- dc_disposition_line: cumulative returned qty ---
  if (await knex.schema.hasTable('dc_disposition_line')) {
    const cols = await knex('information_schema.columns')
      .where({ table_schema: 'public', table_name: 'dc_disposition_line' })
      .select('column_name');
    const have = new Set(cols.map((c) => c.column_name));
    if (!have.has('quantity_returned')) {
      await knex.schema.alterTable('dc_disposition_line', (table) => {
        table.specificType('quantity_returned', 'numeric(18,6)').notNullable().defaultTo(0);
      });
    }
  }

  // --- Return Log ---
  if (!(await knex.schema.hasTable('dc_return_log'))) {
    await knex.schema.createTable('dc_return_log', (table) => {
      table.string('id', 255).primary();
      table.string('delivery_challan_id', 255).notNullable();
      table.string('receipt_note_id', 255).nullable();
      table.string('status', 16).notNullable().defaultTo('OPEN');
      table.string('return_reason', 48).notNullable();
      table.string('returned_by_party', 255).nullable();
      table.string('received_by_user', 255).nullable();
      table.string('account_name', 255).nullable();
      table.string('project_reference', 255).nullable();
      table.timestamp('return_date', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.text('notes').nullable();
      table.string('created_by', 255).nullable();
      table.timestamp('posted_at', { useTz: true }).nullable();
      table.string('posted_by', 255).nullable();
      table.timestamp('cancelled_at', { useTz: true }).nullable();
      table.string('cancelled_by', 255).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table
        .foreign('delivery_challan_id', 'fk_dc_return_log_dc')
        .references('id')
        .inTable('delivery_challans')
        .onDelete('RESTRICT');
    });
    await knex.raw(`
      ALTER TABLE dc_return_log
      ADD CONSTRAINT dc_return_log_id_format_check
      CHECK (id ~ '^RET-[0-9]{4}-[A-Z0-9]{6}-[A-Z0-9]$')
    `);
    await knex.raw(`
      ALTER TABLE dc_return_log
      ADD CONSTRAINT dc_return_log_status_check
      CHECK (status IN ${RETURN_LOG_STATUSES})
    `);
    await knex.raw(`
      ALTER TABLE dc_return_log
      ADD CONSTRAINT dc_return_log_reason_check
      CHECK (return_reason IN ${RETURN_REASONS})
    `);
    await knex.raw(`CREATE INDEX idx_dc_return_log_dc ON dc_return_log (delivery_challan_id)`);
    await knex.raw(`CREATE UNIQUE INDEX idx_dc_return_log_rn ON dc_return_log (receipt_note_id) WHERE receipt_note_id IS NOT NULL`);
  }

  if (!(await knex.schema.hasTable('dc_return_log_line'))) {
    await knex.schema.createTable('dc_return_log_line', (table) => {
      table.string('id', 255).primary();
      table.string('return_log_id', 255).notNullable();
      table.string('disposition_line_id', 255).notNullable();
      table.string('resource_type', 16).notNullable();
      table.string('resource_id', 255).notNullable();
      table.specificType('quantity', 'numeric(18,6)').notNullable();
      table.string('serial_snapshot', 255).nullable();
      table.string('product_id', 255).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table
        .foreign('return_log_id', 'fk_dc_return_log_line_log')
        .references('id')
        .inTable('dc_return_log')
        .onDelete('CASCADE');
      table
        .foreign('disposition_line_id', 'fk_dc_return_log_line_disp')
        .references('id')
        .inTable('dc_disposition_line')
        .onDelete('RESTRICT');
    });
    await knex.raw(`
      ALTER TABLE dc_return_log_line
      ADD CONSTRAINT dc_return_log_line_qty_pos_check CHECK (quantity > 0)
    `);
    await knex.raw(`CREATE INDEX idx_dc_return_log_line_log ON dc_return_log_line (return_log_id)`);
  }

  // FK receipt_note.return_log_id → dc_return_log (after table exists)
  if (await knex.schema.hasTable('receipt_note') && await knex.schema.hasTable('dc_return_log')) {
    await knex.raw(`
      DO $$ BEGIN
        ALTER TABLE receipt_note
          ADD CONSTRAINT fk_receipt_note_return_log
          FOREIGN KEY (return_log_id) REFERENCES dc_return_log(id) ON DELETE RESTRICT;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await knex.raw(`
      DO $$ BEGIN
        ALTER TABLE dc_return_log
          ADD CONSTRAINT fk_dc_return_log_receipt_note
          FOREIGN KEY (receipt_note_id) REFERENCES receipt_note(id) ON DELETE RESTRICT;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
  }

  if (!(await knex.schema.hasTable('dc_return_inward_outbox'))) {
    await knex.schema.createTable('dc_return_inward_outbox', (table) => {
      table.bigIncrements('id').primary();
      table.string('return_log_id', 255).notNullable();
      table.string('receipt_note_id', 255).notNullable();
      table.string('delivery_challan_id', 255).notNullable();
      table.string('event_type', 48).notNullable().defaultTo('RETURN_INWARD_POSTED');
      table.string('status', 16).notNullable().defaultTo('PENDING');
      table.string('idempotency_key', 128).notNullable();
      table.text('payload_json').notNullable();
      table.integer('attempt_count').notNullable().defaultTo(0);
      table.text('last_error').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('sent_at', { useTz: true }).nullable();
    });
    await knex.raw(`
      ALTER TABLE dc_return_inward_outbox
      ADD CONSTRAINT dc_return_inward_outbox_status_check
      CHECK (status IN ${OUTBOX_STATUSES})
    `);
    await knex.raw(`
      ALTER TABLE dc_return_inward_outbox
      ADD CONSTRAINT dc_return_inward_outbox_idempotency_unique UNIQUE (idempotency_key)
    `);
  }

  // Permissions
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
      const roles = ['admin', 'superuser', 'manager', 'Logistics Executive', 'logistics'];
      for (const role of roles) {
        for (const perm of NEW_PERMS) {
          const has = await knex('role_permissions')
            .where({ role_name: role, permission_key: perm.key })
            .first();
          if (!has) {
            const can = await knex('role_permissions')
              .where({ role_name: role, permission_key: 'receipt_note.create' })
              .first();
            const elevated = role === 'admin' || role === 'superuser' || role === 'manager';
            if (can || elevated) {
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
  await knex.schema.dropTableIfExists('dc_return_inward_outbox');
  await knex.schema.dropTableIfExists('dc_return_log_line');
  await knex.schema.dropTableIfExists('dc_return_log');
  if (await knex.schema.hasTable('receipt_note')) {
    await knex.raw(`ALTER TABLE receipt_note DROP CONSTRAINT IF EXISTS fk_receipt_note_return_log`);
    await knex.raw(`ALTER TABLE receipt_note DROP CONSTRAINT IF EXISTS fk_receipt_note_delivery_challan`);
    await knex.raw(`ALTER TABLE receipt_note DROP CONSTRAINT IF EXISTS receipt_note_po_required_for_purchase_check`);
    await knex.raw(`ALTER TABLE receipt_note DROP CONSTRAINT IF EXISTS receipt_note_return_requires_dc_check`);
    await knex.raw(`ALTER TABLE receipt_note DROP CONSTRAINT IF EXISTS receipt_note_inward_kind_check`);
  }
};
