/**
 * Production live auth verification. No user create, no password reset, no role change.
 *
 * Optional password login:
 *   AUTH_LIVE_USERNAME / AUTH_LIVE_PASSWORD in the process environment.
 * If unset, password login is reported skipped (no guessing).
 */
const http = require('http');
const jwt = require('jsonwebtoken');
const { db } = require('../utils');

const BASE = process.env.AUTH_LIVE_BASE || 'http://127.0.0.1:8080';
const failures = [];
const passes = [];

function ok(name) { passes.push(name); console.log('PASS', name); }
function fail(name, detail) { failures.push({ name, detail: String(detail || '') }); console.error('FAIL', name, detail || ''); }
function assert(cond, name, detail) { if (cond) ok(name); else fail(name, detail || 'assertion failed'); }

function parseJson(text) { try { return JSON.parse(text); } catch (err) { return {}; } }

function request(url, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({
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
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function parseSetCookies(headerMap) {
  const raw = headerMap['set-cookie'] || [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter(Boolean).map((line) => {
    const parts = String(line).split(';').map((p) => p.trim());
    const eq = parts[0].indexOf('=');
    const name = parts[0].slice(0, eq);
    const value = parts[0].slice(eq + 1);
    const attrs = {};
    for (let i = 1; i < parts.length; i += 1) {
      const [k, ...rest] = parts[i].split('=');
      attrs[String(k).toLowerCase()] = rest.length ? rest.join('=') : true;
    }
    return { name, value, attrs, raw: line.replace(/=[^;]*/, '=REDACTED') };
  });
}

function applySetCookies(jar, headerMap) {
  for (const c of parseSetCookies(headerMap)) {
    const maxAge = c.attrs['max-age'];
    const expires = c.attrs.expires;
    if (c.value === '' || maxAge === '0' || (expires && Date.parse(expires) && Date.parse(expires) < Date.now())) {
      delete jar[c.name];
    } else {
      jar[c.name] = c.value;
    }
  }
  return jar;
}

function cookieHeader(jar) {
  return Object.entries(jar).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function main() {
  const dbName = (await db.raw('SELECT current_database() AS name')).rows[0].name;
  assert(dbName === 'asset_manager', 'connected to production asset_manager', dbName);

  const json = { 'Content-Type': 'application/json' };
  const me = await request(`${BASE}/api/auth/me`);
  assert(me.status === 401, 'GET /api/auth/me unauthenticated 401', me.status);

  const emptyLogin = await request(`${BASE}/api/auth/login`, {
    method: 'POST', headers: json, body: JSON.stringify({ username: '', password: '' })
  });
  assert(emptyLogin.status === 400 || emptyLogin.status === 401, 'empty login rejected', emptyLogin.status);

  const unknownLogin = await request(`${BASE}/api/auth/login`, {
    method: 'POST', headers: json, body: JSON.stringify({ username: 'no-such-user-auth-live', password: 'WrongPass99', rememberMe: false })
  });
  const unknownBody = parseJson(unknownLogin.body);
  assert(unknownLogin.status === 401 && unknownBody.message === 'Invalid username or password.', 'unknown login generic message', unknownLogin.body.slice(0, 200));

  const liveUser = String(process.env.AUTH_LIVE_USERNAME || '').trim();
  const livePass = String(process.env.AUTH_LIVE_PASSWORD || '');
  if (!liveUser || !livePass) {
    fail('password login', 'AUTH_LIVE_USERNAME/PASSWORD not set; existing production passwords were not guessed');
  } else {
    const sessionLogin = await request(`${BASE}/api/auth/login`, {
      method: 'POST', headers: json, body: JSON.stringify({ username: liveUser, password: livePass, rememberMe: false, category: 'IT' })
    });
    const sessionBody = parseJson(sessionLogin.body);
    assert(sessionLogin.status === 200 && sessionBody.ok === true, 'login success', sessionLogin.status);
    const sessionCookies = parseSetCookies(sessionLogin.headers);
    const jwtCookie = sessionCookies.find((c) => c.name === 'auth_token');
    const rememberCookie = sessionCookies.find((c) => c.name === 'remember_token');
    assert(jwtCookie && jwtCookie.attrs.httponly === true, 'auth_token httpOnly');
    assert(jwtCookie && jwtCookie.attrs.secure === true, 'auth_token Secure');
    assert(String(jwtCookie && jwtCookie.attrs.samesite || '').toLowerCase() === 'lax', 'auth_token SameSite=Lax');
    assert(jwtCookie && !jwtCookie.attrs['max-age'] && !jwtCookie.attrs.expires, 'unchecked Remember Me = session JWT');
    assert(!rememberCookie || rememberCookie.value === '' || rememberCookie.attrs['max-age'] === '0', 'unchecked Remember Me does not persist remember_token');

    const jar = applySetCookies({}, sessionLogin.headers);
    const meOk = await request(`${BASE}/api/auth/me`, { headers: { Cookie: cookieHeader(jar) } });
    assert(meOk.status === 200, 'authenticated /api/auth/me 200', meOk.status);

    const logout = await request(`${BASE}/api/auth/logout`, {
      method: 'POST', headers: { ...json, Cookie: cookieHeader(jar) }, body: '{}'
    });
    assert(logout.status === 200, 'logout', logout.status);
    const cleared = applySetCookies({ ...jar }, logout.headers);
    const after = await request(`${BASE}/api/auth/me`, { headers: { Cookie: cookieHeader(cleared) } });
    assert(after.status === 401, 'after logout /api/auth/me 401', after.status);

    const rememberLogin = await request(`${BASE}/api/auth/login`, {
      method: 'POST', headers: json, body: JSON.stringify({ username: liveUser, password: livePass, rememberMe: true, category: 'IT' })
    });
    const rememberCookies = parseSetCookies(rememberLogin.headers);
    const rememberTok = rememberCookies.find((c) => c.name === 'remember_token' && c.value);
    assert(rememberLogin.status === 200 && rememberTok && Number(rememberTok.attrs['max-age']) > 86400, 'checked Remember Me persistent cookie', rememberLogin.status);
    assert(rememberTok && rememberTok.attrs.httponly === true && rememberTok.attrs.secure === true, 'remember_token httpOnly+Secure');
    const rememberJar = applySetCookies({}, rememberLogin.headers);
    const restored = await request(`${BASE}/api/auth/me`, { headers: { Cookie: `remember_token=${rememberJar.remember_token}` } });
    assert(restored.status === 200, 'remember token restores /api/auth/me', restored.status);
    await request(`${BASE}/api/auth/logout`, {
      method: 'POST', headers: { ...json, Cookie: cookieHeader(rememberJar) }, body: '{}'
    });
  }

  const forgotA = await request(`${BASE}/api/auth/forgot-password`, {
    method: 'POST', headers: json, body: JSON.stringify({ email: 'nobody-a@example.invalid' })
  });
  const forgotB = await request(`${BASE}/api/auth/forgot-password`, {
    method: 'POST', headers: json, body: JSON.stringify({ email: 'nobody-b@example.invalid' })
  });
  const fa = parseJson(forgotA.body);
  const fb = parseJson(forgotB.body);
  assert(forgotA.status === forgotB.status, 'forgot-password same status for two unknown accounts', `${forgotA.status} vs ${forgotB.status}`);
  assert(fa.message === fb.message, 'forgot-password no enumeration', `${fa.message} vs ${fb.message}`);
  if (forgotA.status === 503) {
    assert(fa.reasonCode === 'FORGOT_PASSWORD_EMAIL_DELIVERY_NOT_CONFIGURED', 'SMTP unconfigured reported', fa.reasonCode);
    ok('FORGOT_PASSWORD_LIVE_EMAIL = NOT_TESTED');
  } else {
    assert(forgotA.status === 200 && /if an account exists/i.test(fa.message || ''), 'forgot-password reachable + neutral', forgotA.body.slice(0, 180));
    ok('FORGOT_PASSWORD_LIVE_EMAIL = NOT_TESTED');
  }
  assert(!fa.devResetLink && !fb.devResetLink, 'production forgot-password does not return reset links');

  const secret = process.env.JWT_SECRET || 'change-this-secret-in-production';
  const salesToken = jwt.sign({ user_id: 'live-sales', role: 'sales', company_id: 'x' }, secret, { algorithm: 'HS256', expiresIn: '5m' });
  const userToken = jwt.sign({ user_id: 'live-user', role: 'user', company_id: 'x' }, secret, { algorithm: 'HS256', expiresIn: '5m' });
  const mgrRow = await db('users').where({ role: 'manager' }).select('username', 'company_id').first();
  const mgrToken = jwt.sign({
    user_id: mgrRow ? mgrRow.username : 'live-manager',
    role: 'manager',
    company_id: mgrRow && mgrRow.company_id ? mgrRow.company_id : 'x'
  }, secret, { algorithm: 'HS256', expiresIn: '5m' });

  const assetBody = JSON.stringify({ ItemName: 'nope', Category: 'IT', Type: 'Hardware' });
  const unauthMut = await request(`${BASE}/api/assets`, { method: 'POST', headers: json, body: assetBody });
  const salesMut = await request(`${BASE}/api/assets`, { method: 'POST', headers: { ...json, Authorization: `Bearer ${salesToken}` }, body: assetBody });
  const userMut = await request(`${BASE}/api/assets`, { method: 'POST', headers: { ...json, Authorization: `Bearer ${userToken}` }, body: assetBody });
  assert(unauthMut.status === 401, 'privileged mutation unauth 401', unauthMut.status);
  assert(salesMut.status === 403, 'sales cannot privileged mutation', salesMut.status);
  assert(userMut.status === 403, 'user cannot privileged mutation', userMut.status);

  const reads = [
    ['Products', '/api/products'],
    ['Purchase Orders', '/api/procurement/pos'],
    ['Receipt Notes', '/api/receipt-notes'],
    ['Reservations', '/api/reservations'],
    ['Sets', '/api/sets'],
    ['Assets', '/api/assets'],
    ['Inventory', '/api/inventory/items']
  ];
  const mgrH = { Authorization: `Bearer ${mgrToken}` };
  for (const [label, path] of reads) {
    const unauth = await request(`${BASE}${path}`, { headers: json });
    assert(unauth.status === 401, `${label} unauth 401`, unauth.status);
    const auth = await request(`${BASE}${path}`, { headers: mgrH });
    assert(auth.status === 403, `${label} manager without view permission 403`, auth.status);
    const suH = { Authorization: `Bearer ${jwt.sign({ user_id: 'live-su', role: 'superuser', company_id: 'x' }, secret, { algorithm: 'HS256', expiresIn: '5m' })}` };
    const suRead = await request(`${BASE}${path}`, { headers: suH });
    assert(suRead.status === 200, `${label} superuser read ${suRead.status}`, suRead.body.slice(0, 120));
  }

  const usersAfter = (await db.raw('SELECT count(*)::int AS n FROM users')).rows[0].n;
  assert(usersAfter === 2, 'no production users created', usersAfter);

  console.log(`\n${passes.length} passed, ${failures.length} failed`);
  if (failures.length) {
    failures.forEach((f) => console.error(` - ${f.name}: ${f.detail}`));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
}).finally(async () => {
  await db.destroy().catch(() => {});
});
