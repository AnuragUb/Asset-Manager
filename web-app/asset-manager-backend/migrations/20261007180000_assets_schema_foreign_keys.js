/**
 * Point asset foreign keys at assets.assets.
 * public.assets becomes a view over that table so existing unqualified
 * queries keep reading and writing the same rows.
 * public.assets_retired keeps the pre-cutover table as a frozen snapshot.
 *
 * Apply with named migrate only. Never migrate:latest.
 *
 * @param { import("knex").Knex } knex
 */

async function columnNames(knex, schema) {
  const rows = await knex('information_schema.columns')
    .where({ table_schema: schema, table_name: 'assets' })
    .orderBy('ordinal_position')
    .pluck('column_name');
  return rows;
}

async function assertCopiesMatch(knex) {
  const pub = (await columnNames(knex, 'public')).slice().sort();
  const copy = (await columnNames(knex, 'assets')).slice().sort();
  if (pub.join(',') !== copy.join(',')) {
    throw new Error('STOP: public.assets and assets.assets columns differ');
  }
  const onlyPublic = await knex.raw(`
    SELECT count(*)::int AS n FROM public.assets p
    WHERE NOT EXISTS (SELECT 1 FROM assets.assets a WHERE a.id = p.id)
  `);
  const onlyCopy = await knex.raw(`
    SELECT count(*)::int AS n FROM assets.assets a
    WHERE NOT EXISTS (SELECT 1 FROM public.assets p WHERE p.id = a.id)
  `);
  if (onlyPublic.rows[0].n || onlyCopy.rows[0].n) {
    throw new Error('STOP: asset ids are not the same in both tables');
  }
  const distinct = pub.map((name) => `p."${name}" IS DISTINCT FROM a."${name}"`).join(' OR ');
  const diff = await knex.raw(`
    SELECT count(*)::int AS n
    FROM public.assets p
    JOIN assets.assets a ON a.id = p.id
    WHERE ${distinct}
  `);
  if (diff.rows[0].n) {
    throw new Error(`STOP: ${diff.rows[0].n} asset rows differ`);
  }
}

const CHILD_FKS = [
  ['asset_hierarchy', 'fk_asset_hierarchy_parentid_assets', 'parentid', 'ON DELETE CASCADE'],
  ['asset_hierarchy', 'fk_asset_hierarchy_assetid_assets', 'assetid', 'ON DELETE CASCADE'],
  ['asset_it_details', 'fk_asset_it_details_assetid_assets', 'assetid', 'ON DELETE CASCADE'],
  ['components', 'fk_components_parentid_assets', 'parentid', 'ON DELETE CASCADE'],
  ['dc_item_mappings', 'fk_dc_item_mappings_assetid_assets', 'assetid', 'ON DELETE CASCADE'],
  ['managed_set_components', 'fk_managed_set_components_asset_id', 'asset_id', 'ON DELETE RESTRICT'],
  ['project_assets', 'fk_project_assets_assetid_assets', 'assetid', 'ON DELETE CASCADE'],
  ['project_order_items', 'fk_project_order_items_assetid_assets', 'assetid', 'ON DELETE SET NULL']
];

