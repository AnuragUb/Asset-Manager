/**
 * Product Foundation — additive schema only.
 *
 * Creates:
 *   product
 *   product_external_ref
 *   product_name_conflict
 *   assets.product_id (nullable FK)
 *   inventory_items.product_id (nullable FK)
 *
 * Does NOT:
 *   - drop zoho_catalog
 *   - drop assets.zoho_product_id / inventory_items.zoho_product_id
 *   - drop managed_sets.zoho_product_id
 *   - backfill Product rows (see scripts/product-backfill.js)
 *   - alter quantities, history, serials, QR, Sets, DCs, Projects
 *   - add managed_sets.product_id
 *
 * Apply with a named migration only:
 *   npx knex migrate:up --name 20260827120000_create_product_foundation.js
 * Do NOT run knex migrate:latest (unapplied draft 20260824120000 would execute).
 *
 * @param { import("knex").Knex } knex
 */

exports.up = async function (knex) {
  const hasProduct = await knex.schema.hasTable('product');
  if (!hasProduct) {
    await knex.schema.createTable('product', (table) => {
      table.string('id', 255).primary();
      table.string('name', 255).notNullable();
      table.text('description').nullable();
      table.string('make', 255).nullable();
      table.string('model', 255).nullable();
      table.string('manufacturer', 255).nullable();
      table.string('hsn_code', 255).nullable();
      table.string('unit', 64).nullable();
      table.string('product_code', 255).nullable();
      table.decimal('price', 14, 2).nullable();
      table.string('status', 32).notNullable().defaultTo('ACTIVE');
      table.string('origin', 32).notNullable();
      table.string('origin_ref', 255).nullable();
      table.timestamp('archived_at', { useTz: true }).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.string('created_by', 255).nullable();
      table.string('updated_by', 255).nullable();
    });

    await knex.raw(`
      ALTER TABLE product
      ADD CONSTRAINT product_id_format_check
      CHECK (id ~ '^PRD-[0-9]{4}-[A-Z0-9]{6}-[A-Z0-9]$')
    `);

    await knex.raw(`
      ALTER TABLE product
      ADD CONSTRAINT product_status_check
      CHECK (status IN ('ACTIVE', 'ARCHIVED'))
    `);

    await knex.raw(`
      ALTER TABLE product
      ADD CONSTRAINT product_archive_consistency_check
      CHECK (
        (status = 'ARCHIVED' AND archived_at IS NOT NULL)
        OR (status <> 'ARCHIVED' AND archived_at IS NULL)
      )
    `);

    await knex.raw(`
      ALTER TABLE product
      ADD CONSTRAINT product_origin_check
      CHECK (origin IN ('ZOHO', 'ASSETENGINE', 'ASSET', 'INVENTORY', 'SET'))
    `);

    await knex.raw(`
      ALTER TABLE product
      ADD CONSTRAINT product_origin_ref_check
      CHECK (origin_ref IS NULL OR origin IN ('ASSET', 'INVENTORY', 'SET'))
    `);

    await knex.raw(`CREATE INDEX idx_product_status ON product (status)`);
    await knex.raw(`CREATE INDEX idx_product_origin ON product (origin)`);
    await knex.raw(`CREATE INDEX idx_product_name_lower ON product (lower(name))`);
    await knex.raw(`CREATE INDEX idx_product_make_model ON product (make, model)`);
  }

  const hasExternalRef = await knex.schema.hasTable('product_external_ref');
  if (!hasExternalRef) {
    await knex.schema.createTable('product_external_ref', (table) => {
      table.string('id', 255).primary();
      table.string('product_id', 255).notNullable();
      table.string('system', 32).notNullable().defaultTo('ZOHO_CRM');
      table.string('module', 64).notNullable().defaultTo('Products');
      table.string('external_id', 255).notNullable();
      table.string('link_origin', 16).notNullable();
      table.string('baseline_name', 255).nullable();
      table.timestamp('baseline_captured_at', { useTz: true }).nullable();
      table.string('last_pushed_hash', 64).nullable();
      table.timestamp('last_pulled_at', { useTz: true }).nullable();
      table.timestamp('last_pushed_at', { useTz: true }).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table
        .foreign('product_id', 'fk_product_external_ref_product_id')
        .references('id')
        .inTable('product')
        .onDelete('RESTRICT');
    });

    await knex.raw(`
      ALTER TABLE product_external_ref
      ADD CONSTRAINT product_external_ref_external_unique
      UNIQUE (system, module, external_id)
    `);

    await knex.raw(`
      ALTER TABLE product_external_ref
      ADD CONSTRAINT product_external_ref_product_unique
      UNIQUE (product_id, system, module)
    `);

    await knex.raw(`
      ALTER TABLE product_external_ref
      ADD CONSTRAINT product_external_ref_link_origin_check
      CHECK (link_origin IN ('PULL', 'PUSH'))
    `);

    await knex.raw(`
      ALTER TABLE product_external_ref
      ADD CONSTRAINT product_external_ref_external_id_not_blank_check
      CHECK (BTRIM(external_id) <> '')
    `);
  }

  const hasNameConflict = await knex.schema.hasTable('product_name_conflict');
  if (!hasNameConflict) {
    await knex.schema.createTable('product_name_conflict', (table) => {
      table.string('id', 255).primary();
      table.string('product_id', 255).notNullable();
      table.string('external_ref_id', 255).nullable();
      table.string('baseline_name', 255).nullable();
      table.string('ae_name', 255).notNullable();
      table.string('zoho_name', 255).notNullable();
      table.string('status', 16).notNullable();
      table.timestamp('detected_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('resolved_at', { useTz: true }).nullable();
      table.string('resolved_by', 255).nullable();
      table.string('final_value', 255).nullable();

      table
        .foreign('product_id', 'fk_product_name_conflict_product_id')
        .references('id')
        .inTable('product')
        .onDelete('RESTRICT');

      table
        .foreign('external_ref_id', 'fk_product_name_conflict_external_ref_id')
        .references('id')
        .inTable('product_external_ref')
        .onDelete('RESTRICT');
    });

    await knex.raw(`
      ALTER TABLE product_name_conflict
      ADD CONSTRAINT product_name_conflict_status_check
      CHECK (status IN ('OPEN', 'RESOLVED'))
    `);

    await knex.raw(`
      ALTER TABLE product_name_conflict
      ADD CONSTRAINT product_name_conflict_resolution_check
      CHECK (
        (status = 'RESOLVED' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND final_value IS NOT NULL)
        OR (status = 'OPEN' AND resolved_at IS NULL)
      )
    `);

    await knex.raw(`
      CREATE UNIQUE INDEX product_name_conflict_open_unique
      ON product_name_conflict (product_id)
      WHERE status = 'OPEN'
    `);
  }

  const hasAssetsProductId = await knex.schema.hasColumn('assets', 'product_id');
  if (!hasAssetsProductId) {
    await knex.schema.alterTable('assets', (table) => {
      table.string('product_id', 255).nullable();
      table
        .foreign('product_id', 'fk_assets_product_id')
        .references('id')
        .inTable('product')
        .onDelete('RESTRICT');
      table.index(['product_id'], 'idx_assets_product_id');
    });
  }

  const hasInventoryProductId = await knex.schema.hasColumn('inventory_items', 'product_id');
  if (!hasInventoryProductId) {
    await knex.schema.alterTable('inventory_items', (table) => {
      table.string('product_id', 255).nullable();
      table
        .foreign('product_id', 'fk_inventory_items_product_id')
        .references('id')
        .inTable('product')
        .onDelete('RESTRICT');
      table.index(['product_id'], 'idx_inventory_items_product_id');
    });
  }

  await knex.raw(`
    CREATE OR REPLACE FUNCTION product_protect_immutable_columns()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'product.id is immutable';
      END IF;
      IF NEW.origin IS DISTINCT FROM OLD.origin THEN
        RAISE EXCEPTION 'product.origin is immutable';
      END IF;
      IF NEW.origin_ref IS DISTINCT FROM OLD.origin_ref THEN
        RAISE EXCEPTION 'product.origin_ref is immutable';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_product_immutable ON product;
    CREATE TRIGGER trg_product_immutable
    BEFORE UPDATE ON product
    FOR EACH ROW EXECUTE FUNCTION product_protect_immutable_columns();
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION product_external_ref_protect_immutable_columns()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.link_origin IS DISTINCT FROM OLD.link_origin THEN
        RAISE EXCEPTION 'product_external_ref.link_origin is immutable';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_product_external_ref_immutable ON product_external_ref;
    CREATE TRIGGER trg_product_external_ref_immutable
    BEFORE UPDATE ON product_external_ref
    FOR EACH ROW EXECUTE FUNCTION product_external_ref_protect_immutable_columns();
  `);
};

exports.down = async function (knex) {
  await knex.raw('DROP TRIGGER IF EXISTS trg_product_external_ref_immutable ON product_external_ref;');
  await knex.raw('DROP TRIGGER IF EXISTS trg_product_immutable ON product;');
  await knex.raw('DROP FUNCTION IF EXISTS product_external_ref_protect_immutable_columns();');
  await knex.raw('DROP FUNCTION IF EXISTS product_protect_immutable_columns();');

  await knex.schema.dropTableIfExists('product_name_conflict');
  await knex.schema.dropTableIfExists('product_external_ref');

  if (await knex.schema.hasColumn('inventory_items', 'product_id')) {
    await knex.schema.alterTable('inventory_items', (table) => {
      table.dropForeign('product_id', 'fk_inventory_items_product_id');
      table.dropIndex(['product_id'], 'idx_inventory_items_product_id');
      table.dropColumn('product_id');
    });
  }

  if (await knex.schema.hasColumn('assets', 'product_id')) {
    await knex.schema.alterTable('assets', (table) => {
      table.dropForeign('product_id', 'fk_assets_product_id');
      table.dropIndex(['product_id'], 'idx_assets_product_id');
      table.dropColumn('product_id');
    });
  }

  await knex.schema.dropTableIfExists('product');
};
