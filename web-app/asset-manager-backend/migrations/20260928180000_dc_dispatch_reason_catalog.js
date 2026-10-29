/**
 * Configurable DC dispatch reasons (PHYSICAL_TALLY_AUTHORITY_ADR §9).
 *
 * - dc_dispatch_reason catalog: code, label, behaviour, asset_status, disposition_status,
 *   is_active, is_system, sort_order. Seeded with the nine built-in reasons + LEGACY_UNSPECIFIED.
 * - behaviour decides the stock / tally effect and is fixed once a reason has been used:
 *     RETURNABLE | RETURNABLE_DESTINATION | SALE_EXIT | OTHER_EXIT | VENDOR_EXIT | LEGACY
 * - delivery_challans.dispatch_reason and dc_disposition_line.dispatch_reason become FKs to the
 *   catalog (replacing the fixed CHECK lists); disposition_status becomes a format check.
 * - permission dc.reason.manage (superuser + admin).
 */

const BEHAVIOURS = ['RETURNABLE', 'RETURNABLE_DESTINATION', 'SALE_EXIT', 'OTHER_EXIT', 'VENDOR_EXIT', 'LEGACY'];

const SEED = [
  ['DEMO', 'Demo', 'RETURNABLE', 'Out on Demo', 'OUT_ON_DEMO', 10],
  ['RENTAL', 'Rental', 'RETURNABLE', 'Out on Rental', 'OUT_ON_RENTAL', 20],
  ['REPAIR', 'Repair', 'RETURNABLE', 'Out for Repair', 'OUT_FOR_REPAIR', 30],
  ['INTERNAL_USE', 'Internal Use / Project / Shoot', 'RETURNABLE', 'Out for Internal Use', 'OUT_FOR_INTERNAL_USE', 40],
  ['STOCK_TRANSFER', 'Stock Transfer', 'RETURNABLE_DESTINATION', 'In Transit', 'IN_TRANSIT', 50],
  ['SALE', 'Sale', 'SALE_EXIT', 'Sold', 'SOLD', 110],
  ['REPLACEMENT', 'Replacement / Warranty swap', 'OTHER_EXIT', 'Replaced', 'REPLACED', 120],
  ['FOC', 'Free of Cost / Sample', 'OTHER_EXIT', 'Issued FOC', 'ISSUED_FOC', 130],
  ['VENDOR_RETURN', 'Return to Vendor', 'VENDOR_EXIT', 'Returned to Vendor', 'RETURNED_TO_VENDOR', 140],
  ['LEGACY_UNSPECIFIED', 'Not specified (legacy)', 'LEGACY', null, 'LEGACY', 999]
];

const PERM = { key: 'dc.reason.manage', description: 'Add / edit / deactivate DC dispatch reasons', category: 'action' };
const GRANT_ROLES = ['superuser', 'admin'];

