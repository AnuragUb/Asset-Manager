# 06 — API

## Conventions

| Item | Practice |
|------|----------|
| Base | `/api/...` |
| Style | REST-ish JSON |
| Auth | Mix of none / JWT cookie or Bearer / role / permission / API key |
| Implementation | Almost all handlers in `server.js` |
| Source of truth | Route registrations in `server.js` (not outdated backend README) |

**Auth legend used below**

- `None` — no middleware
- `JWT` — `authenticateJWT`
- `JWT+roles` — plus `authorizeRoles(...)`
- `JWT+perm` — plus `requirePermission(...)`
- `API-Key` — `checkApiKey` (`EXTERNAL_API_KEY`)

---

## Critical warnings

1. **Auth is inconsistent.** Newer domains (assets list, projects writes, inventory, Zoho) often use JWT; older domains (DC, employees, OCR, settings, many ARRI routes) are often open.
2. **Duplicate registrations exist** (Express first-match matters), e.g.:
   - `GET /api/users` (JWT-only, then later admin-restricted)
   - `GET /api/projects` (JWT+roles, then later **unauthenticated** list)
   - `DELETE /api/asset_kinds/:name` (strict then weaker)
3. Frontend calls **`GET /api/all-orders`** — **no matching route found** at documentation time.
4. Legacy `arri.js` calls `/api/arri/clients`; live API is `/api/arri/customers`.

Before removing or renaming any route: **grep frontend, HTML, scripts, and external callers.**

---

## Route catalog by domain

### Health / debug

| Method | Route | Auth | Purpose |
|--------|-------|------|---------|
| GET | `/api/test-ping` | None | Liveness |
| GET | `/api/debug/diagnose/:id` | None | Debug asset |
| GET | `/api/debug/cookies` | None | Echo cookies |

### Auth

| Method | Route | Auth | Purpose | Typical consumers |
|--------|-------|------|---------|-------------------|
| POST | `/api/auth/login` | None | Login + cookies | `auth.js` |
| POST | `/api/auth/logout` | None | Clear session | `auth.js` |
| GET | `/api/auth/me` | Cookie/JWT | Current user / refresh | `auth.js`, `asset-view.js` |
| POST | `/api/auth/forgot-password` | None | Start reset | `auth.js` |
| POST | `/api/auth/reset-password` | None | Finish reset | `auth.js` |
| POST | `/api/signup` | None | Public register | `loginAnimations.js` |

### Users / RBAC / tenant

| Method | Route | Auth | Purpose | Consumers |
|--------|-------|------|---------|-----------|
| GET/POST | `/api/users` | JWT (+ checks) | List/create users | `rbac.js` |
| PUT/DELETE | `/api/users/:username` | JWT (+ admin) | Update/delete | — |
| POST | `/api/users/create` | JWT+roles | Create (alt) | — |
| POST | `/api/users/update-role` | JWT+roles | Role change | `rbac.js` |
| GET | `/api/roles` | JWT | Roles | — |
| GET | `/api/permissions` | JWT | Permissions | `rbac.js` |
| GET/POST/DELETE | `/api/role-permissions` | JWT | Grant/revoke | — |
| GET/POST/DELETE | `/api/rbac/roles`… | JWT+superuser | RBAC admin | `rbac.js` |
| CRUD | `/api/tenant/users`… | JWT+roles+`user.manage` | Tenant admin | `main.js` |
| GET | `/api/company` | JWT | Company info | — |

### Assets

| Method | Route | Auth | Purpose | Consumers |
|--------|-------|------|---------|-----------|
| GET | `/api/assets` | JWT | List/filter | `main`, `dashboard`, `projects`, `itAssets`, scanner |
| POST | `/api/assets` | JWT | Create | `main`, `dashboard` |
| PUT | `/api/assets/:id` | JWT | Update | `main`, `dashboard`, `employees`, `asset-view` |
| DELETE | `/api/assets/:id` | JWT | Soft-delete → Recycle Bin | `dashboard` |
| DELETE | `/api/assets/bulk` | JWT | Bulk soft-delete | — |
| POST | `/api/assets/bulk` | **None** | Bulk import | `dashboard` |
| GET | `/api/assets/search` | JWT | Search | `projects` |
| GET | `/api/assets/retired` | JWT | Retired list | `dashboard` |
| GET | `/api/assets/recycle-bin` | JWT | Legacy alias → Recovery Center (assets) | compat |
| POST | `/api/assets/:id/restore` | JWT+roles | Restore asset (delegates to Recovery Center) | `dashboard` |
| GET | `/api/assets/:id/history` | None | History | — |

### Recovery Center (platform)

| Method | Route | Auth | Purpose | Consumers |
|--------|-------|------|---------|-----------|
| GET | `/api/recovery-center/entity-types` | JWT | Registered entity types | `recovery-center.js` |
| GET | `/api/recovery-center/items` | JWT | Soft-deleted items (filters) | `recovery-center.js` |
| GET | `/api/recovery-center/summary` | JWT | Recoverable totals (nav badge) | `recovery-center.js` |
| POST | `/api/recovery-center/:entityType/:id/restore` | JWT + entity assert | Restore via Recovery Strategy | `recovery-center.js` |

