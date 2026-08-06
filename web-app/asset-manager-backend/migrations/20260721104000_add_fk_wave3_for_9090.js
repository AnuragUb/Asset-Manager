/**
 * Wave 3 foreign keys for the 9090 test environment rollout.
 *
 * Cross-table links that are meaningful and data-clean in asset_manager_test:
 * - layout_markers.assetid -> assets.id
 * - project_order_items.assetid -> assets.id
 * - dc_item_mappings.assetid -> assets.id
 * - dc_item_mappings.dc_id -> delivery_challans.id
 * - users.company_id -> companies.id
 * - users.project_id -> projects.id
 * - users.role -> roles.name
 * - audit_log.assetid -> assets.id
 *
 * The quantity history asset link is intentionally excluded for now because its
 * delete behavior needs a deliberate decision: preserving history vs preventing
 * hard deletes of assets with quantity records.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_layout_markers_assetid
    ON layout_markers(assetid);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_project_order_items_assetid
    ON project_order_items(assetid);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_dc_item_mappings_assetid
    ON dc_item_mappings(assetid);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_users_company_id
    ON users(company_id);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_users_project_id
    ON users(project_id);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_users_role
    ON users(role);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_audit_log_assetid
    ON audit_log(assetid);
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_layout_markers_assetid_assets'
      ) THEN
        ALTER TABLE layout_markers
        ADD CONSTRAINT fk_layout_markers_assetid_assets
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
        WHERE conname = 'fk_project_order_items_assetid_assets'
      ) THEN
        ALTER TABLE project_order_items
        ADD CONSTRAINT fk_project_order_items_assetid_assets
        FOREIGN KEY (assetid) REFERENCES assets(id)
        ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_dc_item_mappings_assetid_assets'
      ) THEN
        ALTER TABLE dc_item_mappings
        ADD CONSTRAINT fk_dc_item_mappings_assetid_assets
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
        WHERE conname = 'fk_dc_item_mappings_dc_id_delivery_challans'
      ) THEN
        ALTER TABLE dc_item_mappings
        ADD CONSTRAINT fk_dc_item_mappings_dc_id_delivery_challans
        FOREIGN KEY (dc_id) REFERENCES delivery_challans(id)
        ON DELETE CASCADE;
      END IF;
    END $$;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_users_company_id_companies'
      ) THEN
        ALTER TABLE users
        ADD CONSTRAINT fk_users_company_id_companies
        FOREIGN KEY (company_id) REFERENCES companies(id)
        ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_users_project_id_projects'
      ) THEN
        ALTER TABLE users
        ADD CONSTRAINT fk_users_project_id_projects
        FOREIGN KEY (project_id) REFERENCES projects(id)
        ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_users_role_roles'
      ) THEN
        ALTER TABLE users
        ADD CONSTRAINT fk_users_role_roles
        FOREIGN KEY (role) REFERENCES roles(name);
      END IF;
    END $$;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_audit_log_assetid_assets'
      ) THEN
        ALTER TABLE audit_log
        ADD CONSTRAINT fk_audit_log_assetid_assets
        FOREIGN KEY (assetid) REFERENCES assets(id)
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
    ALTER TABLE audit_log
    DROP CONSTRAINT IF EXISTS fk_audit_log_assetid_assets;
  `);

  await knex.raw(`
    ALTER TABLE users
    DROP CONSTRAINT IF EXISTS fk_users_role_roles;
  `);

  await knex.raw(`
    ALTER TABLE users
    DROP CONSTRAINT IF EXISTS fk_users_project_id_projects;
  `);

  await knex.raw(`
    ALTER TABLE users
    DROP CONSTRAINT IF EXISTS fk_users_company_id_companies;
  `);

  await knex.raw(`
    ALTER TABLE dc_item_mappings
    DROP CONSTRAINT IF EXISTS fk_dc_item_mappings_dc_id_delivery_challans;
  `);

  await knex.raw(`
    ALTER TABLE dc_item_mappings
    DROP CONSTRAINT IF EXISTS fk_dc_item_mappings_assetid_assets;
  `);

  await knex.raw(`
    ALTER TABLE project_order_items
    DROP CONSTRAINT IF EXISTS fk_project_order_items_assetid_assets;
  `);

  await knex.raw(`
    ALTER TABLE layout_markers
    DROP CONSTRAINT IF EXISTS fk_layout_markers_assetid_assets;
  `);

  await knex.raw(`DROP INDEX IF EXISTS idx_audit_log_assetid;`);
  await knex.raw(`DROP INDEX IF EXISTS idx_users_role;`);
  await knex.raw(`DROP INDEX IF EXISTS idx_users_project_id;`);
  await knex.raw(`DROP INDEX IF EXISTS idx_users_company_id;`);
  await knex.raw(`DROP INDEX IF EXISTS idx_dc_item_mappings_assetid;`);
  await knex.raw(`DROP INDEX IF EXISTS idx_project_order_items_assetid;`);
  await knex.raw(`DROP INDEX IF EXISTS idx_layout_markers_assetid;`);
};
