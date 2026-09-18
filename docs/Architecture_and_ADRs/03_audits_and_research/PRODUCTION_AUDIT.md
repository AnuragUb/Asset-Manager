# Production Forensic Audit — AssetEngine / Asset Manager

**Date:** 2026-08-21  
**Classification:** Read-only forensic audit. **No production code, schema, OAuth, token, network, or data changes were applied.**  
**Auditor host:** `CINEOM-TESTSRV` (`192.168.6.237`)  
**Declared role:** **PRODUCTION** live application (`https://api.spvtm.com`, application port **8080**)

Supporting reports:

- [PRODUCTION_RECONCILIATION_GAP.md](./PRODUCTION_RECONCILIATION_GAP.md)
- [PRODUCTION_ZOHO_MODULE_STATUS.md](./PRODUCTION_ZOHO_MODULE_STATUS.md)
- [PRODUCTION_TEST_DIFFERENCES.md](./PRODUCTION_TEST_DIFFERENCES.md)

---

## 1. Current production architecture

```text
Browser
  │
  ├─ Internal (split DNS):  api.spvtm.com  →  192.168.6.237:8080
  └─ External:              api.spvtm.com  →  public IP → Sophos DNAT → 192.168.6.237:8080

Docker (this host)
  asset-manager-prod     Node 20.20.2   0.0.0.0:8080  bind-mount repo → /app
  asset-manager-db       PostgreSQL 15  :5432         DB asset_manager  (healthy)
  asset-manager-cache    Redis 7        :6379         (healthy, PONG)

Zoho India
  accounts.zoho.in  (OAuth)
  www.zohoapis.in   (CRM v8 API)
  crm.zoho.in       (CRM UI links)
```

- Compose in use: `docker-compose.yml` service `app-prod`. Anonymous volumes protect `node_modules`. **Do not modify `node_modules`.**
- Git: `main` @ `bfae1b3`, **plus uncommitted backend Zoho fixes** that the running process loads via bind-mount.
- Redirect URI: `https://api.spvtm.com/api/zoho/oauth/callback`
- Token store: `web-app/asset-manager-backend/zoho_tokens.txt` (**do not modify/delete**)
- SDK: `@zohocrm/nodejs-sdk-8.0@3.0.0`
- TLS / nginx: **not** running on this application host. HTTPS timeout from the server to `https://api.spvtm.com` is consistent with hairpin NAT; local `http://127.0.0.1:8080/` returns **200**. Networking was not changed.

Host name `CINEOM-TESTSRV` does not match production role. Treat the name as historical debt; this process is production.

TEST is a **different machine**: `192.168.6.59:9090` (TCP open). `app-test` is **not** running here.

---

## 2. Working functionality

Confirmed by logs, schema, and code inspection (no experimental writes):

| Area | Evidence |
|------|----------|
| Backend HTTP | `GET /` 200; container up 21h |
| Frontend static | CSS/JS 200 in `asset-manager-prod` logs |
| PostgreSQL | healthy; application queries succeeding |
| Redis | `PONG`; used for Zoho state / catalog debounce |
| Native inventory APIs | `GET /api/inventory/folders|kinds|items|movements|consumed` 200 |
| Zoho OAuth session | Operator-confirmed; token file present; do not reconnect |
| Zoho Product **pull** | `POST /api/zoho/sync-products` 200 at 08:44 UTC; `PULL_CATALOG` SUCCESS; 202 catalog rows |
| Zoho Product **create push** | `PUSH_ASSET_CREATE` SUCCESS 2026-08-20 |
| Internal path | App listens on 8080; split DNS documented as working |
| Scheduled warranty check | Cron fired (~09:03 UTC); notifications disabled |
| Backups | `backups/8080_prod/pg_backup_*.sql` present; latest `20260821_0000` |

Product pull implementation on disk:

- Request fields: `Product_Name,Unit_Price,Description,Product_Code,Make,Model,HSN_Code`
- Read accessor: **`getKeyValue(apiName)`** — not `getFieldValue()`

---

## 3. Broken functionality

| Item | Status |
|------|--------|
| Top-nav **Inventory** can show Zoho catalog | Sticky `catalogMode` on production frontend (TEST already resets it) |
| **View in Zoho** | URL uses hardcoded org `60021949576`; `crmUi` not loaded unless status modal opened; `ZOHO_CRM_ORG_ID` env **MISSING** |
| Product **UPDATE** push | `KEY: id EXPECTED TYPE: BigInt` (two errors 2026-08-21 04:24–04:26 UTC) |
| Deal / project sync | Unused, accessor still `getFieldValue`, dangerous `orWhere` |
| Public HTTPS from this host | `https://api.spvtm.com` timed out here (hairpin); not treated as app-code failure |
| Catalog sample row | `ZP-SAMPLE-0001` cannot be a valid CRM Product URL |

