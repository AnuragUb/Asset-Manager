/**
 * Synthetic FileStore/OAuth tests — no Production tokens/credentials.
 * Run: node scripts/zoho-filestore-oauth-smoke.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const ZOHOCRMSDK = require('@zohocrm/nodejs-sdk-8.0');
const zoho = require('../services/zohoService');

const parse = zoho.parseZohoFileStoreCredentials;
const HDR =
  'id,user_name,client_id,client_secret,refresh_token,access_token,grant_token,expiry_time,redirect_url,api_domain';

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

function ok(name) {
  console.log('PASS', name);
}

async function main() {
  // A. Missing token file
  assert(parse('') === null, 'A empty parse');
  {
    const realE = fs.existsSync;
    fs.existsSync = (p) => (String(p).includes('zoho_tokens') ? false : realE(p));
    assert(zoho.hasPersistedTokens() === false, 'A hasPersistedTokens');
    fs.existsSync = realE;
  }
  ok('A_missing_token_file');

  // B. Header-only FileStore (SDK constructor)
  const tmp = path.join(os.tmpdir(), 'zoho_test_hdr_' + Date.now() + '.txt');
  if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  // eslint-disable-next-line no-new
  new ZOHOCRMSDK.FileStore(tmp);
  const hdrRaw = fs.readFileSync(tmp, 'utf8');
  assert(hdrRaw.split(/\r?\n/).filter((l) => l.trim()).length === 1, 'B one line');
  assert(parse(hdrRaw) === null, 'B parse header-only');
  {
    const realE = fs.existsSync;
    const realR = fs.readFileSync;
    fs.existsSync = (p) => (String(p).includes('zoho_tokens') ? true : realE(p));
    fs.readFileSync = (p, e) => (String(p).includes('zoho_tokens') ? hdrRaw : realR(p, e));
    assert(zoho.hasPersistedTokens() === false, 'B hasPersistedTokens');
    fs.existsSync = realE;
    fs.readFileSync = realR;
  }
  let threwMandatory = false;
  try {
    new ZOHOCRMSDK.OAuthBuilder()
      .clientId('c')
      .clientSecret('s')
      .redirectURL('https://api.spvtm.com/api/zoho/oauth/callback')
      .findUser(false)
      .build();
  } catch (e) {
    threwMandatory = String(e.code || '').includes('MANDATORY');
  }
  assert(threwMandatory, 'B empty build still throws in SDK');
  assert(parse(hdrRaw) === null, 'B fixed path skips empty build');
  ok('B_header_only_FileStore');

  // C. Malformed / credential-less
  assert(parse(HDR + '\n1,,,,,,,') === null, 'C blank row');
  assert(parse(HDR + '\nnot,enough') === null, 'C short row');
  assert(parse('garbage') === null, 'C garbage');
  ok('C_malformed_credential_less');

  // D. Synthetic valid refresh/access
  const valid =
    HDR +
    '\n1,u,cid,csec,refresh_syn,access_syn,g,1,https://api.spvtm.com/api/zoho/oauth/callback,www.zohoapis.in';
  const cred = parse(valid);
  assert(cred && cred.refreshToken === 'refresh_syn' && cred.accessToken === 'access_syn', 'D parse');
  const tok = new ZOHOCRMSDK.OAuthBuilder()
    .clientId('c')
    .clientSecret('s')
    .redirectURL('https://api.spvtm.com/api/zoho/oauth/callback')
    .refreshToken(cred.refreshToken)
    .findUser(false)
    .build();
  assert(!!tok, 'D OAuthBuilder.refreshToken build');
  {
    const realE = fs.existsSync;
    const realR = fs.readFileSync;
    fs.existsSync = (p) => (String(p).includes('zoho_tokens') ? true : realE(p));
    fs.readFileSync = (p, e) => (String(p).includes('zoho_tokens') ? valid : realR(p, e));
    assert(zoho.hasPersistedTokens() === true, 'D hasPersistedTokens');
    fs.existsSync = realE;
    fs.readFileSync = realR;
  }
  ok('D_synthetic_valid_refresh_access');

  // E. Synthetic authorization-code → grantToken (no Zoho network)
  let grantSeen = false;
  let grantVal = null;
  const protoGrant = ZOHOCRMSDK.OAuthBuilder.prototype.grantToken;
  ZOHOCRMSDK.OAuthBuilder.prototype.grantToken = function (g) {
    grantSeen = true;
    grantVal = g;
    return protoGrant.call(this, g);
  };
  const code = 'synthetic_authorization_code_NOT_REAL';
  const gTok = new ZOHOCRMSDK.OAuthBuilder()
    .clientId('c')
    .clientSecret('s')
    .redirectURL('https://api.spvtm.com/api/zoho/oauth/callback')
    .grantToken(code)
    .findUser(false)
    .build();
  ZOHOCRMSDK.OAuthBuilder.prototype.grantToken = protoGrant;
  assert(grantSeen && grantVal === code && !!gTok, 'E grantToken path');
  ok('E_synthetic_authorization_code_grantToken');

  // E2. completeOAuthWithCode clears stale FileStore then inits with code
  let cleared = false;
  const origClear = zoho._clearTokenFileForOAuthExchange.bind(zoho);
  const origInit = zoho.init.bind(zoho);
  zoho._clearTokenFileForOAuthExchange = () => {
    cleared = true;
  };
  zoho.init = async (opts) => {
    assert(cleared === true, 'clear before init');
    assert(opts && opts.authorizationCode === 'synth_code', 'code to init');
    const realE = fs.existsSync;
    const realR = fs.readFileSync;
    fs.existsSync = (p) => (String(p).includes('zoho_tokens') ? true : realE(p));
    fs.readFileSync = (p, e) => (String(p).includes('zoho_tokens') ? valid : realR(p, e));
    zoho.initialized = true;
    fs.existsSync = realE;
    fs.readFileSync = realR;
  };
  const exchange = await zoho.completeOAuthWithCode('synth_code');
  zoho._clearTokenFileForOAuthExchange = origClear;
  zoho.init = origInit;
  assert(exchange.ok && exchange.authorized && cleared, 'E2 completeOAuth');
  ok('E2_completeOAuth_clears_stale_FileStore');

  // F. Disconnect removes auth; catalog marker untouched
  const catalogMarker = path.join(os.tmpdir(), 'zoho_catalog_marker_' + Date.now() + '.txt');
  fs.writeFileSync(catalogMarker, 'local_catalog_untouched');
  const realUnlink = fs.unlinkSync;
  const realExists = fs.existsSync;
  let unlinked = false;
  fs.existsSync = (p) => (String(p).includes('zoho_tokens') ? true : realExists(p));
  fs.unlinkSync = (p) => {
    if (String(p).includes('zoho_tokens')) {
      unlinked = true;
      return;
    }
    return realUnlink(p);
  };
  zoho.initialized = true;
  const disc = await zoho.disconnect();
  fs.existsSync = realExists;
  fs.unlinkSync = realUnlink;
  assert(disc.ok === true && disc.authorized === false, 'F result');
  assert(unlinked === true && zoho.initialized === false, 'F token cleared');
  assert(
    fs.existsSync(catalogMarker) && fs.readFileSync(catalogMarker, 'utf8') === 'local_catalog_untouched',
    'F catalog intact'
  );
  fs.unlinkSync(catalogMarker);
  ok('F_disconnect');

  // G. Existing sync methods
  assert(typeof zoho.syncAssetToZoho === 'function', 'G syncAssetToZoho');
  assert(typeof zoho.syncProductsFromZoho === 'function', 'G syncProductsFromZoho');
  assert(typeof zoho.syncDealsFromZoho === 'function', 'G syncDealsFromZoho');
  assert(typeof zoho.checkConnection === 'function', 'G checkConnection');
  ok('G_existing_sync_methods');

  fs.unlinkSync(tmp);
  console.log('ALL_TESTS_PASS');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
