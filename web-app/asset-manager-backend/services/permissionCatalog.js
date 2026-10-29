/**
 * RBAC V2 — canonical permission catalog and Phase 19 role authority model.
 * Single source for migration + docs. Do not invent keys not backed by routes.
 *
 * Authority layers: MODULE → VIEW → ACTION
 * Sensitivity: normal | lifecycle | high_risk
 * Deny by default — grants are explicit only.
 */

/** Legacy view.* → canonical resource.view */
const VIEW_ALIASES = {
  'view.assets': 'asset.view',
  'view.inventory': 'inventory.view',
  'view.products': 'product.view',
  'view.purchase_orders': 'purchase_order.view',
  'view.purchase_books': 'purchase_book.view',
  'view.receipt_notes': 'receipt_note.view',
  'view.physical_intake': 'physical_intake.view',
  'view.reservations': 'reservation.view',
  'view.sets': 'set.view',
  'view.dc': 'dc.view',
  'view.projects': 'project.view',
  'view.warranty': 'warranty.view',
  'view.dashboard': 'dashboard.view',
  'view.history': 'history.view',
  'view.settings': 'settings.view',
  'view.recovery': 'recovery.view',
  'view.scanner': 'scanner.view',
  'view.admin': 'admin.view',
  'view.releases': 'release.view'
};

/**
 * Sensitivity classification (Phase 21).
 * Keys not listed default to 'normal' for views/modules.
 */
const ACTION_SENSITIVITY = {
  // Level 2 — lifecycle transitions
  'receipt_note.post': 'lifecycle',
  'receipt_note.cancel': 'lifecycle',
  'return_log.create': 'lifecycle',
  'procurement_reconciliation.resolve': 'lifecycle',
  'vendor_return.ready': 'lifecycle',
  'vendor_return.dispatch': 'lifecycle',
  'vendor_return.cancel': 'lifecycle',
  'purchase_book.post': 'lifecycle',
  'purchase_book.physical': 'lifecycle',
  'physical_intake.create': 'lifecycle',
  'physical_intake.link_po': 'lifecycle',
  'reservation.release': 'lifecycle',
  'reservation.transfer': 'lifecycle',
  'set.allocate': 'lifecycle',
  'set.archive': 'lifecycle',
  'dc.create': 'lifecycle',
  'dc.ready': 'lifecycle',
  'dc.dispatch': 'lifecycle',
  'dc.cancel': 'lifecycle',
  'asset.restore': 'lifecycle',
  'asset.sell': 'lifecycle',
  'asset.retire': 'lifecycle',
  'asset.release_to_store': 'lifecycle',
  'asset.convert': 'lifecycle',
  'inventory.restore': 'lifecycle',
  'product.archive': 'lifecycle',
  'product.restore': 'lifecycle',
  'project.assign': 'lifecycle',
  'recovery.restore': 'lifecycle',

  // Level 3 — high-risk / corrective
  'asset.delete': 'high_risk',
  'asset.edit_price': 'high_risk',
  'inventory.delete': 'high_risk',
  'inventory.adjust': 'high_risk',
  'receipt_note.reverse': 'high_risk',
  'purchase_book.void': 'high_risk',
  'dc.void': 'high_risk',
  'project.delete': 'high_risk',
  'category.delete': 'high_risk',
  'manage.hierarchy': 'high_risk',
  'user.manage': 'high_risk',
  'role.manage': 'high_risk',
  'settings.edit': 'high_risk',
  'dc.reason.manage': 'high_risk',
  'zoho.oauth.manage': 'high_risk',
  'network.credentials.manage': 'high_risk',
  'network.contacts.manage': 'high_risk'
};

