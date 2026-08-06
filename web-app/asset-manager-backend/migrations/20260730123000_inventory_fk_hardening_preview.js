/**
 * Inventory foreign key hardening (9090/test only).
 *
 * Enforces relational integrity for:
 * - inventory_folders parent relationship
 * - inventory_kinds folder + parent relationship
 * - inventory_items folder + kind + parent relationship
 * - inventory_components parent relationship
 * - inventory_quantity_events root relationship
 * - inventory_quantity_event_lines item relationship
 *
 * Also enforces the project rule: inventory items and kinds must always belong to a folder/category
 * by ensuring non-null folder/kind references (with a safe "Inbox/Misc" fallback for legacy rows).
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const result = await knex.raw('select current_database() as db_name');
  const dbName = result?.rows?.[0]?.db_name || result?.[0]?.db_name || '';

  if (dbName !== 'asset_manager_test') {
    console.log(`[inventory-preview] Skipping inventory FK hardening for database ${dbName}`);
    return;
  }

  const hasItems = await knex.schema.hasTable('inventory_items');
  const hasFolders = await knex.schema.hasTable('inventory_folders');
  const hasKinds = await knex.schema.hasTable('inventory_kinds');

  if (!hasItems || !hasFolders || !hasKinds) return;

  await knex.raw(`
    INSERT INTO inventory_folders (id, name, parentid, icon, module, createdby, timestamp, is_deleted, deleted_at)
    VALUES ('IF-INBOX', 'Inbox', NULL, '📥', 'INVENTORY', 'system', to_char(now(), 'YYYY-MM-DD HH24:MI:SS'), 0, NULL)
    ON CONFLICT (id) DO NOTHING;
  `);

  await knex.raw(`
    INSERT INTO inventory_kinds (id, name, folderid, parentid, module, icon, displayimage, identifier, lastupdated, is_deleted, deleted_at)
    VALUES ('IK-MISC', 'Misc', 'IF-INBOX', NULL, 'INVENTORY', '📦', NULL, NULL, to_char(now(), 'YYYY-MM-DD HH24:MI:SS'), 0, NULL)
    ON CONFLICT (id) DO NOTHING;
  `);

  await knex.raw(`
    UPDATE inventory_items SET folderid = NULL WHERE folderid = '';
    UPDATE inventory_items SET kindid = NULL WHERE kindid = '';
    UPDATE inventory_items SET parentid = NULL WHERE parentid = '';

    UPDATE inventory_kinds SET folderid = NULL WHERE folderid = '';
    UPDATE inventory_kinds SET parentid = NULL WHERE parentid = '';

    UPDATE inventory_folders SET parentid = NULL WHERE parentid = '';
  `);

  await knex.raw(`
    UPDATE inventory_kinds
    SET folderid = 'IF-INBOX'
    WHERE folderid IS NULL;

    UPDATE inventory_items
    SET folderid = 'IF-INBOX'
    WHERE folderid IS NULL;

    UPDATE inventory_items
    SET kindid = 'IK-MISC'
    WHERE kindid IS NULL;
  `);

  await knex.raw(`
    DELETE FROM inventory_items i
    WHERE i.folderid IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM inventory_folders f WHERE f.id = i.folderid);

    DELETE FROM inventory_items i
    WHERE i.kindid IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM inventory_kinds k WHERE k.id = i.kindid);

    DELETE FROM inventory_kinds k
    WHERE k.folderid IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM inventory_folders f WHERE f.id = k.folderid);
  `);

  await knex.raw(`
    ALTER TABLE inventory_kinds ALTER COLUMN folderid SET NOT NULL;
    ALTER TABLE inventory_items ALTER COLUMN folderid SET NOT NULL;
    ALTER TABLE inventory_items ALTER COLUMN kindid SET NOT NULL;
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_inventory_folders_parentid
    ON inventory_folders(parentid);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_inventory_kinds_folderid
    ON inventory_kinds(folderid);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_inventory_kinds_parentid
    ON inventory_kinds(parentid);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_inventory_items_parentid
    ON inventory_items(parentid);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_inventory_items_folderid
    ON inventory_items(folderid);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_inventory_items_kindid
    ON inventory_items(kindid);
  `);

  await knex.raw(`
    ALTER TABLE inventory_folders DROP CONSTRAINT IF EXISTS inventory_folders_parentid_foreign;
    ALTER TABLE inventory_kinds DROP CONSTRAINT IF EXISTS inventory_kinds_folderid_foreign;
    ALTER TABLE inventory_kinds DROP CONSTRAINT IF EXISTS inventory_kinds_parentid_foreign;
    ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS inventory_items_parentid_foreign;
    ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS inventory_items_folderid_foreign;
    ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS inventory_items_kindid_foreign;
    ALTER TABLE inventory_components DROP CONSTRAINT IF EXISTS inventory_components_parentid_foreign;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_inventory_folders_parentid_inventory_folders'
      ) THEN
        ALTER TABLE inventory_folders
        ADD CONSTRAINT fk_inventory_folders_parentid_inventory_folders
        FOREIGN KEY (parentid) REFERENCES inventory_folders(id)
        ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_inventory_kinds_folderid_inventory_folders'
      ) THEN
        ALTER TABLE inventory_kinds
        ADD CONSTRAINT fk_inventory_kinds_folderid_inventory_folders
        FOREIGN KEY (folderid) REFERENCES inventory_folders(id)
        ON DELETE RESTRICT;
      END IF;
    END $$;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_inventory_kinds_parentid_inventory_kinds'
      ) THEN
        ALTER TABLE inventory_kinds
        ADD CONSTRAINT fk_inventory_kinds_parentid_inventory_kinds
        FOREIGN KEY (parentid) REFERENCES inventory_kinds(id)
        ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_inventory_items_parentid_inventory_items'
      ) THEN
        ALTER TABLE inventory_items
        ADD CONSTRAINT fk_inventory_items_parentid_inventory_items
        FOREIGN KEY (parentid) REFERENCES inventory_items(id)
        ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_inventory_items_folderid_inventory_folders'
      ) THEN
        ALTER TABLE inventory_items
        ADD CONSTRAINT fk_inventory_items_folderid_inventory_folders
        FOREIGN KEY (folderid) REFERENCES inventory_folders(id)
        ON DELETE RESTRICT;
      END IF;
    END $$;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_inventory_items_kindid_inventory_kinds'
      ) THEN
        ALTER TABLE inventory_items
        ADD CONSTRAINT fk_inventory_items_kindid_inventory_kinds
        FOREIGN KEY (kindid) REFERENCES inventory_kinds(id)
        ON DELETE RESTRICT;
      END IF;
    END $$;
  `);

  const hasComponents = await knex.schema.hasTable('inventory_components');
  if (hasComponents) {
    await knex.raw(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_inventory_components_parentid_inventory_items'
        ) THEN
          ALTER TABLE inventory_components
          ADD CONSTRAINT fk_inventory_components_parentid_inventory_items
          FOREIGN KEY (parentid) REFERENCES inventory_items(id)
          ON DELETE SET NULL;
        END IF;
      END $$;
    `);
  }

  const hasEvents = await knex.schema.hasTable('inventory_quantity_events');
  if (hasEvents) {
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_inventory_quantity_events_root_id
      ON inventory_quantity_events(root_id);
    `);

    await knex.raw(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_inventory_quantity_events_rootid_inventory_items'
        ) THEN
          ALTER TABLE inventory_quantity_events
          ADD CONSTRAINT fk_inventory_quantity_events_rootid_inventory_items
          FOREIGN KEY (root_id) REFERENCES inventory_items(id)
          ON DELETE CASCADE;
        END IF;
      END $$;
    `);
  }

  const hasLines = await knex.schema.hasTable('inventory_quantity_event_lines');
  if (hasLines) {
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_inventory_quantity_event_lines_item_id
      ON inventory_quantity_event_lines(item_id);
    `);

    await knex.raw(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_inventory_quantity_event_lines_itemid_inventory_items'
        ) THEN
          ALTER TABLE inventory_quantity_event_lines
          ADD CONSTRAINT fk_inventory_quantity_event_lines_itemid_inventory_items
          FOREIGN KEY (item_id) REFERENCES inventory_items(id)
          ON DELETE CASCADE;
        END IF;
      END $$;
    `);
  }
};

exports.down = async function () {};

