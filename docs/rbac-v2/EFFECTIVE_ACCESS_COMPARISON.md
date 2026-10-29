# Effective Access Comparison (Phase 25)

BEFORE = production `asset_manager` role_permissions (pre V2 action expansion).
AFTER = scratch `asset_manager_rbac_scratch` after Phase 19 role authority migration.

Note: AFTER includes new action keys; many “gains” are precision grants replacing implicit authorizeRoles triad, not net-new business capability — except Logistics Executive (no active user today).

## Nadagopal (user → user)

- Before count: 6
- After count: 14
- Gained: 8
- Lost: 0

### Gained

- `asset.search`
- `asset.view`
- `dashboard.view`
- `inventory.view`
- `module.assets.access`
- `project.view`
- `set.view`
- `warranty.view`

## SwapnilM (manager → manager)

- Before count: 23
- After count: 84
- Gained: 61
- Lost: 0

### Gained

- `asset.break`
- `asset.convert`
- `asset.delete`
- `asset.release_to_store`
- `asset.restore`
- `asset.sell`
- `dashboard.view`
- `dc.create`
- `dc.remarks`
- `dc.view`
- `dc.void`
- `history.view`
- `inventory.adjust`
- `inventory.create`
- `inventory.delete`
- `inventory.edit`
- `inventory.restore`
- `inventory.view`
- `physical_intake.create`
- `physical_intake.link_po`
- `physical_intake.view`
- `product.archive`
- `product.create`
- `product.edit`
- `product.restore`
- `product.view`
- `product.zoho_conflict_resolve`
- `product.zoho_publish`
- `product.zoho_refresh`
- `project.assign`
- `project.create`
- `project.edit`
- `project.view`
- `purchase_book.create`
- `purchase_book.edit`
- `purchase_book.physical`
- `purchase_book.post`
- `purchase_book.view`
- `purchase_book.void`
- `purchase_order.import`
- `purchase_order.refresh`
- `purchase_order.view`
- `receipt_note.cancel`
- `receipt_note.create`
- `receipt_note.edit`
- `receipt_note.post`
- `receipt_note.reverse`
- `receipt_note.view`
- `release.view`
- `reservation.create`
- `reservation.release`
- `reservation.transfer`
- `reservation.view`
- `set.allocate`
- `set.archive`
- `set.create`
- `set.edit`
- `set.restore`
- `set.view`
- `warranty.view`
- `zoho.sync`

## admin (superuser → superuser)

- Before count: 36
- After count: 108
- Gained: 72
- Lost: 0

### Gained

- `admin.view`
- `asset.break`
- `asset.convert`
- `asset.release_to_store`
- `asset.restore`
- `asset.sell`
- `dashboard.view`
- `dc.create`
- `dc.remarks`
- `dc.view`
- `dc.void`
- `history.view`
- `inventory.adjust`
- `inventory.create`
- `inventory.delete`
- `inventory.edit`
- `inventory.restore`
- `inventory.view`
- `manage.hierarchy`
- `network.contacts.manage`
- `network.credentials.manage`
- `physical_intake.create`
- `physical_intake.link_po`
- `physical_intake.view`
- `product.archive`
- `product.create`
- `product.edit`
- `product.restore`
- `product.view`
- `product.zoho_conflict_resolve`
- `product.zoho_publish`
- `product.zoho_refresh`
- `project.assign`
- `project.create`
- `project.delete`
- `project.edit`
- `project.view`
- `purchase_book.create`
- `purchase_book.edit`
- `purchase_book.physical`
- `purchase_book.post`
- `purchase_book.view`
- `purchase_book.void`
- `purchase_order.import`
- `purchase_order.refresh`
- `purchase_order.view`
- `receipt_note.cancel`
- `receipt_note.create`
- `receipt_note.edit`
- `receipt_note.post`
- `receipt_note.reverse`
- `receipt_note.view`
- `recovery.restore`
- `recovery.view`
- `release.view`
- `reservation.create`
- `reservation.release`
- `reservation.transfer`
- `reservation.view`
- `role.manage`
- `scanner.view`
- `set.allocate`
- `set.archive`
- `set.create`
- `set.edit`
- `set.restore`
- `set.view`
- `settings.edit`
- `settings.view`
- `warranty.view`
- `zoho.oauth.manage`
- `zoho.sync`

## nandagopal.nadar@cineon.in (it_manager → it_manager)

- Before count: 15
- After count: 27
- Gained: 13
- Lost: 1

### Gained

- `admin.view`
- `inventory.view`
- `module.admin.access`
- `module.employees.access`
- `module.settings.access`
- `network.contacts.manage`
- `network.credentials.manage`
- `recovery.restore`
- `recovery.view`
- `release.view`
- `scanner.view`
- `settings.edit`
- `settings.view`

### Lost

- `asset.create`

## sudhir.lodhi@cineom.in (it_manager → it_manager)

- Before count: 15
- After count: 27
- Gained: 13
- Lost: 1

### Gained

- `admin.view`
- `inventory.view`
- `module.admin.access`
- `module.employees.access`
- `module.settings.access`
- `network.contacts.manage`
- `network.credentials.manage`
- `recovery.restore`
- `recovery.view`
- `release.view`
- `scanner.view`
- `settings.edit`
- `settings.view`

### Lost

- `asset.create`