/** New catalog entries: { key, description, category } */
const NEW_PERMISSIONS = [
  { key: 'dashboard.view', description: 'View Operations Dashboard', category: 'page' },
  { key: 'asset.view', description: 'View Assets workspace / records', category: 'page' },
  { key: 'inventory.view', description: 'View Inventory workspace / records', category: 'page' },
  { key: 'product.view', description: 'View Products workspace / records', category: 'page' },
  { key: 'purchase_order.view', description: 'View Purchase Orders', category: 'page' },
  { key: 'purchase_book.view', description: 'View Purchase Books', category: 'page' },
  { key: 'receipt_note.view', description: 'View Receipt Notes', category: 'page' },
  { key: 'return_log.view', description: 'View DC Return Logs', category: 'page' },
  { key: 'procurement_reconciliation.view', description: 'View commercial vs physical reconciliation', category: 'page' },
  { key: 'vendor_return.view', description: 'View Vendor Purchase Returns', category: 'page' },
  { key: 'physical_intake.view', description: 'View Physical Intake', category: 'page' },
  { key: 'reservation.view', description: 'View Reservations', category: 'page' },
  { key: 'set.view', description: 'View Sets', category: 'page' },
  { key: 'dc.view', description: 'View Delivery Challans', category: 'page' },
  { key: 'project.view', description: 'View Projects', category: 'page' },
  { key: 'warranty.view', description: 'View Warranty', category: 'page' },
  { key: 'history.view', description: 'View Lifecycle History', category: 'page' },
  { key: 'settings.view', description: 'View Settings', category: 'page' },
  { key: 'recovery.view', description: 'View Recovery Center', category: 'page' },
  { key: 'scanner.view', description: 'View Network Scanner', category: 'page' },
  { key: 'admin.view', description: 'View Admin workspace', category: 'page' },
  { key: 'release.view', description: 'View Releases', category: 'page' },

  { key: 'manage.hierarchy', description: 'Create and delete folders and categories', category: 'action' },
  { key: 'settings.edit', description: 'Edit Settings (email, tally, etc.)', category: 'action' },

  { key: 'asset.restore', description: 'Restore soft-deleted assets', category: 'action' },
  { key: 'asset.sell', description: 'Mark asset sold', category: 'action' },
  { key: 'asset.retire', description: 'Retire asset (scrapped / lost / damaged / written off)', category: 'action' },
  { key: 'asset.release_to_store', description: 'Release asset to store', category: 'action' },
  { key: 'asset.break', description: 'Quantity break / unsplit operations', category: 'action' },
  { key: 'asset.convert', description: 'Asset ↔ inventory conversion', category: 'action' },

  { key: 'inventory.create', description: 'Create inventory items', category: 'action' },
  { key: 'inventory.edit', description: 'Edit inventory items', category: 'action' },
  { key: 'inventory.delete', description: 'Soft-delete inventory items', category: 'action' },
  { key: 'inventory.restore', description: 'Restore inventory items', category: 'action' },
  { key: 'inventory.adjust', description: 'Inventory movements / quantity adjust', category: 'action' },

  { key: 'product.create', description: 'Create products', category: 'action' },
  { key: 'product.edit', description: 'Edit products', category: 'action' },
  { key: 'product.archive', description: 'Archive products', category: 'action' },
  { key: 'product.restore', description: 'Restore products', category: 'action' },
  { key: 'product.zoho_publish', description: 'Publish product to Zoho', category: 'action' },
  { key: 'product.zoho_refresh', description: 'Refresh product from Zoho', category: 'action' },
  { key: 'product.zoho_conflict_resolve', description: 'Resolve product Zoho conflicts', category: 'action' },

  { key: 'purchase_order.import', description: 'Import Purchase Order from Zoho', category: 'action' },
  { key: 'purchase_order.refresh', description: 'Refresh Purchase Order from Zoho', category: 'action' },

  { key: 'purchase_book.create', description: 'Create Purchase Book', category: 'action' },
  { key: 'purchase_book.edit', description: 'Edit Purchase Book draft', category: 'action' },
  { key: 'purchase_book.post', description: 'Post Purchase Book', category: 'action' },
  { key: 'purchase_book.void', description: 'Void Purchase Book', category: 'action' },
  { key: 'purchase_book.physical', description: 'Purchase Book physical receipt / release', category: 'action' },

  { key: 'receipt_note.create', description: 'Create Receipt Note', category: 'action' },
  { key: 'receipt_note.edit', description: 'Edit Receipt Note', category: 'action' },
  { key: 'receipt_note.post', description: 'Post Receipt Note', category: 'action' },
  { key: 'receipt_note.cancel', description: 'Cancel Receipt Note', category: 'action' },
  { key: 'receipt_note.reverse', description: 'Reverse Receipt Note', category: 'action' },
  { key: 'return_log.create', description: 'Create DC Return Log + Return Inward RN', category: 'action' },
  { key: 'procurement_reconciliation.resolve', description: 'Resolve commercial reconciliation (return/retain)', category: 'action' },
  { key: 'vendor_return.create', description: 'Create Vendor Purchase Return', category: 'action' },
  { key: 'vendor_return.edit', description: 'Edit Vendor Purchase Return (OPEN)', category: 'action' },
  { key: 'vendor_return.ready', description: 'Mark Vendor Return READY', category: 'action' },
  { key: 'vendor_return.dispatch', description: 'Dispatch Vendor Return (physical exit)', category: 'action' },
  { key: 'vendor_return.cancel', description: 'Cancel Vendor Return before dispatch', category: 'action' },

  { key: 'physical_intake.create', description: 'Create Physical Intake', category: 'action' },
  { key: 'physical_intake.link_po', description: 'Link Physical Intake to PO / mark RN not required', category: 'action' },

  { key: 'reservation.create', description: 'Create reservation', category: 'action' },
  { key: 'reservation.release', description: 'Release reservation', category: 'action' },
  { key: 'reservation.transfer', description: 'Transfer reservation', category: 'action' },

  { key: 'set.create', description: 'Create sets / managed sets', category: 'action' },
  { key: 'set.edit', description: 'Edit sets / allocations / components', category: 'action' },
  { key: 'set.allocate', description: 'Allocate / replace / remove set allocations', category: 'action' },
  { key: 'set.archive', description: 'Archive / disband / delete sets', category: 'action' },
  { key: 'set.restore', description: 'Restore managed sets', category: 'action' },

  { key: 'dc.create', description: 'Create Delivery Challan', category: 'action' },
  { key: 'dc.ready', description: 'Mark Delivery Challan READY', category: 'action' },
  { key: 'dc.dispatch', description: 'Dispatch Delivery Challan (physical commit)', category: 'action' },
  { key: 'dc.cancel', description: 'Cancel Delivery Challan before dispatch', category: 'action' },
  { key: 'dc.void', description: 'Void Delivery Challan', category: 'action' },
  { key: 'dc.remarks', description: 'Manage DC remarks', category: 'action' },
  { key: 'dc.reason.manage', description: 'Add / edit / deactivate DC dispatch reasons', category: 'action' },

  { key: 'project.create', description: 'Create projects', category: 'action' },
  { key: 'project.edit', description: 'Edit projects / orders / temp assets', category: 'action' },
  { key: 'project.delete', description: 'Delete projects', category: 'action' },
  { key: 'project.assign', description: 'Assign / unassign project assets', category: 'action' },

  { key: 'recovery.restore', description: 'Restore entities from Recovery Center', category: 'action' },

  { key: 'network.credentials.manage', description: 'Create/update/delete network credentials', category: 'action' },
  { key: 'network.contacts.manage', description: 'Create/update/delete network contacts', category: 'action' },

  { key: 'zoho.oauth.manage', description: 'Connect / disconnect Zoho OAuth', category: 'action' },
  { key: 'zoho.sync', description: 'Trigger Zoho sync operations', category: 'action' },

  { key: 'role.manage', description: 'Create/update/delete RBAC roles and grants', category: 'action' }
];

