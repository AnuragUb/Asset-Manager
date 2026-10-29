/**
 * Generate RBAC_ROLE_MATRIX.md from permissionCatalog Phase 19 model.
 */
const fs = require('fs');
const path = require('path');
const {
  NEW_PERMISSIONS,
  ROLE_ACTION_GRANTS,
  FUTURE_PERMISSIONS,
  DELIBERATE_PRIVILEGE_CHANGES,
  VIEW_ALIASES,
  sensitivityOf
} = require('../services/permissionCatalog');

const ROLES = [
  'superuser',
  'admin',
  'manager',
  'Logistics Executive',
  'user',
  'it_manager',
  'it_user',
  'HR',
  'client',
  'Accounts Executive',
  'Accounts Manager'
];

const FUTURE_ROLES = new Set(['Accounts Executive', 'Accounts Manager']);

const preexisting = [
  'asset.create', 'asset.delete', 'asset.edit', 'asset.edit_price',
  'asset.search', 'asset.view', 'asset.view_price',
  'category.create', 'category.delete', 'logs.view', 'user.manage',
  'module.admin.access', 'module.assets.access', 'module.employees.access',
  'module.network.access', 'module.network_scanner.access', 'module.settings.access'
];

const catalogKeys = [
  ...new Set([
    ...preexisting,
    ...NEW_PERMISSIONS.map((p) => p.key),
    ...Object.values(VIEW_ALIASES)
  ])
].sort();

function cell(role, key) {
  if (FUTURE_ROLES.has(role)) {
    // Accounts future posture
    const accountsRead = new Set([
      'dashboard.view', 'purchase_order.view', 'receipt_note.view',
      'inventory.view', 'asset.view', 'product.view', 'asset.view_price'
    ]);
    const accountsDeny = new Set([
      'asset.create', 'asset.edit', 'inventory.adjust', 'physical_intake.create',
      'reservation.create', 'set.allocate', 'dc.create', 'dc.void',
      'receipt_note.post', 'receipt_note.create'
    ]);
    if (accountsDeny.has(key)) return 'DENY';
    if (key.startsWith('books.')) return 'FUTURE';
    if (accountsRead.has(key)) return 'FUTURE';
    if (role === 'Accounts Manager' && (key === 'books.reconciliation.resolve' || accountsRead.has(key))) {
      return 'FUTURE';
    }
    return 'FUTURE';
  }
  const grants = new Set(ROLE_ACTION_GRANTS[role] || []);
  if (role === 'superuser') return 'ALLOW';
  return grants.has(key) ? 'ALLOW' : 'DENY';
}

function layer(key) {
  const s = sensitivityOf(key);
  if (s === 'module' || String(key).startsWith('module.')) return 'MODULE';
  if (s === 'view') return 'VIEW';
  if (s === 'lifecycle') return 'LIFECYCLE ACTION';
  if (s === 'high_risk') return 'HIGH-RISK ACTION';
  return 'NORMAL ACTION';
}

const lines = [];
lines.push('# RBAC Role Matrix (Phase 19 — Canonical Authority Model)');
lines.push('');
lines.push('Deny by default. ALLOW only via stored `role_permissions` (superuser also has centralized bypass).');
lines.push('');
lines.push('Accounts Executive / Accounts Manager columns are **FUTURE** — roles are not created until Zoho Books functionality exists.');
lines.push('');
lines.push('Scratch DB after `20260923140000_rbac_v2_role_authority_model.js`. Production not migrated.');
lines.push('');
lines.push('## Legend');
lines.push('');
lines.push('| Value | Meaning |');
lines.push('|-------|---------|');
lines.push('| ALLOW | Role has stored grant (or superuser bypass) |');
lines.push('| DENY | No grant |');
lines.push('| FUTURE | Planned for Accounts / Books — not in catalog yet |');
lines.push('');
lines.push('## Layers');
lines.push('');
lines.push('- **MODULE** — workspace access');
lines.push('- **VIEW** — read / page access');
lines.push('- **NORMAL ACTION** — ordinary create/edit/refresh');
lines.push('- **LIFECYCLE ACTION** — post / allocate / restore / dispatch-class');
lines.push('- **HIGH-RISK ACTION** — delete / reverse / void / price / admin / OAuth');
lines.push('');

const header = ['Permission', 'Layer', ...ROLES].join(' | ');
const sep = ['---', '---', ...ROLES.map(() => '---')].join(' | ');
lines.push('| ' + header + ' |');
lines.push('| ' + sep + ' |');

for (const key of catalogKeys) {
  const row = [ `\`${key}\``, layer(key), ...ROLES.map((r) => cell(r, key)) ];
  lines.push('| ' + row.join(' | ') + ' |');
}

lines.push('');
lines.push('## Future-only keys (not in live catalog)');
lines.push('');
lines.push('| Permission | Layer | Notes |');
lines.push('|------------|-------|-------|');
for (const key of FUTURE_PERMISSIONS.sort()) {
  lines.push(`| \`${key}\` | FUTURE | Documented for Books / finer lifecycle; not inserted |`);
}

lines.push('');
lines.push('## Deliberate privilege changes');
lines.push('');
for (const d of DELIBERATE_PRIVILEGE_CHANGES) {
  lines.push(`### ${d.role} — ${d.change}`);
  lines.push('');
  lines.push(d.reason);
  lines.push('');
  lines.push(d.keys.map((k) => `- \`${k}\``).join('\n'));
  lines.push('');
}

lines.push('## Segregation of duties (Phase 20)');
lines.push('');
lines.push('| Concern | Logistics Executive | Manager | Accounts (future) | IT |');
lines.push('|---------|---------------------|---------|-------------------|-----|');
lines.push('| Post Receipt Note | ALLOW | ALLOW | DENY | DENY |');
lines.push('| Reverse Receipt Note | DENY | ALLOW | DENY | DENY |');
lines.push('| Edit asset price | DENY | ALLOW | FUTURE view only | DENY |');
lines.push('| Inventory adjust | DENY | ALLOW | DENY | DENY |');
lines.push('| User manage | DENY | DENY | DENY | IT Manager ALLOW |');
lines.push('| Category delete | DENY | DENY | DENY | DENY (superuser only) |');
lines.push('');

const outBackend = path.join(__dirname, '../RBAC_ROLE_MATRIX.md');
fs.writeFileSync(outBackend, lines.join('\n') + '\n');
console.log('Wrote', outBackend, 'rows', catalogKeys.length);
