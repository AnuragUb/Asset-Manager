exports.up = async function (knex) {
  const has = await knex.schema.hasColumn('assets', 'itemdescription');
  if (!has) {
    await knex.schema.alterTable('assets', (table) => {
      table.text('itemdescription');
    });
  }
};

exports.down = async function (knex) {
  const has = await knex.schema.hasColumn('assets', 'itemdescription');
  if (has) {
    await knex.schema.alterTable('assets', (table) => {
      table.dropColumn('itemdescription');
    });
  }
};
