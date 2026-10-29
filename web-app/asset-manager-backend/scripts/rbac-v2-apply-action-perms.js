/**
 * RBAC V2 — replace authorizeRoles mutation gates with requirePermission action keys.
 * Idempotent: skips lines that already have requirePermission for the target action.
 * Does NOT touch auth/login, OCR, arri service portal, or other deliberately open surfaces
 * in this pass (documented as unresolved gaps in RBAC_ROUTE_COVERAGE.md).
 */
const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '../server.js');
let src = fs.readFileSync(serverPath, 'utf8');

const LOGISTICS = "authorizeRoles('superuser', 'admin', 'manager')";
const ADMIN_SU = "authorizeRoles('superuser', 'admin')";
const ADMIN_SU_ALT = "authorizeRoles('admin', 'superuser')";
const IT_NET = "authorizeRoles('superuser', 'admin', 'it_user', 'it_manager')";
const IT_NET_DEL = "authorizeRoles('superuser', 'admin', 'it_manager')";
const SERIAL = "authorizeRoles('superuser', 'admin', 'manager', 'it_manager')";
const SU_ONLY = "authorizeRoles('superuser')";

/** Exact route string → permission key for the first matching mutation line */
const ROUTE_PERMS = [
  // Sets / managed sets
  ["app.post('/api/managed-sets'", 'set.create'],
  ["app.put('/api/managed-sets/:id'", 'set.edit'],
  ["app.post('/api/managed-sets/:id/components'", 'set.edit'],
  ["app.delete('/api/managed-sets/:id/components/:componentId'", 'set.edit'],
  ["app.post('/api/managed-sets/:id/archive'", 'set.archive'],
  ["app.post('/api/managed-sets/:id/restore'", 'set.restore'],
  ["app.post('/api/sets'", 'set.create'],
  ["app.post('/api/sets/absorb'", 'set.create'],
  ["app.post('/api/sets/:id/commercialize'", 'set.edit'],
  ["app.post('/api/sets/:id/allocations'", 'set.allocate'],
  ["app.delete('/api/sets/:id/allocations/:allocationId'", 'set.allocate'],
  ["app.post('/api/sets/:id/allocations/:allocationId/replace'", 'set.allocate'],
  ["app.post('/api/sets/:id/disband'", 'set.archive'],
  ["app.post('/api/sets/:id/archive'", 'set.archive'],
  ["app.post('/api/sets/:id/delete'", 'set.archive'],
  ["app.post('/api/sets/:id/disassemble'", 'set.archive'],
  ["app.put('/api/sets/:id'", 'set.edit'],

  // Products
  ["app.post('/api/products/from-catalog'", 'product.create'],
  ["app.post('/api/products/:id/publish'", 'product.zoho_publish'],
  ["app.post('/api/products/:id/refresh-zoho'", 'product.zoho_refresh'],
  ["app.post('/api/products/:id/conflicts/:conflictId/resolve'", 'product.zoho_conflict_resolve'],
  ["app.post('/api/products/:id/external-refs'", 'product.edit'],
  ["app.post('/api/products/:id/archive'", 'product.archive'],
  ["app.post('/api/products/:id/restore'", 'product.restore'],
  ["app.post('/api/products'", 'product.create'],
  ["app.put('/api/products/:id'", 'product.edit'],

  // Break / convert
  ["app.post('/api/break'", 'asset.break'],
  ["app.post('/api/break/inactivate'", 'asset.break'],
  ["app.post('/api/conversions'", 'asset.convert'],

  // Reservations
  ["app.post('/api/reservations'", 'reservation.create'],
  ["app.post('/api/reservations/:id/release'", 'reservation.release'],
  ["app.post('/api/reservations/:id/transfer'", 'reservation.transfer'],

  // PO
  ["app.post('/api/purchase-orders/import-zoho'", 'purchase_order.import'],
  ["app.post('/api/procurement/pos/import'", 'purchase_order.import'],
  ["app.post('/api/procurement/pos/:id/refresh'", 'purchase_order.refresh'],
  ["app.post('/api/purchase-orders/:id/refresh-zoho'", 'purchase_order.refresh'],

  // Receipt notes
  ["app.post('/api/receipt-notes'", 'receipt_note.create'],
  ["app.post('/api/receipt-notes/:id/post'", 'receipt_note.post'],
  ["app.post('/api/receipt-notes/:id/cancel'", 'receipt_note.cancel'],
  ["app.post('/api/receipt-notes/:id/reverse'", 'receipt_note.reverse'],
  ["app.post('/api/receipt-notes/:id/project-to-zoho'", 'receipt_note.edit'],
  ["app.put('/api/receipt-notes/:id'", 'receipt_note.edit'],

  // Purchase books
  ["app.post('/api/purchase-books/physical'", 'purchase_book.physical'],
  ["app.post('/api/purchase-books/physical/:physId/release'", 'purchase_book.physical'],
  ["app.post('/api/purchase-books'", 'purchase_book.create'],
  ["app.put('/api/purchase-books/:id'", 'purchase_book.edit'],
  ["app.post('/api/purchase-books/:id/post'", 'purchase_book.post'],
  ["app.post('/api/purchase-books/:id/void'", 'purchase_book.void'],

  // Serials (asset.edit for IT managers who had access)
  ["app.post('/api/serials'", 'asset.edit'],
  ["app.post('/api/serials/retire'", 'asset.edit'],

  // Physical intake
  ["app.post('/api/physical-intakes/link-po'", 'physical_intake.link_po'],
  ["app.post('/api/physical-intakes/mark-not-required'", 'physical_intake.link_po'],
  ["app.post('/api/physical-intakes'", 'physical_intake.create'],

  // Zoho
  ["app.post('/api/zoho/sync-asset/:id'", 'zoho.sync'],
  ["app.post('/api/zoho/oauth/disconnect'", 'zoho.oauth.manage'],

  // Hierarchy / kinds
  ["app.delete('/api/asset_kinds/:name'", 'manage.hierarchy'],
  ["app.post('/api/inventory/folders'", 'manage.hierarchy'],
  ["app.post('/api/inventory/kinds'", 'manage.hierarchy'],
  ["app.post('/api/asset_kinds'", 'category.create'],

  // Inventory
  ["app.post('/api/inventory/movements'", 'inventory.adjust'],
  ["app.post('/api/inventory/items'", 'inventory.create'],
  ["app.put('/api/inventory/items/:id'", 'inventory.edit'],
  ["app.post('/api/inventory/items/:id/delete'", 'inventory.delete'],
  ["app.post('/api/inventory/items/:id/restore'", 'inventory.restore'],

  // Projects
  ["app.delete('/api/projects/:id'", 'project.delete'],
  ["app.post('/api/projects'", 'project.create'],

  // Network
  ["app.post('/api/network/credentials'", 'network.credentials.manage'],
  ["app.put('/api/network/credentials/:id'", 'network.credentials.manage'],
  ["app.delete('/api/network/credentials/:id'", 'network.credentials.manage'],
  ["app.post('/api/network/contacts'", 'network.contacts.manage'],
  ["app.put('/api/network/contacts/:id'", 'network.contacts.manage'],
  ["app.delete('/api/network/contacts/:id'", 'network.contacts.manage'],

  // Users
  ["app.post('/api/users/create'", 'user.manage'],
  ["app.post('/api/users/update-role'", 'user.manage'],

  // Assets
  ["app.post('/api/assets'", 'asset.create'],
  ["app.post('/api/assets/make-set'", 'set.create'],
  ["app.post('/api/assets/bulk'", 'asset.create'],
  ["app.post('/api/temporary-assets/:id/make-permanent'", 'asset.create'],
  ["app.post('/api/assets/split'", 'asset.break'],
  ["app.post('/api/assets/unsplit'", 'asset.break'],
  ["app.post('/api/external/sheets-sync'", 'project.edit'],

  // RBAC roles
  ["app.post('/api/rbac/roles'", 'role.manage'],
  ["app.delete('/api/rbac/roles/:name'", 'role.manage'],

  // Dynamic forms (admin)
  ["app.delete('/api/dynamic/:code'", 'settings.edit']
];

