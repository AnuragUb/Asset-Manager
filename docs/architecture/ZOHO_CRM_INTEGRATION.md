# Zoho CRM Integration Architecture

**Status:** Current implementation documentation  
**Related:** [`HOST_REVERSE_PROXY.md`](./HOST_REVERSE_PROXY.md) · [`../06_API.md`](../06_API.md) · [`../07_SECURITY.md`](../07_SECURITY.md)

---

## Purpose

Describe how AssetEngine connects to Zoho CRM (India Production), including:

- Server-Based OAuth authorization
- Token persistence
- Existing business sync operations (Assets ↔ Products, Catalog, Deals, Status)

This document does **not** redesign Product mapping, Inventory→Zoho push, or catalog pagination.

---

## Layers

```text
Admin (AssetEngine UI)
        │
        ▼
GET /api/zoho/oauth/authorize   (admin/superuser JWT)
        │
        ▼
Zoho Accounts (accounts.zoho.in) — consent
        │
        ▼
GET https://api.spvtm.com/api/zoho/oauth/callback
        │  (Nginx on 118 → 127.0.0.1:8080)
        ▼
AssetEngine exchanges authorization code via SDK
        │
        ▼
FileStore: web-app/asset-manager-backend/zoho_tokens.txt
        │
        ▼
Existing sync routes (unchanged contracts)
   READ:  sync-products, catalog, status, sync-deals
   WRITE: sync-asset/:id
```

---

## OAuth flow

1. Admin opens **Integration Status** → **Connect Zoho**.  
2. Browser navigates to `GET /api/zoho/oauth/authorize` (cookie/JWT required).  
3. Backend creates a one-time **cryptographic `state`**, bound to `user_id`, stored in Redis/memory cache (~10 minutes).  
4. Browser redirects to Zoho India authorize URL with scopes + `redirect_uri` + `state`.  
5. Zoho redirects to `ZOHO_REDIRECT_URL` (production: `https://api.spvtm.com/api/zoho/oauth/callback`) with `code` + `state`.  
6. Backend validates/consumes `state`, exchanges `code` through `@zohocrm/nodejs-sdk-8.0` `OAuthBuilder.grantToken(code)`, persists tokens via **FileStore**.  
7. Browser receives a success HTML page (**no tokens**).  

**Disconnect:** `POST /api/zoho/oauth/disconnect` deletes the token file only. Local `zoho_catalog`, `assets.zoho_product_id`, and inventory Zoho IDs are **preserved**.

---

## Callback / public URL

| Item | Value |
|------|--------|
| Production callback | `https://api.spvtm.com/api/zoho/oauth/callback` |
| Env var | `ZOHO_REDIRECT_URL` must match the Zoho API Console redirect URI **exactly** |
| Host proxy | See [`HOST_REVERSE_PROXY.md`](./HOST_REVERSE_PROXY.md) — Git deploy does not configure Nginx |

Dev (`59:9090`) can use a temporary redirect URI registered for local testing **only if** that same value is set in Dev `.env`. Production registration should use `api.spvtm.com`.

**Observed on 59:9090 during implementation smoke:** existing `.env` still had a Self-Client-era redirect path (`…/api/zoho/callback` on localhost). Browser OAuth will not complete until `ZOHO_REDIRECT_URL` (and the Zoho API Console entry) match the new callback path exactly: `/api/zoho/oauth/callback`. Do not change production secrets casually; update Dev first for Connect testing.

---

## Token storage (chosen approach)

**Option A — FileStore (implemented — do not change in this iteration)**

| Topic | Detail |
|-------|--------|
| Path | `web-app/asset-manager-backend/zoho_tokens.txt` |
| Git | Ignored (`**/zoho_tokens.txt`) — never commit |
| API exposure | Token file contents are **never** returned by any API |
| Logging | Token values must **never** be logged (app request logs omit query secrets; Zoho init logs presence only) |
| Persistence on 118 | File must survive container recreate (bind-mounted app tree or explicit volume). Losing the file requires Connect Zoho again |
| Host permissions | Restrict read/write to the application user only; exclude from unencrypted off-host backups when possible |
| Why FileStore | Existing SDK integration; lowest migration risk |

**Option B — DBStore (not selected now)**

SDK DBStore is oriented around MySQL-style stores. A Postgres `oauthtoken` migration exists but is **not wired**. Moving to DBStore is a separate hardening task.

---

## Operator checklist — before first OAuth Connect on 118

Complete on host **118** (manual; Cursor has no shell access to 118):

1. Confirm app tip is the approved OAuth commit and health is OK.  
2. Set runtime env (names only; never commit values):  
   - `ZOHO_CLIENT_ID`  
   - `ZOHO_CLIENT_SECRET`  
   - `ZOHO_REDIRECT_URL=https://api.spvtm.com/api/zoho/oauth/callback`  
   - Recommended: `COOKIE_SECURE=true` (and/or `NODE_ENV=production`) so session cookies use `Secure` on HTTPS  
