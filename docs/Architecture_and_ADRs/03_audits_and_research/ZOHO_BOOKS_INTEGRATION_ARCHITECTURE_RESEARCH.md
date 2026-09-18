# Zoho Books × AssetEngine — Integration Architecture Research

**Status:** Research / architecture discovery only  
**Date:** 2026-09-13  
**Constraint:** No production code, OAuth, or database changes were made in this pass.

**Companion canvas:** open beside chat — `zoho-books-integration-architecture.canvas.tsx`

Related codebase docs:

- `[architecture/ZOHO_CRM_INTEGRATION.md](./architecture/ZOHO_CRM_INTEGRATION.md)`
- `[PROCUREMENT_PHASE9_PLAN.md](./PROCUREMENT_PHASE9_PLAN.md)` (explicitly excludes Books)
- `[RECEIPT_NOTE_PHASE7_PLAN.md](./RECEIPT_NOTE_PHASE7_PLAN.md)` (notes no Books/Inventory SDK)

---



## Legend (claim types)


| Marker             | Meaning                                         |
| ------------------ | ----------------------------------------------- |
| **Codebase fact**  | Observed in AssetEngine repository              |
| **Documented**     | Official Zoho documentation                     |
| **Inference**      | Reasonable conclusion from docs + codebase      |
| **Recommendation** | Proposed architecture for next phase            |
| **Unresolved**     | Requires live Books org test or policy decision |


---



## Final architectural answer

**If AssetEngine remains the authoritative physical asset and operational inventory system for Cineom, what is the cleanest and safest way to make AssetEngine a first-class companion to Zoho Books without recreating Zoho Books inside AssetEngine or allowing Zoho Books to corrupt physical truth?**

**Recommendation:** Dual-connection, reference-first, event-assisted reconciliation — not inventory replication.

1. Keep **separate** Zoho product connections: existing **Zoho CRM** and new **Zoho Books**, each with its own OAuth scopes, refresh token store, and identity (`organization_id` for Books).
2. Integrate **commercial identities and documents** first: Books Items ↔ AE Products, Vendors/Customers, Books POs ↔ AE procurement mirror, later Bills/Payments as status references.
3. Keep AE exclusive ownership of: Assets, operational Inventory quantity + lineage, Receipt Notes, Physical Intake, Reservations, Managed Sets, Delivery Challans / physical dispatch.
4. Treat Books `stock_on_hand` as **financial inventory** derived from Books transactions — never as AE physical truth; do **not** auto-push AE quantities through Inventory Adjustments without an explicit finance policy (that recreates the JV anti-pattern).
5. Use **widgets** so Books users can see AE physical truth in context; use **webhooks + polling** so Books commercial events enter AE outboxes — never silently create physical Assets/Inventory without AE lifecycle rules.
6. Prefer **Premium** for API + widgets/automation companion mode; evaluate **Elite** only if Cineom needs warehouses / serial / composite **financial** features — still without making Elite inventory AE’s physical ledger.

---



## 1. Existing Zoho CRM integration architecture

**Codebase fact.** Live Zoho integration is **Zoho CRM India Production only**, centered on `@zohocrm/nodejs-sdk-8.0`.

### Layers

```text
Admin UI (contextMenu / products / purchase-orders)
        │
        ▼
Express server.js  (/api/zoho/oauth/*, status, sync, PO import)
        │
        ├─► zohoService.js          CRM SDK + FileStore OAuth
        ├─► zohoProcurementService  CRM Purchase_Orders GET
        ├─► productService          Product publish/refresh + product_external_ref
        ├─► procurementService      PO mirror + procurement_* tables
        └─► receiptProjectionService  outbox stub (no Books adapter)
```



### Exact files


