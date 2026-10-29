/**
 * Extended DC dispatch reasons (PHYSICAL_TALLY_AUTHORITY_ADR §8).
 *
 * New dispatch reasons:
 *   returnable: INTERNAL_USE, STOCK_TRANSFER
 *   exit:       REPLACEMENT, FOC, VENDOR_RETURN
 * New disposition statuses: OUT_FOR_INTERNAL_USE, IN_TRANSIT, REPLACED, ISSUED_FOC, RETURNED_TO_VENDOR
 * New return reasons: INTERNAL_USE_COMPLETED, TRANSFER_RECEIVED
 * delivery_challans.transfer_destination — destination location for STOCK_TRANSFER.
 *
 * Constraint widening only; no existing rows are rewritten. down() refuses to narrow
 * while rows still use the new values.
 */

const OLD = {
  dcReasons: ['DEMO', 'RENTAL', 'REPAIR', 'SALE', 'LEGACY_UNSPECIFIED'],
  lineReasons: ['DEMO', 'RENTAL', 'REPAIR', 'SALE'],
  lineStatuses: ['OUT_ON_DEMO', 'OUT_ON_RENTAL', 'OUT_FOR_REPAIR', 'SOLD', 'RETURNED'],
  returnReasons: [
    'DEMO_COMPLETED', 'RENTAL_COMPLETED', 'REPAIR_COMPLETED', 'CUSTOMER_RETURN',
    'PROJECT_COMPLETED', 'UNUSED_RETURN', 'DAMAGED_RETURN', 'OTHER'
  ]
};
const ADDED = {
  reasons: ['INTERNAL_USE', 'STOCK_TRANSFER', 'REPLACEMENT', 'FOC', 'VENDOR_RETURN'],
  lineStatuses: ['OUT_FOR_INTERNAL_USE', 'IN_TRANSIT', 'REPLACED', 'ISSUED_FOC', 'RETURNED_TO_VENDOR'],
  returnReasons: ['INTERNAL_USE_COMPLETED', 'TRANSFER_RECEIVED']
};

const list = (values) => `(${values.map((v) => `'${v}'`).join(',')})`;

async function replaceCheck(knex, table, name, expr) {
  if (!(await knex.schema.hasTable(table))) return;
  await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${name}`);
  await knex.raw(`ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${expr})`);
}

exports.up = async function up(knex) {
  await replaceCheck(knex, 'delivery_challans', 'delivery_challans_dispatch_reason_check',
    `dispatch_reason IS NULL OR dispatch_reason IN ${list([...OLD.dcReasons, ...ADDED.reasons])}`);
  await replaceCheck(knex, 'dc_disposition_line', 'dc_disposition_line_reason_check',
    `dispatch_reason IN ${list([...OLD.lineReasons, ...ADDED.reasons])}`);
  await replaceCheck(knex, 'dc_disposition_line', 'dc_disposition_line_status_check',
    `disposition_status IN ${list([...OLD.lineStatuses, ...ADDED.lineStatuses])}`);
  await replaceCheck(knex, 'dc_return_log', 'dc_return_log_reason_check',
    `return_reason IN ${list([...OLD.returnReasons, ...ADDED.returnReasons])}`);

  if (await knex.schema.hasTable('delivery_challans')
    && !(await knex.schema.hasColumn('delivery_challans', 'transfer_destination'))) {
    await knex.schema.alterTable('delivery_challans', (table) => {
      table.string('transfer_destination', 255).nullable();
    });
  }
};

exports.down = async function down(knex) {
  const inUse = async (table, col, values) => {
    if (!(await knex.schema.hasTable(table))) return 0;
    const row = await knex(table).whereIn(col, values).count('* as c').first();
    return Number(row?.c || 0);
  };
  const blockers = [
    ['delivery_challans', 'dispatch_reason', ADDED.reasons],
    ['dc_disposition_line', 'dispatch_reason', ADDED.reasons],
    ['dc_disposition_line', 'disposition_status', ADDED.lineStatuses],
    ['dc_return_log', 'return_reason', ADDED.returnReasons]
  ];
  for (const [table, col, values] of blockers) {
    const n = await inUse(table, col, values);
    if (n > 0) {
      throw new Error(`Cannot roll back: ${n} ${table} row(s) use new ${col} values`);
    }
  }

  await replaceCheck(knex, 'delivery_challans', 'delivery_challans_dispatch_reason_check',
    `dispatch_reason IS NULL OR dispatch_reason IN ${list(OLD.dcReasons)}`);
  await replaceCheck(knex, 'dc_disposition_line', 'dc_disposition_line_reason_check',
    `dispatch_reason IN ${list(OLD.lineReasons)}`);
  await replaceCheck(knex, 'dc_disposition_line', 'dc_disposition_line_status_check',
    `disposition_status IN ${list(OLD.lineStatuses)}`);
  await replaceCheck(knex, 'dc_return_log', 'dc_return_log_reason_check',
    `return_reason IN ${list(OLD.returnReasons)}`);

  if (await knex.schema.hasTable('delivery_challans')
    && (await knex.schema.hasColumn('delivery_challans', 'transfer_destination'))) {
    await knex.schema.alterTable('delivery_challans', (table) => {
      table.dropColumn('transfer_destination');
    });
  }
};
