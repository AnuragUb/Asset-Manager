/**
 * Allow PO_NOT_REQUIRED on physical_intake_event after Awaiting Adoption close.
 * Named migrate only. Never migrate:latest.
 */

const EVENT_TYPES = "('PHYSICAL_INTAKE_CREATED', 'PHYSICAL_INTAKE_ASSET_CREATED', 'PHYSICAL_INTAKE_INVENTORY_CREATED', 'PO_EXPECTED', 'PO_LINKED', 'PO_NOT_REQUIRED')";
const PREVIOUS = "('PHYSICAL_INTAKE_CREATED', 'PHYSICAL_INTAKE_ASSET_CREATED', 'PHYSICAL_INTAKE_INVENTORY_CREATED', 'PO_EXPECTED', 'PO_LINKED')";

async function constraintExists(knex, name) {
  const existing = await knex.raw('SELECT 1 FROM pg_constraint WHERE conname = ?', [name]);
  return !!(existing.rows && existing.rows.length);
}

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('physical_intake_event'))) return;
  if (await constraintExists(knex, 'physical_intake_event_type_check')) {
    await knex.raw('ALTER TABLE physical_intake_event DROP CONSTRAINT physical_intake_event_type_check');
  }
  await knex.raw(`
    ALTER TABLE physical_intake_event
    ADD CONSTRAINT physical_intake_event_type_check
    CHECK (type IN ${EVENT_TYPES})
  `);
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasTable('physical_intake_event'))) return;
  if (await constraintExists(knex, 'physical_intake_event_type_check')) {
    await knex.raw('ALTER TABLE physical_intake_event DROP CONSTRAINT physical_intake_event_type_check');
  }
  await knex.raw(`
    ALTER TABLE physical_intake_event
    ADD CONSTRAINT physical_intake_event_type_check
    CHECK (type IN ${PREVIOUS})
  `);
};
