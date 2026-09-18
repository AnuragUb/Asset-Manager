# Production Zoho Module Status

**Audit date:** 2026-08-21  
**Environment:** Production AssetEngine (`192.168.6.237:8080`, `https://api.spvtm.com`)  
**SDK:** `@zohocrm/nodejs-sdk-8.0` **3.0.0**  
**Data center:** India (`accounts.zoho.in`, `www.zohoapis.in`, CRM UI `crm.zoho.in`)  
**OAuth scopes currently configured (do not change):**

```text
ZohoCRM.modules.products.ALL
ZohoCRM.modules.deals.READ
ZohoCRM.settings.fields.READ
ZohoCRM.settings.modules.READ
```

**Rule:** No new Zoho modules were implemented on production during this audit.

---

## Summary

| Module | API integration | Direction | UI | Feasibility with current scopes |
|--------|-----------------|-----------|----|----------------------------------|
| Products | **Implemented and working** | Pull catalog + push assets | Catalog workspace, asset “Push to Zoho”, View in Zoho (broken URL helper) | Already in scope (`products.ALL`) |
| Deals | Code exists; **not used in production** | Intended pull → Projects | **No frontend caller** | `deals.READ` present; implementation unsafe (`getFieldValue`) |
| Leads | None | — | None | **Out of scope** — would need new OAuth scopes + TEST first |
| Accounts | Column only (`clients.zoho_account_id`) | — | None | Out of scope |
| Contacts | None (local “Quick Contacts” is network scanner, not CRM) | — | Network scanner only | Out of scope |
| Quotes | None | — | None | Out of scope |
| Sales Orders | None | — | None | Out of scope |
| Purchase Orders | Local `project_orders` only | — | Projects UI | Out of scope (not Zoho PO) |
| Invoices | None | — | None | Out of scope |
| Vendors | None | — | None | Out of scope |

---

## Products

| Item | Status |
|------|--------|
| API | `GET` CRM v8 Products with `fields=Product_Name,Unit_Price,Description,Product_Code,Make,Model,HSN_Code` |
| Accessor | `getKeyValue(apiName)` on pull (correct for SDK 8.0). **Do not revert to `getFieldValue()`.** |
| Write | `addFieldValue` / `addKeyValue` on push (valid). `setId` on update currently passes a **string**; logs show `KEY: id EXPECTED TYPE: BigInt` on two UPDATE attempts. CREATE succeeded once. |
| Routes | `POST /api/zoho/sync-products`, `POST /api/zoho/sync-asset/:id`, `GET /api/zoho/catalog`, `GET /api/zoho/status` |
| Local store | `zoho_catalog`; `assets.zoho_product_id` |
| UI | Sidebar “Zoho Reference Catalog”; catalog cards; asset view push; “View in Zoho” |
| Known errors (historical, in `zoho_sync_logs`) | `OAUTH_SCOPE_MISMATCH` (fixed by metadata scopes), `SDK is UnInitialized`, `REQUIRED_PARAM_MISSING` (missing `fields`), `product.getFieldValue is not a function` (fixed on pull), BigInt on UPDATE |
| Latest pull | `2026-08-21 08:44 UTC` `PULL_CATALOG` SUCCESS; HTTP `POST /api/zoho/sync-products` 200 |

**Do not modify** the working Product `getKeyValue` pull or the OAuth singleton FileStore handling.

---

## Deals

