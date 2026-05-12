/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    const hasCompanyId = await knex.schema.hasColumn('assets', 'company_id');
    if (!hasCompanyId) {
        await knex.schema.table('assets', (table) => {
            table.string('company_id');
        });
    }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    const hasCompanyId = await knex.schema.hasColumn('assets', 'company_id');
    if (hasCompanyId) {
        await knex.schema.table('assets', (table) => {
            table.dropColumn('company_id');
        });
    }
};
