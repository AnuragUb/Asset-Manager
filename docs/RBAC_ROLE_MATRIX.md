# RBAC Role Matrix (Phase 19 — Canonical Authority Model)

Deny by default. ALLOW only via stored `role_permissions` (superuser also has centralized bypass).

Accounts Executive / Accounts Manager columns are **FUTURE** — roles are not created until Zoho Books functionality exists.

Scratch DB after `20260923140000_rbac_v2_role_authority_model.js`. Production not migrated.

## Legend

| Value | Meaning |
|-------|---------|
| ALLOW | Role has stored grant (or superuser bypass) |
| DENY | No grant |
| FUTURE | Planned for Accounts / Books — not in catalog yet |

## Layers

- **MODULE** — workspace access
- **VIEW** — read / page access
- **NORMAL ACTION** — ordinary create/edit/refresh
- **LIFECYCLE ACTION** — post / allocate / restore / dispatch-class
- **HIGH-RISK ACTION** — delete / reverse / void / price / admin / OAuth

| Permission | Layer | superuser | admin | manager | Logistics Executive | user | it_manager | it_user | HR | client | Accounts Executive | Accounts Manager |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `admin.view` | VIEW | ALLOW | ALLOW | DENY | DENY | DENY | ALLOW | DENY | DENY | DENY | FUTURE | FUTURE |
| `asset.break` | NORMAL ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `asset.convert` | LIFECYCLE ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `asset.create` | NORMAL ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | DENY | DENY |
| `asset.delete` | HIGH-RISK ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `asset.edit` | NORMAL ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | ALLOW | DENY | DENY | DENY | DENY | DENY |
| `asset.edit_price` | HIGH-RISK ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `asset.release_to_store` | LIFECYCLE ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `asset.restore` | LIFECYCLE ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `asset.search` | VIEW | ALLOW | ALLOW | ALLOW | DENY | ALLOW | ALLOW | ALLOW | DENY | ALLOW | FUTURE | FUTURE |
| `asset.sell` | LIFECYCLE ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `asset.view` | VIEW | ALLOW | ALLOW | ALLOW | DENY | ALLOW | ALLOW | ALLOW | DENY | ALLOW | FUTURE | FUTURE |
| `asset.view_price` | NORMAL ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `category.create` | NORMAL ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `category.delete` | HIGH-RISK ACTION | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `dashboard.view` | VIEW | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `dc.create` | LIFECYCLE ACTION | ALLOW | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | DENY |
| `dc.remarks` | NORMAL ACTION | ALLOW | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `dc.view` | VIEW | ALLOW | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `dc.void` | HIGH-RISK ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | DENY | DENY |
| `history.view` | VIEW | ALLOW | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `inventory.adjust` | HIGH-RISK ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | DENY | DENY |
| `inventory.create` | NORMAL ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `inventory.delete` | HIGH-RISK ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `inventory.edit` | NORMAL ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `inventory.restore` | LIFECYCLE ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `inventory.view` | VIEW | ALLOW | ALLOW | ALLOW | DENY | ALLOW | ALLOW | ALLOW | DENY | DENY | FUTURE | FUTURE |
| `logs.view` | VIEW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `manage.hierarchy` | HIGH-RISK ACTION | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `module.admin.access` | MODULE | ALLOW | ALLOW | DENY | DENY | DENY | ALLOW | DENY | DENY | DENY | FUTURE | FUTURE |
| `module.assets.access` | MODULE | ALLOW | ALLOW | ALLOW | DENY | ALLOW | ALLOW | ALLOW | DENY | ALLOW | FUTURE | FUTURE |
| `module.employees.access` | MODULE | ALLOW | ALLOW | DENY | DENY | DENY | ALLOW | DENY | ALLOW | DENY | FUTURE | FUTURE |
| `module.network.access` | MODULE | ALLOW | ALLOW | DENY | DENY | DENY | ALLOW | ALLOW | DENY | DENY | FUTURE | FUTURE |
| `module.network_scanner.access` | MODULE | ALLOW | ALLOW | DENY | DENY | DENY | ALLOW | ALLOW | DENY | DENY | FUTURE | FUTURE |
| `module.settings.access` | MODULE | ALLOW | ALLOW | DENY | DENY | DENY | ALLOW | DENY | DENY | DENY | FUTURE | FUTURE |
| `network.contacts.manage` | HIGH-RISK ACTION | ALLOW | ALLOW | DENY | DENY | DENY | ALLOW | DENY | DENY | DENY | FUTURE | FUTURE |
| `network.credentials.manage` | HIGH-RISK ACTION | ALLOW | ALLOW | DENY | DENY | DENY | ALLOW | DENY | DENY | DENY | FUTURE | FUTURE |
| `physical_intake.create` | LIFECYCLE ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | DENY | DENY |
| `physical_intake.link_po` | LIFECYCLE ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `physical_intake.view` | VIEW | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `product.archive` | LIFECYCLE ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `product.create` | NORMAL ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `product.edit` | NORMAL ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `product.restore` | LIFECYCLE ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `product.view` | VIEW | ALLOW | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `product.zoho_conflict_resolve` | NORMAL ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `product.zoho_publish` | NORMAL ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `product.zoho_refresh` | NORMAL ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `project.assign` | LIFECYCLE ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `project.create` | NORMAL ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `project.delete` | HIGH-RISK ACTION | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `project.edit` | NORMAL ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `project.view` | VIEW | ALLOW | ALLOW | ALLOW | DENY | ALLOW | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `purchase_book.create` | NORMAL ACTION | ALLOW | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `purchase_book.edit` | NORMAL ACTION | ALLOW | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `purchase_book.physical` | LIFECYCLE ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `purchase_book.post` | LIFECYCLE ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `purchase_book.view` | VIEW | ALLOW | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `purchase_book.void` | HIGH-RISK ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `purchase_order.import` | NORMAL ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `purchase_order.refresh` | NORMAL ACTION | ALLOW | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `purchase_order.view` | VIEW | ALLOW | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `receipt_note.cancel` | LIFECYCLE ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `receipt_note.create` | NORMAL ACTION | ALLOW | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | DENY |
| `receipt_note.edit` | NORMAL ACTION | ALLOW | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `receipt_note.post` | LIFECYCLE ACTION | ALLOW | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | DENY |
| `receipt_note.reverse` | HIGH-RISK ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `receipt_note.view` | VIEW | ALLOW | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `recovery.restore` | LIFECYCLE ACTION | ALLOW | ALLOW | DENY | DENY | DENY | ALLOW | DENY | DENY | DENY | FUTURE | FUTURE |
| `recovery.view` | VIEW | ALLOW | ALLOW | DENY | DENY | DENY | ALLOW | DENY | DENY | DENY | FUTURE | FUTURE |
| `release.view` | VIEW | ALLOW | ALLOW | ALLOW | DENY | DENY | ALLOW | DENY | DENY | DENY | FUTURE | FUTURE |
| `reservation.create` | NORMAL ACTION | ALLOW | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | DENY |
| `reservation.release` | LIFECYCLE ACTION | ALLOW | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `reservation.transfer` | LIFECYCLE ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `reservation.view` | VIEW | ALLOW | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `role.manage` | HIGH-RISK ACTION | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `scanner.view` | VIEW | ALLOW | ALLOW | DENY | DENY | DENY | ALLOW | ALLOW | DENY | DENY | FUTURE | FUTURE |
| `set.allocate` | LIFECYCLE ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | DENY | DENY |
| `set.archive` | LIFECYCLE ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `set.create` | NORMAL ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `set.edit` | NORMAL ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `set.restore` | NORMAL ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `set.view` | VIEW | ALLOW | ALLOW | ALLOW | DENY | ALLOW | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `settings.edit` | HIGH-RISK ACTION | ALLOW | ALLOW | DENY | DENY | DENY | ALLOW | DENY | DENY | DENY | FUTURE | FUTURE |
| `settings.view` | VIEW | ALLOW | ALLOW | DENY | DENY | DENY | ALLOW | DENY | ALLOW | DENY | FUTURE | FUTURE |
| `user.manage` | HIGH-RISK ACTION | ALLOW | ALLOW | DENY | DENY | DENY | ALLOW | DENY | ALLOW | DENY | FUTURE | FUTURE |
| `warranty.view` | VIEW | ALLOW | ALLOW | ALLOW | DENY | ALLOW | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `zoho.oauth.manage` | HIGH-RISK ACTION | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |
| `zoho.sync` | NORMAL ACTION | ALLOW | ALLOW | ALLOW | DENY | DENY | DENY | DENY | DENY | DENY | FUTURE | FUTURE |