| Responsibility            | Path                                                                      |
| ------------------------- | ------------------------------------------------------------------------- |
| SDK init / OAuth / tokens | `web-app/asset-manager-backend/services/zohoService.js`                   |
| CRM PO adapter            | `web-app/asset-manager-backend/services/zohoProcurementService.js`        |
| Product field capability  | `web-app/asset-manager-backend/services/zohoProductFields.js`             |
| Product domain            | `web-app/asset-manager-backend/services/productService.js`                |
| Procurement domain        | `web-app/asset-manager-backend/services/procurementService.js`            |
| Receipt outbox            | `web-app/asset-manager-backend/services/receiptProjectionService.js`      |
| Routes                    | `web-app/asset-manager-backend/server.js` (`/api/zoho/*`, PO zoho routes) |
| Status UI                 | `web-app/asset-manager-frontend/js/contextMenu.js`                        |
| Architecture doc          | `docs/architecture/ZOHO_CRM_INTEGRATION.md`                               |




### OAuth flow (codebase fact)

1. Admin JWT → `GET /api/zoho/oauth/authorize`
2. CSRF `state` in cache (`zoho:oauth:state:*`, TTL ~600s)
3. Redirect `https://accounts.zoho.in/oauth/v2/auth` with scopes, `access_type=offline`, `prompt=consent`
4. Callback `ZOHO_REDIRECT_URL` → `completeOAuthWithCode` → SDK `OAuthBuilder.grantToken`
5. Persist via **FileStore** `zoho_tokens.txt` (plaintext CSV)
6. Later calls: `zohoService.init()` loads refresh token; SDK refreshes access token

Env keys (names only): `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REDIRECT_URL`, `ZOHO_CRM_ORG_ID`, optional legacy `ZOHO_GRANT_TOKEN`.

### Current CRM scopes (codebase fact)

- `ZohoCRM.modules.products.ALL`
- `ZohoCRM.modules.deals.READ`
- `ZohoCRM.settings.fields.READ`
- `ZohoCRM.settings.modules.READ`
- `ZohoCRM.modules.purchaseorders.READ`
- `ZohoCRM.modules.accounts.READ`



### Caching / errors / outbox

- Redis/memory: OAuth state, catalog debounce, accounts cache
- Rate limits classified (`RATE_LIMIT` / `ZOHO_429`) — no automatic retry loop in `zohoService`
- `zoho_sync_logs`, `procurement_sync_event`, `receipt_projection_outbox` (adapter not configured)



### Books today

**Codebase fact:** No Zoho Books SDK, no `zohoapis.*/books` client, no Books scopes. Procurement Phase 9 docs explicitly exclude Books.

---



## 2–3. Reusable vs CRM-specific; reuse strategy



### Reusable patterns

- Server-based OAuth authorize/callback + CSRF state
- Presence-only connection status APIs
- Cache debounce / list caching conventions
- Error taxonomy helpers
- `*_external_ref` uniqueness model `(system, module, external_id)`
- Sync event / outbox tables
- `setZohoGateway` injection in domain services



### CRM-specific

- `@zohocrm/nodejs-sdk-8.0`
- All `ZohoCRM.*` scopes
- Modules Products / Deals / Accounts / Purchase_Orders
- FileStore CRM tokens + `crm.zoho.in` UI links
- `zohoProductFields.js` CRM field maps



### Recommendation: **Option A**

Create a **separate Zoho Books service** that reuses OAuth *patterns*, not the CRM SDK singleton.

**Do not** (yet) generalize into a multi-product Zoho connector (**Option B**): CRM is SDK-centric; Books is REST + mandatory `organization_id`. Premature abstraction adds risk without payoff.

---



## 4–5. Books authentication & scopes



### Documented differences vs CRM


| Concern        | CRM (AE today)           | Books (official)                                |
| -------------- | ------------------------ | ----------------------------------------------- |
| India accounts | `accounts.zoho.in`       | Same DC family                                  |
| API            | CRM SDK                  | `https://www.zohoapis.in/books/v3`              |
| Auth header    | SDK-managed              | `Authorization: Zoho-oauthtoken {access_token}` |
| Org            | `ZOHO_CRM_ORG_ID` for UI | `organization_id` **on every API call**         |
| Scopes         | `ZohoCRM.*`              | `ZohoBooks.*` — **not interchangeable**         |
| Items          | CRM Products             | Items under `ZohoBooks.settings.*`              |
| Multi-org      | Single FileStore         | `GET /organizations` then pin one               |


