/**
 * Five user teams for account creation: Logistics, Procurement, Sales, HR, IT.
 * Logistics has full operations + modules. Procurement can see Operations but not mutate it.
 *
 * Tables live in utility (not public). Named migrate only. Never migrate:latest.
 *
 *   npx knex migrate:up 20261015140000_user_team_roles.js --env production
 *
 * @param { import("knex").Knex } knex
 */

const {
  ROLE_ACTION_GRANTS
} = require('../services/permissionCatalog');

const UTILITY = 'utility';

const ROLE_ROWS = [
  { name: 'logistics', description: 'Logistics — all operations and business modules' },
  { name: 'procurement', description: 'Procurement — all modules; Operations is view-only' },
  { name: 'sales', description: 'Sales — see stock; cannot run warehouse operations' },
  { name: 'it', description: 'IT — Logistics plus Sales access' },
  { name: 'director', description: 'Director — all product access except RBAC / OAuth' }
];

const USER_REMAP = {
  user: 'sales',
  'Logistics Executive': 'logistics',
  manager: 'logistics',
  it_user: 'it'
};

function util(knex, table) {
  return knex.withSchema(UTILITY).table(table);
}

async function upsertRole(knex, name, description) {
  const existing = await util(knex, 'roles').where({ name }).first();
  if (existing) {
    await util(knex, 'roles').where({ name }).update({ description });
    return;
  }
  await util(knex, 'roles').insert({ name, description });
}

async function replaceGrants(knex, roleName, keys, known) {
  const unique = [...new Set(keys)].filter((key) => known.has(key));
  await util(knex, 'role_permissions').where({ role_name: roleName }).del();
  if (!unique.length) return;
  await util(knex, 'role_permissions').insert(unique.map((permission_key) => ({
    role_name: roleName,
    permission_key
  })));
}

exports.up = async function (knex) {
  for (const row of ROLE_ROWS) {
    await upsertRole(knex, row.name, row.description);
  }
  await util(knex, 'roles').where({ name: 'HR' }).update({ description: 'HR — people and user accounts' });
  await util(knex, 'roles').where({ name: 'logistics' }).update({ description: ROLE_ROWS[0].description });

  const known = new Set((await util(knex, 'permissions').select('key')).map((row) => row.key));
  const grantRoles = ['logistics', 'Logistics Executive', 'procurement', 'sales', 'user', 'it', 'it_user', 'HR', 'director'];
  for (const roleName of grantRoles) {
    const keys = ROLE_ACTION_GRANTS[roleName];
    if (!keys) continue;
    await replaceGrants(knex, roleName, keys, known);
  }

  for (const [from, to] of Object.entries(USER_REMAP)) {
    await util(knex, 'users').where({ role: from }).update({ role: to });
  }
};

exports.down = async function (knex) {
  await util(knex, 'users').where({ role: 'sales' }).update({ role: 'user' });
  await util(knex, 'users').where({ role: 'logistics' }).update({ role: 'manager' });
  await util(knex, 'users').where({ role: 'it' }).update({ role: 'it_user' });
};
