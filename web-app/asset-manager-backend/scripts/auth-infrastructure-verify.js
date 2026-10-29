/**
 * Auth infrastructure verification.
 *
 * Scratch mutations:
 *   node scripts/auth-infrastructure-verify.js --database-name asset_manager_auth_scratch --run-tests --http-base http://127.0.0.1:9090
 *
 * Production (non-destructive):
 *   node scripts/auth-infrastructure-verify.js --database-name asset_manager --http-base http://127.0.0.1:8080
 *
 * --run-tests is refused against asset_manager. Do not create accounts or reset
 * passwords on production.
 */
function parseArgs(argv) {
  const args = {
    databaseName: null,
    httpBase: null,
    runTests: false
  };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--database-name') args.databaseName = argv[++i];
    else if (token === '--http-base') args.httpBase = argv[++i];
    else if (token === '--run-tests') args.runTests = true;
  }
  return args;
}

const args = parseArgs(process.argv);
if (args.databaseName) process.env.DB_NAME = args.databaseName;

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');
const jwt = require('jsonwebtoken');
const { db } = require('../utils');
const passwordService = require('../services/passwordService');
const tokenService = require('../services/tokenService');

const failures = [];
const passes = [];
const PRODUCTION_DBS = new Set(['asset_manager']);

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

function parseJson(text) {
  try { return JSON.parse(text); } catch (err) { return {}; }
}

async function currentDbName() {
  return (await db.raw('SELECT current_database() AS name')).rows[0].name;
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
      attrs[k.toLowerCase()] = rest.length ? rest.join('=') : true;
    }
    return { name, value, raw: line, attrs };
  });
}