## Future-only keys (not in live catalog)

| Permission | Layer | Notes |
|------------|-------|-------|
| `asset.archive` | FUTURE | Documented for Books / finer lifecycle; not inserted |
| `books.integration.view` | FUTURE | Documented for Books / finer lifecycle; not inserted |
| `books.reconciliation.resolve` | FUTURE | Documented for Books / finer lifecycle; not inserted |
| `books.reconciliation.view` | FUTURE | Documented for Books / finer lifecycle; not inserted |
| `dc.cancel` | FUTURE | Documented for Books / finer lifecycle; not inserted |
| `dc.dispatch` | FUTURE | Documented for Books / finer lifecycle; not inserted |
| `dc.edit` | FUTURE | Documented for Books / finer lifecycle; not inserted |
| `dc.ready` | FUTURE | Documented for Books / finer lifecycle; not inserted |
| `employee.create` | FUTURE | Documented for Books / finer lifecycle; not inserted |
| `employee.disable` | FUTURE | Documented for Books / finer lifecycle; not inserted |
| `employee.edit` | FUTURE | Documented for Books / finer lifecycle; not inserted |
| `employees.view` | FUTURE | Documented for Books / finer lifecycle; not inserted |
| `physical_intake.correct` | FUTURE | Documented for Books / finer lifecycle; not inserted |
| `physical_intake.post` | FUTURE | Documented for Books / finer lifecycle; not inserted |
| `product.search` | FUTURE | Documented for Books / finer lifecycle; not inserted |
| `product.zoho_link` | FUTURE | Documented for Books / finer lifecycle; not inserted |
| `purchase_order.cancel` | FUTURE | Documented for Books / finer lifecycle; not inserted |
| `purchase_order.reconcile` | FUTURE | Documented for Books / finer lifecycle; not inserted |
| `purchase_order.version` | FUTURE | Documented for Books / finer lifecycle; not inserted |
| `release.approve` | FUTURE | Documented for Books / finer lifecycle; not inserted |
| `release.cancel` | FUTURE | Documented for Books / finer lifecycle; not inserted |
| `release.create` | FUTURE | Documented for Books / finer lifecycle; not inserted |
| `reservation.override` | FUTURE | Documented for Books / finer lifecycle; not inserted |
| `warranty.close` | FUTURE | Documented for Books / finer lifecycle; not inserted |
| `warranty.create` | FUTURE | Documented for Books / finer lifecycle; not inserted |
| `warranty.edit` | FUTURE | Documented for Books / finer lifecycle; not inserted |

