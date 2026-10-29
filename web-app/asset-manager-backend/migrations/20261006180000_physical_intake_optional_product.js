/**
 * Single Physical Intake may register a holding with no Product.
 * physical_intake.product_id stays a foreign key and becomes nullable.
 * Assets and inventory_items already allow a null product_id.
 *
 * Apply with named migrate only. Never migrate:latest.
 *
 * @param { import("knex").Knex } knex
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('physical_intake'))) return;
  await knex.raw('ALTER TABLE physical_intake ALTER COLUMN product_id DROP NOT NULL');
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasTable('physical_intake'))) return;
  const empty = await knex('physical_intake').whereNull('product_id').first();
  if (empty) {
    throw new Error('STOP: physical_intake rows exist with no product_id');
  }
  await knex.raw('ALTER TABLE physical_intake ALTER COLUMN product_id SET NOT NULL');
};
