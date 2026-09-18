/**
 * Serial identity foundation (ADR-SERIAL-IDENTITY-001).
 *
 * Additive table only. Does not drop or alter assets.srno / inventory_items.srno.
 * Backfill is a separate script (serial-identity-backfill.js).
 */

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('serial_identity'))) {
    await knex.schema.createTable('serial_identity', (table) => {
      table.string('id', 255).primary();
      table.string('resource_type', 16).notNullable();
      table.string('resource_id', 255).notNullable();
      table.string('product_id', 255).nullable();
      table.string('serial_value', 512).notNullable();
      table.string('status', 16).notNullable().defaultTo('ACTIVE');
      table.integer('sort_order').notNullable().defaultTo(0);
      table.string('source', 32).notNullable().defaultTo('MANUAL');
      table.string('created_by', 255).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });

    await knex.raw(`
      ALTER TABLE serial_identity
      ADD CONSTRAINT serial_identity_id_format_check
      CHECK (id ~ '^SER-[0-9]{4}-[A-Z0-9]{6}-[A-Z0-9]$')
    `);
    await knex.raw(`
      ALTER TABLE serial_identity
      ADD CONSTRAINT serial_identity_resource_type_check
      CHECK (resource_type IN ('ASSET', 'INVENTORY'))
    `);
    await knex.raw(`
      ALTER TABLE serial_identity
      ADD CONSTRAINT serial_identity_status_check
      CHECK (status IN ('ACTIVE', 'RETIRED', 'LOST', 'CONSUMED'))
    `);
    await knex.raw(`
      ALTER TABLE serial_identity
      ADD CONSTRAINT serial_identity_source_check
      CHECK (source IN ('MIGRATED_SRNO', 'MANUAL', 'RECEIPT', 'INTAKE'))
    `);
    await knex.raw(`
      ALTER TABLE serial_identity
      ADD CONSTRAINT serial_identity_serial_value_nonempty
      CHECK (length(trim(serial_value)) > 0)
    `);

    if (await knex.schema.hasTable('product')) {
      await knex.schema.alterTable('serial_identity', (table) => {
        table
          .foreign('product_id', 'fk_serial_identity_product_id')
          .references('id')
          .inTable('product')
          .onDelete('SET NULL');
      });
    }

    await knex.raw(`
      CREATE UNIQUE INDEX uq_serial_identity_active_product_value
      ON serial_identity (product_id, lower(serial_value))
      WHERE status = 'ACTIVE' AND product_id IS NOT NULL
    `);
    await knex.raw(`
      CREATE UNIQUE INDEX uq_serial_identity_active_holding_value
      ON serial_identity (resource_type, resource_id, lower(serial_value))
      WHERE status = 'ACTIVE'
    `);
    await knex.raw(`
      CREATE INDEX idx_serial_identity_holding
      ON serial_identity (resource_type, resource_id)
    `);
    await knex.raw(`
      CREATE INDEX idx_serial_identity_value_lower
      ON serial_identity (lower(serial_value))
    `);
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasTable('serial_identity')) {
    await knex.schema.dropTable('serial_identity');
  }
};