Service: `services/recoveryCenterService.js` (entity registry + Recovery Strategy). Permanent delete not enabled.
| POST | `/api/assets/:id/sell` | JWT | Sell/retire | `dashboard` |
| POST | `/api/assets/:id/release-to-store` | JWT | End inspection | `dashboard` |
| POST | `/api/assets/:id/link-po-item` | JWT | Link PO line | `projects` |
| POST | `/api/assets/make-set` | JWT | Build kit | `dashboard`, `projects` |
| POST | `/api/assets/break-set` | JWT | Break kit | `projects`, `asset-view` |
| POST | `/api/assets/split` | **None** | Qty split | `dashboard`, `projects` |
| POST | `/api/assets/unsplit` | JWT | Merge back | `dashboard`, `projects`, `asset-view` |
| GET | `/api/asset-details/:id` | None (optional JWT) | Full detail | `dashboard`, `projects`, `asset-view` |
| GET | `/api/public/assets/:label` | None | Public payload | `public-view.html` |

**Tables often touched:** `assets`, `components`, `asset_it_details`, `project_assets`, `asset_history`, `audit_log`, `quantity_*`.

### Hierarchy

| Method | Route | Auth | Purpose | Consumers |
|--------|-------|------|---------|-----------|
| GET/POST | `/api/folders` | GET None / POST None | Folders | `main`, `dashboard` |
| DELETE | `/api/folders/:id` | JWT | Delete folder | `dashboard` |
| GET/POST | `/api/asset_kinds` | GET None / POST JWT+roles | Kinds | `main`, `dashboard` |
| DELETE | `/api/asset_kinds/:name` | JWT(+roles duplicate) | Delete kind | `dashboard` |
| POST | `/api/asset_kinds/upload-image` | None | Kind image | `dashboard` |
| GET | `/api/hierarchy/tree` | JWT | Combined tree | — |
| GET/POST | `/api/icons`… | None | Icon files | `dashboard` |

### Inventory

| Method | Route | Auth | Purpose | Consumers |
|--------|-------|------|---------|-----------|
| GET/POST | `/api/inventory/folders` | JWT / JWT+roles | Folders | `inventory`, `dashboard` |
| GET/POST | `/api/inventory/kinds` | JWT / JWT+roles | Kinds | `inventory`, `dashboard` |
| GET/POST/PUT | `/api/inventory/items`… | JWT / JWT+roles | Items | `inventory`, `dashboard` |
| POST | `/api/inventory/items/:id/delete` | JWT+roles | Soft-delete + `DELETE` history | Issue 4+ |
| POST | `/api/inventory/items/:id/restore` | JWT+roles | Restore + `RESTORE` history | Issue 4+ |
| GET | `/api/inventory/item-details/:id` | JWT | Detail | `inventory` |
| GET | `/api/inventory/quantity/events/:rootId` | JWT | Qty events (presented) | `quantity-history-modal`, `inventory` |

Event type SSOT: [`docs/architecture/inventory-event-system.md`](./architecture/inventory-event-system.md).

Gated by `FEATURE_INVENTORY_ENABLED`. Tables: `inventory_*`.

### Quantity (asset)

| Method | Route | Auth | Purpose |
|--------|-------|------|---------|
| POST | `/api/quantity/split` | None | Split event |
| POST | `/api/quantity/issue` | None | Issue |
| POST | `/api/quantity/consume` | None | Consume |
| POST | `/api/quantity/adjust` | None | Adjust |
| GET | `/api/quantity/events/:rootId` | None | History |
| GET | `/api/quantity/replay/:rootId` | None | Replay |

Consumers: `dashboard`, `quantity-history-modal`, inventory fallbacks.

### Projects / orders / temp assets

| Method | Route | Auth | Purpose | Consumers |
|--------|-------|------|---------|-----------|
| GET | `/api/projects` | JWT+roles **and** duplicate None | List | `dashboard`, `projects` |
| POST | `/api/projects` | JWT+roles | Create | `projects` |
| GET/PATCH/DELETE | `/api/projects/:id` | JWT / JWT+roles | CRUD | `projects`, `dashboard`, HTML |
| GET | `/api/projects/search` | JWT | Search | `dcProjectFetcher` |
| GET | `/api/projects/:id/history` | None | History | `project-view.html` |
| GET | `/api/projects/:id/assets` | JWT | Assigned | `projects`, `dashboard` |
| POST | `/api/projects/:id/assign-asset` | JWT | Assign | `projects`, `dashboard` |
| DELETE | `/api/projects/:id/unassign-asset/:assetId` | JWT | Unassign | `dashboard`, `projects` |
| POST | `/api/projects/:id/create-user` | JWT | Project user | `dashboard` |
| GET/POST | `/api/projects/:id/temporary-assets` | JWT | Temp assets | `dashboard` |
| GET/POST/DELETE | `/api/projects/:id/orders`… | JWT | POs | `projects` |
| GET | `/api/projects/:id/available-inventory` | JWT | Available stock | — |
| GET/PUT | `/api/orders`… | JWT | Global orders | `projects` |
| GET/POST/DELETE | `/api/temporary-assets`… | mixed | Temp lifecycle | `main`, `dashboard`, `projects` |
| POST | `/api/temporary-assets/:id/make-permanent` | **None** | Promote temp | `dashboard`, `projects` |
| GET | `/api/companies` | None | Companies | `dashboard` |
| GET | `/api/templates/set-import` | JWT | Import template file | `dashboard`, `employees` |

