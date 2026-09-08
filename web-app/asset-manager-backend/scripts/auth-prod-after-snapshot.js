/**
 * Non-destructive production after-snapshot + remaining auth probes.
 * No passwords, no user create, cookie values redacted.
 */
const http = require('http');
const { db } = require('../utils');

function request(path, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 8080,
      path,
      method,
      headers
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function cookieAttrs(headerMap) {
  const raw = headerMap['set-cookie'] || [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter(Boolean).map((line) => {
    const parts = String(line).split(';').map((p) => p.trim());
    const name = parts[0].split('=')[0];
    const attrs = { name };
    for (let i = 1; i < parts.length; i += 1) {
      const [k, ...rest] = parts[i].split('=');
      attrs[String(k).toLowerCase()] = rest.length ? rest.join('=') : true;
    }
    return attrs;
  });
}

(async () => {
  const json = { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:8080' };
  const snap = (await db.raw(`
    SELECT
      (SELECT count(*)::int FROM users) AS users,
      (SELECT count(*)::int FROM roles) AS roles,
      (SELECT count(*)::int FROM product) AS product,
      (SELECT count(*)::int FROM assets) AS assets,
      (SELECT count(*)::int FROM inventory_items) AS inventory_items,
      (SELECT count(*)::int FROM reservation) AS reservation,
      (SELECT count(*)::int FROM conversion) AS conversion,
      (SELECT count(*)::int FROM receipt_note) AS receipt_note,
      (SELECT count(*)::int FROM procurement_po) AS procurement_po,
      (SELECT count(*)::int FROM product_external_ref) AS product_external_ref,
      (SELECT count(*)::int FROM managed_sets) AS managed_sets,
      (SELECT count(*)::int FROM set_requirement) AS set_requirement
  `)).rows[0];
  const fp = (await db.raw(`
    SELECT md5(string_agg(username || '|' || role || '|' || coalesce(email,'') || '|' || length(password)::text, ',' ORDER BY username)) AS fp
    FROM users
  `)).rows[0].fp;
  const roleStatus = (await db.raw(`
    SELECT role, status, count(*)::int AS n FROM users GROUP BY role, status ORDER BY role, status
  `)).rows;
  const cols = {
    users_status: await db.schema.hasColumn('users', 'status'),
    password_resets_used_at: await db.schema.hasColumn('password_resets', 'used_at')
  };
  const latestMig = await db('knex_migrations').select('name', 'batch').orderBy('id', 'desc').limit(3);
  const abandoned = await db('knex_migrations').where({ name: '20260824120000_create_managed_sets_tables.js' }).first();
  const authMig = await db('knex_migrations').where({ name: '20260901120000_auth_infrastructure_hardening.js' }).first();

  const logout = await request('/api/auth/logout', { method: 'POST', headers: json, body: '{}' });
  const signupAdmin = await request('/api/auth/signup', {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ email: 'nobody-role@example.invalid', password: 'short', confirmPassword: 'short', role: 'admin' })
  });
  const signupMgr = await request('/api/signup', {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ email: 'nobody-role2@example.invalid', password: 'short', confirmPassword: 'short', role: 'manager' })
  });
  const signupSu = await request('/api/auth/signup', {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ email: 'nobody-role3@example.invalid', password: 'short', confirmPassword: 'short', role: 'superuser' })
  });
  const cors = await request('/api/auth/me', { headers: { Origin: 'http://example.com' } });
  const dbg = await request('/api/debug/cookies');
  const index = await request('/');
  const usersAfter = (await db.raw('SELECT count(*)::int AS n FROM users')).rows[0].n;

  console.log(JSON.stringify({
    snap,
    fp,
    roleStatus,
    cols,
    latestMig,
    authMigApplied: Boolean(authMig),
    abandonedManagedSetsRecorded: Boolean(abandoned),
    usersAfterSignupProbes: usersAfter,
    logoutStatus: logout.status,
    logoutCookieAttrs: cookieAttrs(logout.headers),
    signupAdmin: { status: signupAdmin.status, body: signupAdmin.body.slice(0, 160) },
    signupMgr: { status: signupMgr.status, body: signupMgr.body.slice(0, 160) },
    signupSu: { status: signupSu.status, body: signupSu.body.slice(0, 160) },
    acao: cors.headers['access-control-allow-origin'] || null,
    debugCookiesStatus: dbg.status,
    jwtSecretSet: Boolean(process.env.JWT_SECRET),
    jwtSecretIsLiteralFallback: process.env.JWT_SECRET === 'change-this-secret-in-production',
    nodeEnv: process.env.NODE_ENV,
    indexHas729: /main\.js\?v=7\.29/.test(index.body) && /style\.css\?v=7\.29/.test(index.body),
    rememberCheckedInHtml: /id=["']rememberMe["'][^>]*\bchecked\b/.test(index.body)
  }, null, 2));
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
}).finally(async () => {
  await db.destroy().catch(() => {});
});
