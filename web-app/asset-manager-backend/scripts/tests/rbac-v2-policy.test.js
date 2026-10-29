/**
 * RBAC V2 — Phase 19 policy assertions.
 * Run: docker run --rm -v ... node:20 node scripts/tests/rbac-v2-policy.test.js
 */
const assert = require('assert');
const {
  permissionEquivalents,
  ROLE_ACTION_GRANTS,
  ROLE_REVOKE_KEYS,
  VIEW_ALIASES,
  LOGISTICS_ACTIONS,
  PROCUREMENT_ACTIONS,
  OPERATIONS_MUTATIONS,
  USER_TEAM_KEYS
} = require('../../services/permissionCatalog');

function simulateHasPermission(roleName, grants, requiredKey) {
  if (roleName === 'superuser') return true;
  const set = new Set(grants);
  return permissionEquivalents(requiredKey).some((k) => set.has(k));
}

// TEST 1 — VIEW ≠ ACTION
{
  const grants = ['receipt_note.view', 'view.receipt_notes'];
  assert.strictEqual(simulateHasPermission('user', grants, 'receipt_note.view'), true);
  assert.strictEqual(simulateHasPermission('user', grants, 'receipt_note.post'), false);
  console.log('PASS TEST1 view≠action');
}

// TEST 2 — manager has RN lifecycle
{
  assert.ok(ROLE_ACTION_GRANTS.manager.includes('receipt_note.post'));
  assert.ok(ROLE_ACTION_GRANTS.manager.includes('receipt_note.create'));
  assert.ok(!ROLE_ACTION_GRANTS.manager.includes('manage.hierarchy'));
  assert.ok(!ROLE_ACTION_GRANTS.manager.includes('user.manage'));
  console.log('PASS TEST2 manager ops without admin');
}

// TEST 4 — admin stored ticks only (no role-name bypass in simulator)
{
  const grants = ['admin.view'];
  assert.strictEqual(simulateHasPermission('admin', grants, 'receipt_note.post'), false);
  assert.ok(ROLE_ACTION_GRANTS.admin.includes('role.manage'));
  assert.ok(!ROLE_ACTION_GRANTS.admin.includes('category.delete'));
  assert.ok(ROLE_REVOKE_KEYS.admin.includes('category.delete'));
  console.log('PASS TEST4 admin ticks; category.delete revoked');
}

// TEST 5 — superuser bypass
{
  assert.strictEqual(simulateHasPermission('superuser', [], 'receipt_note.post'), true);
  console.log('PASS TEST5 superuser bypass');
}

// TEST 6 — Logistics full operations; Procurement view-only on operations
{
  for (const k of LOGISTICS_ACTIONS) {
    assert.ok(ROLE_ACTION_GRANTS.logistics.includes(k), k);
  }
  assert.ok(ROLE_ACTION_GRANTS.logistics.includes('dashboard.view'));
  assert.ok(ROLE_ACTION_GRANTS.procurement.includes('dashboard.view'));
  assert.ok(ROLE_ACTION_GRANTS.procurement.includes('dc.view'));
  for (const k of PROCUREMENT_ACTIONS) {
    assert.ok(ROLE_ACTION_GRANTS.procurement.includes(k), k);
  }
  for (const k of OPERATIONS_MUTATIONS) {
    assert.ok(!ROLE_ACTION_GRANTS.procurement.includes(k), k);
  }
  assert.deepStrictEqual(USER_TEAM_KEYS, ['logistics', 'procurement', 'sales', 'HR', 'it']);
  console.log('PASS TEST6 logistics vs procurement');
}

// TEST 7 — user read-only actions
{
  assert.ok(ROLE_ACTION_GRANTS.user.every((k) => k.endsWith('.view') || k === 'asset.search' || k.startsWith('module.')));
  console.log('PASS TEST7 user');
}

// TEST 8 — IT no procurement
{
  assert.ok(!ROLE_ACTION_GRANTS.it_manager.includes('purchase_order.import'));
  assert.ok(!ROLE_ACTION_GRANTS.it_manager.includes('asset.create'));
  assert.ok(ROLE_ACTION_GRANTS.it_user.includes('dc.create'));
  assert.ok(!ROLE_ACTION_GRANTS.it_user.includes('network.credentials.manage'));
  console.log('PASS TEST8 IT');
}

// TEST 9 — HR no physical mutation
{
  assert.ok(!ROLE_ACTION_GRANTS.HR.includes('asset.edit'));
  assert.ok(!ROLE_ACTION_GRANTS.HR.includes('inventory.adjust'));
  assert.ok(ROLE_ACTION_GRANTS.HR.includes('user.manage'));
  console.log('PASS TEST9 HR');
}

// TEST 10 — manager logistics
{
  for (const k of ['dc.create', 'receipt_note.post', 'reservation.create', 'physical_intake.create']) {
    assert.ok(ROLE_ACTION_GRANTS.manager.includes(k), k);
  }
  console.log('PASS TEST10 manager');
}

// TEST 11 — hierarchy + aliases
{
  assert.ok(ROLE_ACTION_GRANTS.admin.includes('manage.hierarchy'));
  assert.ok(!ROLE_ACTION_GRANTS.manager.includes('manage.hierarchy'));
  assert.strictEqual(VIEW_ALIASES['view.assets'], 'asset.view');
  console.log('PASS TEST11 hierarchy + aliases');
}

// TEST 12 — client restricted
{
  assert.ok(!ROLE_ACTION_GRANTS.client.includes('asset.view_price'));
  assert.ok(ROLE_ACTION_GRANTS.client.includes('asset.view'));
  console.log('PASS TEST12 client');
}

console.log('All RBAC V2 Phase 19 policy tests passed');
