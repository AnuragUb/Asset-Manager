/**
 * Rekey serial_identity: drop generated SER- ids.
 * PK = (resource_type, resource_id, sort_order) — notations under a holding.
 *
 * Also: purchase_book_physical — book line ↔ holding (+ optional serial sort_order).
 */

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('serial_identity'))) {
    throw new Error('STOP: serial_identity missing; apply serial_identity_foundation first');
  }

  const hasId = await knex.schema.hasColumn('serial_identity', 'id');
  if (hasId) {
    // Drop SER-id dependent objects
    await knex.raw('ALTER TABLE serial_identity DROP CONSTRAINT IF EXISTS serial_identity_pkey');
    await knex.raw('ALTER TABLE serial_identity DROP CONSTRAINT IF EXISTS serial_identity_id_format_check');
    await knex.schema.alterTable('serial_identity', (table) => {
      table.dropColumn('id');
    });
  }

  // Ensure unique sort per holding (required for new PK)
  const dups = await knex.raw(`
    SELECT resource_type, resource_id, sort_order, COUNT(*) AS n
    FROM serial_identity
    GROUP BY 1, 2, 3
    HAVING COUNT(*) > 1
  `);
  if (dups.rows && dups.rows.length) {
    // Compact sort_order per holding
    const holdings = await knex('serial_identity')
      .distinct('resource_type', 'resource_id');
    for (const h of holdings) {
      const rows = await knex('serial_identity')
        .where({ resource_type: h.resource_type, resource_id: h.resource_id })
        .orderBy('sort_order')
        .orderBy('serial_value');
      let i = 0;
      for (const row of rows) {
        await knex('serial_identity')
          .where({
            resource_type: row.resource_type,
            resource_id: row.resource_id,
            sort_order: row.sort_order,
            serial_value: row.serial_value
          })
          .update({ sort_order: i });
        i += 1;
      }
    }
  }

  // PK = notations under the holding (resource_id is asset/inventory id)
  await knex.raw(`
    DO $$ BEGIN
      ALTER TABLE serial_identity
        ADD CONSTRAINT serial_identity_pkey
        PRIMARY KEY (resource_type, resource_id, sort_order);
    EXCEPTION WHEN duplicate_object OR invalid_table_definition THEN NULL;
    END $$;
  `);

  if (!(await knex.schema.hasTable('purchase_book_physical'))) {
    await knex.schema.createTable('purchase_book_physical', (table) => {
      table.increments('id').primary();
      table.string('purchase_book_id', 255).notNullable();
      table.string('purchase_book_line_id', 255).notNullable();
      table.string('resource_type', 16).notNullable();
      table.string('resource_id', 255).notNullable();
      table.integer('serial_sort_order').nullable(); // null = whole holding; else FK into serial_identity
      table.specificType('qty_allocated', 'NUMERIC(18,6)').notNullable().defaultTo(1);
      table.string('status', 16).notNullable().defaultTo('ACTIVE');
      table.string('created_by', 255).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table
        .foreign('purchase_book_id', 'fk_pb_phys_book_id')
        .references('id')
        .inTable('purchase_book')
        .onDelete('CASCADE');
      table
        .foreign('purchase_book_line_id', 'fk_pb_phys_line_id')
        .references('id')
        .inTable('purchase_book_line')
        .onDelete('CASCADE');
    });

    await knex.raw(`
      ALTER TABLE purchase_book_physical
      ADD CONSTRAINT purchase_book_physical_resource_type_check
      CHECK (resource_type IN ('ASSET', 'INVENTORY'))
    `);
    await knex.raw(`
      ALTER TABLE purchase_book_physical
      ADD CONSTRAINT purchase_book_physical_status_check
      CHECK (status IN ('ACTIVE', 'RELEASED'))
    `);
    await knex.raw(`
      ALTER TABLE purchase_book_physical
      ADD CONSTRAINT purchase_book_physical_qty_positive
      CHECK (qty_allocated > 0)
    `);
    // Optional FK: when serial_sort_order is set, it must exist on that holding
    await knex.raw(`
      ALTER TABLE purchase_book_physical
      ADD CONSTRAINT fk_pb_phys_serial_notation
      FOREIGN KEY (resource_type, resource_id, serial_sort_order)
      REFERENCES serial_identity (resource_type, resource_id, sort_order)
      ON DELETE RESTRICT
    `);
    // One active allocation of a specific serial (or whole holding) per book line
    await knex.raw(`
      CREATE UNIQUE INDEX uq_pb_phys_line_holding_serial_active
      ON purchase_book_physical (
        purchase_book_line_id, resource_type, resource_id,
        COALESCE(serial_sort_order, -1)
      )
      WHERE status = 'ACTIVE'
    `);
    await knex.raw(`
      CREATE INDEX idx_pb_phys_book_id ON purchase_book_physical (purchase_book_id)
    `);
    await knex.raw(`
      CREATE INDEX idx_pb_phys_holding ON purchase_book_physical (resource_type, resource_id)
    `);
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasTable('purchase_book_physical')) {
    await knex.schema.dropTable('purchase_book_physical');
  }
  // Cannot safely restore SER- ids; leave composite PK in place on down.
};
