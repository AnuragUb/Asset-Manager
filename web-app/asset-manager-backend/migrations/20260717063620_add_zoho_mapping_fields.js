/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    // 1. Projects table: Link to Zoho Deal/Project
    await knex.schema.alterTable('projects', (table) => {
        table.string('zoho_deal_id').nullable(); // Standard Zoho ID
        table.string('zoho_project_id_key').nullable(); // Your custom Project_ID field
        table.string('sale_type').defaultTo('Project'); // Project vs Box Sale
    });

    // 2. Assets table: Link to Zoho Product (for Supersets)
    await knex.schema.alterTable('assets', (table) => {
        table.string('zoho_product_id').nullable();
    });

    // 3. Check if 'clients' exists, otherwise add to 'projects' or handle fallback
    const hasClients = await knex.schema.hasTable('clients');
    if (hasClients) {
        await knex.schema.alterTable('clients', (table) => {
            table.string('zoho_account_id').nullable();
        });
    } else {
        console.log('[Migration] Table "clients" not found, adding zoho_account_id to "projects" as fallback');
        await knex.schema.alterTable('projects', (table) => {
            table.string('zoho_account_id').nullable();
        });
    }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    await knex.schema.alterTable('projects', (table) => {
        table.dropColumn('zoho_deal_id');
        table.dropColumn('zoho_project_id_key');
        table.dropColumn('sale_type');
        table.dropColumn('zoho_account_id');
    });

    await knex.schema.alterTable('assets', (table) => {
        table.dropColumn('zoho_product_id');
    });

    const hasClients = await knex.schema.hasTable('clients');
    if (hasClients) {
        await knex.schema.alterTable('clients', (table) => {
            table.dropColumn('zoho_account_id');
        });
    }
};
