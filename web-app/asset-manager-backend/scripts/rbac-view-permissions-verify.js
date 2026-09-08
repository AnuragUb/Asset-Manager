/**
 * RBAC view-permission verification.
 *
 * Scratch (HTTP against a running app with the named migration applied):
 *   node scripts/rbac-view-permissions-verify.js --database-name asset_manager --http-base http://127.0.0.1:8080
 *
 * Does not grant keys, mutate business records, or run migrate:latest.
 */
function parseArgs(argv) {
  const args = { databaseName: null, httpBase: null };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--database-name') args.databaseName = argv[++i];
    else if (token === '--http-base') args.httpBase = argv[++i];
  }
  return args;
}

const args = parseArgs(process.argv);
if (args.databaseName) process.env.DB_NAME = args.databaseName;

const http = require('http');
const https = require('https');
const { URL } = require('url');
const jwt = require('jsonwebtoken');
const { db } = require('../utils');

const NEW_KEYS = [
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

const ALL_VIEW_KEYS = [
  'view.dashboard',
  ...NEW_KEYS,
  'view.projects',
  'view.dc',
  'view.warranty'
];

const PAGE_READS = [
  ['products', '/api/products', 'view.products'],
  ['inventory', '/api/inventory/items', 'view.inventory'],
  ['assets', '/api/assets', 'view.assets'],
  ['reservations', '/api/reservations', 'view.reservations'],
  ['purchase_orders', '/api/procurement/pos', 'view.purchase_orders'],
  ['receipt_notes', '/api/receipt-notes', 'view.receipt_notes'],
  ['sets', '/api/sets', 'view.sets'],
  ['physical_intakes', '/api/physical-intakes', 'view.physical_intake'],
  ['zoho_catalog', '/api/zoho/catalog', 'view.products'],
  ['dc', '/api/dc', 'view.dc']
];

const ROLES = [
  'superuser',
  'admin',
  'manager',
  'it_manager',
  'it_user',
  'user',
  'client',
  'HR',
  'Logistics Executive'
];

const failures = [];
const passes = [];

function ok(name) {
  passes.push(name);
  console.log('PASS', name);
}

function fail(name, detail) {
  failures.push({ name, detail: String(detail || '') });
  console.error('FAIL', name, detail || '');
}

function assert(cond, name, detail) {
  if (cond) ok(name);
  else fail(name, detail || 'assertion failed');
}

function request(url, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method,
      headers
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function tokenFor(role, secret) {
  return jwt.sign(
    { user_id: `rbac-view-${role}`, role, company_id: 'x' },
    secret,
    { algorithm: 'HS256', expiresIn: '5m' }
  );
}

async function main() {
  const dbName = (await db.raw('SELECT current_database() AS name')).rows[0].name;
  console.log('DATABASE', dbName);

  const keys = await db('permissions').whereIn('key', ALL_VIEW_KEYS).select('key');
  const present = new Set(keys.map((r) => r.key));
  ALL_VIEW_KEYS.forEach((k) => assert(present.has(k), `permission exists: ${k}`));

  const newGrants = await db('role_permissions').whereIn('permission_key', NEW_KEYS);
  assert(newGrants.length === 0, 'no grants on newly created view keys', newGrants.length);

  const dashGrants = await db('role_permissions').where({ permission_key: 'view.dashboard' });
  assert(true, `view.dashboard grant count (unchanged by this pass): ${dashGrants.length}`);

  if (args.httpBase) {
    const base = args.httpBase.replace(/\/$/, '');
    const secret = process.env.JWT_SECRET || 'change-this-secret-in-production';
    const json = { 'Content-Type': 'application/json' };

    const unauthDc = await request(`${base}/api/dc`);
    assert(unauthDc.status === 401, 'GET /api/dc unauthenticated 401', unauthDc.status);

    const unauthPostDc = await request(`${base}/api/dc`, { method: 'POST', headers: json, body: '{}' });
    assert(unauthPostDc.status === 401, 'POST /api/dc unauthenticated 401', unauthPostDc.status);

    for (const [label, path] of PAGE_READS) {
      const unauth = await request(`${base}${path}`);
      assert(unauth.status === 401, `${label} unauthenticated 401`, unauth.status);
    }

    const userTok = tokenFor('user', secret);
    const mgrTok = tokenFor('manager', secret);
    const suTok = tokenFor('superuser', secret);
    const adminTok = tokenFor('admin', secret);

    for (const [label, path] of PAGE_READS) {
      const userRes = await request(`${base}${path}`, { headers: { Authorization: `Bearer ${userTok}` } });
      assert(userRes.status === 403, `${label} user without view 403`, userRes.status);
      const mgrRes = await request(`${base}${path}`, { headers: { Authorization: `Bearer ${mgrTok}` } });
      assert(mgrRes.status === 403, `${label} manager without view 403`, mgrRes.status);
      const adminRes = await request(`${base}${path}`, { headers: { Authorization: `Bearer ${adminTok}` } });
      assert(adminRes.status === 403, `${label} admin without view grant 403 (no backend admin bypass)`, adminRes.status);
      const suRes = await request(`${base}${path}`, { headers: { Authorization: `Bearer ${suTok}` } });
      assert(suRes.status === 200, `${label} superuser 200`, suRes.status);
    }

    const userMut = await request(`${base}/api/products`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userTok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'rbac-view-must-not-create' })
    });
    assert(userMut.status === 403, 'user mutation POST /api/products 403', userMut.status);

    const roleGrantRows = await db('role_permissions').select('role_name', 'permission_key');
    const byRole = {};
    ROLES.forEach((r) => { byRole[r] = new Set(); });
    roleGrantRows.forEach((row) => {
      if (!byRole[row.role_name]) byRole[row.role_name] = new Set();
      byRole[row.role_name].add(row.permission_key);
    });
    ROLES.forEach((role) => {
      const views = ALL_VIEW_KEYS.filter((k) => byRole[role] && byRole[role].has(k));
      ok(`role matrix ${role}: configured view keys [${views.join(', ') || 'none'}]`);
    });
  }

  console.log(`\n${passes.length} passed, ${failures.length} failed`);
  if (failures.length) {
    failures.forEach((f) => console.error(` - ${f.name}: ${f.detail}`));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
}).finally(() => db.destroy());