Official sources:

- [Books API Introduction](https://www.zoho.com/books/api/v3/introduction/)
- [Books OAuth / scopes](https://www.zoho.com/books/api/v3/oauth/)
- [Books API v4 OAuth](https://www.zoho.com/books/api/v4/oauth/) (same scope model; prefer v3 unless AE standardizes on v4 later)



### Recommended storage model

**Recommendation:** Two integration identities:

- `Zoho CRM connection` (existing tokens)
- `Zoho Books connection` (new tokens + `organization_id` + DC)

Do **not** add Books scopes to the existing CRM refresh token / FileStore. Prefer a dedicated Books token store (and improve encryption vs CRM plaintext when introducing it).

### Recommended least-privilege scopes (Phase 0–1 read)


| Scope                           | Purpose                     |
| ------------------------------- | --------------------------- |
| `ZohoBooks.settings.READ`       | Organizations + Items       |
| `ZohoBooks.contacts.READ`       | Customers + Vendors         |
| `ZohoBooks.purchaseorders.READ` | PO mirror                   |
| `ZohoBooks.bills.READ`          | Bill reconciliation (later) |
| `ZohoBooks.vendorpayments.READ` | Payment status (Phase 7+)   |


Write scopes deferred until a deliberate write phase.

**Unresolved:** Whether Elite advanced inventory requires additional `ZohoInventory.`* scopes for Purchase Receives / Composite Items on the Cineom org.

---



## 6. Books APIs relevant to AE


| Area                 | Official surface                                                  | AE relevance                                 |
| -------------------- | ----------------------------------------------------------------- | -------------------------------------------- |
| Items                | Books Items (settings scopes); `stock_on_hand`, `track_inventory` | High — Product mapping                       |
| Contacts             | Customers + Vendors                                               | High — reference masters                     |
| Purchase Orders      | Books PO API                                                      | High — commercial PO                         |
| Bills                | Bills API; can link `purchaseorder_item_id`                       | High — AP / receive financialization         |
| Vendor Payments      | Vendor payments API                                               | Medium — later                               |
| Banking / Accountant | Banking, journals                                                 | Low initially                                |
| Purchase Receives    | **Zoho Inventory** API (`/inventory/v1/purchasereceives`)         | Conditional — Elite / Inventory-enabled orgs |
| Composite Items      | **Zoho Inventory** composite items API                            | Conditional — not AE Set engine              |
| Delivery Challans    | Books DC module + extension metadata                              | Medium — later GST/finance copy              |
| Widgets              | ZET / ZFAPPS                                                      | High — UX companion                          |
| Webhooks             | Workflow automation                                               | Medium — events + polling                    |


Sources:

- [Purchase Orders](https://www.zoho.com/books/api/v3/purchase-order/)
- [Bills](https://www.zoho.com/books/api/v3/bills/)
- [Items](https://www.zoho.com/books/api/v3/items/)
- [Inventory Purchase Receives](https://www.zoho.com/inventory/api/v1/purchasereceives/)
- [Composite Items](https://www.zoho.com/inventory/api/v1/compositeitems/)
- [Widgets overview](https://www.zoho.com/books/developer/widgets/overview.html)
- [Extension components](https://www.zoho.com/books/developer/extensions/extension-components.html)
- [Workflow rules / webhooks](https://www.zoho.com/books/help/settings/automation.html)

---



## 7–12. Object mapping recommendations


| AE object      | Books object             | Books needs it?    | Owner of truth                    | Direction                            | Sync                      | Notes                                       |
| -------------- | ------------------------ | ------------------ | --------------------------------- | ------------------------------------ | ------------------------- | ------------------------------------------- |
| Product        | Item                     | Yes                | AE identity; Books financial item | AE↔Books reference; optional publish | Reference / optional push | Never equate CRM Product id = Books Item id |
| Customer       | Contact (customer)       | Yes                | Books financial                   | Books→AE                             | Reference                 | Separate from CRM Account                   |
| Vendor         | Contact (vendor)         | Yes                | Books                             | Books→AE                             | Reference                 | Store on PO provenance                      |
| Procurement PO | Purchase Order           | Yes                | Books commercial; AE mirror       | Books→AE READ                        | Mirror                    | Future preferred PO commercial source       |
| Receipt Note   | Bill / Purchase Receive* | Financial qty only | **AE physical**                   | Reconcile; optional AE→draft         | Reconciliation            | RN ≠ Bill ≠ Receive                         |
| Asset          | None / Fixed Asset       | Usually no         | **AE**                            | None                                 | None                      | Do not invent stock rows per SN             |
| Inventory qty  | Item `stock_on_hand`     | Optional           | **AE physical**                   | Variance report                      | Reconciliation            | Avoid Adjustments as sync                   |
| Reservation    | —                        | No                 | AE                                | —                                    | None                      | Ops-only                                    |
| Managed Set    | Composite Item*          | Commercial only    | **AE set lifecycle**              | Optional later                       | Reference                 | Composite ≠ allocation engine               |
| DC             | Books Delivery Challan   | Maybe GST          | AE physical dispatch              | Deferred                             | Reference                 | Extension metadata exists                   |
| Bill / Payment | Bill / Vendor Payment    | Yes AP             | Books                             | Books→AE status                      | Event/poll                | Never auto-create AE assets                 |


Purchase Receive / Composite primarily Inventory APIs; availability depends on plan/org (**Unresolved** live).

### Identifier architecture (Recommendation)

Follow existing `*_external_ref` pattern:

```text
AE Product
  ├── (ZOHO_CRM, Products, crm_id)
  └── (ZOHO_BOOKS, Items, books_item_id)

AE PO
  └── (ZOHO_BOOKS, Purchase_Orders, books_po_id)

AE Vendor / Customer
  └── dedicated external_ref or columns for Books contact ids
```

Do not assume CRM id = Books id. Uniqueness: `(system, module, external_id)` unique; one AE entity may have multiple systems.

---



## 13. Physical stock authority

**Documented:** Books Items expose `track_inventory`, `stock_on_hand`, location stock fields. Stock changes through commercial/inventory transactions.

**Inference:** Books is a **transaction-derived financial stock ledger**, not a physical identity system for serialized broadcast assets.

**Recommendation:**

- AE remains physical SOH / serialized truth.
- Books stock (if enabled) is financial representation.
- Do **not** blindly write AE quantities via Inventory Adjustments — that recreates Tally/JV “paper fixes.”
- Prefer reconciliation reports + deliberate finance-approved Books corrections.
- Policy decision (**Unresolved**): whether mapped AE SKUs should have Books `track_inventory` on or off.

---



## 14. Sets vs Composite Items


| AE Managed Set                                   | Books/Inventory Composite                       |
| ------------------------------------------------ | ----------------------------------------------- |
| Immutable requirements                           | Mapped component list                           |
| Allocates real Assets/Inventory via reservations | Kit/assembly stock explosion for commercial qty |
| Completeness / composition / break with lineage  | Bundle/unbundle financial stock                 |
| **Must remain AE-only for physical truth**       | Optional commercial representation later        |


Do not force 1:1 mapping because both say “kit/composite.”

---



## 15. PO / Receipt / Bill

**Safest architecture (Recommendation):**

1. AE Receipt Note remains authoritative for **physical** receipt.
2. Books Bill (and Inventory Purchase Receive if present) is **financial/commercial**.
3. Optional later: AE POSTED RN enqueues a **draft** Books receive/bill for finance confirmation.
4. Books Receive/Bill must **not** auto-create AE Assets/Inventory.
5. During transition, expect dual PO sources (CRM PO today + Books PO later) — plan a single commercial source of truth.

---



## 16. Widgets

**Documented:**

- ZET / `ZFAPPS.extension.init()`, `ZFAPPS.get('user.name'|'organization.org_name')`
- Internal or external hosting (iframe)
- API Configurations + Connections for backend calls
- Extension metadata paths include purchase orders, bills, items, customers, vendors, delivery challans, composite items

**Inference:** A Books → AE Widget → AE backend → physical truth panel is technically supported in principle.

**Unresolved:** Exact sidebar location keys for PO/Bill/Item (public examples emphasize invoice/customer). Confirm on live developer “supported locations” help.

Sources: [Widgets](https://www.zoho.com/books/developer/widgets/overview.html), [Key configuration](https://www.zoho.com/books/developer/widgets/key-configuration.html), [Create widgets](https://www.zoho.com/books/developer/widgets/create-widget.html), [Extension components](https://www.zoho.com/books/developer/extensions/extension-components.html).

---



## 17. Webhooks / events

**Documented:** Workflow rules support Created / Edited / Deleted / Submitted / Approved / Rejected; actions include webhooks; usage limits apply.

**Recommendation:** Use webhooks as accelerators; retain polling for PO/Bill/Item sync reliability (missed deliveries, retries). AE endpoints must authenticate and enqueue outbox — never directly mutate physical tables from raw webhook payloads without AE services.

Source: [Workflow Rules](https://www.zoho.com/books/help/settings/automation.html).

---



## 18. India Free / Premium / Elite matrix

Region: **India** (`zoho.com/in/books`). Prices change; use official pages for quotes.


| Capability                              | Free    | Standard | Professional | Premium | Elite  |
| --------------------------------------- | ------- | -------- | ------------ | ------- | ------ |
| API calls/day                           | 1,000   | 2,000    | 5,000        | 10,000  | 10,000 |
| PO / Bills / basic inventory track      | Limited | Yes      | Yes          | Yes     | Yes    |
| Custom roles / workflows                | Limited | Limited  | Yes          | Yes     | Yes    |
| Widgets / embed apps                    | Confirm | Confirm  | Limited*     | Yes     | Yes    |
| Custom modules / buttons                | No      | No       | No           | Yes     | Yes    |
| Warehouses / composite / serial / batch | No      | No       | No           | No      | Yes    |


Sources:

- [India pricing](https://www.zoho.com/in/books/pricing.html)
- [Plan comparison](https://www.zoho.com/in/books/pricing/pricing-comparison.html)
- [API calls/day FAQ](https://www.zoho.com/in/books/kb/automation/per-day-api-limit.html)

Web tabs noted Premium (India) in extension docs — confirm widgets on live plan.

**Recommendation:** Premium is the practical minimum for a serious AE companion (API headroom + automation/widgets). Elite only if finance requires advanced inventory features — still without replacing AE physical authority.

---



## 19. Phased roadmap


| Phase | Purpose                                          | Direction                   | Authority preserved | Risk                             |
| ----- | ------------------------------------------------ | --------------------------- | ------------------- | -------------------------------- |
| 0     | OAuth + org discovery read-only                  | Books→token store           | All AE truth        | Wrong DC/redirect                |
| 1     | `zohoBooksService` + status UI + separate tokens | Connect                     | CRM unchanged       | Scope creep into CRM FileStore   |
| 2     | Item ↔ Product `product_external_ref`            | Pull / optional publish     | AE Product          | SKU/name collisions              |
| 3     | Vendor/Customer reference masters                | Books→AE                    | Books owns contacts | CRM/Books duplicates             |
| 4     | Books PO mirror (like CRM PO)                    | Books→AE READ               | AE RN receiving     | Dual PO sources                  |
| 5     | RN ↔ Bill/Receive reconciliation                 | Link ids only               | AE RN               | Finance assumes Books = physical |
| 6     | Widgets on PO/Item/Vendor                        | Books UI→AE API             | AE auth             | Location/plan gates              |
| 7     | Bill/payment + stock variance reports            | Reports / controlled drafts | Dual authority      | Adjustments-as-JV temptation     |




### Build first / defer

**First:** OAuth, org pin, read Items/Contacts/Vendors/POs, external refs, separate status UI.  
**Defer:** Inventory Adjustments sync, auto Asset create from Books, Set↔Composite bidirectional sync, banking deep dive, replacing CRM PO import before Books PO is proven.

---



## 20. Risks / unknowns


| Item                                                      | Type                             |
| --------------------------------------------------------- | -------------------------------- |
| CRM + Books dual PO sources during transition             | Operational                      |
| Inventory Purchase Receive availability on Cineom org     | Live-test                        |
| Widget locations for PO/Bill/Item                         | Live-test                        |
| Whether Books inventory tracking should be ON for AE SKUs | Policy                           |
| API rate limits vs catalog volume                         | Capacity                         |
| Token encryption when adding Books store                  | Security improvement opportunity |
| Fixed Asset module (Premium+) vs AE Asset                 | Scope confusion risk             |


---



## 21. Questions requiring live Books test

1. What is Cineom’s Books `organization_id` and DC confirmation (`.in`)?
2. Current subscription plan (Free → Ultimate)?
3. Are advanced inventory / Purchase Receives / Composite Items enabled?
4. Do Items already exist that should map to AE Products (SKU strategy)?
5. Are vendors already Books Contacts with stable ids?
6. Exact widget locations available on the org?
7. Can a workflow webhook reach AE staging with HMAC/auth?
8. Accounting policy: Books `track_inventory` on or off for AE-managed SKUs?
9. Will Books become the **only** commercial PO source (vs CRM POs)?

---



## 22. Read-only live validation plan (do not execute destructively)

1. OAuth authorize (India) with READ scopes; store tokens separately from CRM
2. `GET /organizations` → pin org
3. List Items
4. List customer Contacts
5. List Vendors
6. List Purchase Orders
7. Probe Purchase Receives (Inventory API) — success or documented absence
8. List Bills
9. Inspect inventory fields on Items
10. Inspect widget locations / ZFAPPS context
11. Confirm webhook modules on plan (outbound test to staging only)

No create/update/delete of Books records unless a future implementation phase explicitly requests it.

---



## Official link index

- [https://www.zoho.com/books/api/v3/introduction/](https://www.zoho.com/books/api/v3/introduction/)
- [https://www.zoho.com/books/api/v3/oauth/](https://www.zoho.com/books/api/v3/oauth/)
- [https://www.zoho.com/books/api/v3/items/](https://www.zoho.com/books/api/v3/items/)
- [https://www.zoho.com/books/api/v3/purchase-order/](https://www.zoho.com/books/api/v3/purchase-order/)
- [https://www.zoho.com/books/api/v3/bills/](https://www.zoho.com/books/api/v3/bills/)
- [https://www.zoho.com/inventory/api/v1/purchasereceives/](https://www.zoho.com/inventory/api/v1/purchasereceives/)
- [https://www.zoho.com/inventory/api/v1/compositeitems/](https://www.zoho.com/inventory/api/v1/compositeitems/)
- [https://www.zoho.com/books/developer/widgets/overview.html](https://www.zoho.com/books/developer/widgets/overview.html)
- [https://www.zoho.com/books/developer/widgets/key-configuration.html](https://www.zoho.com/books/developer/widgets/key-configuration.html)
- [https://www.zoho.com/books/developer/extensions/extension-components.html](https://www.zoho.com/books/developer/extensions/extension-components.html)
- [https://www.zoho.com/books/help/settings/automation.html](https://www.zoho.com/books/help/settings/automation.html)
- [https://www.zoho.com/in/books/pricing.html](https://www.zoho.com/in/books/pricing.html)
- [https://www.zoho.com/in/books/pricing/pricing-comparison.html](https://www.zoho.com/in/books/pricing/pricing-comparison.html)
- [https://www.zoho.com/in/books/kb/automation/per-day-api-limit.html](https://www.zoho.com/in/books/kb/automation/per-day-api-limit.html)