Do not treat identification of a cause as a production fix.

---

## 4. Zoho status

| Item | Production |
|------|------------|
| OAuth | **WORKING** — do not Connect, disconnect, rotate, or change scopes/redirect |
| Scopes | products.ALL, deals.READ, settings.fields.READ, settings.modules.READ |
| Singleton FileStore fix | Present in **uncommitted** `zohoService.js` — **do not modify** |
| Token file | Present — **do not modify/delete** |
| Org ID env | `ZOHO_CRM_ORG_ID` **MISSING**; code default `60021949576` |
| Regional CRM | India (`crm.zoho.in` / `zohoapis.in`) — correct DC for this install |

---

## 5. Product sync status

**Healthy for pull.** Last successful catalog pull 2026-08-21 08:44 UTC. Accessor and `fields=` match the required contract.

**Push:** create works; update is **not** healthy (`BigInt` id). User-visible “push works” is consistent with **create-only** success.

**Do not modify** the working Product `getKeyValue` implementation.

Debounce: Redis key `zoho:last_catalog_sync` (5 minutes) can return `syncCount: 0` without calling Zoho — not a failure.

---

## 6. Project sync status

**Gap — not active in production.**

| Question | Finding |
|----------|---------|
| Synchronization exists? | Backend function + `POST /api/zoho/sync-deals` only |
| Direction | Zoho Deals → `projects` (one way) |
| Fields requested | `Deal_Name,Type,Project_ID` |
| Zoho record ID | `deal.getId()` → `projects.zoho_deal_id` |
| AssetEngine project ID | `Project_ID` or `PROJ-{suffix}` |
| Mapped rows | **0 / 2** projects |
| UI | **None** |
| Audit log | No Deals rows in `zoho_sync_logs` |
| Duplicate prevention | Unsafe `orWhere` on possibly null `Project_ID` |

**Do not enable** bidirectional sync. **Do not** auto-create Zoho Deals or production projects.

If someone calls `/api/zoho/sync-deals` today it will likely throw `getFieldValue is not a function` (same class of bug Product pull had).

---

## 7. Inventory status

Native inventory **exists** and APIs return 200. Volume: 1 folder, 2 kinds, 1 item, **0** items linked to Zoho catalog. Catalog has **202** products (including sample `ZP-SAMPLE-0001`).

Operators can reasonably perceive “Inventory” as the Zoho catalog because that list is large and native inventory is almost empty — plus the sticky catalog-mode bug below.

Inventory table migrations are gated to `asset_manager_test` in source, yet tables exist on production `asset_manager`. See reconciliation gap doc.

---

## 8. UI problems

### 8.1 Audit 1 — Inventory navigation

**Desired**

```text
Top-level Inventory  →  native AssetEngine inventory
Zoho Reference Catalog  →  hierarchy / reference / catalog navigation
```

**Production wiring (current source)**

| Element | File | Behavior |
|---------|------|----------|
| Top nav `id="nav-inventory"` | `index.html`, `main.js` | `view=dashboardView`, `subView=inventory-view`, `initInventoryView()` |
| Hash / view | `inventory-view` | Native workspace chrome in `index.html` |
| Sidebar Inventory | `dashboard.js` `#inventoryRootLink` | `openInventoryRoot()` → `catalogMode=false` → `/api/inventory/*` |
| Sidebar catalog | `dashboard.js` `#zohoCatalogStandaloneLink` | `openInventoryCatalog()` → `GET /api/zoho/catalog` |
| State | `inventory.js` | `state.catalogMode`, `window.currentInventorySidebar` `{root\|node\|catalog}` |
| Alternate renderer | `dashboard.js` `renderZohoCatalog()` | Writes Zoho cards into the **asset** grid (legacy path) |

**Why Inventory can open the Zoho catalog**

`initInventoryView()` on production, when already initialized, calls `loadInventoryWorkspace()` **without** clearing `state.catalogMode`. After a catalog visit, top-level Inventory keeps rendering `renderCatalogView()`.

TEST (`59:9090`) already contains this comment and fix:

```text
// Top-nav / hash entry must not inherit sticky Zoho catalog mode.
state.catalogMode = false;
```

**Not done on TEST or production:** moving “Zoho Reference Catalog” off the top-level sidebar into hierarchy/reference-only navigation. Both still show a top-level catalog link.

**Do not change production inventory IA** beyond a TEST-proven sticky-mode port, and only with explicit authorization.

### 8.2 Audit 2 — View in Zoho

**Current URL construction (production)**

```text
https://crm.zoho.in/crm/org{orgId}/tab/Products/{recordId}
```