3. **Nginx access logs:** before first OAuth Connect, apply the canonical config from [`ops/nginx/api.spvtm.com.conf`](../../ops/nginx/api.spvtm.com.conf) (see [`ops/nginx/README.md`](../../ops/nginx/README.md)) so `/api/zoho/oauth/callback` uses query-safe logging (`$uri` without `$args`). Verify on 118 that `code` / `state` do not appear in `C:\nginx\logs\access.log`. Do **not** assume git pull reloads Nginx — operator must `nginx -t` and reload. Cursor cannot modify 118.  
4. Confirm `zoho_tokens.txt` path is writable and will persist across restarts.  
5. Perform Connect only via `https://api.spvtm.com` (not raw `:8080`).  
6. Do **not** run the real OAuth handshake on `59:9090`.

---

## Application request logging (OAuth-safe)

Global request logs record **method + pathname + status + duration** only.

Example: `GET /api/zoho/oauth/callback 400 12ms`

They must **never** include query strings such as `code` or `state`.

---

## Environment configuration (names only)

| Variable | Purpose |
|----------|---------|
| `ZOHO_CLIENT_ID` | Server-based app client id |
| `ZOHO_CLIENT_SECRET` | Client secret |
| `ZOHO_REDIRECT_URL` | Must equal registered callback URL |
| `ZOHO_GRANT_TOKEN` / `GRANT_TOKEN` | **Legacy** Self Client bootstrap (still supported if no token file) |
| `ZOHO_CRM_ORG_ID` | Optional; defaults to historical org id for “View in Zoho” links |
| `COOKIE_SECURE` | `true` on HTTPS production (118 / api.spvtm.com); leave unset/false for local HTTP |
| `TRUST_PROXY` | Optional `true` to enable Express `trust proxy` for `req.secure` behind Nginx |

Never commit values. Never return secrets from APIs.

---

## Scopes (minimum for current features)

| Operation | Module | R/W | Scope | Why |
|-----------|--------|-----|-------|-----|
| Catalog pull / status probe | Products | READ | `ZohoCRM.modules.products.ALL` | `getRecords` |
| Asset push create/update | Products | WRITE | `ZohoCRM.modules.products.ALL` | `createRecords` / `updateRecords` |
| Deal sync API | Deals | READ | `ZohoCRM.modules.deals.READ` | `getRecords` |

SDK init uses `findUser(false)` so `ZohoCRM.users.READ` / `ZohoCRM.org.READ` are **not** required for authorization bootstrap.

---

## Existing business routes (preserved)

| Method | Path | Role |
|--------|------|------|
| POST | `/api/zoho/sync-asset/:id` | Asset → Zoho Product |
| POST | `/api/zoho/sync-products` | Zoho → `zoho_catalog` |
| POST | `/api/zoho/sync-deals` | Zoho Deals → `projects` |
| GET | `/api/zoho/catalog` | Local catalog list |
| GET | `/api/zoho/status` | Connection status + logs + OAuth meta |

### New OAuth routes

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/zoho/oauth/authorize` | JWT + admin/superuser |
| GET | `/api/zoho/oauth/callback` | Public (state-validated) |
| POST | `/api/zoho/oauth/disconnect` | JWT + admin/superuser |

---

## Status semantics

`GET /api/zoho/status` → `health.status`:

| Status | Meaning |
|--------|---------|
| `NOT_CONFIGURED` | Missing client id/secret/redirect |
| `NOT_AUTHORIZED` | Configured but no token file / grant bootstrap |
| `CONNECTED` | SDK init + Products probe OK |
| `TOKEN_REFRESH_FAILED` | OAuth/token errors |
| `ZOHO_UNREACHABLE` | Network failures |
| `API_ERROR` | Other API failures |

---

## What is intentionally out of scope

- Inventory → Zoho Product **write** (does not exist; do not invent)
- Catalog pagination redesign (known debt: single `getRecords` page)
- Hard-delete of grant-token support (kept for migration)

---

## Failure modes

| Symptom | Likely cause |
|---------|----------------|
| Connect returns 400 NOT_CONFIGURED | Env vars missing on host |
| Callback “Invalid OAuth state” | Expired/replayed state or cache miss |
| Callback success but status NOT_AUTHORIZED | Token file not persisted / wrong working directory |
| Sync routes fail after Connect | Wrong DC, scopes, or redirect mismatch |
| `api.spvtm.com` callback fails, `:8080` OK | Nginx/DNS/TLS — not Git |

---

## Rollback

1. Disconnect Zoho (or remove `zoho_tokens.txt`).  
2. Optionally restore legacy `ZOHO_GRANT_TOKEN` bootstrap.  
3. Revert OAuth route/UI commits if needed.  
4. Local catalog / asset Zoho IDs remain unless manually cleared.

---

## India Data Center

SDK continues to use `ZOHOCRMSDK.INDataCenter.PRODUCTION()` and `accounts.zoho.in` for authorization. Do not switch to US/EU without an explicit product decision.