/** Auth-only mutations that need requirePermission added (no authorizeRoles today) */
const AUTH_ONLY = [
  ["app.post('/api/assets/:id/sell'", 'asset.sell'],
  ["app.post('/api/assets/:id/release-to-store'", 'asset.release_to_store'],
  ["app.post('/api/recovery-center/:entityType/:id/restore'", 'recovery.restore'],
  ["app.post('/api/users'", 'user.manage'],
  ["app.put('/api/users/:username'", 'user.manage'],
  ["app.delete('/api/users/:username'", 'user.manage'],
  ["app.post('/api/role-permissions'", 'role.manage'],
  ["app.delete('/api/role-permissions'", 'role.manage'],
  ["app.post('/api/zoho/sync-deals'", 'zoho.sync'],
  ["app.post('/api/zoho/sync-products'", 'zoho.sync'],
  ["app.delete('/api/folders/:id'", 'manage.hierarchy'],
  ["app.post('/api/assets/break-set'", 'set.archive'],
  ["app.post('/api/projects/:id/orders'", 'project.edit'],
  ["app.put('/api/orders/:orderId'", 'project.edit'],
  ["app.delete('/api/projects/:projectId/orders/:orderId'", 'project.edit'],
  ["app.patch('/api/projects/:id'", 'project.edit'],
  ["app.post('/api/projects/:id/assign-asset'", 'project.assign'],
  ["app.delete('/api/projects/:id/unassign-asset/:assetId'", 'project.assign'],
  ["app.post('/api/projects/:id/create-user'", 'user.manage'],
  ["app.post('/api/projects/:id/temporary-assets'", 'project.edit'],
  ["app.post('/api/temporary-assets'", 'project.edit'],
  ["app.delete('/api/temporary-assets/:id'", 'project.edit'],
  ["app.put('/api/assets/:id'", 'asset.edit'],
  ["app.put('/api/orders/:orderId/status'", 'project.edit'],
  ["app.delete('/api/assets/bulk'", 'asset.delete'],
  ["app.delete('/api/assets/:id'", 'asset.delete'],
  ["app.post('/api/assets/:id/restore'", 'asset.restore'],
  ["app.post('/api/assets/:id/link-po-item'", 'asset.edit'],
  ["app.post('/api/company-templates'", 'settings.edit'],
  ["app.put('/api/company-templates/:id'", 'settings.edit'],
  ["app.delete('/api/company-templates/:id'", 'settings.edit']
];