| Input | Source |
|-------|--------|
| Record ID | `zoho_catalog.zoho_product_id` (CRM Product ID string, e.g. `1205624000000978029`) — correct ID type for UI |
| Org ID | `process.env.ZOHO_CRM_ORG_ID` **or hardcoded `60021949576`** |
| Region | `crm.zoho.in` (India) — DC is correct |
| Template | `/api/zoho/status` → `crmUi.productUrlTemplate` — production UI rarely fetches this before click |

**Why the generated URL fails**

1. Production frontend **guesses org `60021949576`** if `window.__zohoCrmUi` was never loaded (status modal not opened).
2. Production `.env` does **not** set `ZOHO_CRM_ORG_ID`. If the live CRM org is not `60021949576`, every link is wrong even after status fetch.
3. Sample ID `ZP-SAMPLE-0001` is not a CRM record.

TEST already: fetch `/api/zoho/status`, **no hardcoded org**, refuse to open if org/template missing (`ensureZohoCrmUi` / `openZohoProductInNewTab` / `openAssetZohoProduct`).

This audit did not perform OAuth and did not open CRM in a browser.

---

## 9. Reconciliation gaps

See [PRODUCTION_RECONCILIATION_GAP.md](./PRODUCTION_RECONCILIATION_GAP.md).

Short version: catalog, assets, inventory, projects, serials, locations, quantities, ownership, and rental state are **not** one reconciled graph. No FKs on Zoho IDs. Duplicate Zoho IDs are allowed. Quantities/locations/rental are local-only.

---

## 10. Module feasibility status

See [PRODUCTION_ZOHO_MODULE_STATUS.md](./PRODUCTION_ZOHO_MODULE_STATUS.md).

Only **Products** is a live CRM integration. **Deals** is dead code. Leads, Accounts, Contacts, Quotes, Sales Orders, Purchase Orders (Zoho), Invoices, Vendors are **not implemented** and **must not** be added on production. Current OAuth grant cannot support them without a scope change (forbidden here).

---

## 11. TEST vs PROD differences

See [PRODUCTION_TEST_DIFFERENCES.md](./PRODUCTION_TEST_DIFFERENCES.md).

Divergence is **bidirectional**:

- TEST frontend is **ahead** on Inventory sticky-mode and View-in-Zoho hydration.
- Production backend working tree is **ahead** (uncommitted) on OAuth FileStore safety and Product `getKeyValue`/`fields=` pull.

Wholesale replace in either direction is unsafe.

---

## 12. Recommended changes

None applied. Grouped by validation state.

### Already present on TEST frontend (port only after explicit production authorization)

| Proposed file | Proposed change | Reason | Expected impact | Rollback | Test still required on prod after copy |
|---------------|-----------------|--------|-----------------|----------|----------------------------------------|
| `web-app/asset-manager-frontend/js/inventory.js` | Reset `catalogMode`/`consumedMode` at start of `initInventoryView`; if sidebar type is `catalog`, set `{ type: 'root' }` | Stops top-nav Inventory from showing Zoho catalog | Native inventory on `#nav-inventory` | Revert file | Click Inventory after visiting catalog |
| `web-app/asset-manager-frontend/js/contextMenu.js` | Add `ensureZohoCrmUi` + `openZohoProductInNewTab`; stop hardcoding org | View in Zoho uses server `crmUi` | Correct URL **if** org on server is correct | Revert file | Click View in Zoho; confirm CRM record |
| `web-app/asset-manager-frontend/js/dashboard.js` | `openZohoProduct` → `openZohoProductInNewTab` | Same | Same | Revert file | Same |
| `web-app/asset-manager-frontend/js/asset-view.js` | Port `openAssetZohoProduct` | Asset page links | Same | Revert file | Asset View in Zoho |

**Config (not a code edit):** confirm real CRM org ID from Zoho (Setup → Company / org switcher). Set `ZOHO_CRM_ORG_ID` on TEST first, then production. This is **not** an OAuth client secret change, but still **do not apply** until authorized. Wrong value keeps View in Zoho broken.

### REQUIRES TEST VALIDATION (not shown as done on TEST backend)

#### Product UPDATE `setId` BigInt

- **Proposed file:** `web-app/asset-manager-backend/services/zohoService.js` (`syncAssetToZoho`)
- **Proposed change:** pass CRM id as BigInt (or SDK-accepted type) on update only; keep create path unchanged
- **Reason:** production logs `KEY: id EXPECTED TYPE: BigInt`
- **Expected impact:** re-push/update of existing Products works
- **Rollback:** revert function; CREATE still works
- **Test required:** push update of a TEST asset that already has `zoho_product_id`; do **not** experiment on production products

