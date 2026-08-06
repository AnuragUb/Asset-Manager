exports.up = async function (knex) {
  const hasCondition = await knex.schema.hasColumn('assets', 'condition');
  if (!hasCondition) {
    await knex.schema.alterTable('assets', (table) => {
      table.string('condition').defaultTo('Good');
    });
  }
};

exports.down = async function (knex) {
  const hasCondition = await knex.schema.hasColumn('assets', 'condition');
  if (hasCondition) {
    await knex.schema.alterTable('assets', (table) => {
      table.dropColumn('condition');
    });
  }
};
