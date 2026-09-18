# Production vs TEST Differences

**Audit date:** 2026-08-21  
**Production host:** `CINEOM-TESTSRV` / `192.168.6.237:8080` / `https://api.spvtm.com`  
**TEST host (reachable from production):** `192.168.6.59:9090` (`asset-manager-test` per historical docs)  
**Staging on 59:** `192.168.6.59:8080` (historically misnamed `asset-manager-prod` on host 59)

**Do not overwrite production with TEST.** TEST is not automatically correct. Production currently has working Zoho OAuth + Product sync/push that must be preserved.

---

## How comparison was done

| Source | What was compared |
|--------|-------------------|
| This Git working tree | `main` @ `bfae1b3` plus **uncommitted** backend Zoho files |
| Live TEST frontend | HTTP GET `http://192.168.6.59:9090/js/*.js` (read-only) |
| Live TEST/staging index | HTTP GET `/` on 9090 and 8080 on host 59 |
| TEST backend / `.env` / Git | **Not inspected** (not exposed over HTTP; no SSH into 59) |
| Historical doc | `docs/architecture/DEPLOYMENT_ENVIRONMENT_REPORT.md` (2026-08-13) — older matrix (`118` as prod). This live production is **`.237`**, not `118`. |

---

## Commits

| Location | Git state |
|----------|-----------|
| Production working tree | Branch `main`, HEAD `bfae1b3` (`fix(zoho): add required CRM metadata scopes`) |
| `origin/main` | Same commit `bfae1b3` |
| Production **uncommitted** | `zohoService.js` (+structural OAuth singleton reset, no pre-clear of token file, Product `fields=` + `getKeyValue`, Deal `fields=` still using `getFieldValue`), `server.js` (syncCount guards), smoke script edits |
| Production **untracked** | `scripts/zoho-oauth-runtime-regression.js`, SDK `zoho_resources/` cache JSON, `zoho_tokens.txt.bak-118-local` |
| TEST Git commit | **Unknown from this host.** Frontend bytes **do not match** this tree, so TEST is not the same working copy. |

Zoho catalog navigation was introduced in commit `5166cc4` (“Inventory module parity, Zoho Catalog workspace, ParentId FK safety (9090 -> 118)”). That predates the TEST-only sticky-catalog and View-in-Zoho hydration fixes now visible on 59:9090.

---

## Changed files (frontend: TEST vs this production tree)

SHA-256 prefixes of live TEST JS vs production bind-mounted JS:

| File | TEST `59:9090` | Production `AssetManager_Dev` |
|------|----------------|-------------------------------|
| `dashboard.js` | `9F8067AA6EA5…` | `1C0406621CE6…` |
| `inventory.js` | `380EC664D24A…` | `4E1326855DFB…` |
| `contextMenu.js` | `D48F95518977…` | `CA81B3C6B961…` |

Material TEST-only frontend behavior (present on 9090, **absent** on production):

1. **`inventory.js` `initInventoryView`** resets `state.catalogMode = false` (and consumed mode) so top-nav Inventory cannot stay stuck on Zoho catalog.
2. **`contextMenu.js`** `ensureZohoCrmUi()` + `openZohoProductInNewTab()` — fetch `/api/zoho/status` for `crmUi` before opening CRM. No hardcoded org `60021949576`. Returns null if org/template missing.
3. **`dashboard.js` `openZohoProduct`** delegates to `openZohoProductInNewTab`.
4. **`asset-view.js`** `openAssetZohoProduct()` hydrates `crmUi` then builds URL; no hardcoded org fallback.

Production frontend still:

- Hardcodes `https://crm.zoho.in/crm/org60021949576/tab/Products/{id}` in `dashboard.js`, `inventory.js`, `asset-view.js`, `contextMenu.js`.
- Only sets `window.__zohoCrmUi` when the Zoho **status modal** is opened.

Both environments still render **top-level** sidebar item “Zoho Reference Catalog” (`#zohoCatalogStandaloneLink`). Desired “catalog only under hierarchy/reference” is **not** implemented on TEST either.

---

## Backend / Zoho (production-only live tree)

Production bind-mount is running **uncommitted** `zohoService.js` that TEST may not have:

- SDK `Initializer.LOCAL.clear()` + `initializer = undefined` before grant-token exchange
- No destructive pre-exchange wipe of `zoho_tokens.txt`
- Product pull: required `fields=` + `getKeyValue`
- `checkConnection` product fields + `per_page=1`
- Deal pull: `fields=` present, **still** `getFieldValue` for Deal_Name/Type

Copying TEST frontend onto production **without** keeping this backend would risk OAuth/sync regressions. Copying TEST backend onto production **without** the Product accessor/`fields` work would also regress. **Do not sync trees wholesale.**

---

## Migrations

Production `knex_migrations`: **31** files, latest `20260812120000_assets_soft_delete_recovery.js`.

Inventory preview migrations are recorded on production `asset_manager` even though several `up()` functions skip work unless `current_database() = 'asset_manager_test'`. Inventory tables **do** exist on production.

TEST DB is historically `asset_manager_test` on the shared Postgres of host 59. Production DB is `asset_manager` on this host. **Do not run TEST migrations blindly on production.**

---

## Environment differences

| Key | Production (this host) | TEST (59:9090, from docs + TCP) |
|-----|------------------------|----------------------------------|
| `PORT` | 8080 | 9090 |
| `NODE_ENV` | `production` | historically `test` |
| `DB_NAME` | `asset_manager` | `asset_manager_test` (documented) |
| `FEATURE_INVENTORY_ENABLED` | unset (inventory APIs allowed) | unknown |
| `ZOHO_REDIRECT_URL` | `https://api.spvtm.com/api/zoho/oauth/callback` | must differ (TEST must not use production callback) |
| `ZOHO_CRM_ORG_ID` | **MISSING** (code defaults `60021949576`) | unknown; TEST UI will not open CRM until `crmUi.orgId` is returned |
| OAuth token file | Production `zoho_tokens.txt` — **do not copy/replace** | Separate file on 59 |
| Hostname | `CINEOM-TESTSRV` (name ≠ role) | `192.168.6.59` |

---

## Package versions (production container)

| Package | Production |
|---------|------------|
| Node | `v20.20.2` |
| `@zohocrm/nodejs-sdk-8.0` declared | `^3.0.0` |
| SDK installed | `3.0.0` |

TEST container versions were not read (would require exec on 59). Do not change production `node_modules`.

---

## Configuration differences (frontend cache bust)

Production `index.html` loads `main.js?v=7.10`. TEST `dashboard.js` still imports some modules at `?v=6.59`. Cache-bust tokens have drifted; a naive file copy can leave mixed versions.

---

## What has already been validated on TEST (frontend)

Observed **running** on `59:9090` (not a paper design):

- Native Inventory top-nav does not inherit catalog mode.
- View in Zoho hydrates org/template from `/api/zoho/status` and refuses to open a guessed org URL.

This audit did **not** click Zoho Connect on TEST and did **not** assume TEST Product sync uses `getKeyValue`.

---

## What production has that TEST may lack

- Live OAuth session against `api.spvtm.com`
- Confirmed Product pull/push on this dataset
- Uncommitted OAuth FileStore singleton safety and Product accessor fix

---

## Policy

- Do **not** rsync `59` → `.237`.
- Do **not** replace production `.env` or `zoho_tokens.txt` from TEST.
- Cherry-pick only explicitly authorized, TEST-proven diffs, file by file, after confirming they do not revert production Zoho backend fixes.