/**
 * FUTURE permission concepts (Phase 19 Accounts / Phase 26 Books).
 * Documented only — not inserted into catalog until functionality exists.
 */
const FUTURE_PERMISSIONS = [
  'employees.view', 'employee.create', 'employee.edit', 'employee.disable',
  'physical_intake.post', 'physical_intake.correct',
  'reservation.override',
  'dc.edit',
  'warranty.create', 'warranty.edit', 'warranty.close',
  'release.create', 'release.approve', 'release.cancel',
  'purchase_order.reconcile', 'purchase_order.version', 'purchase_order.cancel',
  'product.zoho_link', 'asset.archive', 'product.search',
  'books.integration.view', 'books.reconciliation.view', 'books.reconciliation.resolve'
];

/** Manager operational views (explicit; also copied from legacy view.* where present). */
const MANAGER_VIEWS = [
  'dashboard.view', 'asset.view', 'asset.search', 'asset.view_price',
  'inventory.view', 'product.view', 'project.view',
  'purchase_book.view', 'purchase_order.view', 'receipt_note.view',
  'return_log.view', 'procurement_reconciliation.view', 'vendor_return.view',
  'reservation.view', 'set.view', 'dc.view', 'physical_intake.view',
  'warranty.view', 'release.view', 'history.view',
  'module.assets.access'
];