### Delivery challans

| Method | Route | Auth | Purpose | Consumers |
|--------|-------|------|---------|-----------|
| GET/POST | `/api/dc` | None | List/create | `dashboard`, `projects` |
| GET | `/api/dc/:id` | None | Detail | `dashboard` |
| POST | `/api/upload-logo` | None | Logo upload | `dashboard` |
| CRUD | `/api/dc-remarks`… | None | Remark templates | DC UI |

Tables: `delivery_challans`, `dc_item_mappings`, `dc_remark_templates`.

### Employees / quotas

| Method | Route | Auth | Consumers |
|--------|-------|------|-----------|
| CRUD + bulk `/api/employees`… | None | `employees.js`, `projects.js` |
| `/api/quotas`… | None | `employees.js` |

### Audit / reports

| Method | Route | Auth | Consumers |
|--------|-------|------|-----------|
| `/api/recent-activity`, `/api/audit-logs`… | None | `admin.js` (logs) |
| `/api/audit` | JWT | — |
| `/api/reports/asset-history` | None | — |

### Settings / Tally / HSN

| Method | Route | Auth | Consumers |
|--------|-------|------|-----------|
| `/api/settings/email`… | None | `settings.js` |
| `/api/settings/tally`… | None | settings UI |
| POST `/api/tally/sync` | None | `dashboard` |
| GET `/api/hsn` | None | forms |

Persistence often `dynamic.json` for settings; HSN uses `hsn_codes`.

### Zoho

| Method | Route | Auth | Consumers |
|--------|-------|------|-----------|
| POST `/api/zoho/sync-asset/:id` | JWT | `asset-view.js` |
| POST `/api/zoho/sync-deals` | JWT | — |
| POST `/api/zoho/sync-products` | JWT | `contextMenu`, `dashboard` |
| GET `/api/zoho/catalog` | JWT | `inventory` |
| GET `/api/zoho/status` | JWT | `contextMenu` |

### Service + ARRI

| Method | Route | Auth | Consumers |
|--------|-------|------|-----------|
| `/api/service/*` job-cards/customers | JWT | dual/legacy |
| `/api/arri/customers`, job-cards, next-jc-id, sync-sheets | **None** | `servicePortal.js` |

### Network

| Method | Route | Auth | Consumers |
|--------|-------|------|-----------|
| `/api/network/credentials`… | JWT+IT roles | `networkScanner.js` |
| `/api/network/contacts`… | JWT+IT roles | `networkScanner.js` |
| GET `/api/network-info` | None | scanner |
| GET `/api/scan` | None | scanner |

### QR / dynamic

| Method | Route | Auth | Consumers |
|--------|-------|------|-----------|
| `/api/qr/:id`, `/api/qr/generate/:text`, dynamic asset/project | None | dashboard, projects, warranty, img tags |
| `/api/dynamic`… | mostly None; DELETE JWT+roles | `dynamic.html` |

### Company templates

| Method | Route | Auth | Consumers |
|--------|-------|------|-----------|
| CRUD `/api/company-templates` | JWT | `companyTemplates.js` |

### OCR

| Method | Route | Auth | Consumers |
|--------|-------|------|-----------|
| `/api/ocr/*` process/history/export | **None** | `integration_client.js` / `ocr.js` |

Mostly filesystem under `input/` / export, not primary Postgres tables.

### External API

| Method | Route | Auth | Purpose |
|--------|-------|------|---------|
| `/api/external/projects`… | API-Key | External project CRUD/read |
| `/api/external/assets` | API-Key | External assets |
| `/api/external/stats` | API-Key | Stats |
| POST `/api/external/sheets-sync` | JWT+roles | Sheets sync |

### HTML page routes (non-JSON)

`GET /`, `/favicon.ico`, `/asset/:id`, `/inventory/:id`, `/project/:id`, `/public/asset/:label`, `/test-asset/:id`

---

## Tables of interest when changing APIs

Always identify:

1. Route handler in `server.js`
2. Knex tables touched
3. Frontend callers (`rg "/api/..."` under `asset-manager-frontend`)
4. Cache invalidation needs
5. Auth middleware consistency with sibling routes

---

## Count (approximate)

~**160** Express method registrations including HTML pages and duplicates.  
Treat this doc as a map; re-grep `server.js` before relying on exact line-level completeness after future commits.
