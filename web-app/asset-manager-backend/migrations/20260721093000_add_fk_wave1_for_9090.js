/**
 * Wave 1 foreign keys for the 9090 test environment rollout.
 *
 * This migration only introduces the safest first-wave relationships:
 * - asset_it_details.assetid -> assets.id
 * - project_order_items.orderid -> project_orders.id
 * - assets.linked_po_item_id -> project_order_items.id
 * - temporary_assets.linked_po_item_id -> project_order_items.id
 * - components.parentid -> assets.id
 *
 * Supporting indexes are added on the referencing columns where needed.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_project_order_items_orderid
    ON project_order_items(orderid);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_assets_linked_po_item_id
    ON assets(linked_po_item_id);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_temporary_assets_linked_po_item_id
    ON temporary_assets(linked_po_item_id);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_components_parentid
    ON components(parentid);
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_asset_it_details_assetid_assets'
      ) THEN
        ALTER TABLE asset_it_details
        ADD CONSTRAINT fk_asset_it_details_assetid_assets
        FOREIGN KEY (assetid) REFERENCES assets(id)
        ON DELETE CASCADE;
      END IF;
    END $$;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_project_order_items_orderid_project_orders'
      ) THEN
        ALTER TABLE project_order_items
        ADD CONSTRAINT fk_project_order_items_orderid_project_orders
        FOREIGN KEY (orderid) REFERENCES project_orders(id)
        ON DELETE CASCADE;
      END IF;
    END $$;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_assets_linked_po_item_id_project_order_items'
      ) THEN
        ALTER TABLE assets
        ADD CONSTRAINT fk_assets_linked_po_item_id_project_order_items
        FOREIGN KEY (linked_po_item_id) REFERENCES project_order_items(id)
        ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_temporary_assets_linked_po_item_id_project_order_items'
      ) THEN
        ALTER TABLE temporary_assets
        ADD CONSTRAINT fk_temporary_assets_linked_po_item_id_project_order_items
        FOREIGN KEY (linked_po_item_id) REFERENCES project_order_items(id)
        ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_components_parentid_assets'
      ) THEN
        ALTER TABLE components
        ADD CONSTRAINT fk_components_parentid_assets
        FOREIGN KEY (parentid) REFERENCES assets(id)
        ON DELETE CASCADE;
      END IF;
    END $$;
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.raw(`
    ALTER TABLE components
    DROP CONSTRAINT IF EXISTS fk_components_parentid_assets;
  `);

  await knex.raw(`
    ALTER TABLE temporary_assets
    DROP CONSTRAINT IF EXISTS fk_temporary_assets_linked_po_item_id_project_order_items;
  `);

  await knex.raw(`
    ALTER TABLE assets
    DROP CONSTRAINT IF EXISTS fk_assets_linked_po_item_id_project_order_items;
  `);

  await knex.raw(`
    ALTER TABLE project_order_items
    DROP CONSTRAINT IF EXISTS fk_project_order_items_orderid_project_orders;
  `);

  await knex.raw(`
    ALTER TABLE asset_it_details
    DROP CONSTRAINT IF EXISTS fk_asset_it_details_assetid_assets;
  `);

  await knex.raw(`
    DROP INDEX IF EXISTS idx_components_parentid;
  `);

  await knex.raw(`
    DROP INDEX IF EXISTS idx_temporary_assets_linked_po_item_id;
  `);

  await knex.raw(`
    DROP INDEX IF EXISTS idx_assets_linked_po_item_id;
  `);

  await knex.raw(`
    DROP INDEX IF EXISTS idx_project_order_items_orderid;
  `);
};
