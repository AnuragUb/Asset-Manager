exports.up = async function(knex) {
  await knex.raw(`
    UPDATE folders
    SET parentid = NULL
    WHERE parentid = '';
  `);

  await knex.raw(`
    UPDATE assets
    SET parentid = NULL
    WHERE parentid = '';
  `);

  await knex.raw(`
    UPDATE asset_hierarchy
    SET parentid = NULL
    WHERE parentid = '';
  `);

  await knex.raw(`
    UPDATE asset_hierarchy
    SET assetid = NULL
    WHERE assetid = '';
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_folders_parentid
    ON folders(parentid);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_assets_parentid
    ON assets(parentid);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_asset_hierarchy_parentid
    ON asset_hierarchy(parentid);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_asset_hierarchy_assetid
    ON asset_hierarchy(assetid);
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_folders_parentid_folders'
      ) THEN
        ALTER TABLE folders
        ADD CONSTRAINT fk_folders_parentid_folders
        FOREIGN KEY (parentid) REFERENCES folders(id)
        ON DELETE NO ACTION;
      END IF;
    END $$;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_assets_parentid_assets'
      ) THEN
        ALTER TABLE assets
        ADD CONSTRAINT fk_assets_parentid_assets
        FOREIGN KEY (parentid) REFERENCES assets(id)
        ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_asset_hierarchy_parentid_assets'
      ) THEN
        ALTER TABLE asset_hierarchy
        ADD CONSTRAINT fk_asset_hierarchy_parentid_assets
        FOREIGN KEY (parentid) REFERENCES assets(id)
        ON DELETE CASCADE;
      END IF;
    END $$;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_asset_hierarchy_assetid_assets'
      ) THEN
        ALTER TABLE asset_hierarchy
        ADD CONSTRAINT fk_asset_hierarchy_assetid_assets
        FOREIGN KEY (assetid) REFERENCES assets(id)
        ON DELETE CASCADE;
      END IF;
    END $$;
  `);
};

exports.down = async function(knex) {
  await knex.raw(`
    ALTER TABLE asset_hierarchy
    DROP CONSTRAINT IF EXISTS fk_asset_hierarchy_assetid_assets;
  `);

  await knex.raw(`
    ALTER TABLE asset_hierarchy
    DROP CONSTRAINT IF EXISTS fk_asset_hierarchy_parentid_assets;
  `);

  await knex.raw(`
    ALTER TABLE assets
    DROP CONSTRAINT IF EXISTS fk_assets_parentid_assets;
  `);

  await knex.raw(`
    ALTER TABLE folders
    DROP CONSTRAINT IF EXISTS fk_folders_parentid_folders;
  `);

  await knex.raw(`
    DROP INDEX IF EXISTS idx_asset_hierarchy_assetid;
  `);

  await knex.raw(`
    DROP INDEX IF EXISTS idx_asset_hierarchy_parentid;
  `);

  await knex.raw(`
    DROP INDEX IF EXISTS idx_assets_parentid;
  `);

  await knex.raw(`
    DROP INDEX IF EXISTS idx_folders_parentid;
  `);
};

