/**
 * RBAC V2 smoke — role permission matrix + HTTP requirePermission checks.
 * Runs inside asset-manager-prod. Does not print secrets.
 */
const jwt = require('jsonwebtoken');
const http = require('http');
const { Client } = require('pg');
const { permissionEquivalents } = require('../services/permissionCatalog');

const ROLES = ['superuser', 'admin', 'manager', 'Logistics Executive', 'user', 'it_manager'];

const EXPECT = {
  superuser: { allow: ['receipt_note.post', 'category.delete', 'role.manage'], deny: [] },
  admin: {
    allow: ['receipt_note.post', 'manage.hierarchy', 'role.manage', 'dc.create'],
    deny: ['category.delete']
  },
  manager: {
    allow: ['receipt_note.post', 'dc.create', 'asset.edit_price'],
    deny: ['manage.hierarchy', 'user.manage', 'category.delete', 'zoho.oauth.manage']
  },
  'Logistics Executive': {
    allow: ['receipt_note.post', 'receipt_note.create', 'dc.create', 'purchase_order.refresh'],
    deny: ['receipt_note.reverse', 'dc.void', 'asset.edit_price', 'user.manage', 'manage.hierarchy']
  },
  user: {
    allow: ['asset.view', 'dashboard.view'],
    deny: ['receipt_note.post', 'asset.edit', 'dc.create']
  },
  it_manager: {
    allow: ['asset.edit', 'user.manage', 'recovery.restore', 'settings.edit'],
    deny: ['asset.create', 'receipt_note.post', 'dc.create', 'purchase_order.import']
  }
};

function hasPerm(role, grants, key) {
  if (role === 'superuser') return true;
  const set = new Set(grants);
  return permissionEquivalents(key).some((k) => set.has(k));
}

function request(method, path, token) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: Number(process.env.PORT || 8080),
        path,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Cookie: `auth_token=${token}`
        },
        timeout: 10000
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body: body.slice(0, 200) }));
      }
    );
    req.on('error', (err) => resolve({ status: 0, body: err.message }));
    if (method === 'POST') req.write('{}');
    req.end();
  });
}

async function main() {
  // Wait briefly for app listen after restart
  await new Promise((r) => setTimeout(r, 5000));

  const client = new Client({
    host: process.env.DB_HOST || 'postgres',
    database: process.env.DB_NAME || 'asset_manager',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'password',
    port: Number(process.env.DB_PORT || 5432)
  });
  await client.connect();

  const { rows } = await client.query('SELECT role_name, permission_key FROM role_permissions');
  const byRole = {};
  for (const r of rows) {
    if (!byRole[r.role_name]) byRole[r.role_name] = [];
    byRole[r.role_name].push(r.permission_key);
  }

  const results = [];
  let failed = 0;

  for (const role of ROLES) {
    const grants = byRole[role] || [];
    const exp = EXPECT[role];
    for (const key of exp.allow) {
      const ok = hasPerm(role, grants, key);
      results.push({ role, check: `ALLOW ${key}`, ok });
      if (!ok) failed += 1;
    }
    for (const key of exp.deny) {
      const ok = !hasPerm(role, grants, key);
      results.push({ role, check: `DENY ${key}`, ok });
      if (!ok) failed += 1;
    }
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.log('SKIP HTTP smoke: JWT_SECRET missing');
  } else {
    // Cookie name from server — try common paths
    const cases = [
      {
        role: 'user',
        method: 'GET',
        path: '/api/receipt-notes',
        expectStatus: [200, 403], // 403 if no view; 200 if view
        label: 'user GET receipt-notes'
      },
      {
        role: 'user',
        method: 'POST',
        path: '/api/receipt-notes/00000000-0000-0000-0000-000000000001/post',
        expectStatus: [403],
        label: 'user POST receipt-note.post → 403'
      },
      {
        role: 'Logistics Executive',
        method: 'GET',
        path: '/api/receipt-notes',
        expectStatus: [200],
        label: 'logistics GET receipt-notes'
      },
      {
        role: 'manager',
        method: 'GET',
        path: '/api/receipt-notes',
        expectStatus: [200],
        label: 'manager GET receipt-notes'
      },
      {
        role: 'it_manager',
        method: 'POST',
        path: '/api/receipt-notes',
        expectStatus: [403],
        label: 'it_manager POST receipt-notes → 403'
      },
      {
        role: 'admin',
        method: 'GET',
        path: '/api/receipt-notes',
        expectStatus: [200],
        label: 'admin GET receipt-notes'
      }
    ];

    for (const c of cases) {
      const token = jwt.sign(
        {
          username: `smoke_${c.role}`,
          role: c.role,
          user_id: `smoke_${c.role}`,
          company_id: 'smoke'
        },
        secret,
        { expiresIn: '10m' }
      );
      const res = await request(c.method, c.path, token);
      const ok = c.expectStatus.includes(res.status);
      results.push({ role: c.role, check: `${c.label} (HTTP ${res.status})`, ok });
      if (!ok) failed += 1;
    }
  }

  await client.end();

  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'} [${r.role}] ${r.check}`);
  }
  console.log(failed === 0 ? 'SMOKE_OK' : `SMOKE_FAIL count=${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('SMOKE_ERROR', err.message);
  process.exit(2);
});