/**
 * Manager actions — operational management.
 * Excludes: user/role/network/OAuth/settings admin, manage.hierarchy, recovery (IT/admin),
 * category.delete (superuser-only).
 */
const MANAGER_ACTIONS = [
  'asset.create', 'asset.edit', 'asset.delete', 'asset.edit_price',
  'asset.restore', 'asset.sell', 'asset.release_to_store', 'asset.break', 'asset.convert',
  'inventory.create', 'inventory.edit', 'inventory.delete', 'inventory.restore', 'inventory.adjust',
  'product.create', 'product.edit', 'product.archive', 'product.restore',
  'product.zoho_publish', 'product.zoho_refresh', 'product.zoho_conflict_resolve',
  'purchase_order.import', 'purchase_order.refresh',
  'purchase_book.create', 'purchase_book.edit', 'purchase_book.post', 'purchase_book.void', 'purchase_book.physical',
  'receipt_note.create', 'receipt_note.edit', 'receipt_note.post', 'receipt_note.cancel', 'receipt_note.reverse',
  'return_log.create',
  'procurement_reconciliation.resolve',
  'vendor_return.create', 'vendor_return.edit', 'vendor_return.ready', 'vendor_return.dispatch', 'vendor_return.cancel',
  'physical_intake.create', 'physical_intake.link_po',
  'reservation.create', 'reservation.release', 'reservation.transfer',
  'set.create', 'set.edit', 'set.allocate', 'set.archive', 'set.restore',
  'dc.create', 'dc.ready', 'dc.dispatch', 'dc.cancel', 'dc.void', 'dc.remarks',
  'project.create', 'project.edit', 'project.assign',
  'zoho.sync',
  'category.create'
];

/**
 * Logistics — full operations workspace and every business module.
 * Not system admin (no RBAC / settings / OAuth).
 */
const LOGISTICS_VIEWS = [...MANAGER_VIEWS];
const LOGISTICS_ACTIONS = [...MANAGER_ACTIONS];

/**
 * Procurement — every business module including Operations (read).
 * Cannot mutate Operations (DC / reservations / holdings / sets / intake).
 */
const PROCUREMENT_VIEWS = [...MANAGER_VIEWS];
const PROCUREMENT_ACTIONS = [
  'purchase_order.import', 'purchase_order.refresh',
  'purchase_book.create', 'purchase_book.edit', 'purchase_book.post', 'purchase_book.physical',
  'receipt_note.create', 'receipt_note.edit', 'receipt_note.post', 'receipt_note.cancel',
  'return_log.create',
  'procurement_reconciliation.resolve',
  'vendor_return.create', 'vendor_return.edit', 'vendor_return.ready', 'vendor_return.dispatch', 'vendor_return.cancel',
  'product.create', 'product.edit', 'product.archive', 'product.restore',
  'product.zoho_publish', 'product.zoho_refresh', 'product.zoho_conflict_resolve',
  'purchase_book.void', 'receipt_note.reverse',
  'category.create',
  'zoho.sync'
];