exports.up = async function (knex) {
  const retired = await knex.schema.hasTable('assets_retired');
  const assetsIsView = await knex.raw(`
    SELECT c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'assets'
  `);
  if (retired || (assetsIsView.rows[0] && assetsIsView.rows[0].relkind === 'v')) {
    return;
  }
  await assertCopiesMatch(knex);

  await knex.raw('ALTER TABLE public.assets DROP CONSTRAINT IF EXISTS fk_assets_parentid_assets');
  await knex.raw('ALTER TABLE public.assets DROP CONSTRAINT IF EXISTS fk_assets_quantity_parent_id');
  await knex.raw('ALTER TABLE public.assets DROP CONSTRAINT IF EXISTS fk_assets_quantity_root_id');
  for (const [table, name] of CHILD_FKS) {
    await knex.raw(`ALTER TABLE public.${table} DROP CONSTRAINT IF EXISTS ${name}`);
  }

  await knex.raw('ALTER TABLE public.assets RENAME TO assets_retired');
  await knex.raw('DROP TRIGGER IF EXISTS trg_check_assets_dup ON public.assets_retired');
  await knex.raw('CREATE VIEW public.assets AS SELECT * FROM assets.assets');
  await knex.raw(`
    CREATE TRIGGER trg_check_assets_dup
    BEFORE INSERT OR UPDATE OF id ON assets.assets
    FOR EACH ROW EXECUTE FUNCTION check_cross_table_id_duplication()
  `);

  await knex.raw(`
    ALTER TABLE assets.assets
      ADD CONSTRAINT fk_assets_parentid_assets
      FOREIGN KEY (parentid) REFERENCES assets.assets(id) ON DELETE SET NULL
  `);
  await knex.raw(`
    ALTER TABLE assets.assets
      ADD CONSTRAINT fk_assets_quantity_parent_id
      FOREIGN KEY (quantity_parent_id) REFERENCES assets.assets(id) ON DELETE RESTRICT
  `);
  await knex.raw(`
    ALTER TABLE assets.assets
      ADD CONSTRAINT fk_assets_quantity_root_id
      FOREIGN KEY (quantity_root_id) REFERENCES assets.assets(id) ON DELETE RESTRICT
  `);
  for (const [table, name, column, action] of CHILD_FKS) {
    await knex.raw(`
      ALTER TABLE public.${table}
        ADD CONSTRAINT ${name}
        FOREIGN KEY (${column}) REFERENCES assets.assets(id) ${action}
    `);
  }
};

exports.down = async function (knex) {
  const kind = await knex.raw(`
    SELECT c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'assets'
  `);
  if (!kind.rows[0] || kind.rows[0].relkind !== 'v') return;
  const drifted = await knex.raw(`
    SELECT count(*)::int AS n FROM assets.assets a
    WHERE NOT EXISTS (SELECT 1 FROM public.assets_retired r WHERE r.id = a.id)
  `);
  if (drifted.rows[0].n) {
    throw new Error('STOP: assets.assets has rows that are not in assets_retired');
  }

  await knex.raw('ALTER TABLE assets.assets DROP CONSTRAINT IF EXISTS fk_assets_parentid_assets');
  await knex.raw('ALTER TABLE assets.assets DROP CONSTRAINT IF EXISTS fk_assets_quantity_parent_id');
  await knex.raw('ALTER TABLE assets.assets DROP CONSTRAINT IF EXISTS fk_assets_quantity_root_id');
  for (const [table, name] of CHILD_FKS) {
    await knex.raw(`ALTER TABLE public.${table} DROP CONSTRAINT IF EXISTS ${name}`);
  }
  await knex.raw('DROP TRIGGER IF EXISTS trg_check_assets_dup ON assets.assets');
  await knex.raw('DROP VIEW public.assets');
  await knex.raw('ALTER TABLE public.assets_retired RENAME TO assets');
  await knex.raw(`
    CREATE TRIGGER trg_check_assets_dup
    BEFORE INSERT OR UPDATE OF id ON public.assets
    FOR EACH ROW EXECUTE FUNCTION check_cross_table_id_duplication()
  `);
  await knex.raw(`
    ALTER TABLE public.assets
      ADD CONSTRAINT fk_assets_parentid_assets
      FOREIGN KEY (parentid) REFERENCES public.assets(id) ON DELETE SET NULL
  `);
  await knex.raw(`
    ALTER TABLE public.assets
      ADD CONSTRAINT fk_assets_quantity_parent_id
      FOREIGN KEY (quantity_parent_id) REFERENCES public.assets(id) ON DELETE RESTRICT
  `);
  await knex.raw(`
    ALTER TABLE public.assets
      ADD CONSTRAINT fk_assets_quantity_root_id
      FOREIGN KEY (quantity_root_id) REFERENCES public.assets(id) ON DELETE RESTRICT
  `);
  for (const [table, name, column, action] of CHILD_FKS) {
    await knex.raw(`
      ALTER TABLE public.${table}
        ADD CONSTRAINT ${name}
        FOREIGN KEY (${column}) REFERENCES public.assets(id) ${action}
    `);
  }
};