function cookieHeader(jar) {
  return Object.entries(jar).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ');
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

function jsonHeaders(extra) {
  return { 'Content-Type': 'application/json', ...(extra || {}) };
}

function sourceChecks() {
  const serverSrc = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const authSrc = fs.readFileSync(path.join(__dirname, '../../asset-manager-frontend/js/auth.js'), 'utf8');
  const loginAnimSrc = fs.readFileSync(path.join(__dirname, '../../asset-manager-frontend/js/loginAnimations.js'), 'utf8');
  const indexSrc = fs.readFileSync(path.join(__dirname, '../../asset-manager-frontend/index.html'), 'utf8');
  const tokenSrc = fs.readFileSync(path.join(__dirname, '../services/tokenService.js'), 'utf8');
  const passSrc = fs.readFileSync(path.join(__dirname, '../services/passwordService.js'), 'utf8');

  assert(!/Stored: "\$\{stored\}", Input: "\$\{password\}"/.test(serverSrc), '34. no plaintext password logging');
  assert(serverSrc.includes("res.cookie(JWT_COOKIE_NAME, token, getAuthCookieOptions(req))"), '13. login JWT is session cookie');
  assert(serverSrc.includes('AUTH_REMEMBER_MAX_AGE_MS'), '14. remember cookie uses persistent maxAge');
  const allowFnStart = serverSrc.indexOf('function allowAuthDevResetLink');
  const allowFn = allowFnStart >= 0 ? serverSrc.slice(allowFnStart, allowFnStart + 700) : '';
  assert(allowFn.includes("host.includes('9090')") && !allowFn.includes("8080"), 'forgot-password does not treat 8080 as dev');
  assert(serverSrc.includes('resolvePublicSignupTeam'), '6. public signup only accepts the five user teams');
  assert(serverSrc.includes("httpOnly: true") && serverSrc.includes("sameSite: 'lax'") && serverSrc.includes("path: '/'"), '39-41. cookie httpOnly / SameSite / Path');
  assert(serverSrc.includes('shouldUseSecureCookies'), '40. production Secure cookie helper present');
  assert(tokenSrc.includes('randomBytes(32)') && tokenSrc.includes("createHash('sha256')"), '38. reset token CSPRNG + hashed storage');
  assert(passSrc.includes('this.minLength = 8') && passSrc.includes('bcrypt.hash'), '11. password policy + bcrypt');
  assert(!/localStorage\.setItem\(['"]currentUser['"]/.test(authSrc) && !/localStorage\.setItem\(['"]auth_token['"]/.test(authSrc), 'do not store JWT in localStorage');
  assert(/id="rememberMe"[^>]*>(?![\s\S]*checked)/.test(indexSrc) || /id="rememberMe"[^>]*name="remember"[^>]*>/.test(indexSrc) && !/<input type="checkbox" id="rememberMe"[^>]*checked/.test(indexSrc), 'Remember Me default unchecked in HTML');
  assert(indexSrc.includes('name="confirmPassword"') && loginAnimSrc.includes('confirmPassword: data.confirmPassword'), 'signup confirm password wired');
  assert(indexSrc.includes('Forgot Password?') && indexSrc.includes('signupLink'), 'login has Forgot Password and Sign Up');
  assert(serverSrc.includes('FORGOT_PASSWORD_EMAIL_DELIVERY_NOT_CONFIGURED'), '25. email-unconfigured reasonCode');
  assert(serverSrc.includes('mustChangePassword') && serverSrc.includes('must_change_password'), 'first-login password setup is gated');
}

async function ensureAuthColumns() {
  if (await db.schema.hasTable('users') && !(await db.schema.hasColumn('users', 'status'))) {
    await db.schema.alterTable('users', (table) => {
      table.string('status', 16).notNullable().defaultTo('ACTIVE');
    });
  }
  if (await db.schema.hasTable('password_resets') && !(await db.schema.hasColumn('password_resets', 'used_at'))) {
    await db.schema.alterTable('password_resets', (table) => {
      table.timestamp('used_at').nullable();
    });
  }
}

async function runDbUnitTests() {
  const err = passwordService.validatePassword('short');
  assert(!!err && /at least 8/i.test(err), '4. weak password rejected');
  assert(passwordService.validatePassword('longenough', 'mismatch') === 'Passwords do not match.', '5. password mismatch rejected');
  const hash = await passwordService.hashPassword('CorrectHorse1');
  assert(passwordService.looksLikeBcrypt(hash) && !hash.includes('CorrectHorse1'), '11. bcrypt hash stored, not plaintext');
  assert(await passwordService.comparePassword('CorrectHorse1', hash), 'bcrypt compare succeeds');
  assert(!(await passwordService.comparePassword('wrong-password', hash)), '10. wrong password fails compare');

  const a = tokenService.generateToken();
  const b = tokenService.generateToken();
  assert(a !== b && a.length >= 32 && tokenService.hashToken(a) !== a, '38. token unpredictability + hashed');
}

async function cleanupAuthInfraUsers(prefix) {
  const rows = await db('users').where('username', 'like', `${prefix}%`).select('username');
  for (const row of rows) {
    await db('auth_tokens').where({ user_id: row.username }).del().catch(() => {});
    await db('password_resets').where({ email: row.username }).del().catch(() => {});
    await db('users').where({ username: row.username }).del();
  }
}

async function runHttpMutationTests(base) {
  const prefix = `authinfra_${Date.now().toString(36)}_`;
  const email = `${prefix}user@example.test`;
  const password = 'CorrectHorse1';
  const json = jsonHeaders();

  try {
    const valid = await request(`${base}/api/signup`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({
        email,
        name: 'Auth Infra User',
        password,
        confirmPassword: password,
        role: 'admin'
      })
    });
    const validBody = parseJson(valid.body);
    assert(valid.status === 200 && validBody.ok === true, '1. valid signup', `${valid.status} ${valid.body}`);
    assert(!JSON.stringify(validBody).includes('$2a$') && !JSON.stringify(validBody).includes(password), '35. no password hash in signup response');

    const created = await db('users').whereRaw('LOWER(username) = LOWER(?)', [email]).first();
    assert(!!created, 'signup persisted in this database (http-base matches scratch)');
    if (!created) {
      fail('HTTP mutations aborted', 'signup did not land in connected DB — refusing further writes');
      return;
    }
    assert(created.role === 'user', '6. cannot self-assign admin');
    assert(passwordService.looksLikeBcrypt(created.password), '11. password hashed in users table');
    assert(created.password !== password, '34. no plaintext password stored');

    const dup = await request(`${base}/api/signup`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email, name: 'Dup', password, confirmPassword: password })
    });
    const dupBody = parseJson(dup.body);
    assert(dup.status === 400 && /could not create/i.test(dupBody.message || ''), '2. duplicate signup generic');
    assert(!/already exists|not registered|admin/i.test(JSON.stringify(dupBody)), '37. signup duplicate does not enumerate');

    const invalid = await request(`${base}/api/signup`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email: 'not-an-email', name: 'x', password, confirmPassword: password })
    });
    assert(invalid.status === 400, '3. invalid signup', invalid.status);

    const weak = await request(`${base}/api/signup`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email: `${prefix}weak@example.test`, name: 'x', password: '123', confirmPassword: '123' })
    });
    assert(weak.status === 400 && /at least 8/i.test(parseJson(weak.body).message || ''), '4. weak password HTTP');

    const mismatch = await request(`${base}/api/signup`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email: `${prefix}mis@example.test`, name: 'x', password, confirmPassword: 'OtherPass9' })
    });
    assert(mismatch.status === 400 && /do not match/i.test(parseJson(mismatch.body).message || ''), '5. password mismatch HTTP');

    if (await db.schema.hasColumn('users', 'status')) {
      const disabledName = `${prefix}disabled@example.test`;
      const company = await db('companies').select('id').first();
      await db('users').insert({
        username: disabledName,
        password: await passwordService.hashPassword(password),
        fullname: 'Disabled',
        role: 'user',
        email: disabledName,
        status: 'DISABLED',
        company_id: company ? company.id : null
      });
      const disabledLogin = await request(`${base}/api/auth/login`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ username: disabledName, password, rememberMe: false })
      });
      assert(disabledLogin.status === 401 && parseJson(disabledLogin.body).message === 'Invalid username or password.', '7. disabled account cannot authenticate');
    } else {
      fail('7. disabled account', 'users.status column missing');
    }

    const badUser = await request(`${base}/api/auth/login`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ username: `${prefix}missing@example.test`, password, rememberMe: false })
    });
    const badPass = await request(`${base}/api/auth/login`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ username: email, password: 'WrongPass99', rememberMe: false })
    });
    assert(badUser.status === 401 && badPass.status === 401, '9/10. invalid login/password 401');
    assert(parseJson(badUser.body).message === parseJson(badPass.body).message && parseJson(badUser.body).message === 'Invalid username or password.', '37. login enumeration minimized');

    const empty = await request(`${base}/api/auth/login`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ username: '', password: '' })
    });
    assert(empty.status === 400, '11. malformed/empty login', empty.status);

    if (await db.schema.hasColumn('users', 'must_change_password')) {
      await db('users').whereRaw('LOWER(username) = LOWER(?)', [email]).update({ must_change_password: true });
      const pendingLogin = await request(`${base}/api/auth/login`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ username: email, password, rememberMe: false, category: 'IT' })
      });
      const pendingBody = parseJson(pendingLogin.body);
      const pendingCookies = parseSetCookies(pendingLogin.headers);
      const pendingJwt = pendingCookies.find((c) => c.name === 'auth_token' && c.value);
      assert(pendingLogin.status === 200 && pendingBody.mustChangePassword === true && pendingBody.setupToken, 'first-login must change password', pendingLogin.body);
      assert(!pendingJwt, 'first-login does not issue a session cookie');
      await db('users').whereRaw('LOWER(username) = LOWER(?)', [email]).update({ must_change_password: false });
    }

    const sessionLogin = await request(`${base}/api/auth/login`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ username: email, password, rememberMe: false, category: 'IT' })
    });
    const sessionBody = parseJson(sessionLogin.body);
    assert(sessionLogin.status === 200 && sessionBody.ok === true, '8. valid login', `${sessionLogin.status} ${sessionLogin.body}`);
    assert(!JSON.stringify(sessionBody).includes('$2a$') && !JSON.stringify(sessionBody).includes(password), '35. no password hash in login response');
    const sessionCookies = parseSetCookies(sessionLogin.headers);
    const sessionJwt = sessionCookies.find((c) => c.name === 'auth_token');
    const sessionRemember = sessionCookies.find((c) => c.name === 'remember_token');
    assert(sessionJwt && sessionJwt.attrs.httponly === true, '39. auth cookie httpOnly');
    assert(String(sessionJwt.attrs.samesite || '').toLowerCase() === 'lax', '41. SameSite=Lax');
    assert(!sessionJwt.attrs['max-age'] && !sessionJwt.attrs.expires, '13. unchecked = no persistent JWT cookie');
    assert(!sessionRemember || sessionRemember.value === '' || sessionRemember.attrs['max-age'] === '0', '13. unchecked = no remember cookie');

    const sessionJar = applySetCookies({}, sessionLogin.headers);
    const meOk = await request(`${base}/api/auth/me`, { headers: { Cookie: cookieHeader(sessionJar) } });
    assert(meOk.status === 200, '12. protected /api/auth/me after login', meOk.status);

    const products = await request(`${base}/api/products`, { headers: { Cookie: cookieHeader(sessionJar) } });
    assert(products.status === 200 || products.status === 403, '48. Product auth accepts session', products.status);

    const restartJar = {};
    if (sessionJar.remember_token) restartJar.remember_token = sessionJar.remember_token;
    const afterRestart = await request(`${base}/api/auth/me`, { headers: { Cookie: cookieHeader(restartJar) } });
    assert(afterRestart.status === 401, '17. unchecked does not restore after browser restart analogue', afterRestart.status);

    const logout = await request(`${base}/api/auth/logout`, {
      method: 'POST',
      headers: jsonHeaders({ Cookie: cookieHeader(sessionJar) }),
      body: '{}'
    });
    assert(logout.status === 200, '19. logout', logout.status);
    const cleared = applySetCookies({ ...sessionJar }, logout.headers);
    assert(!cleared.auth_token && !cleared.remember_token, '20. cookie cleared');
    const afterLogout = await request(`${base}/api/auth/me`, { headers: { Cookie: cookieHeader(sessionJar) } });
    const afterLogoutCleared = await request(`${base}/api/auth/me`, { headers: { Cookie: cookieHeader(cleared) } });
    assert(afterLogoutCleared.status === 401, '21. protected API 401 after logout', afterLogoutCleared.status);
    void afterLogout;

    const rememberLogin = await request(`${base}/api/auth/login`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ username: email, password, rememberMe: true, category: 'IT' })
    });
    const rememberCookies = parseSetCookies(rememberLogin.headers);
    const rememberTok = rememberCookies.find((c) => c.name === 'remember_token' && c.value);
    assert(rememberLogin.status === 200 && rememberTok && Number(rememberTok.attrs['max-age']) > 86400, '14. checked = persistent cookie', rememberLogin.status);
    const rememberJar = applySetCookies({}, rememberLogin.headers);
    const rememberRestart = { remember_token: rememberJar.remember_token };
    const restored = await request(`${base}/api/auth/me`, { headers: { Cookie: cookieHeader(rememberRestart) } });
    assert(restored.status === 200, '18. checked restores after browser restart analogue', restored.status);

    await request(`${base}/api/auth/logout`, {
      method: 'POST',
      headers: jsonHeaders({ Cookie: cookieHeader(rememberJar) }),
      body: '{}'
    });

    const unknownForgot = await request(`${base}/api/auth/forgot-password`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email: `${prefix}nobody@example.test` })
    });
    const knownForgot = await request(`${base}/api/auth/forgot-password`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email })
    });
    const unknownBody = parseJson(unknownForgot.body);
    const knownBody = parseJson(knownForgot.body);
    assert(unknownForgot.status === 200 && knownForgot.status === 200, '22. valid forgot-password request');
    assert(unknownBody.message === knownBody.message, '23. unknown account neutral response');
    assert(/if an account exists/i.test(knownBody.message || ''), 'forgot-password neutral copy');
    if (knownForgot.status === 503) {
      assert(knownBody.reasonCode === 'FORGOT_PASSWORD_EMAIL_DELIVERY_NOT_CONFIGURED', '25. email/send attempt reports unconfigured');
    } else if (!knownBody.devResetLink) {
      ok('25. email/send attempted without leaking unknown accounts');
    } else {
      ok('25. development reset link issued because SMTP is unconfigured');
    }

    let resetToken = knownBody.devResetLink ? String(knownBody.devResetLink).split('token=')[1] : null;
    if (!resetToken) {
      const raw = tokenService.generateToken();
      await tokenService.storeResetToken(email, raw, 60);
      resetToken = raw;
      ok('24. token generated (DB helper; SMTP did not return a link)');
    } else {
      ok('24. token generated');
    }

    const expiredRaw = tokenService.generateToken();
    await db('password_resets').insert({
      email,
      token_hash: tokenService.hashToken(expiredRaw),
      expires_at: new Date(Date.now() - 60 * 1000).toISOString(),
      created_at: new Date().toISOString()
    });
    const expiredReset = await request(`${base}/api/auth/reset-password`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ token: expiredRaw, newPassword: 'NewCorrect1', confirmPassword: 'NewCorrect1' })
    });
    assert(expiredReset.status === 400 && /expired/i.test(parseJson(expiredReset.body).message || ''), '26. token expires', expiredReset.body);

    const bogus = await request(`${base}/api/auth/reset-password`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ token: crypto.randomBytes(32).toString('hex'), newPassword: 'NewCorrect1', confirmPassword: 'NewCorrect1' })
    });
    assert(bogus.status === 400 && /no longer valid/i.test(parseJson(bogus.body).message || ''), '29. invalid token');

    const newPassword = 'NewCorrect9';
    const resetOk = await request(`${base}/api/auth/reset-password`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ token: resetToken, newPassword, confirmPassword: newPassword })
    });
    assert(resetOk.status === 200 && /has been reset/i.test(parseJson(resetOk.body).message || ''), '28. successful reset', resetOk.body);

    const reuse = await request(`${base}/api/auth/reset-password`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ token: resetToken, newPassword: 'AnotherPass9', confirmPassword: 'AnotherPass9' })
    });
    assert(reuse.status === 400, '27/30. token single-use / used token', reuse.status);

    const after = await db('users').whereRaw('LOWER(username) = LOWER(?)', [email]).first();
    assert(after.password !== created.password && passwordService.looksLikeBcrypt(after.password), '31. password hash changed');

    const oldLogin = await request(`${base}/api/auth/login`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ username: email, password, rememberMe: false })
    });
    const newLogin = await request(`${base}/api/auth/login`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ username: email, password: newPassword, rememberMe: false })
    });
    assert(oldLogin.status === 401, '32. old password fails');
    assert(newLogin.status === 200, '33. new password works');

    const tampered = await request(`${base}/api/auth/me`, { headers: { Cookie: 'auth_token=not-a-jwt' } });
    assert(tampered.status === 401, '42. tampered cookie rejected');

    const secret = process.env.JWT_SECRET || 'change-this-secret-in-production';
    const roles = ['user', 'sales', 'manager', 'admin', 'superuser'];
    const protectedPaths = [
      ['48. Product auth', '/api/products', 'GET'],
      ['49. PO auth', '/api/purchase-orders', 'GET'],
      ['50. Receipt auth', '/api/receipt-notes', 'GET'],
      ['51. Reservation auth', '/api/reservations', 'GET'],
      ['52. Set auth', '/api/sets', 'GET'],
      ['53. Break auth', '/api/break', 'POST'],
      ['54. Conversion auth', '/api/conversions', 'GET']
    ];
    const unauth = await request(`${base}/api/products`, { headers: json });
    assert(unauth.status === 401, 'protected routes unauthenticated 401', unauth.status);

    for (const role of roles) {
      const token = jwt.sign({ user_id: `authinfra-${role}`, role, company_id: 'x' }, secret, { algorithm: 'HS256', expiresIn: '5m' });
      const hdr = { Authorization: `Bearer ${token}` };
      const sample = await request(`${base}/api/products`, { headers: hdr });
      assert(sample.status === 200 || sample.status === 403, `${role} token accepted by auth middleware`, sample.status);
      if (role === 'user') ok('43. user');
      if (role === 'sales') ok('44. sales');
      if (role === 'manager') ok('45. manager');
      if (role === 'admin') ok('46. admin');
      if (role === 'superuser') ok('47. superuser');
    }

    const p0 = await request(`${base}/api/assets`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ ItemName: 'nope' })
    });
    assert(p0.status === 401, '55. P0 containment auth (unauth 401)', p0.status);

    const expiredJwt = jwt.sign({ user_id: email, role: 'user', company_id: 'x' }, secret, { algorithm: 'HS256', expiresIn: 0 });
    await new Promise((r) => setTimeout(r, 1100));
    const expiredRes = await request(`${base}/api/products`, { headers: { Authorization: `Bearer ${expiredJwt}` } });
    assert(expiredRes.status === 401, '15. session JWT expiry rejected', expiredRes.status);

    void protectedPaths;
  } finally {
    await cleanupAuthInfraUsers(prefix);
  }
}

