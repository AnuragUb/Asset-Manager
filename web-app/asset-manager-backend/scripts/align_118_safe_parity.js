const { Client } = require('pg');

async function main() {
  const client = new Client({
    host: '192.168.6.118',
    port: 5432,
    database: 'asset_manager',
    user: 'postgres',
    password: 'password',
    ssl: false,
  });

  try {
    await client.connect();
    await client.query('BEGIN');

    await client.query(`
      INSERT INTO companies (id, name, created_at)
      VALUES ($1, $2, NOW()::text)
      ON CONFLICT (id) DO NOTHING
    `, ['25451fa6-82a7-414b-9b40-341bcd1b7286', 'CINEOM']);

    await client.query(`
      DELETE FROM asset_it_details
      WHERE assetid = $1
        AND NOT EXISTS (
          SELECT 1 FROM assets a WHERE a.id = asset_it_details.assetid
        )
    `, ['APP-MUM-0526-TADSNN-9']);

    await client.query(`
      UPDATE assets
      SET parentid = NULL
      WHERE parentid = ''
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_asset_it_details_assetid ON asset_it_details(assetid)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_project_order_items_orderid ON project_order_items(orderid)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_assets_linked_po_item_id ON assets(linked_po_item_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_temporary_assets_linked_po_item_id ON temporary_assets(linked_po_item_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_components_parentid ON components(parentid)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_project_history_projectid ON project_history(projectid)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_project_orders_projectid ON project_orders(projectid)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_project_assets_assetid ON project_assets(assetid)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_temporary_assets_projectid ON temporary_assets(projectid)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_project_order_items_assetid ON project_order_items(assetid)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_dc_item_mappings_assetid ON dc_item_mappings(assetid)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_project_id ON users(project_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_folders_parentid ON folders(parentid)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_assets_parentid ON assets(parentid)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_asset_hierarchy_parentid ON asset_hierarchy(parentid)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_asset_hierarchy_assetid ON asset_hierarchy(assetid)`);

    const statements = [
      {
        name: 'fk_asset_it_details_assetid_assets',
        sql: `ALTER TABLE asset_it_details ADD CONSTRAINT fk_asset_it_details_assetid_assets FOREIGN KEY (assetid) REFERENCES assets(id) ON DELETE CASCADE`,
      },
      {
        name: 'fk_project_order_items_orderid_project_orders',
        sql: `ALTER TABLE project_order_items ADD CONSTRAINT fk_project_order_items_orderid_project_orders FOREIGN KEY (orderid) REFERENCES project_orders(id) ON DELETE CASCADE`,
      },
      {
        name: 'fk_assets_linked_po_item_id_project_order_items',
        sql: `ALTER TABLE assets ADD CONSTRAINT fk_assets_linked_po_item_id_project_order_items FOREIGN KEY (linked_po_item_id) REFERENCES project_order_items(id) ON DELETE SET NULL`,
      },
      {
        name: 'fk_temporary_assets_linked_po_item_id_project_order_items',
        sql: `ALTER TABLE temporary_assets ADD CONSTRAINT fk_temporary_assets_linked_po_item_id_project_order_items FOREIGN KEY (linked_po_item_id) REFERENCES project_order_items(id) ON DELETE SET NULL`,
      },
      {
        name: 'fk_components_parentid_assets',
        sql: `ALTER TABLE components ADD CONSTRAINT fk_components_parentid_assets FOREIGN KEY (parentid) REFERENCES assets(id) ON DELETE CASCADE`,
      },
      {
        name: 'fk_project_history_projectid_projects',
        sql: `ALTER TABLE project_history ADD CONSTRAINT fk_project_history_projectid_projects FOREIGN KEY (projectid) REFERENCES projects(id) ON DELETE CASCADE`,
      },
      {
        name: 'fk_project_orders_projectid_projects',
        sql: `ALTER TABLE project_orders ADD CONSTRAINT fk_project_orders_projectid_projects FOREIGN KEY (projectid) REFERENCES projects(id) ON DELETE CASCADE`,
      },
      {
        name: 'fk_project_assets_projectid_projects',
        sql: `ALTER TABLE project_assets ADD CONSTRAINT fk_project_assets_projectid_projects FOREIGN KEY (projectid) REFERENCES projects(id) ON DELETE CASCADE`,
      },
      {
        name: 'fk_project_assets_assetid_assets',
        sql: `ALTER TABLE project_assets ADD CONSTRAINT fk_project_assets_assetid_assets FOREIGN KEY (assetid) REFERENCES assets(id) ON DELETE CASCADE`,
      },
      {
        name: 'fk_temporary_assets_projectid_projects',
        sql: `ALTER TABLE temporary_assets ADD CONSTRAINT fk_temporary_assets_projectid_projects FOREIGN KEY (projectid) REFERENCES projects(id) ON DELETE SET NULL`,
      },
      {
        name: 'fk_project_order_items_assetid_assets',
        sql: `ALTER TABLE project_order_items ADD CONSTRAINT fk_project_order_items_assetid_assets FOREIGN KEY (assetid) REFERENCES assets(id) ON DELETE SET NULL`,
      },
      {
        name: 'fk_dc_item_mappings_assetid_assets',
        sql: `ALTER TABLE dc_item_mappings ADD CONSTRAINT fk_dc_item_mappings_assetid_assets FOREIGN KEY (assetid) REFERENCES assets(id) ON DELETE CASCADE`,
      },
      {
        name: 'fk_dc_item_mappings_dc_id_delivery_challans',
        sql: `ALTER TABLE dc_item_mappings ADD CONSTRAINT fk_dc_item_mappings_dc_id_delivery_challans FOREIGN KEY (dc_id) REFERENCES delivery_challans(id) ON DELETE CASCADE`,
      },
      {
        name: 'fk_users_company_id_companies',
        sql: `ALTER TABLE users ADD CONSTRAINT fk_users_company_id_companies FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL`,
      },
      {
        name: 'fk_users_project_id_projects',
        sql: `ALTER TABLE users ADD CONSTRAINT fk_users_project_id_projects FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL`,
      },
      {
        name: 'fk_users_role_roles',
        sql: `ALTER TABLE users ADD CONSTRAINT fk_users_role_roles FOREIGN KEY (role) REFERENCES roles(name)`,
      },
      {
        name: 'fk_folders_parentid_folders',
        sql: `ALTER TABLE folders ADD CONSTRAINT fk_folders_parentid_folders FOREIGN KEY (parentid) REFERENCES folders(id) ON DELETE NO ACTION`,
      },
      {
        name: 'fk_assets_parentid_assets',
        sql: `ALTER TABLE assets ADD CONSTRAINT fk_assets_parentid_assets FOREIGN KEY (parentid) REFERENCES assets(id) ON DELETE SET NULL`,
      },
      {
        name: 'fk_asset_hierarchy_parentid_assets',
        sql: `ALTER TABLE asset_hierarchy ADD CONSTRAINT fk_asset_hierarchy_parentid_assets FOREIGN KEY (parentid) REFERENCES assets(id) ON DELETE CASCADE`,
      },
      {
        name: 'fk_asset_hierarchy_assetid_assets',
        sql: `ALTER TABLE asset_hierarchy ADD CONSTRAINT fk_asset_hierarchy_assetid_assets FOREIGN KEY (assetid) REFERENCES assets(id) ON DELETE CASCADE`,
      },
    ];

    for (const statement of statements) {
      const exists = await client.query(`
        SELECT 1
        FROM pg_constraint
        WHERE conname = $1
      `, [statement.name]);

      if (exists.rowCount === 0) {
        await client.query(statement.sql);
      }
    }

    await client.query('COMMIT');
    console.log('118 safe parity alignment completed.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('118 safe parity alignment failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
