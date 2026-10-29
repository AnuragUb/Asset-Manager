# RBAC Permission Matrix (V2)

Canonical model: `module.*.access` → workspace · `resource.view` → read · `resource.action` → mutation.

Scratch verification DB: `asset_manager_rbac_scratch` (prod untouched).

## Legacy → canonical view mapping

| Legacy | Canonical |
|--------|-----------|
| `view.assets` | `asset.view` |
| `view.inventory` | `inventory.view` |
| `view.products` | `product.view` |
| `view.purchase_orders` | `purchase_order.view` |
| `view.purchase_books` | `purchase_book.view` |
| `view.receipt_notes` | `receipt_note.view` |
| `view.physical_intake` | `physical_intake.view` |
| `view.reservations` | `reservation.view` |
| `view.sets` | `set.view` |
| `view.dc` | `dc.view` |
| `view.projects` | `project.view` |
| `view.warranty` | `warranty.view` |
| `view.dashboard` | `dashboard.view` |
| `view.history` | `history.view` |
| `view.settings` | `settings.view` |
| `view.recovery` | `recovery.view` |
| `view.scanner` | `scanner.view` |
| `view.admin` | `admin.view` |
| `view.releases` | `release.view` |

## New / action catalog entries

| Key | Category | Description |
|-----|----------|-------------|
| `dashboard.view` | page | View Operations Dashboard |
| `asset.view` | page | View Assets workspace / records |
| `inventory.view` | page | View Inventory workspace / records |
| `product.view` | page | View Products workspace / records |
| `purchase_order.view` | page | View Purchase Orders |
| `purchase_book.view` | page | View Purchase Books |
| `receipt_note.view` | page | View Receipt Notes |
| `physical_intake.view` | page | View Physical Intake |
| `reservation.view` | page | View Reservations |
| `set.view` | page | View Sets |
| `dc.view` | page | View Delivery Challans |
| `project.view` | page | View Projects |
| `warranty.view` | page | View Warranty |
| `history.view` | page | View Lifecycle History |
| `settings.view` | page | View Settings |
| `recovery.view` | page | View Recovery Center |
| `scanner.view` | page | View Network Scanner |
| `admin.view` | page | View Admin workspace |
| `release.view` | page | View Releases |
| `manage.hierarchy` | action | Create and delete folders and categories |
| `settings.edit` | action | Edit Settings (email, tally, etc.) |
| `asset.restore` | action | Restore soft-deleted assets |
| `asset.sell` | action | Mark asset sold |
| `asset.release_to_store` | action | Release asset to store |
| `asset.break` | action | Quantity break / unsplit operations |
| `asset.convert` | action | Asset ↔ inventory conversion |
| `inventory.create` | action | Create inventory items |
| `inventory.edit` | action | Edit inventory items |
| `inventory.delete` | action | Soft-delete inventory items |
| `inventory.restore` | action | Restore inventory items |
| `inventory.adjust` | action | Inventory movements / quantity adjust |
| `product.create` | action | Create products |
| `product.edit` | action | Edit products |
| `product.archive` | action | Archive products |
| `product.restore` | action | Restore products |
| `product.zoho_publish` | action | Publish product to Zoho |
| `product.zoho_refresh` | action | Refresh product from Zoho |
| `product.zoho_conflict_resolve` | action | Resolve product Zoho conflicts |
| `purchase_order.import` | action | Import Purchase Order from Zoho |
| `purchase_order.refresh` | action | Refresh Purchase Order from Zoho |
| `purchase_book.create` | action | Create Purchase Book |
| `purchase_book.edit` | action | Edit Purchase Book draft |
| `purchase_book.post` | action | Post Purchase Book |
| `purchase_book.void` | action | Void Purchase Book |
| `purchase_book.physical` | action | Purchase Book physical receipt / release |
| `receipt_note.create` | action | Create Receipt Note |
| `receipt_note.edit` | action | Edit Receipt Note |
| `receipt_note.post` | action | Post Receipt Note |
| `receipt_note.cancel` | action | Cancel Receipt Note |
| `receipt_note.reverse` | action | Reverse Receipt Note |
| `physical_intake.create` | action | Create Physical Intake |
| `physical_intake.link_po` | action | Link Physical Intake to PO / mark RN not required |
| `reservation.create` | action | Create reservation |
| `reservation.release` | action | Release reservation |
| `reservation.transfer` | action | Transfer reservation |
| `set.create` | action | Create sets / managed sets |
| `set.edit` | action | Edit sets / allocations / components |
| `set.allocate` | action | Allocate / replace / remove set allocations |
| `set.archive` | action | Archive / disband / disassemble sets |
| `set.restore` | action | Restore managed sets |
| `dc.create` | action | Create Delivery Challan |
| `dc.void` | action | Void Delivery Challan |
| `dc.remarks` | action | Manage DC remarks |
| `project.create` | action | Create projects |
| `project.edit` | action | Edit projects / orders / temp assets |
| `project.delete` | action | Delete projects |
| `project.assign` | action | Assign / unassign project assets |
| `recovery.restore` | action | Restore entities from Recovery Center |
| `network.credentials.manage` | action | Create/update/delete network credentials |
| `network.contacts.manage` | action | Create/update/delete network contacts |
| `zoho.oauth.manage` | action | Connect / disconnect Zoho OAuth |
| `zoho.sync` | action | Trigger Zoho sync operations |
| `role.manage` | action | Create/update/delete RBAC roles and grants |