#### Deal `getFieldValue` → `getKeyValue`

- **Proposed file:** `zohoService.js` `syncDealsFromZoho`
- **Proposed change:** read `Deal_Name`, `Type` via `getKeyValue`; keep `fields=`
- **Reason:** same SDK Record bug as Products
- **Expected impact:** function would no longer throw on accessor
- **Rollback:** revert
- **Test required:** dry-run against TEST DB only; **still do not enable** production deal sync or auto-create projects
- **Do not** treat this as permission to turn on `/api/zoho/sync-deals` in production

#### Catalog information architecture

- **Proposed files:** `dashboard.js` sidebar HTML / handlers
- **Proposed change:** remove top-level “Zoho Reference Catalog”; open catalog only from hierarchy/reference
- **Reason:** matches desired architecture
- **Expected impact:** catalog less prominent; operators must learn new path
- **Rollback:** restore standalone link
- **Test required:** **TEST does not have this yet** — implement and validate on 9090 first

---

## 13. Changes that must be validated on TEST first

- Any Deal↔Project sync, including “just pull”
- Any new Zoho module (Leads, Accounts, Contacts, Quotes, SO, PO, Invoices, Vendors)
- Schema FKs / unique indexes on Zoho IDs
- Removing `ZP-SAMPLE-0001`
- OAuth scope or redirect changes (**must not** be done on production)
- Replacing production tree with TEST tree
- Product UPDATE BigInt `setId`
- Moving catalog under hierarchy (TEST has not done this)

Sticky Inventory mode + View-in-Zoho hydration are **already on TEST**. They still need a **production change window** and operator confirmation; they were not deployed by this audit.

---

## 14. Production deployment plan

1. **Freeze** working Zoho backend: do not revert `getKeyValue`, `fields=`, or FileStore singleton handling.
2. **Commit** production-only Zoho backend on a branch after review (not done here) so TEST can receive the **same** backend, rather than TEST overwriting production.
3. On **TEST 9090**: confirm View in Zoho with the real org ID; confirm Inventory top-nav after catalog visit; confirm Product pull still uses `getKeyValue`.
4. After written authorization: cherry-pick **only** the four frontend files listed in §12 (or equivalent minimal diffs). Do not copy TEST `zohoService.js` over production if TEST lacks the accessor/OAuth fixes.
5. Smoke on production (read-only / UI only): Inventory root, catalog link, one View in Zoho click, no OAuth Connect, no deal sync, no migrations.
6. Product UPDATE BigInt: TEST only, then a later production window.
7. **Never** `docker compose` swap TEST DB, never copy `zoho_tokens.txt`, never change Sophos/DNS from this app server.

Rollback: Git revert of the cherry-picked frontend files; backend left untouched.

---

## 15. Risks

| Risk | Severity | Note |
|------|----------|------|
| Uncommitted production Zoho backend | High | Bind-mount live; not on `origin/main`; host crash/rebuild from Git would **lose** working OAuth/sync code |
| Overwriting production with TEST | Critical | Would drop Product accessor / OAuth singleton fixes and/or production tokens |
| Hardcoded CRM org | High | View in Zoho opens wrong org or error page |
| Sticky catalogMode | Medium | Operators lose native Inventory |
| Enabling deal sync | High | `getFieldValue` crash; null `Project_ID` can update the wrong projects |
| Product UPDATE BigInt | Medium | Duplicate Zoho Products if operators retry as create |
| Sample catalog row | Low | Noise / bad View in Zoho |
| Inventory migration gating | Medium | TEST schema can drift from production silently |
| Host named TESTSRV | Low | Operational confusion |
| Redis/catalog debounce | Low | False “empty sync” within 5 minutes |
| Hairpin HTTPS | Low | Monitor from a client PC, not from this server |
| Scanner traffic | Low | Logs show `/owa/auth/x.js` 404 |

---

## Must NOT be changed (production freeze)

- OAuth client ID/secret, scopes, redirect URI
- `zoho_tokens.txt` (no delete, no rewrite, no disconnect)
- `node_modules` / SDK install
- Working OAuth singleton reset
- Working Product `getKeyValue` pull + `fields=` list
- Networking / Sophos / split DNS
- Destructive SQL (drop/truncate/delete catalog, assets, projects)
- New Zoho modules
- Experimental bidirectional Deal/Project sync
- Real OAuth Connect / re-consent as an audit step

---

## Audit 3 / 8 verification notes (read-only)

- **Product accessor:** `syncProductsFromZoho` uses `getKeyValue` only. `getFieldValue` remains on **Deals** only.
- **Health:** app 200, DB healthy, Redis PONG, inventory APIs 200, product sync 200, backups present, no local nginx, no service restarts performed.