## Deliberate privilege changes

### Logistics Executive — GRANT

Phase 19: execution role may create/post RN, create PB drafts, refresh PO, create/release reservations, create DC — previously blocked by authorizeRoles triad

- `purchase_order.refresh`
- `purchase_book.create`
- `purchase_book.edit`
- `receipt_note.create`
- `receipt_note.edit`
- `receipt_note.post`
- `reservation.create`
- `reservation.release`
- `dc.create`
- `dc.remarks`

### Logistics Executive — DENY

Execution role is not approval/admin; high-risk corrections reserved for manager/admin

- `receipt_note.reverse`
- `receipt_note.cancel`
- `dc.void`
- `asset.edit_price`
- `inventory.adjust`
- `set.allocate`
- `user.manage`

### admin — REVOKE

Destructive category delete remains superuser-only

- `category.delete`

### admin — GRANT

Phase 19: company admin may manage roles where UI supports it (stored tick, not bypass)

- `role.manage`

### manager — REVOKE

Operational manager is not system/security admin

- `manage.hierarchy`
- `recovery.restore`
- `user.manage`
- `zoho.oauth.manage`
- `network.credentials.manage`
- `settings.edit`

### it_manager — REVOKE

Prevent IT create-asset path around Receipt Note / Physical Intake containment; retain asset.edit for serials support

- `asset.create`

### it_user — REVOKE

Phase 19: IT User is read/support; network credential mutation reserved for IT Manager / Admin

- `network.credentials.manage`
- `network.contacts.manage`

## Segregation of duties (Phase 20)

| Concern | Logistics Executive | Manager | Accounts (future) | IT |
|---------|---------------------|---------|-------------------|-----|
| Post Receipt Note | ALLOW | ALLOW | DENY | DENY |
| Reverse Receipt Note | DENY | ALLOW | DENY | DENY |
| Edit asset price | DENY | ALLOW | FUTURE view only | DENY |
| Inventory adjust | DENY | ALLOW | DENY | DENY |
| User manage | DENY | DENY | DENY | IT Manager ALLOW |
| Category delete | DENY | DENY | DENY | DENY (superuser only) |

