/**
 * Seed default page-visibility (view.*) grants by role.
 *
 * Prior state: view.* keys existed but no role had any grants, so only
 * superuser/admin UI bypass showed pages. Non-bypass roles landed blank.
 * Admin also needs explicit view.* for APIs (backend bypasses superuser only).
 *
 * Idempotent: onConflict ignore. Does not remove existing non-view grants.
 *
 * @param { import("knex").Knex } knex
 */
const ALL_VIEWS = [
  'view.dashboard',
  'view.products',
  'view.inventory',
  'view.assets',
  'view.history',
  'view.reservations',
  'view.purchase_orders',
  'view.purchase_books',
  'view.receipt_notes',
  'view.sets',
  'view.projects',
  'view.dc',
  'view.warranty',
  'view.settings',
  'view.recovery',
  'view.scanner',
  'view.physical_intake',
  'view.admin',
  'view.releases'
];

const LOGISTICS_VIEWS = [
  'view.dashboard',
  'view.products',
  'view.history',
  'view.reservations',
  'view.purchase_orders',
  'view.purchase_books',
  'view.receipt_notes',
  'view.dc'
];

const ROLE_VIEW_GRANTS = {
  superuser: ALL_VIEWS,
  admin: ALL_VIEWS,
  manager: [
    ...LOGISTICS_VIEWS,
    'view.assets',
    'view.inventory',
    'view.sets',
    'view.projects',
    'view.warranty',
    'view.physical_intake',
    'view.releases'
  ],
  'Logistics Executive': LOGISTICS_VIEWS,
  user: [
    'view.dashboard',
    'view.assets',
    'view.inventory',
    'view.sets',
    'view.projects',
    'view.warranty'
  ],
  it_manager: [
    'view.assets',
    'view.inventory',
    'view.scanner',
    'view.settings',
    'view.recovery',
    'view.admin',
    'view.releases'
  ],
  it_user: [
    'view.assets',
    'view.inventory',
    'view.scanner'
  ],
  client: ['view.assets'],
  HR: ['view.settings']
};

/** HR also needs Employees nav (gated by user.manage, not view.*). */
const ROLE_EXTRA_GRANTS = {
  HR: ['user.manage']
};

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('role_permissions'))) return;
  if (!(await knex.schema.hasTable('permissions'))) return;

  const known = new Set(
    (await knex('permissions').select('key')).map((r) => r.key)
  );

  for (const [roleName, keys] of Object.entries(ROLE_VIEW_GRANTS)) {
    const role = await knex('roles').where({ name: roleName }).first();
    if (!role) continue;
    for (const key of keys) {
      if (!known.has(key)) continue;
      await knex('role_permissions')
        .insert({ role_name: roleName, permission_key: key })
        .onConflict(['role_name', 'permission_key'])
        .ignore();
    }
  }

  for (const [roleName, keys] of Object.entries(ROLE_EXTRA_GRANTS)) {
    const role = await knex('roles').where({ name: roleName }).first();
    if (!role) continue;
    for (const key of keys) {
      if (!known.has(key)) continue;
      await knex('role_permissions')
        .insert({ role_name: roleName, permission_key: key })
        .onConflict(['role_name', 'permission_key'])
        .ignore();
    }
  }
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('role_permissions'))) return;
  const roles = Object.keys(ROLE_VIEW_GRANTS);
  await knex('role_permissions')
    .whereIn('role_name', roles)
    .where('permission_key', 'like', 'view.%')
    .del();
  await knex('role_permissions')
    .where({ role_name: 'HR', permission_key: 'user.manage' })
    .del();
};