| Item | Status |
|------|--------|
| API | `syncDealsFromZoho()` — `RecordOperations('Deals')` with `fields=Deal_Name,Type,Project_ID` |
| Accessor | **Broken copy of the old Product bug:** `deal.getFieldValue(...)` for name/type. `Project_ID` already uses `getKeyValue`. |
| Direction | Zoho → `projects` only (insert/update). No AssetEngine → Zoho Deal create. |
| Zoho record ID | `deal.getId()` stored as `projects.zoho_deal_id` |
| AssetEngine ID | Insert uses `Project_ID` or `PROJ-{last 6 of dealId}` |
| Mapping | `zoho_deal_id`, `zoho_project_id_key`, `sale_type` |
| Duplicate prevention | Weak `orWhere` on `zoho_project_id_key` (dangerous if null) |
| Update behavior | Overwrites `projectname`, Zoho keys, `sale_type` on match |
| Audit logging | `logSync` exists for Products; Deals path does **not** write `zoho_sync_logs` on success/fail the same way |
| Route | `POST /api/zoho/sync-deals` (JWT). **No frontend reference.** |
| Production data | 0/2 projects have Zoho IDs. Zero Deals rows in `zoho_sync_logs`. |

**Do not enable** experimental bidirectional sync. **Do not** create Zoho Deals or production projects automatically.

Fixing `getFieldValue` on Deals **REQUIRES TEST VALIDATION** and is still not a reason to turn the route on in production.

---

## Leads

- **API:** Not implemented. No `RecordOperations('Leads')`.
- **UI:** None.
- **Feasibility:** Not allowed with current scopes. Adding `ZohoCRM.modules.leads.*` would be an OAuth scope change — **forbidden** without a planned re-consent on TEST, and not to be done on production now.

---

## Accounts

- **API:** Not implemented.
- **Schema:** `clients.zoho_account_id` (nullable). 0 clients.
- **UI:** None.
- **Feasibility:** Needs Accounts scope + mapping design. Out of current OAuth grant.

---

## Contacts

- **API:** Not implemented against Zoho Contacts.
- **UI:** `networkScanner.js` “Quick Contacts” is a local network feature, not CRM.
- **Feasibility:** Needs Contacts scope. Out of grant.

---

## Quotes

- **API / UI:** None.
- **Feasibility:** Needs Quotes module scope and commercial workflow. Not in current integration.

---

## Sales Orders

- **API / UI:** None (Zoho Sales Orders).
- **Feasibility:** Out of grant. Do not implement on production.

---

## Purchase Orders

- **Zoho PO module:** Not integrated.
- **Local:** Project purchase orders (`project_orders`, `project_order_items`) are AssetEngine-native.
- **Feasibility:** Linking local POs to Zoho POs would be a new module + scopes. Keep local POs as-is.

---

## Invoices

- **API / UI:** None.
- **Feasibility:** Out of grant.

---

## Vendors

- **API / UI:** None.
- **Feasibility:** Out of grant.

---

## OAuth / shared routes (not a CRM module)

| Route | Purpose | Production note |
|-------|---------|-----------------|
| `GET /api/zoho/oauth/authorize` | Start Connect | Working. **Do not click / re-consent** as part of audits. |
| `GET /api/zoho/oauth/callback` | Code exchange | Working. Redirect `https://api.spvtm.com/api/zoho/oauth/callback` |
| `POST /api/zoho/oauth/disconnect` | Revoke local session | **Do not use.** |
| `GET /api/zoho/status` | Health + `crmUi` org/template | Used by TEST View-in-Zoho hydration; production frontend rarely calls it before opening CRM |

Token file: `web-app/asset-manager-backend/zoho_tokens.txt` — **do not modify or delete.**

---

## Known errors (production `zoho_sync_logs`)

| When (UTC) | Operation | Status | Error |
|------------|-----------|--------|-------|
| 2026-08-18 | PULL_CATALOG | ERROR | `OAUTH_SCOPE_MISMATCH` (historical) |
| 2026-08-20 | PULL_CATALOG | ERROR | SDK uninitialized / `REQUIRED_PARAM_MISSING` / `getFieldValue is not a function` |
| 2026-08-20 | PUSH_ASSET_CREATE | SUCCESS | — |
| 2026-08-21 | PUSH_ASSET | ERROR | `KEY: id EXPECTED TYPE: BigInt` |
| 2026-08-21 08:44 | PULL_CATALOG | SUCCESS | — |

No Leads/Accounts/Contacts/Quotes/SO/PO/Invoice/Vendor errors exist because those APIs are not called.
