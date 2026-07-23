const knex = require('knex');
const knexConfig = require('../knexfile');

const checks = [
  { childTable: 'asset_hierarchy', childColumn: 'assetid', parentTable: 'assets', parentColumn: 'id' },
  { childTable: 'asset_hierarchy', childColumn: 'parentid', parentTable: 'assets', parentColumn: 'id' },
  { childTable: 'asset_it_details', childColumn: 'assetid', parentTable: 'assets', parentColumn: 'id' },
  { childTable: 'assets', childColumn: 'linked_po_item_id', parentTable: 'project_order_items', parentColumn: 'id' },
  { childTable: 'assets', childColumn: 'parentid', parentTable: 'assets', parentColumn: 'id' },
  { childTable: 'audit_log', childColumn: 'assetid', parentTable: 'assets', parentColumn: 'id' },
  { childTable: 'auth_tokens', childColumn: 'user_id', parentTable: 'users', parentColumn: 'username' },
  { childTable: 'components', childColumn: 'parentid', parentTable: 'assets', parentColumn: 'id' },
  { childTable: 'dc_item_mappings', childColumn: 'assetid', parentTable: 'assets', parentColumn: 'id' },
  { childTable: 'dc_item_mappings', childColumn: 'dc_id', parentTable: 'delivery_challans', parentColumn: 'id' },
  { childTable: 'folders', childColumn: 'parentid', parentTable: 'folders', parentColumn: 'id' },
  { childTable: 'layout_markers', childColumn: 'assetid', parentTable: 'assets', parentColumn: 'id' },
  { childTable: 'layout_markers', childColumn: 'layoutid', parentTable: 'layouts', parentColumn: 'id' },
  { childTable: 'project_assets', childColumn: 'assetid', parentTable: 'assets', parentColumn: 'id' },
  { childTable: 'project_assets', childColumn: 'projectid', parentTable: 'projects', parentColumn: 'id' },
  { childTable: 'project_history', childColumn: 'projectid', parentTable: 'projects', parentColumn: 'id' },
  { childTable: 'project_order_items', childColumn: 'assetid', parentTable: 'assets', parentColumn: 'id' },
  { childTable: 'project_order_items', childColumn: 'orderid', parentTable: 'project_orders', parentColumn: 'id' },
  { childTable: 'project_orders', childColumn: 'projectid', parentTable: 'projects', parentColumn: 'id' },
  { childTable: 'quantity_event_lines', childColumn: 'event_id', parentTable: 'quantity_events', parentColumn: 'id' },
  { childTable: 'role_permissions', childColumn: 'permission_key', parentTable: 'permissions', parentColumn: 'key' },
  { childTable: 'role_permissions', childColumn: 'role_name', parentTable: 'roles', parentColumn: 'name' },
  { childTable: 'temporary_assets', childColumn: 'linked_po_item_id', parentTable: 'project_order_items', parentColumn: 'id' },
  { childTable: 'temporary_assets', childColumn: 'projectid', parentTable: 'projects', parentColumn: 'id' },
  { childTable: 'users', childColumn: 'company_id', parentTable: 'companies', parentColumn: 'id' },
  { childTable: 'users', childColumn: 'project_id', parentTable: 'projects', parentColumn: 'id' },
  { childTable: 'users', childColumn: 'role', parentTable: 'roles', parentColumn: 'name' },
];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = 'true';
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function q(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

function relationName(check) {
  return `${check.childTable}.${check.childColumn} -> ${check.parentTable}.${check.parentColumn}`;
}

async function columnExists(db, tableName, columnName) {
  const result = await db('information_schema.columns')
    .where({
      table_schema: 'public',
      table_name: tableName,
      column_name: columnName,
    })
    .first();
  return Boolean(result);
}

async function runCheck(db, check) {
  const childTableExists = await db.schema.hasTable(check.childTable);
  const parentTableExists = await db.schema.hasTable(check.parentTable);
  const childColumnExists = childTableExists && await columnExists(db, check.childTable, check.childColumn);
  const parentColumnExists = parentTableExists && await columnExists(db, check.parentTable, check.parentColumn);

  if (!childTableExists || !parentTableExists || !childColumnExists || !parentColumnExists) {
    return {
      relation: relationName(check),
      status: 'SKIP',
      orphanCount: null,
      samples: [],
      reason: 'table/column missing in this database',
    };
  }

  const childTable = q(check.childTable);
  const childColumn = q(check.childColumn);
  const parentTable = q(check.parentTable);
  const parentColumn = q(check.parentColumn);

  const basePredicate = `
    c.${childColumn} IS NOT NULL
    AND BTRIM(c.${childColumn}::text) <> ''
    AND NOT EXISTS (
      SELECT 1
      FROM ${parentTable} p
      WHERE p.${parentColumn} = c.${childColumn}
    )
  `;

  const countQuery = `
    SELECT COUNT(*)::int AS orphan_count
    FROM ${childTable} c
    WHERE ${basePredicate}
  `;

  const sampleQuery = `
    SELECT DISTINCT c.${childColumn}::text AS value
    FROM ${childTable} c
    WHERE ${basePredicate}
    ORDER BY 1
    LIMIT 5
  `;

  const countResult = await db.raw(countQuery);
  const samplesResult = await db.raw(sampleQuery);
  const orphanCount = countResult.rows[0].orphan_count;

  return {
    relation: relationName(check),
    status: orphanCount === 0 ? 'OK' : 'BROKEN',
    orphanCount,
    samples: samplesResult.rows.map((row) => row.value),
    reason: null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const envName = args.env || (process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'test');
  let config = knexConfig[envName];

  if (args.host || args.database || args.user || args.password || args.port) {
    config = {
      client: 'postgresql',
      connection: {
        host: args.host || 'localhost',
        port: args.port ? Number(args.port) : 5432,
        database: args.database || 'postgres',
        user: args.user || 'postgres',
        password: args.password || '',
        ssl: args.ssl === 'true',
      },
    };
  }

  if (!config) {
    console.error(`Unknown knex environment: ${envName}`);
    process.exit(1);
  }

  const db = knex(config);

  try {
    const results = [];
    for (const check of checks) {
      results.push(await runCheck(db, check));
    }

    const broken = results.filter((item) => item.status === 'BROKEN');
    const skipped = results.filter((item) => item.status === 'SKIP');

    console.log(`FK preflight audit target: ${args.host ? 'direct connection' : `knex env ${envName}`}`);
    console.log(`Database target: ${config.connection.database}`);
    console.log(`Host target: ${config.connection.host || 'n/a'}`);
    console.log('');

    for (const item of results) {
      const orphanText = item.orphanCount === null ? 'n/a' : String(item.orphanCount);
      console.log(`[${item.status}] ${item.relation} | orphans=${orphanText}`);
      if (item.samples.length > 0) {
        console.log(`       samples: ${item.samples.join(', ')}`);
      }
      if (item.reason) {
        console.log(`       note: ${item.reason}`);
      }
    }

    console.log('');
    console.log(`Summary: ${results.length} checked | ${broken.length} broken | ${skipped.length} skipped`);

    if (broken.length > 0) {
      process.exitCode = 2;
    }
  } catch (error) {
    console.error('FK preflight audit failed:', error);
    process.exitCode = 1;
  } finally {
    await db.destroy();
  }
}

main();
