/**
 * Phase 8 — Product ↔ Zoho + Set commercialization schema.
 *
 * Additive:
 *   product_name_conflict.resolution
 *   product.composition_hash
 *   product_external_ref.last_error / last_error_at
 *   partial unique product.origin_ref WHERE origin='SET'
 *
 * Does NOT:
 *   drop zoho_catalog
 *   drop assets.zoho_product_id / inventory_items.zoho_product_id / managed_sets.zoho_product_id
 *   change Product ID format or 1:1 mapping uniques
 *   add Product origin RECEIPT
 *   add product.sync_status
 *   apply 20260824120000_create_managed_sets_tables.js
 *
 * Apply with:
 *   npx knex migrate:up 20260829120000_product_zoho_phase8.js --env production
 * Never migrate:latest.
 *
 * @param { import("knex").Knex } knex
 */

async function constraintExists(knex, name) {
  const existing = await knex.raw(`SELECT 1 FROM pg_constraint WHERE conname = ?`, [name]);
  return !!(existing.rows && existing.rows.length);
}

async function indexExists(knex, name) {
  const existing = await knex.raw(`SELECT 1 FROM pg_class WHERE relname = ?`, [name]);
  return !!(existing.rows && existing.rows.length);
}

exports.up = async function (knex) {
  if (await knex.schema.hasTable('product_name_conflict')) {
    if (!(await knex.schema.hasColumn('product_name_conflict', 'resolution'))) {
      await knex.schema.alterTable('product_name_conflict', (table) => {
        table.string('resolution', 16).nullable();
      });
    }
    if (!(await constraintExists(knex, 'product_name_conflict_resolution_value_check'))) {
      await knex.raw(`
        ALTER TABLE product_name_conflict
        ADD CONSTRAINT product_name_conflict_resolution_value_check
        CHECK (
          (status = 'RESOLVED' AND resolution IN ('AE_WINS', 'ZOHO_WINS'))
          OR (status = 'OPEN' AND resolution IS NULL)
        )
      `);
    }
  }

  if (await knex.schema.hasTable('product')) {
    if (!(await knex.schema.hasColumn('product', 'composition_hash'))) {
      await knex.schema.alterTable('product', (table) => {
        table.string('composition_hash', 64).nullable();
      });
    }
    if (!(await indexExists(knex, 'product_set_origin_ref_unique'))) {
      await knex.raw(`
        CREATE UNIQUE INDEX product_set_origin_ref_unique
        ON product (origin_ref)
        WHERE origin = 'SET' AND origin_ref IS NOT NULL
      `);
    }
  }

  if (await knex.schema.hasTable('product_external_ref')) {
    if (!(await knex.schema.hasColumn('product_external_ref', 'last_error'))) {
      await knex.schema.alterTable('product_external_ref', (table) => {
        table.text('last_error').nullable();
        table.timestamp('last_error_at', { useTz: true }).nullable();
      });
    }
  }
};

exports.down = async function (knex) {
  if (await indexExists(knex, 'product_set_origin_ref_unique')) {
    await knex.raw(`DROP INDEX IF EXISTS product_set_origin_ref_unique`);
  }
  if (await constraintExists(knex, 'product_name_conflict_resolution_value_check')) {
    await knex.raw(`ALTER TABLE product_name_conflict DROP CONSTRAINT IF EXISTS product_name_conflict_resolution_value_check`);
  }
  if (await knex.schema.hasTable('product_name_conflict') && await knex.schema.hasColumn('product_name_conflict', 'resolution')) {
    await knex.schema.alterTable('product_name_conflict', (table) => {
      table.dropColumn('resolution');
    });
  }
  if (await knex.schema.hasTable('product') && await knex.schema.hasColumn('product', 'composition_hash')) {
    await knex.schema.alterTable('product', (table) => {
      table.dropColumn('composition_hash');
    });
  }
  if (await knex.schema.hasTable('product_external_ref') && await knex.schema.hasColumn('product_external_ref', 'last_error')) {
    await knex.schema.alterTable('product_external_ref', (table) => {
      table.dropColumn('last_error');
      table.dropColumn('last_error_at');
    });
  }
};
