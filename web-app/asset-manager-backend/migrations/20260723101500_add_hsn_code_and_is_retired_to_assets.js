exports.up = async function (knex) {
  const hasHsn = await knex.schema.hasColumn('assets', 'hsn_code');
  if (!hasHsn) {
    await knex.schema.alterTable('assets', (table) => {
      table.string('hsn_code');
    });
  }

  const hasIsRetired = await knex.schema.hasColumn('assets', 'is_retired');
  if (!hasIsRetired) {
    await knex.schema.alterTable('assets', (table) => {
      table.integer('is_retired').defaultTo(0);
    });
  }
};

exports.down = async function (knex) {
  const hasIsRetired = await knex.schema.hasColumn('assets', 'is_retired');
  if (hasIsRetired) {
    await knex.schema.alterTable('assets', (table) => {
      table.dropColumn('is_retired');
    });
  }

  const hasHsn = await knex.schema.hasColumn('assets', 'hsn_code');
  if (hasHsn) {
    await knex.schema.alterTable('assets', (table) => {
      table.dropColumn('hsn_code');
    });
  }
};
