/**
 * Seeds a sample Zoho catalog product for 9090/test only.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const result = await knex.raw('select current_database() as db_name');
  const dbName = result?.rows?.[0]?.db_name || result?.[0]?.db_name || '';

  if (dbName !== 'asset_manager_test') {
    console.log(`[inventory-preview] Skipping zoho_catalog sample seed for database ${dbName}`);
    return;
  }

  const hasCatalog = await knex.schema.hasTable('zoho_catalog');
  if (!hasCatalog) return;

  await knex.raw(`
    INSERT INTO zoho_catalog (
      zoho_product_id,
      product_name,
      unit_price,
      make,
      model,
      hsn_code,
      description,
      sku,
      is_active,
      last_synced_at,
      created_at
    ) VALUES (
      'ZP-SAMPLE-0001',
      'Sample Catalog Product (Hardcoded)',
      25000,
      'CINEOM',
      'SAMPLE-MODEL-1',
      '9987',
      'Hardcoded sample catalog product for testing catalog → inventory conversion flow.',
      'SAMPLE-001',
      true,
      now(),
      now()
    )
    ON CONFLICT (zoho_product_id) DO NOTHING;
  `);
};

exports.down = async function () {};

