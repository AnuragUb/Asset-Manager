/**
 * Soft Delete & Recovery foundation: attribution + generic domain events store.
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  const hasAssets = await knex.schema.hasTable('assets');
  if (hasAssets) {
    const hasDeletedBy = await knex.schema.hasColumn('assets', 'deleted_by');
    if (!hasDeletedBy) {
      await knex.schema.alterTable('assets', (table) => {
        table.string('deleted_by').nullable();
      });
    }
  }

  const hasDomainEvents = await knex.schema.hasTable('domain_events');
  if (!hasDomainEvents) {
    await knex.schema.createTable('domain_events', (table) => {
      table.increments('id').primary();
      table.string('entity_type').notNullable(); // inventory_item | asset | project | ...
      table.string('entity_id').notNullable();
      table.string('type').notNullable();
      table.string('actor').nullable();
      table.string('timestamp').notNullable();
      table.text('note').nullable();
      table.text('metadata_json').nullable();
      table.index(['entity_type', 'entity_id'], 'idx_domain_events_entity');
      table.index(['type'], 'idx_domain_events_type');
      table.index(['timestamp'], 'idx_domain_events_timestamp');
    });
  }
};

exports.down = async function (knex) {
  const hasDomainEvents = await knex.schema.hasTable('domain_events');
  if (hasDomainEvents) {
    await knex.schema.dropTable('domain_events');
  }
  const hasAssets = await knex.schema.hasTable('assets');
  if (hasAssets) {
    const hasDeletedBy = await knex.schema.hasColumn('assets', 'deleted_by');
    if (hasDeletedBy) {
      await knex.schema.alterTable('assets', (table) => {
        table.dropColumn('deleted_by');
      });
    }
  }
};