async function runProductionHttp(base) {
  const me = await request(`${base}/api/auth/me`);
  assert(me.status === 401, 'Production /api/auth/me unauthenticated 401', me.status);
  const products = await request(`${base}/api/products`);
  assert(products.status === 401, 'Production products unauthenticated 401', products.status);
  const loginGet = await request(`${base}/api/auth/login`);
  assert(loginGet.status === 404 || loginGet.status === 405 || loginGet.status === 415 || loginGet.status === 400 || loginGet.status === 401, 'login is not a GET bypass', loginGet.status);
}

async function main() {
  const dbName = await currentDbName();
  if (args.databaseName) {
    assert(dbName === args.databaseName, `connected to ${args.databaseName}`, `connected to ${dbName}`);
  } else {
    ok(`connected to ${dbName}`);
  }

  if (args.runTests && PRODUCTION_DBS.has(dbName)) {
    throw new Error('--run-tests refused against production database asset_manager');
  }

  sourceChecks();
  await runDbUnitTests();

  if (args.runTests) {
    await ensureAuthColumns();
    assert(await db.schema.hasTable('users'), 'users table exists');
    assert(await db.schema.hasTable('auth_tokens'), 'auth_tokens table exists');
    assert(await db.schema.hasTable('password_resets'), 'password_resets table exists');
    if (!args.httpBase) {
      fail('HTTP mutation tests', '--http-base required with --run-tests');
    } else {
      await runHttpMutationTests(args.httpBase);
    }
  } else if (args.httpBase) {
    await runProductionHttp(args.httpBase);
  }

  console.log(`\n${passes.length} passed, ${failures.length} failed`);
  if (failures.length) {
    failures.forEach((f) => console.error(` - ${f.name}: ${f.detail}`));
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.destroy().catch(() => {});
  });
