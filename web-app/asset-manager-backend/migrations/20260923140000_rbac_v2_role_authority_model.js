/**
 * RBAC V2 Phase 19 — canonical role authority reconciliation.
 *
 * Applies ROLE_ACTION_GRANTS + ROLE_REVOKE_KEYS from permissionCatalog.js.
 * Idempotent grant/revoke. Does not create Accounts roles.
 *
 * Scratch only first:
 *   DB_NAME=asset_manager_rbac_scratch npx knex migrate:up 20260923140000_rbac_v2_role_authority_model.js
 *
 * Do NOT use migrate:latest against production for this workstream.
 */

const {
  NEW_PERMISSIONS,
  ROLE_ACTION_GRANTS,
  ROLE_REVOKE_KEYS,
  VIEW_ALIASES
} = require('../services/permissionCatalog');

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('permissions'))) {
    throw new Error('STOP: permissions table missing');
  }
  if (!(await knex.schema.hasTable('role_permissions'))) {
    throw new Error('STOP: role_permissions table missing');
  }

  // Ensure catalog rows exist (safe if hardening migration already ran)
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

  for (const [legacy, canon] of Object.entries(VIEW_ALIASES)) {
    const existing = await knex('permissions').where({ key: legacy }).first();
    if (!existing) {
      await knex('permissions').insert({
        key: legacy,
        description: `DEPRECATED alias → ${canon}`,
        category: 'deprecated'
      });
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

  async function revoke(roleName, permissionKey) {
    await knex('role_permissions')
      .where({ role_name: roleName, permission_key: permissionKey })
      .del();
  }

  // Grant canonical matrix
  for (const [roleName, keys] of Object.entries(ROLE_ACTION_GRANTS)) {
    for (const key of keys) {
      await grant(roleName, key);
    }
  }

  // Explicit hierarchy storage (admin + superuser)
  await grant('superuser', 'manage.hierarchy');
  await grant('admin', 'manage.hierarchy');
  await grant('superuser', 'category.delete');

  // Revoke disallowed keys (least privilege / segregation)
  for (const [roleName, keys] of Object.entries(ROLE_REVOKE_KEYS)) {
    for (const key of keys) {
      await revoke(roleName, key);
    }
  }

  // Ensure admin does not retain category.delete even if present in older grant sets
  await revoke('admin', 'category.delete');
};

exports.down = async function down(knex) {
  // Non-destructive down: do not re-escalate. Operators should restore from snapshot CSV.
  if (!(await knex.schema.hasTable('role_permissions'))) return;
  // Revoke only Logistics Executive action grants added by this phase
  const logisticsActions = [
    'purchase_order.refresh',
    'purchase_book.create', 'purchase_book.edit',
    'receipt_note.create', 'receipt_note.edit', 'receipt_note.post',
    'reservation.create', 'reservation.release',
    'dc.create', 'dc.remarks'
  ];
  await knex('role_permissions')
    .where({ role_name: 'Logistics Executive' })
    .whereIn('permission_key', logisticsActions)
    .del();
};