const OPERATIONS_MUTATIONS = [
  'dc.create', 'dc.ready', 'dc.dispatch', 'dc.cancel', 'dc.void', 'dc.remarks',
  'reservation.create', 'reservation.release', 'reservation.transfer',
  'asset.create', 'asset.edit', 'asset.delete', 'asset.break', 'asset.convert',
  'asset.restore', 'asset.sell', 'asset.release_to_store', 'asset.retire',
  'inventory.create', 'inventory.edit', 'inventory.delete', 'inventory.restore', 'inventory.adjust',
  'physical_intake.create', 'physical_intake.link_po',
  'set.create', 'set.edit', 'set.allocate', 'set.archive', 'set.restore'
];

/** Signup / Admin create-user teams (not Director / Super User / IT Admin). */
const USER_TEAMS = [
  { key: 'logistics', label: 'Logistics' },
  { key: 'procurement', label: 'Procurement' },
  { key: 'sales', label: 'Sales' },
  { key: 'HR', label: 'HR' },
  { key: 'it', label: 'IT' }
];

const USER_TEAM_KEYS = USER_TEAMS.map((t) => t.key);

/** @deprecated old name kept for grant lookup during rename */
const LOGISTICS_EXECUTIVE_VIEWS = LOGISTICS_VIEWS;
const LOGISTICS_EXECUTIVE_ACTIONS = LOGISTICS_ACTIONS;

/** Standard internal read user */
const USER_VIEWS = [
  'dashboard.view', 'asset.view', 'asset.search',
  'inventory.view', 'project.view', 'set.view', 'warranty.view',
  'module.assets.access'
];

/** IT Manager — technical admin, not business operator */
const IT_MANAGER_VIEWS = [
  'asset.view', 'asset.search', 'inventory.view',
  'scanner.view', 'recovery.view', 'release.view', 'settings.view', 'admin.view',
  'module.assets.access', 'module.network.access', 'module.network_scanner.access',
  'module.settings.access', 'module.admin.access', 'module.employees.access'
];

const IT_MANAGER_ACTIONS = [
  // Serial / asset support (edit only — no create to avoid lifecycle bypass)
  'asset.edit',
  'user.manage',
  'network.credentials.manage', 'network.contacts.manage',
  'settings.edit',
  'recovery.restore'
];

/** IT User — read + network module; no mutations by default */
const IT_USER_VIEWS = [
  'asset.view', 'asset.search', 'inventory.view', 'scanner.view',
  'module.assets.access', 'module.network.access', 'module.network_scanner.access'
];

/** HR — employees / users only */
const HR_VIEWS = ['settings.view', 'module.employees.access'];
const HR_ACTIONS = ['user.manage'];

/** Client — strictly restricted */
const CLIENT_VIEWS = ['asset.view', 'asset.search', 'module.assets.access'];

/**
 * Admin company administrator — stored ticks only (no FE bypass).
 * Includes role.manage (UI supported). Excludes category.delete (superuser-only).
 */
const ADMIN_GRANTS = [
  ...MANAGER_VIEWS,
  ...MANAGER_ACTIONS,
  'manage.hierarchy',
  'project.delete',
  'asset.retire',
  'dc.reason.manage',
  'user.manage',
  'role.manage',
  'settings.edit',
  'admin.view',
  'logs.view',
  'recovery.view', 'recovery.restore',
  'scanner.view',
  'module.admin.access', 'module.settings.access', 'module.employees.access',
  'module.network.access', 'module.network_scanner.access',
  'zoho.oauth.manage',
  'network.credentials.manage', 'network.contacts.manage',
  'settings.view'
];

