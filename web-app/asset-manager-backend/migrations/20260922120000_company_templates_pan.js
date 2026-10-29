/**
 * Company template PAN for Delivery Challan parity with physical DN
 * ("Company's PAN" on Tally-style Delivery Notes).
 */
exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('company_templates'))) {
    throw new Error('STOP: company_templates missing');
  }
  if (!(await knex.schema.hasColumn('company_templates', 'pan'))) {
    await knex.schema.alterTable('company_templates', (table) => {
      table.string('pan', 32).nullable();
    });
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasTable('company_templates')
    && await knex.schema.hasColumn('company_templates', 'pan')) {
    await knex.schema.alterTable('company_templates', (table) => {
      table.dropColumn('pan');
    });
  }
};
