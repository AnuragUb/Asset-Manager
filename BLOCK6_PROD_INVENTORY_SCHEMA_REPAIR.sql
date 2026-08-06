-- ================================================================
-- BLOCK 6A / 118-safe.  Idempotent.  Roll forward safe.
--
-- PROD asset_manager inventory schema repair
-- Manually-applied Block5C/5D/5b prod DDL used timestamptz/date/text
-- everywhere; but knex migrations (and server.js normalizeDBData())
-- expect varchar string columns for ALL timestamp-like fields plus
-- a few column rename differences on inventory_folders.
--
-- Run on asset_manager DB via:
--   psql -U postgres -d asset_manager -f BLOCK6_PROD_INVENTORY_SCHEMA_REPAIR.sql
-- ================================================================

SET client_min_messages = warning;

-- ----------------------------------------------------------------
-- 1) inventory_folders: createdat -> rename to timestamp, drop
--    lastupdated (unused in migrations). Change types to varchar.
-- ----------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_catalog='asset_manager' AND table_name='inventory_folders' AND column_name='createdat'
  ) THEN
    ALTER TABLE inventory_folders RENAME COLUMN createdat TO timestamp;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_catalog='asset_manager' AND table_name='inventory_folders' AND column_name='lastupdated'
  ) THEN
    ALTER TABLE inventory_folders DROP COLUMN lastupdated;
  END IF;
END $$;