/** Superuser — all operational keys in catalog (plus centralized bypass at runtime). */
function allCatalogKeys() {
  const preexisting = [
    'asset.create', 'asset.delete', 'asset.edit', 'asset.edit_price',
    'asset.search', 'asset.view', 'asset.view_price',
    'category.create', 'category.delete', 'logs.view', 'user.manage',
    'module.admin.access', 'module.assets.access', 'module.employees.access',
    'module.network.access', 'module.network_scanner.access', 'module.settings.access'
  ];
  return [...new Set([...preexisting, ...NEW_PERMISSIONS.map((p) => p.key), ...ADMIN_GRANTS])];
}

/**
 * Role → explicit grants (views + actions). Migration upserts these.
 * Superuser also has runtime bypass; grants kept for audit completeness.
 */
const ROLE_ACTION_GRANTS = {
  superuser: allCatalogKeys(),
  admin: [...new Set(ADMIN_GRANTS)],
  director: [...new Set(ADMIN_GRANTS.filter((k) => k !== 'role.manage' && k !== 'zoho.oauth.manage'))],
  manager: [...new Set([...MANAGER_VIEWS, ...MANAGER_ACTIONS])],
  logistics: [...new Set([...LOGISTICS_VIEWS, ...LOGISTICS_ACTIONS])],
  'Logistics Executive': [...new Set([...LOGISTICS_VIEWS, ...LOGISTICS_ACTIONS])],
  procurement: [...new Set([...PROCUREMENT_VIEWS, ...PROCUREMENT_ACTIONS])],
  sales: [...new Set(USER_VIEWS)],
  user: [...new Set(USER_VIEWS)],
  it: [...new Set([...LOGISTICS_VIEWS, ...LOGISTICS_ACTIONS, ...USER_VIEWS])],
  it_manager: [...new Set([...IT_MANAGER_VIEWS, ...IT_MANAGER_ACTIONS])],
  it_user: [...new Set([...LOGISTICS_VIEWS, ...LOGISTICS_ACTIONS, ...USER_VIEWS])],
  client: [...new Set(CLIENT_VIEWS)],
  HR: [...new Set([...HR_VIEWS, ...HR_ACTIONS])]
};

/**
 * Deliberate privilege deltas vs prior triad / Phase-0 V2 grants.
 * Used by docs + reconciliation migration comments.
 */
const DELIBERATE_PRIVILEGE_CHANGES = [
  {
    role: 'logistics',
    change: 'GRANT',
    keys: LOGISTICS_ACTIONS,
    reason: 'Logistics team has full operations and every business module (not RBAC / settings / OAuth)'
  },
  {
    role: 'procurement',
    change: 'DENY',
    keys: OPERATIONS_MUTATIONS,
    reason: 'Procurement can see Operations but cannot create/dispatch DCs, adjust holdings, or run intake'
  },
  {
    role: 'admin',
    change: 'REVOKE',
    keys: ['category.delete'],
    reason: 'Destructive category delete remains superuser-only'
  },
  {
    role: 'admin',
    change: 'GRANT',
    keys: ['role.manage'],
    reason: 'Phase 19: company admin may manage roles where UI supports it (stored tick, not bypass)'
  },
  {
    role: 'manager',
    change: 'REVOKE',
    keys: ['manage.hierarchy', 'recovery.restore', 'user.manage', 'zoho.oauth.manage', 'network.credentials.manage', 'settings.edit'],
    reason: 'Operational manager is not system/security admin'
  },
  {
    role: 'it_manager',
    change: 'REVOKE',
    keys: ['asset.create'],
    reason: 'Prevent IT create-asset path around Receipt Note / Physical Intake containment; retain asset.edit for serials support'
  },
  {
    role: 'it_user',
    change: 'REVOKE',
    keys: ['network.credentials.manage', 'network.contacts.manage'],
    reason: 'Phase 19: IT User is read/support; network credential mutation reserved for IT Manager / Admin'
  }
];

