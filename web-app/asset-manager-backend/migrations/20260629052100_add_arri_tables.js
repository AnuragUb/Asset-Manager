/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // 1. ARRI Clients Table
  await knex.schema.createTable('arri_clients', (table) => {
    table.increments('id').primary();
    table.string('name').notNullable();
    table.text('address');
    table.string('contactperson');
    table.string('contactno');
    table.string('email');
    table.string('created_at').defaultTo(knex.fn.now());
    table.unique(['name']); // Prevent duplicate client names
  });

  // 2. ARRI Job Cards Table
  await knex.schema.createTable('arri_job_cards', (table) => {
    table.string('jobcardno').primary();
    table.string('date').notNullable();
    table.string('customername').notNullable();
    table.text('customeraddress');
    table.string('contactperson');
    table.string('contactno');
    table.string('brandmake');
    table.string('modelname');
    table.string('serialno');
    table.string('receivingengineer');
    
    // Accessories (Stored as JSON or individual fields - using individual for simplicity as per existing UI)
    table.string('acc1');
    table.string('acc2');
    table.string('acc3');
    table.string('acc4');

    // Warranty Flags
    table.boolean('typeamc').defaultTo(false);
    table.boolean('typewarranty').defaultTo(false);
    table.boolean('typenowarranty').defaultTo(false);
    table.boolean('typeother').defaultTo(false);

    // Memo Sections
    table.text('reportedproblem');
    table.text('actiontaken');
    table.text('faultfound');
    table.string('faultsn');
    table.text('partsreplaced');
    table.string('partssn');
    table.text('conclusion');

    // Office Purpose
    table.string('invoiceto');
    table.string('invoiceno');
    table.string('invoicedate');
    table.float('estimatedvalue').defaultTo(0);

    table.string('created_at').defaultTo(knex.fn.now());
    table.string('status').defaultTo('Pending');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('arri_job_cards');
  await knex.schema.dropTableIfExists('arri_clients');
};
