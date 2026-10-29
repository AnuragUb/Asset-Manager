/**
 * Probe granted OAuth scopes for the persisted Zoho FileStore token.
 * Prints scope string only — never tokens.
 *
 * Usage (inside backend container):
 *   node scripts/zoho-token-scope-probe.js
 */
const path = require('path');
const fs = require('fs');
const https = require('https');
const { URL } = require('url');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const { parseZohoFileStoreCredentials } = require('../services/zohoService');

const TOKEN_FILE = path.join(__dirname, '../zoho_tokens.txt');
const ACCOUNTS = 'https://accounts.zoho.in/oauth/v2/token';

function postForm(urlStr, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const data = new URLSearchParams(body).toString();
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(data)
        }
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(raw); } catch (_) { /* ignore */ }
          resolve({ status: res.statusCode, json, raw: raw.slice(0, 500) });
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.log(JSON.stringify({ ok: false, error: 'missing_client_env' }));
    process.exit(2);
  }
  if (!fs.existsSync(TOKEN_FILE)) {
    console.log(JSON.stringify({ ok: false, error: 'no_token_file' }));
    process.exit(2);
  }
  const creds = parseZohoFileStoreCredentials(fs.readFileSync(TOKEN_FILE, 'utf8'));
  if (!creds || !creds.refreshToken) {
    console.log(JSON.stringify({ ok: false, error: 'no_refresh_token' }));
    process.exit(2);
  }

  const res = await postForm(ACCOUNTS, {
    refresh_token: creds.refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token'
  });

  const scope = res.json && res.json.scope;
  const scopes = String(scope || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .sort();

  console.log(JSON.stringify({
    ok: res.status === 200 && !!scope,
    httpStatus: res.status,
    apiError: res.json && (res.json.error || res.json.error_description) || null,
    scopeCount: scopes.length,
    scopes,
    hasContactsRead: scopes.some((s) => /contacts\.READ/i.test(s) || /modules\.contacts/i.test(s)),
    hasVendorsRead: scopes.some((s) => /vendors\.READ/i.test(s) || /modules\.vendors/i.test(s)),
    hasAccountsRead: scopes.some((s) => /accounts\.READ/i.test(s) || /modules\.accounts/i.test(s)),
    hasModulesAll: scopes.some((s) => /modules\.ALL/i.test(s))
  }, null, 2));
})().catch((err) => {
  console.log(JSON.stringify({ ok: false, error: String(err.message || err) }));
  process.exit(1);
});