function replaceRolesWithPerm(line, perm) {
  if (line.includes(`requirePermission('${perm}')`)) return line;
  let next = line;
  for (const roles of [LOGISTICS, SERIAL, IT_NET, IT_NET_DEL, ADMIN_SU, ADMIN_SU_ALT, SU_ONLY]) {
    if (next.includes(roles)) {
      next = next.replace(roles, `requirePermission('${perm}')`);
      break;
    }
  }
  // tenant users already have requirePermission — drop redundant authorizeRoles
  if (next.includes("requirePermission('user.manage')") && next.includes('authorizeRoles')) {
    next = next
      .replace(`, ${ADMIN_SU}`, '')
      .replace(`, ${ADMIN_SU_ALT}`, '')
      .replace(`${ADMIN_SU}, `, '')
      .replace(`${ADMIN_SU_ALT}, `, '');
  }
  return next;
}

function injectAfterJwt(line, perm) {
  if (line.includes(`requirePermission('${perm}')`)) return line;
  if (line.includes('requirePermission(')) return line; // already has some perm
  if (!line.includes('authenticateJWT')) return line;
  return line.replace(
    'authenticateJWT',
    `authenticateJWT, requirePermission('${perm}')`
  );
}

const lines = src.split('\n');
let changed = 0;
const applied = [];

// Longest prefix first so /api/sets/absorb wins over /api/sets
const ROUTE_PERMS_SORTED = [...ROUTE_PERMS].sort((a, b) => b[0].length - a[0].length);
const AUTH_ONLY_SORTED = [...AUTH_ONLY].sort((a, b) => b[0].length - a[0].length);

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  let next = line;

  for (const [prefix, perm] of ROUTE_PERMS_SORTED) {
    if (line.includes(prefix) && /app\.(post|put|patch|delete)\(/.test(line)) {
      const updated = replaceRolesWithPerm(line, perm);
      if (updated !== line) {
        next = updated;
        applied.push({ line: i + 1, prefix, perm, mode: 'roles→perm' });
      }
      break;
    }
  }

  if (next === line) {
    for (const [prefix, perm] of AUTH_ONLY_SORTED) {
      if (line.includes(prefix) && /app\.(post|put|patch|delete)\(/.test(line)) {
        const updated = injectAfterJwt(line, perm);
        if (updated !== line) {
          next = updated;
          applied.push({ line: i + 1, prefix, perm, mode: 'inject' });
        }
        break;
      }
    }
  }

  // Also migrate GET view.* to canonical where still present on this line
  if (/requirePermission\('view\./.test(next)) {
    const map = {
      "requirePermission('view.assets')": "requirePermission('asset.view')",
      "requirePermission('view.inventory')": "requirePermission('inventory.view')",
      "requirePermission('view.products')": "requirePermission('product.view')",
      "requirePermission('view.purchase_orders')": "requirePermission('purchase_order.view')",
      "requirePermission('view.purchase_books')": "requirePermission('purchase_book.view')",
      "requirePermission('view.receipt_notes')": "requirePermission('receipt_note.view')",
      "requirePermission('view.physical_intake')": "requirePermission('physical_intake.view')",
      "requirePermission('view.reservations')": "requirePermission('reservation.view')",
      "requirePermission('view.sets')": "requirePermission('set.view')",
      "requirePermission('view.dc')": "requirePermission('dc.view')",
      "requirePermission('view.projects')": "requirePermission('project.view')",
      "requirePermission('view.warranty')": "requirePermission('warranty.view')",
      "requirePermission('view.dashboard')": "requirePermission('dashboard.view')",
      "requirePermission('view.history')": "requirePermission('history.view')",
      "requirePermission('view.settings')": "requirePermission('settings.view')",
      "requirePermission('view.recovery')": "requirePermission('recovery.view')",
      "requirePermission('view.scanner')": "requirePermission('scanner.view')",
      "requirePermission('view.admin')": "requirePermission('admin.view')",
      "requirePermission('view.releases')": "requirePermission('release.view')"
    };
    for (const [a, b] of Object.entries(map)) {
      if (next.includes(a)) {
        next = next.split(a).join(b);
        applied.push({ line: i + 1, prefix: a, perm: b, mode: 'view-alias' });
      }
    }
  }

  if (next !== line) {
    lines[i] = next;
    changed += 1;
  }
}

const outPath = path.join(__dirname, '../server.js.rbac-patched');
fs.writeFileSync(outPath, lines.join('\n'));
const logPath = path.join(__dirname, '../rbac-v2-route-patch-log.json');
fs.writeFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), changed, applied }, null, 2));
console.log(JSON.stringify({ changedLines: changed, appliedCount: applied.length, outPath, logPath, sample: applied.slice(0, 15) }, null, 2));
