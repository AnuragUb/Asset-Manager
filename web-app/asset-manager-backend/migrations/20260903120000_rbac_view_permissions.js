/**
 * Add canonical page-visibility permission keys.
 *
 * Why: view.dashboard previously gated many unrelated operator workspaces.
 * This migration defines dedicated view.* keys so navigation, routes, and
 * APIs can agree. It does NOT grant any key to any role.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
const VIEW_KEYS = [
  { key: 'view.dashboard', description: 'View Dashboard only' },
  { key: 'view.products', description: 'View Products workspace and Zoho Reference Catalog' },
  { key: 'view.inventory', description: 'View Inventory workspace' },
  { key: 'view.assets', description: 'View Assets workspace' },
  { key: 'view.history', description: 'View Lifecycle History' },
  { key: 'view.reservations', description: 'View Reservations' },
  { key: 'view.purchase_orders', description: 'View Purchase Orders' },
  { key: 'view.receipt_notes', description: 'View Receipt Notes' },
  { key: 'view.sets', description: 'View Sets' },
  { key: 'view.projects', description: 'View Projects' },
  { key: 'view.dc', description: 'View Create DC' },
  { key: 'view.warranty', description: 'View Warranty' },
  { key: 'view.settings', description: 'View Settings' },
  { key: 'view.recovery', description: 'View Recovery Center' },
  { key: 'view.scanner', description: 'View Network Scanner' },
  { key: 'view.physical_intake', description: 'View Physical Intake' }
];

exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable('permissions');
  if (!hasTable) return;

  for (const row of VIEW_KEYS) {
    const existing = await knex('permissions').where({ key: row.key }).first();
    if (existing) {
      await knex('permissions').where({ key: row.key }).update({ description: row.description });
    } else {
      await knex('permissions').insert(row);
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  const hasTable = await knex.schema.hasTable('permissions');
  if (!hasTable) return;

  const created = [
    'view.products',
    'view.inventory',
    'view.assets',
    'view.history',
    'view.reservations',
    'view.purchase_orders',
    'view.receipt_notes',
    'view.sets',
    'view.settings',
    'view.recovery',
    'view.scanner',
    'view.physical_intake'
  ];
  await knex('permissions').whereIn('key', created).delete();
  await knex('permissions').where({ key: 'view.dashboard' }).update({
    description: 'Ability to view main Dashboard'
  });
};
