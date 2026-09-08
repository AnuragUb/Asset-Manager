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

  // E2. completeOAuthWithCode must NOT delete the token file before exchange
  let unlinkedDuringExchange = false;
  const origUnlinkExchange = fs.unlinkSync;
  const origInit = zoho.init.bind(zoho);
  const origExists = fs.existsSync;
  const origRead = fs.readFileSync;
  const origRetain = zoho._retainLatestFileStoreRow.bind(zoho);
  fs.unlinkSync = (p) => {
    if (String(p).includes('zoho_tokens')) {
      unlinkedDuringExchange = true;
      return;
    }
    return origUnlinkExchange(p);
  };
  fs.existsSync = (p) => (String(p).includes('zoho_tokens') ? true : origExists(p));
  fs.readFileSync = (p, e) => (String(p).includes('zoho_tokens') ? valid : origRead(p, e));
  zoho._retainLatestFileStoreRow = () => {};
  zoho.init = async (opts) => {
    assert(opts && opts.authorizationCode === 'synth_code', 'code to init');
    zoho.initialized = true;
  };
  const exchange = await zoho.completeOAuthWithCode('synth_code');
  fs.unlinkSync = origUnlinkExchange;
  fs.existsSync = origExists;
  fs.readFileSync = origRead;
  zoho.init = origInit;
  zoho._retainLatestFileStoreRow = origRetain;
  assert(exchange.ok && exchange.authorized, 'E2 completeOAuth');
  assert(unlinkedDuringExchange === false, 'E2 must not delete token file');
  assert(typeof zoho._clearTokenFileForOAuthExchange !== 'function', 'E2 destructive pre-clear removed');
  ok('E2_completeOAuth_does_not_delete_token_file');

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

  // H. SDK singleton reset uses real Initializer.LOCAL Map + initializer field
  {
    const Initializer = ZOHOCRMSDK.Initializer;
    assert(Initializer && Initializer.LOCAL && typeof Initializer.LOCAL.clear === 'function', 'H LOCAL Map');
    Initializer.LOCAL.set('forensic_test_key', { marker: true });
    Initializer.initializer = { marker: true };
    zoho._resetSdkSingleton();
    assert(Initializer.LOCAL.size === 0, 'H LOCAL cleared');
    assert(Initializer.initializer === undefined, 'H initializer undefined');
    ok('H_resetSdkSingleton');
  }

  // I. syncProductsFromZoho handles APIException and never returns undefined
  {
    const cache = require('../services/cacheService');
    const origCacheGet = cache.get;
    const origInitSync = zoho.init.bind(zoho);
    const origAdd = ZOHOCRMSDK.ParameterMap.prototype.add;
    const origROGet = ZOHOCRMSDK.Record.RecordOperations.prototype.getRecords;
    const addedParams = [];
    cache.get = async () => null;
    zoho.init = async () => {};
    ZOHOCRMSDK.ParameterMap.prototype.add = async function (param, value) {
      addedParams.push({
        name: param && typeof param.getName === 'function' ? param.getName() : String(param),
        value
      });
      return origAdd.call(this, param, value);
    };
    ZOHOCRMSDK.Record.RecordOperations.prototype.getRecords = async function () {
      return {
        getObject: () => {
          const ex = Object.create(ZOHOCRMSDK.Record.APIException.prototype);
          ex.getMessage = () => ({ getValue: () => 'REQUIRED_PARAM_MISSING' });
          ex.getCode = () => ({ getValue: () => 'REQUIRED_PARAM_MISSING' });
          return ex;
        }
      };
    };
    let thrown = null;
    let syncResult = 'NOT_SET';
    try {
      syncResult = await zoho.syncProductsFromZoho();
    } catch (e) {
      thrown = e;
    }
    ZOHOCRMSDK.Record.RecordOperations.prototype.getRecords = origROGet;
    ZOHOCRMSDK.ParameterMap.prototype.add = origAdd;
    zoho.init = origInitSync;
    cache.get = origCacheGet;
    assert(syncResult === 'NOT_SET', 'I did not return a value');
    assert(thrown && thrown.code === 'ZOHO_API_EXCEPTION', 'I APIException code');
    assert(String(thrown.message).includes('REQUIRED_PARAM_MISSING'), 'I APIException message');
    const fieldsParam = addedParams.find((p) => p.name === 'fields');
    assert(
      fieldsParam &&
        String(fieldsParam.value) ===
          'Product_Name,Unit_Price,Description,Product_Code,Make,Model,HSN_Code',
      'I Products fields param'
    );
    ok('I_syncProducts_APIException');
  }

  // J. Catalog pull paginates with PAGE / PER_PAGE and follows more_records
  {
    const src = fs.readFileSync(path.join(__dirname, '../services/zohoService.js'), 'utf8');
    const pull = src.slice(src.indexOf('async syncProductsFromZoho()'), src.indexOf('async syncDealsFromZoho()'));
    assert(pull.includes('GetRecordsParam.PAGE'), 'J uses PAGE');
    assert(pull.includes('GetRecordsParam.PER_PAGE'), 'J uses PER_PAGE');
    assert(pull.includes('GetRecordsParam.PAGE_TOKEN'), 'J uses PAGE_TOKEN when provided');
    assert(pull.includes('getMoreRecords'), 'J follows more_records');
    assert(pull.includes('CATALOG_PER_PAGE = 200') || pull.includes('PER_PAGE, CATALOG_PER_PAGE'), 'J per_page 200');
    assert(!/zoho_catalog'\)\.del(ete|Where)/.test(pull) && !pull.includes(".delete("), 'J does not delete catalog rows');
    ok('J_pagination_source');
  }

  {
    const cache = require('../services/cacheService');
    const origCacheGet = cache.get;
    const origCacheSet = cache.set;
    const origInitSync = zoho.init.bind(zoho);
    const origLog = zoho.logSync.bind(zoho);
    const origAdd = ZOHOCRMSDK.ParameterMap.prototype.add;
    const origROGet = ZOHOCRMSDK.Record.RecordOperations.prototype.getRecords;
    const addedParams = [];
    let getCalls = 0;
    cache.get = async () => null;
    cache.set = async () => {};
    zoho.init = async () => {};
    zoho.logSync = async () => {};
    ZOHOCRMSDK.ParameterMap.prototype.add = async function (param, value) {
      addedParams.push({
        name: param && typeof param.getName === 'function' ? param.getName() : String(param),
        value
      });
      return origAdd.call(this, param, value);
    };
    ZOHOCRMSDK.Record.RecordOperations.prototype.getRecords = async function () {
      getCalls += 1;
      const more = getCalls === 1;
      return {
        getObject: () => {
          const wrapper = Object.create(ZOHOCRMSDK.Record.ResponseWrapper.prototype);
          wrapper.getData = () => [];
          wrapper.getInfo = () => ({
            getMoreRecords: () => more,
            getNextPageToken: () => (more ? 'next-page-token' : null),
            getPage: () => getCalls,
            getPerPage: () => 200,
            getCount: () => 0
          });
          return wrapper;
        }
      };
    };
    let result;
    try {
      result = await zoho.syncProductsFromZoho();
    } finally {
      ZOHOCRMSDK.Record.RecordOperations.prototype.getRecords = origROGet;
      ZOHOCRMSDK.ParameterMap.prototype.add = origAdd;
      zoho.init = origInitSync;
      zoho.logSync = origLog;
      cache.get = origCacheGet;
      cache.set = origCacheSet;
    }
    assert(getCalls === 2, 'J fetched two pages');
    assert(result && result.ok === true, 'J ok');
    assert(result.pagesFetched === 2, 'J pagesFetched');
    assert(result.recordsFetched === 0 && result.totalFound === 0 && result.recordsUpserted === 0, 'J empty upsert stats');
    assert(result.syncCount === 0, 'J syncCount preserved');
    const pageParam = addedParams.find((p) => p.name === 'page');
    const perPageParam = addedParams.find((p) => p.name === 'per_page');
    const tokenParam = addedParams.find((p) => p.name === 'page_token');
    assert(pageParam && Number(pageParam.value) === 1, 'J first page param');
    assert(perPageParam && Number(perPageParam.value) === 200, 'J per_page 200');
    assert(tokenParam && String(tokenParam.value) === 'next-page-token', 'J follows page_token');
    ok('J_pagination_loop');
  }

  fs.unlinkSync(tmp);
  console.log('ALL_TESTS_PASS');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
