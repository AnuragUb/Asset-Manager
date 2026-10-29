/**
 * RBAC V2 permission hardening (named migration).
 *
 * - Upserts canonical resource.view + action permission catalog
 * - Copies legacy view.* role grants → canonical *.view
 * - Stores manage.hierarchy for admin/superuser (no login injection required)
 * - Grants action permissions preserving current effective mutate access
 *   (superuser/admin/manager logistics; IT network; HR employees)
 * - Does NOT delete legacy view.* keys (deprecated in-app; dual-resolve via aliases)
 *
 * Apply ONLY against scratch first:
 *   DB_NAME=asset_manager_rbac_scratch npx knex migrate:up 20260923120000_rbac_v2_permission_hardening.js
 *
 * Do NOT run migrate:latest against production for this workstream.
 */

const {
  NEW_PERMISSIONS,
  VIEW_ALIASES,
  ROLE_ACTION_GRANTS
} = require('../services/permissionCatalog');

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('permissions'))) {
    throw new Error('STOP: permissions table missing');
  }
  if (!(await knex.schema.hasTable('role_permissions'))) {
    throw new Error('STOP: role_permissions table missing');
  }

  // Optional category column for catalog quality (non-breaking)
  if (!(await knex.schema.hasColumn('permissions', 'category'))) {
    await knex.schema.alterTable('permissions', (table) => {
      table.string('category', 32).nullable();
    });
  }

  for (const row of NEW_PERMISSIONS) {
    const existing = await knex('permissions').where({ key: row.key }).first();
    if (existing) {
      await knex('permissions').where({ key: row.key }).update({
        description: row.description,
        category: row.category
      });
    } else {
      await knex('permissions').insert({
        key: row.key,
        description: row.description,
        category: row.category
      });
    }
  }

  // Ensure legacy view.* rows still exist for dual-resolve during transition
  for (const [legacy, canon] of Object.entries(VIEW_ALIASES)) {
    const existing = await knex('permissions').where({ key: legacy }).first();
    if (!existing) {
      await knex('permissions').insert({
        key: legacy,
        description: `DEPRECATED alias → ${canon}`,
        category: 'deprecated'
      });
    } else {
      await knex('permissions').where({ key: legacy }).update({ category: 'deprecated' });
    }
  }

  const known = new Set((await knex('permissions').select('key')).map((r) => r.key));

  async function grant(roleName, permissionKey) {
    if (!known.has(permissionKey)) return;
    const role = await knex('roles').where({ name: roleName }).first();
    if (!role) return;
    await knex('role_permissions')
      .insert({ role_name: roleName, permission_key: permissionKey })
      .onConflict(['role_name', 'permission_key'])
      .ignore();
  }

  // Copy view.* → canonical *.view for every role that has the legacy grant
  for (const [legacy, canon] of Object.entries(VIEW_ALIASES)) {
    const holders = await knex('role_permissions')
      .where({ permission_key: legacy })
      .select('role_name');
    for (const row of holders) {
      await grant(row.role_name, canon);
    }
  }

  // Explicit manage.hierarchy for privileged roles (replaces login injection)
  await grant('superuser', 'manage.hierarchy');
  await grant('admin', 'manage.hierarchy');

  // Action grants by role matrix
  for (const [roleName, keys] of Object.entries(ROLE_ACTION_GRANTS)) {
    for (const key of keys) {
      await grant(roleName, key);
    }
  }
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('role_permissions'))) return;

  const newKeys = NEW_PERMISSIONS.map((p) => p.key);
  await knex('role_permissions').whereIn('permission_key', newKeys).del();

  // Remove newly inserted permission definitions (keep pre-existing asset.* etc.)
  const preexisting = new Set([
    'asset.create', 'asset.delete', 'asset.edit', 'asset.edit_price',
    'asset.search', 'asset.view', 'asset.view_price',
    'category.create', 'category.delete', 'logs.view', 'user.manage',
    'module.admin.access', 'module.assets.access', 'module.employees.access',
    'module.network.access', 'module.network_scanner.access', 'module.settings.access'
  ]);
  for (const row of NEW_PERMISSIONS) {
    if (preexisting.has(row.key)) continue;
    await knex('permissions').where({ key: row.key }).del();
  }
};