ALTER TABLE inventory_folders
  ALTER COLUMN id TYPE varchar,
  ALTER COLUMN name TYPE varchar,
  ALTER COLUMN parentid TYPE varchar,
  ALTER COLUMN icon TYPE varchar,
  ALTER COLUMN module TYPE varchar,
  ALTER COLUMN createdby TYPE varchar,
  ALTER COLUMN timestamp TYPE varchar USING CASE WHEN timestamp IS NULL THEN NULL ELSE to_char(timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') END,
  ALTER COLUMN deleted_at TYPE varchar USING CASE WHEN deleted_at IS NULL THEN NULL ELSE to_char(deleted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') END;

-- ----------------------------------------------------------------
-- 2) inventory_kinds: folderid -> SET NOT NULL, all ts -> varchar
-- ----------------------------------------------------------------
ALTER TABLE inventory_kinds
  ALTER COLUMN id TYPE varchar,
  ALTER COLUMN name TYPE varchar,
  ALTER COLUMN folderid TYPE varchar,
  ALTER COLUMN parentid TYPE varchar,
  ALTER COLUMN module TYPE varchar,
  ALTER COLUMN icon TYPE varchar,
  ALTER COLUMN displayimage TYPE varchar,
  ALTER COLUMN identifier TYPE varchar,
  ALTER COLUMN lastupdated TYPE varchar USING CASE WHEN lastupdated IS NULL THEN NULL ELSE to_char(lastupdated AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') END,
  ALTER COLUMN deleted_at TYPE varchar USING CASE WHEN deleted_at IS NULL THEN NULL ELSE to_char(deleted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') END;

ALTER TABLE inventory_kinds ALTER COLUMN folderid SET NOT NULL;

-- ----------------------------------------------------------------
-- 3) inventory_items: timestamptz/date -> varchar, numeric->real
-- ----------------------------------------------------------------
ALTER TABLE inventory_items
  ALTER COLUMN id TYPE varchar,
  ALTER COLUMN status TYPE varchar,
  ALTER COLUMN make TYPE varchar,
  ALTER COLUMN model TYPE varchar,
  ALTER COLUMN srno TYPE varchar,
  ALTER COLUMN serialno TYPE varchar,
  ALTER COLUMN type TYPE varchar,
  ALTER COLUMN category TYPE varchar,
  ALTER COLUMN parentid TYPE varchar,
  ALTER COLUMN folderid TYPE varchar,
  ALTER COLUMN kindid TYPE varchar,
  ALTER COLUMN lastupdated TYPE varchar USING CASE WHEN lastupdated IS NULL THEN NULL ELSE to_char(lastupdated AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') END,
  ALTER COLUMN currency TYPE varchar,
  ALTER COLUMN asset_value TYPE real USING asset_value::real,
  ALTER COLUMN quantity_total TYPE real USING quantity_total::real,
  ALTER COLUMN quantity_available TYPE real USING quantity_available::real,
  ALTER COLUMN conversion_factor TYPE real USING conversion_factor::real,
  ALTER COLUMN weight TYPE real USING weight::real,
  ALTER COLUMN zoho_product_id TYPE varchar,
  ALTER COLUMN catalog_uuid TYPE varchar,
  ALTER COLUMN deleted_at TYPE varchar USING CASE WHEN deleted_at IS NULL THEN NULL ELSE to_char(deleted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') END,
  ALTER COLUMN dispatchreceivedt TYPE varchar USING CASE WHEN dispatchreceivedt IS NULL THEN NULL ELSE to_char(dispatchreceivedt AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') END,
  ALTER COLUMN purpose TYPE varchar,
  ALTER COLUMN purchasedate TYPE varchar USING CASE WHEN purchasedate IS NULL THEN NULL ELSE to_char(purchasedate, 'YYYY-MM-DD') END,
  ALTER COLUMN quantity_unit TYPE varchar,
  ALTER COLUMN conversion_unit TYPE varchar,
  ALTER COLUMN conversion_mode TYPE varchar,
  ALTER COLUMN quantity_updated_at TYPE varchar USING CASE WHEN quantity_updated_at IS NULL THEN NULL ELSE to_char(quantity_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') END,
  ALTER COLUMN folderid SET NOT NULL,
  ALTER COLUMN kindid SET NOT NULL;

-- ----------------------------------------------------------------
-- 4) inventory_components: ts columns -> varchar
-- ----------------------------------------------------------------
ALTER TABLE inventory_components
  ALTER COLUMN id TYPE varchar,
  ALTER COLUMN parentid TYPE varchar,
  ALTER COLUMN status TYPE varchar,
  ALTER COLUMN make TYPE varchar,
  ALTER COLUMN model TYPE varchar,
  ALTER COLUMN srno TYPE varchar,
  ALTER COLUMN type TYPE varchar,
  ALTER COLUMN category TYPE varchar,
  ALTER COLUMN lastupdated TYPE varchar USING CASE WHEN lastupdated IS NULL THEN NULL ELSE to_char(lastupdated AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') END,
  ALTER COLUMN deleted_at TYPE varchar USING CASE WHEN deleted_at IS NULL THEN NULL ELSE to_char(deleted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') END;

-- ----------------------------------------------------------------
-- 5) inventory_quantity_events + lines: ts->varchar, meta_json text
-- ----------------------------------------------------------------
ALTER TABLE inventory_quantity_events
  ALTER COLUMN root_id TYPE varchar,
  ALTER COLUMN type TYPE varchar,
  ALTER COLUMN actor TYPE varchar,
  ALTER COLUMN timestamp TYPE varchar USING CASE WHEN timestamp IS NULL THEN NULL ELSE to_char(timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') END,
  ALTER COLUMN note TYPE varchar,
  ALTER COLUMN metadata_json TYPE text USING metadata_json::text;

ALTER TABLE inventory_quantity_event_lines
  ALTER COLUMN unit TYPE varchar,
  ALTER COLUMN delta_available TYPE real USING delta_available::real,
  ALTER COLUMN delta_total TYPE real USING delta_total::real;

-- ----------------------------------------------------------------
-- 6) Bootstrap + FK cleanup + indexes + named FKs (Block5D parity)
-- ----------------------------------------------------------------
INSERT INTO inventory_folders (id, name, parentid, icon, module, createdby, timestamp, is_deleted, deleted_at)
VALUES ('IF-INBOX', 'Inbox', NULL, '📥', 'INVENTORY', 'system', to_char(now(), 'YYYY-MM-DD HH24:MI:SS'), 0, NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO inventory_kinds (id, name, folderid, parentid, module, icon, displayimage, identifier, lastupdated, is_deleted, deleted_at)
VALUES ('IK-MISC', 'Misc', 'IF-INBOX', NULL, 'INVENTORY', '📦', NULL, NULL, to_char(now(), 'YYYY-MM-DD HH24:MI:SS'), 0, NULL)
ON CONFLICT (id) DO NOTHING;

UPDATE inventory_items SET folderid = NULL WHERE folderid = '';
UPDATE inventory_items SET kindid = NULL WHERE kindid = '';
UPDATE inventory_items SET parentid = NULL WHERE parentid = '';
UPDATE inventory_kinds SET folderid = NULL WHERE folderid = '';
UPDATE inventory_kinds SET parentid = NULL WHERE parentid = '';
UPDATE inventory_folders SET parentid = NULL WHERE parentid = '';

UPDATE inventory_kinds SET folderid = 'IF-INBOX' WHERE folderid IS NULL;
UPDATE inventory_items SET folderid = 'IF-INBOX' WHERE folderid IS NULL;
UPDATE inventory_items SET kindid   = 'IK-MISC'  WHERE kindid IS NULL;

DELETE FROM inventory_items i
WHERE i.folderid IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM inventory_folders f WHERE f.id = i.folderid);
DELETE FROM inventory_items i
WHERE i.kindid IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM inventory_kinds k WHERE k.id = i.kindid);
DELETE FROM inventory_kinds k
WHERE k.folderid IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM inventory_folders f WHERE f.id = k.folderid);

CREATE INDEX IF NOT EXISTS idx_inventory_folders_parentid              ON inventory_folders(parentid);
CREATE INDEX IF NOT EXISTS idx_inventory_kinds_folderid                ON inventory_kinds(folderid);
CREATE INDEX IF NOT EXISTS idx_inventory_kinds_parentid                ON inventory_kinds(parentid);
CREATE INDEX IF NOT EXISTS idx_inventory_items_parentid                ON inventory_items(parentid);
CREATE INDEX IF NOT EXISTS idx_inventory_items_folderid                ON inventory_items(folderid);
CREATE INDEX IF NOT EXISTS idx_inventory_items_kindid                  ON inventory_items(kindid);
CREATE INDEX IF NOT EXISTS idx_inventory_items_zoho_product_id         ON inventory_items(zoho_product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_quantity_events_root_id       ON inventory_quantity_events(root_id);
CREATE INDEX IF NOT EXISTS idx_inventory_quantity_event_lines_item_id  ON inventory_quantity_event_lines(item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_components_parentid           ON inventory_components(parentid);

ALTER TABLE inventory_folders DROP CONSTRAINT IF EXISTS inventory_folders_parentid_foreign;
ALTER TABLE inventory_kinds   DROP CONSTRAINT IF EXISTS inventory_kinds_folderid_foreign;
ALTER TABLE inventory_kinds   DROP CONSTRAINT IF EXISTS inventory_kinds_parentid_foreign;
ALTER TABLE inventory_items   DROP CONSTRAINT IF EXISTS inventory_items_parentid_foreign;
ALTER TABLE inventory_items   DROP CONSTRAINT IF EXISTS inventory_items_folderid_foreign;
ALTER TABLE inventory_items   DROP CONSTRAINT IF EXISTS inventory_items_kindid_foreign;
ALTER TABLE inventory_components DROP CONSTRAINT IF EXISTS inventory_components_parentid_foreign;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_inventory_folders_parentid_inventory_folders') THEN
    ALTER TABLE inventory_folders ADD CONSTRAINT fk_inventory_folders_parentid_inventory_folders
      FOREIGN KEY (parentid) REFERENCES inventory_folders(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_inventory_kinds_folderid_inventory_folders') THEN
    ALTER TABLE inventory_kinds ADD CONSTRAINT fk_inventory_kinds_folderid_inventory_folders
      FOREIGN KEY (folderid) REFERENCES inventory_folders(id) ON DELETE RESTRICT;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_inventory_kinds_parentid_inventory_kinds') THEN
    ALTER TABLE inventory_kinds ADD CONSTRAINT fk_inventory_kinds_parentid_inventory_kinds
      FOREIGN KEY (parentid) REFERENCES inventory_kinds(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_inventory_items_parentid_inventory_items') THEN
    ALTER TABLE inventory_items ADD CONSTRAINT fk_inventory_items_parentid_inventory_items
      FOREIGN KEY (parentid) REFERENCES inventory_items(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_inventory_items_folderid_inventory_folders') THEN
    ALTER TABLE inventory_items ADD CONSTRAINT fk_inventory_items_folderid_inventory_folders
      FOREIGN KEY (folderid) REFERENCES inventory_folders(id) ON DELETE RESTRICT;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_inventory_items_kindid_inventory_kinds') THEN
    ALTER TABLE inventory_items ADD CONSTRAINT fk_inventory_items_kindid_inventory_kinds
      FOREIGN KEY (kindid) REFERENCES inventory_kinds(id) ON DELETE RESTRICT;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_inventory_components_parentid_inventory_items') THEN
    ALTER TABLE inventory_components ADD CONSTRAINT fk_inventory_components_parentid_inventory_items
      FOREIGN KEY (parentid) REFERENCES inventory_items(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_inventory_quantity_events_rootid_inventory_items') THEN
    ALTER TABLE inventory_quantity_events ADD CONSTRAINT fk_inventory_quantity_events_rootid_inventory_items
      FOREIGN KEY (root_id) REFERENCES inventory_items(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_inventory_quantity_event_lines_itemid_inventory_items') THEN
    ALTER TABLE inventory_quantity_event_lines ADD CONSTRAINT fk_inventory_quantity_event_lines_itemid_inventory_items
      FOREIGN KEY (item_id) REFERENCES inventory_items(id) ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE inventory_kinds ALTER COLUMN folderid SET NOT NULL;
ALTER TABLE inventory_items ALTER COLUMN folderid SET NOT NULL;
ALTER TABLE inventory_items ALTER COLUMN kindid SET NOT NULL;

\echo '✅ BLOCK6A done: inventory schema repair / column-mismatch / varchar types / bootstrap / named FKs done.'
