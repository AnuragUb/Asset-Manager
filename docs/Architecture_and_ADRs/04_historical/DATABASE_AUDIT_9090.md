# Database Audit: `59:9090` (`asset_manager_test`)

## Scope

This document describes the **current live PostgreSQL schema** behind the `59:9090` test application.

- Environment: `app-test`
- Database: `asset_manager_test`
- Source of truth for this document: **live PostgreSQL metadata**, not assumptions from migrations alone
- Mode: read-only inspection
- Date of snapshot: current workspace session

Important note:

- This is a document of the **database as it exists right now** on `9090`.

## Environment Mapping

- [docker-compose.yml](file:///f:/AssetManager/AssetManager_Dev/docker-compose.yml) maps `app-test` to port `9090`
- [docker-compose.yml](file:///f:/AssetManager/AssetManager_Dev/docker-compose.yml) sets `DB_NAME=asset_manager_test` for `app-test`
- [knexfile.js](file:///f:/AssetManager/AssetManager_Dev/web-app/asset-manager-backend/knexfile.js) maps the `test` environment to `asset_manager_test`

### Server Relationship

- `59:9090` is the gold-standard schema reference and test environment
- `118:8080` is the primary live production server
- `59:8080` is the local disaster-recovery / backup production environment
- Production-safe alignment is validated by `scripts/audit_fk_preflight.js`

### Production Parity Note

After the July 2026 alignment work:

- `118.asset_manager` has been brought to **safe parity** with `9090`
- `59:8080` has been brought to **safe parity** and currently passes all `27` FK preflight checks
- `118` still intentionally differs from `9090` in two ways:
  - `audit_log.assetid -> assets.id` is not enforced on `118` because live audit rows store non-asset IDs too
  - `layout_markers` is not present in `118.asset_manager`

## Snapshot Summary

- Total live `public` tables: `38`
- Total indexes: `59`
- Strict PostgreSQL foreign keys: `27`
- Live row counts are currently very low in test; most tables are empty

This means the schema is large enough to represent a full application, but the current `9090` database is mostly a structural test environment rather than a fully populated operational copy.

## Mental Domain Segregation

### 1. Inventory Core

These tables represent the physical or native inventory model.

- `assets`
- `asset_it_details`
- `asset_history`
- `asset_hierarchy`
- `components`
- `asset_kinds`
- `folders`
- `temporary_assets`

### 2. Project Operations

These tables represent project masters, project assignment, and project audit.

- `projects`
- `project_assets`
- `project_history`

### 3. Commercial / Dispatch / Procurement

These tables represent outward documents, purchasing context, and dispatch mapping.

- `project_orders`
- `project_order_items`
- `delivery_challans`
- `dc_item_mappings`
- `hsn_codes`

### 4. Quantity / Stock Movement

These tables represent event-style quantity changes.

- `quantity_events`
- `quantity_event_lines`

### 5. Identity / Access / Security

These tables represent users, roles, permissions, and token flows.

- `users`
- `roles`
- `permissions`
- `role_permissions`
- `auth_tokens`
- `password_resets`

### 6. Organization / Workforce / Policy

These tables represent company and employee context.

- `companies`
- `company_templates`
- `employees`
- `department_quotas`

### 7. Layout / Visual Placement

These tables represent floorplan or layout mapping.

- `layouts`
- `layout_markers`

### 8. External / Service Domain

These tables represent service/repair-specific workflows.

- `arri_clients`
- `arri_job_cards`

### 9. External / Integration Metadata

These tables represent external integration state and sync logs.

- `oauthtoken`
- `zoho_catalog`
- `zoho_sync_logs`

### 10. System / Operational Metadata

These tables support migrations and audit.

- `audit_log`
- `knex_migrations`
- `knex_migrations_lock`

## Current ERD

### Strict Foreign Keys Present in PostgreSQL

These relationships are actually enforced by the database:

- `asset_hierarchy.assetid -> assets.id`
- `asset_hierarchy.parentid -> assets.id`
- `asset_it_details.assetid -> assets.id`
- `assets.linked_po_item_id -> project_order_items.id`
- `assets.parentid -> assets.id`
- `audit_log.assetid -> assets.id`
- `auth_tokens.user_id -> users.username`
- `components.parentid -> assets.id`
- `dc_item_mappings.assetid -> assets.id`
- `dc_item_mappings.dc_id -> delivery_challans.id`
- `folders.parentid -> folders.id`
- `layout_markers.assetid -> assets.id`
- `layout_markers.layoutid -> layouts.id`
- `project_assets.assetid -> assets.id`
- `project_assets.projectid -> projects.id`
- `project_history.projectid -> projects.id`
- `project_order_items.assetid -> assets.id`
- `project_order_items.orderid -> project_orders.id`
- `project_orders.projectid -> projects.id`
- `quantity_event_lines.event_id -> quantity_events.id`
- `role_permissions.permission_key -> permissions.key`
- `role_permissions.role_name -> roles.name`
- `temporary_assets.linked_po_item_id -> project_order_items.id`
- `temporary_assets.projectid -> projects.id`
- `users.company_id -> companies.id`
- `users.project_id -> projects.id`
- `users.role -> roles.name`

### FK-Only ERD View

This view shows only the relationships that are currently enforced as foreign keys in `9090`.

```text
users ---< auth_tokens
users >--- roles
users >--- companies
users >--- projects

roles ---< role_permissions >--- permissions

layouts ---< layout_markers
assets ---< layout_markers

quantity_events ---< quantity_event_lines

assets ---1 asset_it_details
assets ---< components
assets ---< audit_log
assets ---< asset_hierarchy >--- assets
assets ---< assets

projects ---< project_history
projects ---< project_orders ---< project_order_items
projects ---< project_assets >--- assets
projects ---o temporary_assets

project_order_items ---o assets
project_order_items ---o temporary_assets

delivery_challans ---< dc_item_mappings >--- assets

folders ---< folders
```

Notes:

- `project_order_items ---o assets` includes both:
  - `project_order_items.assetid -> assets.id`
  - `assets.linked_po_item_id -> project_order_items.id`
- `project_order_items ---o temporary_assets` includes:
  - `temporary_assets.linked_po_item_id -> project_order_items.id`
- `projects ---o temporary_assets` reflects `ON DELETE SET NULL`, not cascade
- The live `9090` schema is now meaningfully linked across inventory, projects, dispatch, orders, users, roles, and layout domains

### Important Implied Relationships

These relationships are used by naming and application logic, but are **not enforced as foreign keys** in the current live schema:

- `asset_history.assetid -> assets.id`
- `layouts.projectid -> projects.id`
- `users.employee_id -> employees.id`
- `company_templates.company_id -> companies.id`
- `quantity_event_lines.asset_id -> assets.id`
- `quantity_events.root_id -> assets.id`

Important note:

- Several relationships that were previously only implied are now FK-enforced in `9090`
- Some of them remain unenforced in `8080` because production orphan data still exists

### Text ERD View

```text
users ---< auth_tokens
users >--- roles
users >--- companies
users >--- projects
roles ---< role_permissions >--- permissions

projects ---< project_assets >--- assets
projects ---< project_history
projects ---< project_orders ---< project_order_items
projects ---< layouts ---< layout_markers
projects ---< temporary_assets

assets ---1 asset_it_details
assets ---o project_order_items
assets ---< asset_history
assets ---< audit_log
assets ---< dc_item_mappings >--- delivery_challans
assets ---< project_assets
assets ---< layout_markers
assets ---< quantity_event_lines >--- quantity_events
assets ---< components
assets ---< asset_hierarchy >--- assets
assets ---o assets.linked_po_item_id >--- project_order_items
temporary_assets ---o linked_po_item_id >--- project_order_items

folders ---< folders
assets ---< assets

companies ---< users
employees ---< users
```

## Current Table Inventory

### Live Tables

- `arri_clients`
- `arri_job_cards`
- `asset_hierarchy`
- `asset_history`
- `asset_it_details`
- `asset_kinds`
- `assets`
- `audit_log`
- `auth_tokens`
- `companies`
- `company_templates`
- `components`
- `dc_item_mappings`
- `delivery_challans`
- `department_quotas`
- `employees`
- `folders`
- `hsn_codes`
- `knex_migrations`
- `knex_migrations_lock`
- `layout_markers`
- `layouts`
- `oauthtoken`
- `password_resets`
- `permissions`
- `project_assets`
- `project_history`
- `project_order_items`
- `project_orders`
- `projects`
- `quantity_event_lines`
- `quantity_events`
- `role_permissions`
- `roles`
- `temporary_assets`
- `users`
- `zoho_catalog`
- `zoho_sync_logs`

## Index Inventory

The current live schema mostly has primary-key and unique indexes, with limited secondary indexing for query acceleration.

### Primary / Unique Indexes Present

- `arri_clients_name_unique` on `arri_clients(name)`
- `arri_clients_pkey` on `arri_clients(id)`
- `arri_job_cards_pkey` on `arri_job_cards(jobcardno)`
- `asset_hierarchy_pkey` on `asset_hierarchy(id)`
- `asset_history_pkey` on `asset_history(id)`
- `asset_it_details_pkey` on `asset_it_details(assetid)`
- `asset_kinds_pkey` on `asset_kinds(name)`
- `assets_pkey` on `assets(id)`
- `audit_log_pkey` on `audit_log(id)`
- `auth_tokens_pkey` on `auth_tokens(token_hash)`
- `companies_pkey` on `companies(id)`
- `company_templates_pkey` on `company_templates(id)`
- `components_pkey` on `components(id)`
- `dc_item_mappings_dc_id_assetid_unique` on `dc_item_mappings(dc_id, assetid)`
- `dc_item_mappings_pkey` on `dc_item_mappings(id)`
- `delivery_challans_pkey` on `delivery_challans(id)`
- `department_quotas_pkey` on `department_quotas(department, category)`
- `employees_pkey` on `employees(id)`
- `folders_pkey` on `folders(id)`
- `hsn_codes_pkey` on `hsn_codes(code)`
- `knex_migrations_pkey` on `knex_migrations(id)`
- `knex_migrations_lock_pkey` on `knex_migrations_lock(index)`
- `layout_markers_pkey` on `layout_markers(id)`
- `layouts_pkey` on `layouts(id)`
- `oauthtoken_pkey` on `oauthtoken(user_mail, client_id)`
- `password_resets_pkey` on `password_resets(token_hash)`
- `permissions_pkey` on `permissions(key)`
- `project_assets_pkey` on `project_assets(projectid, assetid)`
- `project_history_pkey` on `project_history(id)`
- `project_order_items_pkey` on `project_order_items(id)`
- `project_orders_pkey` on `project_orders(id)`
- `projects_pkey` on `projects(id)`
- `quantity_event_lines_pkey` on `quantity_event_lines(event_id, asset_id)`
- `quantity_events_pkey` on `quantity_events(id)`
- `role_permissions_pkey` on `role_permissions(role_name, permission_key)`
- `roles_pkey` on `roles(name)`
- `temporary_assets_pkey` on `temporary_assets(id)`
- `users_pkey` on `users(username)`
- `zoho_catalog_pkey` on `zoho_catalog(zoho_product_id)`
- `zoho_sync_logs_pkey` on `zoho_sync_logs(id)`

### Index Takeaway

This schema has identity and uniqueness mostly covered. After the three `9090` FK waves, it now also has several supporting join indexes that did not exist in the original test schema.

Useful new secondary indexes now present in `9090` include:

- `idx_asset_hierarchy_assetid`
- `idx_asset_hierarchy_parentid`
- `idx_project_order_items_orderid`
- `idx_assets_linked_po_item_id`
- `idx_assets_parentid`
- `idx_temporary_assets_linked_po_item_id`
- `idx_components_parentid`
- `idx_project_history_projectid`
- `idx_project_orders_projectid`
- `idx_project_assets_assetid`
- `idx_temporary_assets_projectid`
- `idx_layout_markers_assetid`
- `idx_project_order_items_assetid`
- `idx_dc_item_mappings_assetid`
- `idx_folders_parentid`
- `idx_users_company_id`
- `idx_users_project_id`
- `idx_users_role`
- `idx_audit_log_assetid`

The schema is still light on some useful performance indexes for common filters and joins such as:

- `assets(category)`
- `assets(status)`
- `assets(department)`
- `asset_history(assetid, timestamp)`
- `layouts(projectid)`
- `company_templates(company_id)`
- `quantity_event_lines(asset_id)`

This is one of the clearest places where future performance work will matter.

## Live Row Counts

These are PostgreSQL estimated live row counts from the current `9090` database:

| Table | Estimated Rows |
|---|---:|
| `arri_clients` | 0 |
| `arri_job_cards` | 0 |
| `asset_hierarchy` | 0 |
| `asset_history` | 1 |
| `asset_it_details` | 1 |
| `asset_kinds` | 1 |
| `assets` | 1 |
| `audit_log` | 2 |
| `auth_tokens` | 0 |
| `companies` | 0 |
| `company_templates` | 0 |
| `components` | 0 |
| `dc_item_mappings` | 0 |
| `delivery_challans` | 0 |
| `department_quotas` | 0 |
| `employees` | 0 |
| `folders` | 1 |
| `hsn_codes` | 0 |
| `knex_migrations` | 0 |
| `knex_migrations_lock` | 0 |
| `layout_markers` | 0 |
| `layouts` | 0 |
| `oauthtoken` | 0 |
| `password_resets` | 0 |
| `permissions` | 0 |
| `project_assets` | 0 |
| `project_history` | 0 |
| `project_order_items` | 0 |
| `project_orders` | 0 |
| `projects` | 0 |
| `quantity_event_lines` | 0 |
| `quantity_events` | 0 |
| `role_permissions` | 0 |
| `roles` | 0 |
| `temporary_assets` | 0 |
| `users` | 0 |
| `zoho_catalog` | 0 |
| `zoho_sync_logs` | 0 |

## The Four Questions: Table-by-Table Review

Legend for the last column:

- `No need`: table is never expected to approach 10M rows
- `Maybe`: possible at scale, but current design would need work
- `Yes`: shape is naturally compatible with very high row counts if indexed and managed well

| Table | Why does this table exist? | Who owns this data? | What relationships does it have? | Can this table survive 10 million records? |
|---|---|---|---|---|
| `arri_clients` | Stores service-domain clients for the ARRI repair/service workflow. | Service/repair workflow. | Likely parent to `arri_job_cards` by business logic, though not enforced in live schema. | `No need` |
| `arri_job_cards` | Stores service or repair job cards. | Service/repair workflow. | Likely belongs to a service client and may reference assets externally, but no live FK is present. | `Maybe` |
| `asset_hierarchy` | Appears intended to store explicit hierarchy mappings for assets. | Asset Engine hierarchy logic. | Conceptually linked to `assets` and possibly `folders`, but no strict FK currently exists. | `Maybe` |
| `asset_history` | Stores change history and audit trail for asset-level actions. | System-generated operational audit. | Implied relationship to `assets.id` via `assetid`. | `Yes`, if treated as an event table with indexing and archive strategy |
| `asset_it_details` | Stores IT/network-specific fields for an asset. | Asset Engine IT workflow. | Implied 1-to-1 with `assets.id` via `assetid`; enforced only by PK uniqueness on `assetid`. | `No need` |
| `asset_kinds` | Stores allowed asset type/category definitions. | Admin/configuration workflow. | Referenced logically by `assets.type` and `assets.category`, not by FK. | `No need` |
| `assets` | Core master table for inventory items and native asset records. | Asset Engine is the source of truth. | Connected logically to `project_assets`, `asset_history`, `asset_it_details`, `layout_markers`, `dc_item_mappings`, quantity tracking, self-parenting, and set logic. | `Maybe`, but not comfortably without more indexing and normalization |
| `audit_log` | Stores broad system activity log entries. | System logging. | Mostly standalone, sometimes indirectly tied to users/assets/actions through payload fields. | `Yes`, if pruned, partitioned, or archived |
| `auth_tokens` | Stores remember-me or persistent auth token hashes. | Authentication system. | Strict FK to `users.username`. | `Yes`, but only with expiry cleanup |
| `companies` | Stores company/tenant records. | Admin/org management. | Implied relationship to `users.company_id` and possibly templates. | `No need` |
| `company_templates` | Stores reusable company-specific template data. | Admin/template management. | Likely linked to `companies`, but no strict FK exists. | `No need` |
| `components` | Stores subcomponents or set members outside the main `assets` master table. | Asset composition / set-management workflow. | Implied relationship to parent asset or set via `parentid`. | `Maybe` |
| `dc_item_mappings` | Stores per-delivery-challan custom naming/description for mapped assets. | Dispatch/document workflow. | Logically joins `delivery_challans.id` with `assets.id`; only uniqueness is enforced. | `Maybe` |
| `delivery_challans` | Stores outward dispatch documents and challan payloads. | Dispatch/operations workflow. | Related logically to `dc_item_mappings`, assets, and project/order flows. | `Maybe` |
| `department_quotas` | Stores policy-level quota values by department and category. | Admin/policy workflow. | Logical relationship to departments and asset categories only. | `No need` |
| `employees` | Stores employee master records. | HR / workforce workflow. | Implied relationship to `users.employee_id`; no live FK. | `No need` |
| `folders` | Stores the category/navigation tree and hierarchical grouping. | Asset Engine taxonomy/navigation. | Self-referential via `parentid`; logically used with assets and UI hierarchy. | `Maybe` |
| `hsn_codes` | Stores GST/HSN tax code reference data. | Finance/compliance reference data. | Referenced logically by asset or order fields, not enforced. | `No need` |
| `knex_migrations` | Tracks executed migrations. | Knex migration system. | Standalone system table. | `No need` |
| `knex_migrations_lock` | Prevents concurrent migrations. | Knex migration system. | Standalone system table. | `No need` |
| `layout_markers` | Stores asset marker positions on a layout/floorplan. | Layout planning workflow. | Strict FK to `layouts.id`; implied link to `assets.id` via `assetid`. | `Maybe` |
| `layouts` | Stores visual layouts, likely project-linked plans or maps. | Layout planning workflow. | Parent of `layout_markers`; implied link to `projects.id` via `projectid`. | `No need` |
| `password_resets` | Stores password reset token hashes and expiry timestamps. | Authentication system. | Standalone auth support table. | `Yes`, but operationally should remain far smaller through expiry cleanup |
| `permissions` | Stores permission keys. | RBAC configuration. | Parent of `role_permissions` via strict FK. | `No need` |
| `project_assets` | Bridge table linking assets to projects. | Project allocation workflow. | Logical many-to-many between `projects` and `assets`; composite PK exists. | `Yes`, with proper indexing |
| `project_history` | Stores project-level history and audit entries. | System-generated project audit. | Implied relationship to `projects.id` via `projectid`. | `Yes`, if treated as an event table |
| `project_order_items` | Stores individual lines under a project order. | Procurement/commercial workflow. | Implied parent `project_orders.id`; optional logical link to `assets.id`. | `Maybe` |
| `project_orders` | Stores project purchase/procurement orders. | Procurement/commercial workflow. | Implied parent link to `projects.id`; parent of `project_order_items`. | `Maybe` |
| `projects` | Core master table for project records. | Asset Engine project workflow, possibly later bridged to Zoho. | Central logical parent of `project_assets`, `project_history`, `layouts`, `temporary_assets`, and project orders. | `Maybe` |
| `quantity_event_lines` | Stores per-asset quantity deltas under a quantity event. | Quantity tracking engine. | Strict FK to `quantity_events.id`; implied relationship to `assets.id` via `asset_id`. | `Yes` |
| `quantity_events` | Stores quantity-change event headers. | Quantity tracking engine. | Parent of `quantity_event_lines`. | `Yes` |
| `role_permissions` | Bridge table between roles and permissions. | RBAC configuration. | Strict FK to both `roles` and `permissions`. | `No need` |
| `roles` | Stores role definitions. | RBAC configuration. | Parent of `role_permissions`; logically referenced by `users.role`. | `No need` |
| `temporary_assets` | Stores provisional or pre-native assets before full conversion/permanence. | Procurement / temporary stock workflow. | Implied relationship to `projects.id`; may later convert into `assets`. | `Maybe` |
| `users` | Stores local system user accounts. | Authentication/admin workflow. | Parent of `auth_tokens`; logically linked to `roles`, `projects`, `companies`, `employees`. | `Maybe`, though 10M is rarely the real target here |

## Core Tables: Plain-English Walkthrough

### `assets`

- Business role: the center of gravity of the entire system
- Why it exists: to hold the native inventory record
- Signs of responsibility:
  - identity fields
  - status and lifecycle fields
  - pricing and warranty fields
  - quantity-tracking fields
  - set/batch flags
  - dispatch/purchase references
  - department and company tags
- What this means: `assets` currently carries multiple concerns in a single table
- Scale judgment: it can grow large, but it is already a wide table, so performance planning matters

### `projects`

- Business role: master record for project work
- Why it exists: to represent commercial or operational projects
- Signs of responsibility:
  - client and location details
  - status and type
  - consignee and buyer details
  - deletion flags
- What this means: `projects` mixes project identity with document/shipping details
- Scale judgment: likely fine for moderate growth, but more normalization may help later

### `project_assets`

- Business role: many-to-many assignment layer
- Why it exists: assets can move across projects and projects can include many assets
- Shape: this is a classic junction table
- Scale judgment: this is one of the best candidates to scale well if it gets supporting indexes

### `asset_history`

- Business role: append-style event trail
- Why it exists: answer "what changed, when, and by whom?"
- Shape: naturally event-oriented
- Scale judgment: one of the most likely tables to hit very high volume

### `users`, `roles`, `permissions`, `role_permissions`

- Business role: access control and identity
- Why they exist: control who can do what
- Shape: clean conceptual domain
- Scale judgment: almost never a 10M concern in an internal system, but correctness matters more than size

### `quantity_events` and `quantity_event_lines`

- Business role: event ledger for quantity-tracked inventory
- Why they exist: preserve movement history instead of only current balances
- Shape: strong event-table design pattern
- Scale judgment: can scale well if treated as ledger tables with targeted indexes

## Reality Check: Live Schema vs Codebase / Migrations

This is important for any future database work.

### What the live `9090` database definitely has

- The 38 tables listed in this document
- 59 total indexes after the FK rollout waves
- 27 strict foreign keys in `9090`

### Why this matters

- Any future schema improvement plan must distinguish:
  - the **live database reality**
  - the **migration intent**
  - the **application-code expectations**
- If these drift apart, the app may appear logically complete in code while the actual test DB does not yet support that design.

## Key Observations

### Strengths

- Clear central entities exist: `assets`, `projects`, `users`
- Junction tables exist where they should: `project_assets`, `role_permissions`
- The quantity domain already uses an event-style model, which is strong
- Identity and uniqueness are mostly defined
- The `9090` schema is now materially more relational than the original test-state schema
- The project, order, dispatch, user, and layout domains now have visible FK-enforced backbone links

### Risks

- Some important relationships are still only implied in code, not enforced in PostgreSQL
- Many date/time fields are stored as `character varying` instead of native timestamp/date types
- Several master tables are wide and mix multiple business concerns
- A few history-sensitive relationships still need deliberate delete-rule decisions before FK enforcement
- The live DB and some later migration intentions are not fully aligned

## Implemented FK Waves In `9090`

The `9090` test database is no longer in its original schema state. Four FK rollout waves have been applied successfully to `asset_manager_test`.

### Wave 1

- `asset_it_details.assetid -> assets.id`
- `project_order_items.orderid -> project_orders.id`
- `assets.linked_po_item_id -> project_order_items.id`
- `temporary_assets.linked_po_item_id -> project_order_items.id`
- `components.parentid -> assets.id`

### Wave 2

- `project_history.projectid -> projects.id`
- `project_orders.projectid -> projects.id`
- `project_assets.projectid -> projects.id`
- `project_assets.assetid -> assets.id`
- `temporary_assets.projectid -> projects.id`

### Wave 3

- `layout_markers.assetid -> assets.id`
- `project_order_items.assetid -> assets.id`
- `dc_item_mappings.assetid -> assets.id`
- `dc_item_mappings.dc_id -> delivery_challans.id`
- `users.company_id -> companies.id`
- `users.project_id -> projects.id`
- `users.role -> roles.name`
- `audit_log.assetid -> assets.id`

### Wave 4 (Hierarchy)

- `folders.parentid -> folders.id`
- `assets.parentid -> assets.id`
- `asset_hierarchy.parentid -> assets.id`
- `asset_hierarchy.assetid -> assets.id`

### Current `9090` Result

- `27` foreign keys
- `59` indexes
- Project-centric links are now live in the actual test database
- Many meaningful cross-table relationships are now enforced by PostgreSQL rather than only by application code

## FK Readiness Cards

This section began as the planning matrix for the `9090` rollout.

It remains useful because it still explains:

- which relationships were clean enough to introduce in `9090`
- which relationships are still blocked in `8080` by orphan rows

Readiness labels used below:

- `Ready` means the relationship had `0` orphan rows in `asset_manager_test (9090)`
- `Blocked in 8080` means production currently contains orphan rows and cannot accept the FK yet without cleanup
- `Review Delete Rule` means the relationship is structurally clean, but delete behavior should still be explicitly chosen before rollout

### FK Readiness Matrix

| Relationship | Confidence | 9090 Orphans | 8080 Orphans | 9090 Status | 8080 Status | Recommended Delete Rule | Notes |
|---|---|---:|---:|---|---|---|---|
| `asset_it_details.assetid -> assets.id` | High | 0 | 10 | Ready | Blocked in 8080 | `ON DELETE CASCADE` | True 1-to-1 extension table; safest first-wave FK in `9090` |
| `project_assets.projectid -> projects.id` | High | 0 | 7 | Ready | Blocked in 8080 | `ON DELETE CASCADE` or `RESTRICT` | Bridge table; choose based on hard-delete policy |
| `project_assets.assetid -> assets.id` | High | 0 | 7 | Ready | Blocked in 8080 | `ON DELETE CASCADE` or `RESTRICT` | Bridge table; same decision as above |
| `project_orders.projectid -> projects.id` | High | 0 | 6 | Ready | Blocked in 8080 | `ON DELETE CASCADE` | Order records appear project-owned in current design |
| `project_order_items.orderid -> project_orders.id` | High | 0 | 0 | Ready | Clean in 8080 | `ON DELETE CASCADE` | Parent-child document relationship |
| `assets.linked_po_item_id -> project_order_items.id` | High | 0 | 0 | Ready | Clean in 8080 | `ON DELETE SET NULL` | Asset should likely survive even if PO line is removed |
| `temporary_assets.linked_po_item_id -> project_order_items.id` | High | 0 | 0 | Ready | Clean in 8080 | `ON DELETE SET NULL` | Similar to `assets.linked_po_item_id` |
| `project_history.projectid -> projects.id` | High | 0 | 0 | Ready | Clean in 8080 | `ON DELETE CASCADE` or `RESTRICT` | History retention preference decides final rule |
| `temporary_assets.projectid -> projects.id` | High | 0 | 0 | Ready | Clean in 8080 | `ON DELETE SET NULL` or `CASCADE` | Depends on whether temp assets should survive project deletion |
| `audit_log.assetid -> assets.id` | High | 0 | 0 | Ready | Clean in 8080 | `ON DELETE SET NULL` | Audit rows should usually survive parent deletion |
| `components.parentid -> assets.id` | High | 0 | 0 | Ready | Clean in 8080 | `ON DELETE CASCADE` | Child components should likely follow parent asset lifecycle |

### Production Orphan Samples

These are the relationships that are currently blocking immediate FK rollout in `8080`.

#### `asset_it_details.assetid -> assets.id`

- Orphan count in `8080`: `10`
- Sample orphan values:
  - `MON-LOC-0426-GC8K8Z-Y`
  - `MON-LOC-0426-RZQZ0T-C`
  - `LPT-MUM-0326-E6UDXT-Z`
  - `AST002`
  - `ACC-MUM-0426-B8FU04-B`

Interpretation:

- `asset_it_details` contains rows for assets that no longer exist in `assets`
- This strongly suggests either historical hard deletes or ID drift

#### `project_assets.projectid -> projects.id`

- Orphan count in `8080`: `7`
- Sample orphan values:
  - `PRJ1773724147996`
  - `PRJ1773746860453`
  - `LOC-0426-222627-P`
  - `LOC-0426-790924-P`
  - `LOC-0426-576345-P`

Interpretation:

- Asset allocation links exist for projects missing from `projects`
- This is a classic bridge-table orphan problem

#### `project_assets.assetid -> assets.id`

- Orphan count in `8080`: `7`
- Sample orphan values:
  - `LPT-MUM-0326-E6UDXT-Z`
  - `LPT-ON-0326-5JUHYK-6`
  - `AST001`
  - `MON-LOC-0426-RZQZ0T-C`
  - `SRV-MUM-0426-FC88BN-6`

Interpretation:

- Allocation rows exist for assets that no longer exist in `assets`
- This is another bridge-table orphan set

#### `project_orders.projectid -> projects.id`

- Orphan count in `8080`: `6`
- Sample orphan values:
  - `PRJ1773724147996`
  - `PRJ1773748315543`
  - `PRJ1773724130572`
  - `LOC-0426-222627-P`
  - `LOC-0426-790924-P`

Interpretation:

- Some project-owned orders still point to projects missing from `projects`
- This needs cleanup before production FK rollout

### Recommended 9090 Rollout Order

This is the order I would use for `9090` first, based on lowest risk and clearest semantics.

#### Wave 1: Safest and Most Clear-Cut

1. `asset_it_details.assetid -> assets.id`
2. `project_order_items.orderid -> project_orders.id`
3. `assets.linked_po_item_id -> project_order_items.id`
4. `temporary_assets.linked_po_item_id -> project_order_items.id`
5. `components.parentid -> assets.id`

Why these first:

- They are structurally very clear
- They had `0` orphan rows in both `9090` and `8080`, except `asset_it_details` which is clean in `9090` but blocked in `8080`
- Their parent-child semantics are easier to reason about

#### Wave 2: Project-Centric Relationships

1. `project_history.projectid -> projects.id`
2. `project_orders.projectid -> projects.id`
3. `project_assets.projectid -> projects.id`
4. `project_assets.assetid -> assets.id`
5. `temporary_assets.projectid -> projects.id`

Why these second:

- They are still high-confidence
- But project deletion semantics and cleanup ordering should be reviewed together
- Some of them are already blocked in `8080`, so validating behavior in `9090` first is useful

#### Wave 3: Audit / Retention-Sensitive Relationships

1. `audit_log.assetid -> assets.id`

Why this last:

- The relationship itself is clean
- But audit tables often require a different retention philosophy than operational child tables
- `SET NULL` is usually safer than `CASCADE` here

### Practical Rule For 9090

If the goal is to "sort foreign keys for `9090`" without surprising the application, the safest rule is:

1. Introduce only the `Ready` relationships in `9090`
2. Prefer the clearest delete actions first:
   - `CASCADE` for true child tables
   - `SET NULL` for references that should not destroy business history
3. Manually test create/edit/delete flows after each wave
4. Only later decide what to do with the `8080` orphan sets

### Practical Rule For 8080

Production should not get the blocked foreign keys until one of these is done for each orphan set:

- delete orphan child rows
- recreate missing parent rows
- remap child rows to the correct parent IDs
- or decide that the relationship should not become an FK after all

Current status:

- `9090` rollout has now been completed for the three implemented waves above
- `8080` is still not fully ready because real orphan data exists

## Remaining Meaningful Links Not Yet Enforced

These are the most meaningful relationships that still deserve separate review before enforcement:

- `quantity_event_lines.asset_id -> assets.id`
  - Held back intentionally because quantity history retention and hard-delete behavior need a deliberate decision
- `quantity_events.root_id -> assets.id`
  - Related to quantity history semantics and should likely be reviewed with the line-level FK above
- `asset_history.assetid -> assets.id`
  - History retention vs parent deletion must be decided first
- `layouts.projectid -> projects.id`
  - Likely safe, but should be paired with review of layout deletion behavior
- `company_templates.company_id -> companies.id`
  - Likely safe, but lower-priority than the operational domains
- `users.employee_id -> employees.id`
  - Key target still needs confirmation because `employees` has both `id` and `employeeid`
- `assets.parentid -> assets.id`
  - Self-reference semantics are mixed between hierarchy and split/batch logic
- `folders.parentid -> folders.id`
  - Self-referential hierarchy, likely safe but separate from the main business backbone
 

## What To Learn First


1. `assets`
2. `projects`
3. `project_assets`
4. `asset_history`
5. `users`
6. `roles`
7. `permissions`
8. `role_permissions`
9. `quantity_events`
10. `quantity_event_lines`

These 10 tables explain most of the application shape.

## Suggested Review Order For Future Sessions

This is not a change plan yet. It is only a learning order.

1. Inventory master model
2. Project allocation model
3. Event/history model
4. Auth/RBAC model
5. Dispatch/order model
6. Hierarchy and taxonomy model
7. Workforce/company model
8. External integration model

## Final Takeaway

The current `9090` database is a workable application schema with a strong operational center around `assets`, `projects`, and user access control, but it is still more **application-driven** than **database-driven**.

In plain terms:

- the app knows more about the relationships than the database does
- the schema is functional, but not yet deeply optimized
- the best improvement path starts with understanding ownership, relationships, and scale table by table

That is exactly what this document is designed to support.
