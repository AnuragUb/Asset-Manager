/**
 * Add Zoho Product Catalog identity fields used in the Products browser:
 *   usage_unit  ← Zoho Usage_Unit
 *   created_by  ← Zoho Created_By (display name)
 *
 * Rollout: run knex migrate. Existing rows stay null until the next Zoho catalog pull.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('zoho_catalog'))) return;
  if (!(await knex.schema.hasColumn('zoho_catalog', 'usage_unit'))) {
    await knex.schema.alterTable('zoho_catalog', (table) => {
      table.string('usage_unit', 128).nullable();
    });
  }
  if (!(await knex.schema.hasColumn('zoho_catalog', 'created_by'))) {
    await knex.schema.alterTable('zoho_catalog', (table) => {
      table.string('created_by', 255).nullable();
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('zoho_catalog'))) return;
  if (await knex.schema.hasColumn('zoho_catalog', 'usage_unit')) {
    await knex.schema.alterTable('zoho_catalog', (table) => {
      table.dropColumn('usage_unit');
    });
  }
  if (await knex.schema.hasColumn('zoho_catalog', 'created_by')) {
    await knex.schema.alterTable('zoho_catalog', (table) => {
      table.dropColumn('created_by');
    });
  }
};
