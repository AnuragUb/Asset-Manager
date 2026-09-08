/**
 * Runtime regression for OAuth singleton reset + token-file safety.
 * Uses a dummy authorization code only. Does not print secrets.
 * Does not delete or rewrite production zoho_tokens.txt.
 *
 * Run: node scripts/zoho-oauth-runtime-regression.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const ZOHOCRMSDK = require('@zohocrm/nodejs-sdk-8.0');
const zoho = require('../services/zohoService');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

function ok(name) {
  console.log('PASS', name);
}

function redactError(err) {
  return {
    name: err && err.name,
    code: err && err.code,
    message: err && String(err.message || '').slice(0, 240)
  };
}

async function seedSdkLocalWithoutProdFile() {
  const tmp = path.join(os.tmpdir(), `zoho_reg_${Date.now()}.txt`);
  const resDir = path.join(os.tmpdir(), `zoho_res_${Date.now()}`);
  fs.mkdirSync(resDir, { recursive: true });
  const token = new ZOHOCRMSDK.OAuthBuilder()
    .clientId('dummy_client_id')
    .clientSecret('dummy_client_secret')
    .redirectURL('https://api.spvtm.com/api/zoho/oauth/callback')
    .accessToken('A'.repeat(40))
    .findUser(false)
    .build();
  const logger = new ZOHOCRMSDK.LogBuilder()
    .level(ZOHOCRMSDK.Levels.INFO)
    .filePath(path.join(os.tmpdir(), `zoho_reg_${Date.now()}.log`))
    .build();
  const builder = await new ZOHOCRMSDK.InitializeBuilder();
  await builder
    .environment(ZOHOCRMSDK.INDataCenter.PRODUCTION())
    .token(token)
    .store(new ZOHOCRMSDK.FileStore(tmp))
    .SDKConfig(new ZOHOCRMSDK.SDKConfigBuilder().autoRefreshFields(false).pickListValidation(false).build())
    .resourcePath(resDir)
    .logger(logger)
    .initialize();
  assert(ZOHOCRMSDK.Initializer.LOCAL.size > 0, 'seed LOCAL populated');
}

async function main() {
  const tokenPath = zoho.getTokenFilePath();
  assert(fs.existsSync(tokenPath), 'prod token file exists');
  const before = fs.readFileSync(tokenPath);
  const beforeText = before.toString('utf8');

  await seedSdkLocalWithoutProdFile();
  ok('seed_previous_sdk_init');

  const t0 = Date.now();
  let err = null;
  try {
    await zoho.init({
      authorizationCode: 'FORENSIC_DUMMY_CODE_NOT_REAL',
      force: true
    });
  } catch (e) {
    err = e;
  }
  const ms = Date.now() - t0;
  const after = fs.readFileSync(tokenPath);
  assert(Buffer.compare(before, after) === 0, 'token file unchanged after failed dummy grant');
  assert(err, 'dummy grant must fail');
  const info = redactError(err);
  const blob = `${info.code || ''} ${info.message || ''}`.toLowerCase();
  assert(!blob.includes("reading 'length'"), `must not be undefined.length: ${JSON.stringify(info)}`);
  assert(
    blob.includes('invalid_code') ||
      blob.includes('invalid token') ||
      blob.includes('access token is not present'),
    `expected Zoho invalid_code, got ${JSON.stringify(info)}`
  );
  console.log('PASS dummy_grant_reaches_zoho', JSON.stringify({ ms, ...info }));

  const health = await zoho.checkConnection();
  assert(health && typeof health.status === 'string', 'checkConnection returns status');
  assert(
    ['NOT_AUTHORIZED', 'NOT_CONFIGURED', 'API_ERROR', 'TOKEN_REFRESH_FAILED', 'CONNECTED', 'ZOHO_UNREACHABLE'].includes(
      health.status
    ),
    `checkConnection status ${health.status}`
  );
  console.log('PASS checkConnection', health.status);
  // Header-only FileStore should not look authorized.
  if (!zoho.hasPersistedTokens()) {
    assert(health.status === 'NOT_AUTHORIZED' || health.status === 'NOT_CONFIGURED', 'unauthorized while header-only');
  }

  assert(beforeText.includes('refresh_token'), 'snapshot still header-shaped');
  ok('ALL_RUNTIME_REGRESSION_PASS');
  process.exit(0);
}

main().catch((e) => {
  console.error(JSON.stringify(redactError(e)));
  process.exit(1);
});
