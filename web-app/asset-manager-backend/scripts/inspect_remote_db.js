const { Client } = require('pg');

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = new Client({
    host: args.host,
    port: args.port ? Number(args.port) : 5432,
    database: args.database,
    user: args.user,
    password: args.password,
    ssl: args.ssl === 'true',
  });

  const queries = [
    ['companies', 'select * from companies order by id limit 20'],
    ['users_orphan_company', `
      select username, fullname, role, company_id, client_id
      from users u
      where company_id is not null
        and btrim(company_id) <> ''
        and not exists (select 1 from companies c where c.id = u.company_id)
      order by username
    `],
    ['asset_it_orphans', `
      select *
      from asset_it_details aid
      where not exists (select 1 from assets a where a.id = aid.assetid)
    `],
    ['asset_hierarchy_parent_orphans', `
      select id, parentid, assetid, position
      from asset_hierarchy h
      where parentid is not null
        and btrim(parentid) <> ''
        and not exists (select 1 from assets a where a.id = h.parentid)
      order by id
      limit 50
    `],
    ['layout_marker_orphans', `
      select *
      from layout_markers lm
      where assetid is not null
        and btrim(assetid) <> ''
        and not exists (select 1 from assets a where a.id = lm.assetid)
      order by id
      limit 50
    `],
    ['project_asset_orphans', `
      select *
      from project_assets pa
      where not exists (select 1 from projects p where p.id = pa.projectid)
         or not exists (select 1 from assets a where a.id = pa.assetid)
      order by projectid, assetid
      limit 50
    `],
    ['project_order_item_asset_orphans', `
      select *
      from project_order_items poi
      where assetid is not null
        and btrim(assetid) <> ''
        and not exists (select 1 from assets a where a.id = poi.assetid)
      order by id
      limit 50
    `],
    ['project_order_project_orphans', `
      select *
      from project_orders po
      where projectid is not null
        and btrim(projectid) <> ''
        and not exists (select 1 from projects p where p.id = po.projectid)
      order by id
      limit 50
    `],
    ['role_orphans', `
      select username, fullname, role, company_id
      from users u
      where role is not null
        and btrim(role) <> ''
        and not exists (select 1 from roles r where r.name = u.role)
      order by username
    `],
    ['roles', `
      select *
      from roles
      order by name
    `],
    ['audit_orphans', `
      select id, action, "user", assetid, severity, details, timestamp
      from audit_log al
      where assetid is not null
        and btrim(assetid) <> ''
        and not exists (select 1 from assets a where a.id = al.assetid)
      order by id
      limit 20
    `],
    ['constraints', `
      select conname, conrelid::regclass::text as table_name, pg_get_constraintdef(oid) as definition
      from pg_constraint
      where contype = 'f'
        and connamespace = 'public'::regnamespace
      order by conrelid::regclass::text, conname
    `],
    ['empty_string_fk_candidates', `
      select *
      from (
        select 'assets.parentid' as relation, count(*)::int as row_count from assets where parentid = ''
        union all
        select 'asset_hierarchy.parentid' as relation, count(*)::int as row_count from asset_hierarchy where parentid = ''
        union all
        select 'asset_hierarchy.assetid' as relation, count(*)::int as row_count from asset_hierarchy where assetid = ''
        union all
        select 'users.company_id' as relation, count(*)::int as row_count from users where company_id = ''
        union all
        select 'users.project_id' as relation, count(*)::int as row_count from users where project_id = ''
        union all
        select 'project_order_items.assetid' as relation, count(*)::int as row_count from project_order_items where assetid = ''
        union all
        select 'temporary_assets.projectid' as relation, count(*)::int as row_count from temporary_assets where projectid = ''
      ) s
      order by relation
    `],
    ['tables', `
      select tablename
      from pg_tables
      where schemaname = 'public'
      order by tablename
    `],
  ];

  try {
    await client.connect();
    for (const [name, sql] of queries) {
      const res = await client.query(sql);
      console.log(`\n--- ${name} ---`);
      console.log(JSON.stringify(res.rows, null, 2));
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