/** Keys that must be revoked from a role during reconciliation (even if previously granted). */
const ROLE_REVOKE_KEYS = {
  admin: ['category.delete'],
  manager: [
    'manage.hierarchy', 'recovery.restore', 'user.manage', 'role.manage',
    'zoho.oauth.manage', 'network.credentials.manage', 'network.contacts.manage',
    'settings.edit', 'module.network.access', 'module.network_scanner.access',
    'module.admin.access', 'module.employees.access', 'admin.view'
  ],
  logistics: [
    'user.manage', 'role.manage', 'settings.edit', 'zoho.oauth.manage',
    'network.credentials.manage', 'manage.hierarchy', 'admin.view'
  ],
  'Logistics Executive': [
    'user.manage', 'role.manage', 'settings.edit', 'zoho.oauth.manage',
    'network.credentials.manage', 'manage.hierarchy', 'admin.view'
  ],
  procurement: [
    'dc.create', 'dc.ready', 'dc.dispatch', 'dc.cancel', 'dc.void', 'dc.remarks',
    'reservation.create', 'reservation.release', 'reservation.transfer',
    'asset.create', 'asset.edit', 'asset.delete', 'inventory.adjust',
    'physical_intake.create', 'set.allocate', 'user.manage'
  ],
  it_manager: [
    'asset.create', 'receipt_note.create', 'receipt_note.post', 'dc.create',
    'purchase_order.import', 'physical_intake.create', 'reservation.create',
    'set.allocate', 'product.zoho_publish', 'asset.edit_price'
  ],
  it_user: [
    'network.credentials.manage', 'network.contacts.manage',
    'user.manage', 'role.manage', 'zoho.oauth.manage'
  ],
  it: [
    'network.credentials.manage', 'network.contacts.manage',
    'user.manage', 'role.manage', 'zoho.oauth.manage'
  ],
  user: [
    'asset.create', 'asset.edit', 'inventory.adjust', 'reservation.create',
    'set.allocate', 'dc.create', 'receipt_note.post'
  ],
  client: [
    'asset.create', 'asset.edit', 'asset.delete', 'asset.view_price', 'asset.edit_price'
  ],
  HR: [
    'asset.edit', 'asset.view_price', 'inventory.adjust', 'receipt_note.create',
    'dc.create', 'physical_intake.create'
  ]
};

function resolvePermissionKey(key) {
  const k = String(key || '');
  return VIEW_ALIASES[k] || k;
}

function permissionEquivalents(requiredKey) {
  const canon = resolvePermissionKey(requiredKey);
  const set = new Set([canon, requiredKey]);
  for (const [legacy, target] of Object.entries(VIEW_ALIASES)) {
    if (target === canon) set.add(legacy);
  }
  return [...set];
}

function sensitivityOf(key) {
  if (ACTION_SENSITIVITY[key]) return ACTION_SENSITIVITY[key];
  if (String(key).startsWith('module.')) return 'module';
  if (String(key).endsWith('.view') || String(key).startsWith('view.') || key === 'asset.search' || key === 'logs.view') {
    return 'view';
  }
  return 'normal';
}

module.exports = {
  VIEW_ALIASES,
  NEW_PERMISSIONS,
  FUTURE_PERMISSIONS,
  ACTION_SENSITIVITY,
  ROLE_ACTION_GRANTS,
  ROLE_REVOKE_KEYS,
  DELIBERATE_PRIVILEGE_CHANGES,
  MANAGER_ACTIONS,
  LOGISTICS_ACTIONS,
  LOGISTICS_EXECUTIVE_ACTIONS,
  PROCUREMENT_ACTIONS,
  OPERATIONS_MUTATIONS,
  USER_TEAMS,
  USER_TEAM_KEYS,
  resolvePermissionKey,
  permissionEquivalents,
  sensitivityOf
};
