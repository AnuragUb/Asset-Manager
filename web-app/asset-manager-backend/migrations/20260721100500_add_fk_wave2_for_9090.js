/**
 * Wave 2 foreign keys for the 9090 test environment rollout.
 *
 * Project-centric relationships:
 * - project_history.projectid -> projects.id
 * - project_orders.projectid -> projects.id
 * - project_assets.projectid -> projects.id
 * - project_assets.assetid -> assets.id
 * - temporary_assets.projectid -> projects.id
 *
 * Supporting indexes are added on referencing columns used by joins/lookups.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_project_history_projectid
    ON project_history(projectid);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_project_orders_projectid
    ON project_orders(projectid);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_project_assets_assetid
    ON project_assets(assetid);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_temporary_assets_projectid
    ON temporary_assets(projectid);
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_project_history_projectid_projects'
      ) THEN
        ALTER TABLE project_history
        ADD CONSTRAINT fk_project_history_projectid_projects
        FOREIGN KEY (projectid) REFERENCES projects(id)
        ON DELETE CASCADE;
      END IF;
    END $$;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_project_orders_projectid_projects'
      ) THEN
        ALTER TABLE project_orders
        ADD CONSTRAINT fk_project_orders_projectid_projects
        FOREIGN KEY (projectid) REFERENCES projects(id)
        ON DELETE CASCADE;
      END IF;
    END $$;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_project_assets_projectid_projects'
      ) THEN
        ALTER TABLE project_assets
        ADD CONSTRAINT fk_project_assets_projectid_projects
        FOREIGN KEY (projectid) REFERENCES projects(id)
        ON DELETE CASCADE;
      END IF;
    END $$;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_project_assets_assetid_assets'
      ) THEN
        ALTER TABLE project_assets
        ADD CONSTRAINT fk_project_assets_assetid_assets
        FOREIGN KEY (assetid) REFERENCES assets(id)
        ON DELETE CASCADE;
      END IF;
    END $$;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_temporary_assets_projectid_projects'
      ) THEN
        ALTER TABLE temporary_assets
        ADD CONSTRAINT fk_temporary_assets_projectid_projects
        FOREIGN KEY (projectid) REFERENCES projects(id)
        ON DELETE SET NULL;
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
    ALTER TABLE temporary_assets
    DROP CONSTRAINT IF EXISTS fk_temporary_assets_projectid_projects;
  `);

  await knex.raw(`
    ALTER TABLE project_assets
    DROP CONSTRAINT IF EXISTS fk_project_assets_assetid_assets;
  `);

  await knex.raw(`
    ALTER TABLE project_assets
    DROP CONSTRAINT IF EXISTS fk_project_assets_projectid_projects;
  `);

  await knex.raw(`
    ALTER TABLE project_orders
    DROP CONSTRAINT IF EXISTS fk_project_orders_projectid_projects;
  `);

  await knex.raw(`
    ALTER TABLE project_history
    DROP CONSTRAINT IF EXISTS fk_project_history_projectid_projects;
  `);

  await knex.raw(`
    DROP INDEX IF EXISTS idx_temporary_assets_projectid;
  `);

  await knex.raw(`
    DROP INDEX IF EXISTS idx_project_assets_assetid;
  `);

  await knex.raw(`
    DROP INDEX IF EXISTS idx_project_orders_projectid;
  `);

  await knex.raw(`
    DROP INDEX IF EXISTS idx_project_history_projectid;
  `);
};