## Role action grants (beyond migrated views)

| Role | Action keys (count) | Notes |
|------|---------------------|-------|
| superuser | 72 | `asset.create`, `asset.edit`, `asset.delete`, `asset.view_price`, `asset.edit_price`, `asset.restore`, `asset.sell`, `asset.release_to_store`, … |
| admin | 71 | `asset.create`, `asset.edit`, `asset.delete`, `asset.view_price`, `asset.edit_price`, `asset.restore`, `asset.sell`, `asset.release_to_store`, … |
| manager | 56 | `asset.create`, `asset.edit`, `asset.delete`, `asset.view_price`, `asset.edit_price`, `asset.restore`, `asset.sell`, `asset.release_to_store`, … |
| Logistics Executive | 0 | _views only_ |
| user | 0 | _views only_ |
| it_manager | 14 | `asset.create`, `asset.edit`, `asset.search`, `asset.view`, `module.assets.access`, `module.network.access`, `module.network_scanner.access`, `user.manage`, … |
| it_user | 7 | `asset.search`, `asset.view`, `module.assets.access`, `module.network.access`, `module.network_scanner.access`, `network.credentials.manage`, `network.contacts.manage` |
| client | 0 | _views only_ |
| HR | 3 | `user.manage`, `module.employees.access`, `settings.view` |

## Logistics action bundle

Granted to `superuser`, `admin`, and (minus `manage.hierarchy`) `manager`:

- `asset.create`
- `asset.edit`
- `asset.delete`
- `asset.view_price`
- `asset.edit_price`
- `asset.restore`
- `asset.sell`
- `asset.release_to_store`
- `asset.break`
- `asset.convert`
- `inventory.create`
- `inventory.edit`
- `inventory.delete`
- `inventory.restore`
- `inventory.adjust`
- `product.create`
- `product.edit`
- `product.archive`
- `product.restore`
- `product.zoho_publish`
- `product.zoho_refresh`
- `product.zoho_conflict_resolve`
- `purchase_order.import`
- `purchase_order.refresh`
- `purchase_book.create`
- `purchase_book.edit`
- `purchase_book.post`
- `purchase_book.void`
- `purchase_book.physical`
- `receipt_note.create`
- `receipt_note.edit`
- `receipt_note.post`
- `receipt_note.cancel`
- `receipt_note.reverse`
- `physical_intake.create`
- `physical_intake.link_po`
- `reservation.create`
- `reservation.release`
- `reservation.transfer`
- `set.create`
- `set.edit`
- `set.allocate`
- `set.archive`
- `set.restore`
- `dc.create`
- `dc.void`
- `dc.remarks`
- `project.create`
- `project.edit`
- `project.assign`
- `recovery.restore`
- `zoho.sync`
- `category.create`
- `manage.hierarchy`

## Privilege preservation rules

- Logistics Executive / user / client: **no** mutation action grants
- IT roles: network + asset search; no procurement/DC/RN mutations
- HR: `user.manage` + settings view; no physical mutations
- `manage.hierarchy`: stored for admin + superuser only
- `category.delete`: remains admin/superuser via grants (superuser also has global bypass)

## Deprecated (kept for dual-resolve)

All legacy `view.*` keys remain in catalog with category `deprecated` until a later named migration removes them after zero code references.