const PREV = {
  dcReasons: ['DEMO', 'RENTAL', 'REPAIR', 'SALE', 'LEGACY_UNSPECIFIED', 'INTERNAL_USE', 'STOCK_TRANSFER', 'REPLACEMENT', 'FOC', 'VENDOR_RETURN'],
  lineReasons: ['DEMO', 'RENTAL', 'REPAIR', 'SALE', 'INTERNAL_USE', 'STOCK_TRANSFER', 'REPLACEMENT', 'FOC', 'VENDOR_RETURN'],
  lineStatuses: ['OUT_ON_DEMO', 'OUT_ON_RENTAL', 'OUT_FOR_REPAIR', 'SOLD', 'RETURNED',
    'OUT_FOR_INTERNAL_USE', 'IN_TRANSIT', 'REPLACED', 'ISSUED_FOC', 'RETURNED_TO_VENDOR']
};
const list = (values) => `(${values.map((v) => `'${v}'`).join(',')})`;

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('dc_dispatch_reason'))) {
    await knex.schema.createTable('dc_dispatch_reason', (table) => {
      table.string('code', 32).primary();
      table.string('label', 80).notNullable();
      table.string('behaviour', 32).notNullable();
      table.string('asset_status', 64).nullable();
      table.string('disposition_status', 32).notNullable();
      table.boolean('is_active').notNullable().defaultTo(true);
      table.boolean('is_system').notNullable().defaultTo(false);
      table.integer('sort_order').notNullable().defaultTo(500);
      table.string('created_by', 255).nullable();
      table.string('updated_by', 255).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
    await knex.raw(`ALTER TABLE dc_dispatch_reason ADD CONSTRAINT dc_dispatch_reason_code_format_check CHECK (code ~ '^[A-Z][A-Z0-9_]{1,31}$')`);
    await knex.raw(`ALTER TABLE dc_dispatch_reason ADD CONSTRAINT dc_dispatch_reason_behaviour_check CHECK (behaviour IN ${list(BEHAVIOURS)})`);
    await knex.raw(`ALTER TABLE dc_dispatch_reason ADD CONSTRAINT dc_dispatch_reason_disposition_format_check CHECK (disposition_status ~ '^[A-Z][A-Z0-9_]{1,31}$' AND disposition_status <> 'RETURNED')`);
    await knex.raw(`ALTER TABLE dc_dispatch_reason ADD CONSTRAINT dc_dispatch_reason_asset_status_check CHECK (behaviour = 'LEGACY' OR (asset_status IS NOT NULL AND length(trim(asset_status)) > 0))`);
    await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS dc_dispatch_reason_label_uq ON dc_dispatch_reason (LOWER(label))`);
    await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS dc_dispatch_reason_disposition_uq ON dc_dispatch_reason (disposition_status)`);
  }

  for (const [code, label, behaviour, assetStatus, dispositionStatus, sort] of SEED) {
    const exists = await knex('dc_dispatch_reason').where({ code }).first();
    if (exists) continue;
    await knex('dc_dispatch_reason').insert({
      code,
      label,
      behaviour,
      asset_status: assetStatus,
      disposition_status: dispositionStatus,
      is_active: behaviour !== 'LEGACY',
      is_system: true,
      sort_order: sort,
      created_by: 'migration'
    });
  }

  if (await knex.schema.hasTable('delivery_challans')) {
    await knex.raw('ALTER TABLE delivery_challans DROP CONSTRAINT IF EXISTS delivery_challans_dispatch_reason_check');
    await knex.raw(`
      DO $$ BEGIN
        ALTER TABLE delivery_challans ADD CONSTRAINT delivery_challans_dispatch_reason_fk
          FOREIGN KEY (dispatch_reason) REFERENCES dc_dispatch_reason (code) ON UPDATE RESTRICT ON DELETE RESTRICT;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
  }
  if (await knex.schema.hasTable('dc_disposition_line')) {
    await knex.raw('ALTER TABLE dc_disposition_line DROP CONSTRAINT IF EXISTS dc_disposition_line_reason_check');
    await knex.raw('ALTER TABLE dc_disposition_line DROP CONSTRAINT IF EXISTS dc_disposition_line_status_check');
    await knex.raw(`
      DO $$ BEGIN
        ALTER TABLE dc_disposition_line ADD CONSTRAINT dc_disposition_line_reason_fk
          FOREIGN KEY (dispatch_reason) REFERENCES dc_dispatch_reason (code) ON UPDATE RESTRICT ON DELETE RESTRICT;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await knex.raw(`ALTER TABLE dc_disposition_line ADD CONSTRAINT dc_disposition_line_status_check CHECK (disposition_status ~ '^[A-Z][A-Z0-9_]{1,31}$')`);
  }

  if (await knex.schema.hasTable('permissions')) {
    if (!(await knex('permissions').where({ key: PERM.key }).first())) await knex('permissions').insert(PERM);
    if (await knex.schema.hasTable('role_permissions') && await knex.schema.hasTable('roles')) {
      for (const role of GRANT_ROLES) {
        if (!(await knex('roles').where({ name: role }).first())) continue;
        const has = await knex('role_permissions').where({ role_name: role, permission_key: PERM.key }).first();
        if (!has) await knex('role_permissions').insert({ role_name: role, permission_key: PERM.key });
      }
    }
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasTable('dc_dispatch_reason')) {
    const custom = await knex('dc_dispatch_reason').where({ is_system: false }).pluck('code');
    if (custom.length) {
      const usedDc = await knex('delivery_challans').whereIn('dispatch_reason', custom).count('* as c').first();
      const usedLine = await knex('dc_disposition_line').whereIn('dispatch_reason', custom).count('* as c').first();
      if (Number(usedDc?.c || 0) + Number(usedLine?.c || 0) > 0) {
        throw new Error(`Cannot roll back: custom DC reasons are in use (${custom.join(', ')})`);
      }
    }
  }

  if (await knex.schema.hasTable('role_permissions')) await knex('role_permissions').where({ permission_key: PERM.key }).del();
  if (await knex.schema.hasTable('permissions')) await knex('permissions').where({ key: PERM.key }).del();

  if (await knex.schema.hasTable('dc_disposition_line')) {
    await knex.raw('ALTER TABLE dc_disposition_line DROP CONSTRAINT IF EXISTS dc_disposition_line_reason_fk');
    await knex.raw('ALTER TABLE dc_disposition_line DROP CONSTRAINT IF EXISTS dc_disposition_line_status_check');
    await knex.raw(`ALTER TABLE dc_disposition_line ADD CONSTRAINT dc_disposition_line_reason_check CHECK (dispatch_reason IN ${list(PREV.lineReasons)})`);
    await knex.raw(`ALTER TABLE dc_disposition_line ADD CONSTRAINT dc_disposition_line_status_check CHECK (disposition_status IN ${list(PREV.lineStatuses)})`);
  }
  if (await knex.schema.hasTable('delivery_challans')) {
    await knex.raw('ALTER TABLE delivery_challans DROP CONSTRAINT IF EXISTS delivery_challans_dispatch_reason_fk');
    await knex.raw(`ALTER TABLE delivery_challans ADD CONSTRAINT delivery_challans_dispatch_reason_check CHECK (dispatch_reason IS NULL OR dispatch_reason IN ${list(PREV.dcReasons)})`);
  }
  await knex.schema.dropTableIfExists('dc_dispatch_reason');
};
