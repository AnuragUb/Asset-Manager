# Event System Guide

Developer reference for AssetEngine’s shared domain event catalog and how to extend it safely.

**Canonical module (do not rename this sprint):**  
[`web-app/shared/inventoryEventSystem.js`](../../web-app/shared/inventoryEventSystem.js)

**Related:** [`inventory-event-system.md`](./inventory-event-system.md) (inventory quantity store specifics)

---

## Purpose

Provide a **single source of truth** for operational audit events across the product:

- Canonical **event type** constants (never hardcode `"DELETE"` / `"ADJUST"` at call sites)
- **Display labels** separate from internal types
- **Legacy alias** mapping for older stored values
- Structured **metadata** (entity, previous/new values, notes)
- Helpers to detect meaningful inventory changes and to **present** events to UIs

Today’s writers:

| Store | Used by |
|-------|---------|
| `inventory_quantity_events` (+ lines) | Inventory quantity / batch / status (Issue 4) |
| `domain_events` | Asset soft-delete / restore (Issue 5) and future domains |

The shared module is intentionally **domain-neutral**. The filename remains `inventoryEventSystem.js` for backwards compatibility; treat it as the Event System catalog.

---

## Event Types

Import `EVENT_TYPES` from the shared module. Do not invent ad-hoc strings.

### Active / commonly written

| Constant | Typical use |
|----------|-------------|
| `INIT` | Quantity tracking enabled / initialized |
| `ADJUST` | Total / available quantity change |
| `STATUS_CHANGE` | Status change without qty delta |
| `BATCH_ENABLED` / `BATCH_DISABLED` | Batch / serial tracking toggled |
| `DELETE` | Soft delete (Recycle Bin / inventory soft-delete) |
| `RESTORE` | Restore from soft delete |
| `CONSUME` / `RETURN` | Consume / return flows |

### Reserved for future lifecycle / stock movement

`TRANSFER`, `RESERVE`, `UNRESERVE`, `CHECKOUT`, `CHECKIN`, `REPAIR`, `MAINTENANCE`, `CALIBRATION`, `IMPORT`, `EXPORT`, `AUDIT_CORRECTION`

Plus legacy asset qty names kept for mapping: `ISSUE`, `SPLIT`, `RECEIVE`.

---

## Display Labels

Use `getEventDisplayName(type)` or `presentEvent(row).display_name`.

| Type | Display |
|------|---------|
| `INIT` | Quantity Tracking Initialized |
| `ADJUST` | Quantity Adjusted |
| `STATUS_CHANGE` | Status Changed |
| `BATCH_ENABLED` | Batch / Serial Number Tracking Enabled |
| `BATCH_DISABLED` | Batch / Serial Number Tracking Disabled |
| `DELETE` | Deleted |
| `RESTORE` | Restored |
| `CONSUME` | Quantity Consumed |
| `RETURN` | Quantity Returned |
| … | See `EVENT_DISPLAY_NAMES` in the module |

Never render the raw constant as the primary UI label.

---

## Legacy Alias Mapping

`normalizeEventType()` / `LEGACY_TYPE_ALIASES` map older stored values → canonical types, e.g.:

- `STATUS` → `STATUS_CHANGE`
- `BATCH_ENABLE` → `BATCH_ENABLED`
- `SOFT_DELETE` → `DELETE`
- `QTY_ADJUST` → `ADJUST`

Existing history rows keep working without manual DB edits.

---

## Metadata Fields

Prefer `buildEventMetadata` / `createEventEnvelope`:

```json
{
  "schema_version": 1,
  "entity_type": "asset",
  "entity_id": "TES-MUM-…",
  "previous_value": { "...": "..." },
  "new_value": { "...": "..." }
}
```

Envelope fields:

| Field | Meaning |
|-------|---------|
| Event type | `EVENT_TYPES.*` |
| Timestamp | ISO string |
| User / actor | Username or user id |
| Entity type | `ENTITY_TYPES` (`asset`, `inventory_item`, `project`, …) |
| Entity ID | Primary business id |
| Previous / new value | Snapshots when applicable |
| Optional notes | Human-readable note |

---

## Lifecycle (soft delete) & Recovery Center

Soft delete is a **lifecycle flag**, not erasure:

1. Row remains in its table with `is_deleted = 1`, `deleted_at`, `deleted_by` (where applicable)
2. Normal module lists continue to exclude deleted rows
3. **Recovery Center** (SYSTEM nav) is the platform browse/restore surface — not an Assets toolbar
4. APIs: `GET /api/recovery-center/items`, `POST /api/recovery-center/:entityType/:id/restore`
5. Service registry: `services/recoveryCenterService.js` — register entity adapters (list + restore strategy)
6. `DELETE` / `RESTORE` domain events use shared `EVENT_TYPES` (no raw strings)
7. Automatic hard purge remains **disabled** this sprint

### Adding a new entity type to Recovery Center

1. Ensure the table has soft-delete columns (`is_deleted`, `deleted_at`, ideally `deleted_by`)
2. In `recoveryCenterService.js`, `registerEntityType({ type, label, enabled: true, list, restore, ... })`  
   - Prefer `createTableAdapter({ table, nameColumn, locationColumn, ... })` for simple tables  
   - Override `restore` when relationships/qty need special handling (see Assets)
3. On soft-delete write paths, call `recordDomainEvent` with `EVENT_TYPES.DELETE` and `ENTITY_TYPES.*`
4. No UI rewrite required — Recovery Center loads enabled types dynamically

Phase 1 enabled type: **Assets**. Inventory, Projects, Employees, etc. are registered as stubs (`enabled: false`).

Future lifecycle states (Active, Retired, Consumed, Reserved, Checked Out, Repair, Disposed, Archived, …) can reuse the same event catalog and flags without rewriting Recovery Center.

---

## Example Payloads

### Asset soft delete (`domain_events`)

```json
{
  "entity_type": "asset",
  "entity_id": "TES-MUM-0726-ABC123-0",
  "type": "DELETE",
  "actor": "admin",
  "timestamp": "2026-08-12T06:00:00.000Z",
  "note": "Soft-deleted (moved to Recovery Center)",
  "metadata_json": {
    "schema_version": 1,
    "entity_type": "asset",
    "entity_id": "TES-MUM-0726-ABC123-0",
    "previous_value": { "is_deleted": 0, "status": "In Store", "srno": "SN-1" },
    "new_value": { "is_deleted": 1, "deleted_by": "admin" }
  }
}
```

### Inventory quantity adjust (`inventory_quantity_events`)

```json
{
  "root_id": "INV-…",
  "type": "ADJUST",
  "actor": "manager1",
  "note": "Updated quantity",
  "metadata_json": {
    "schema_version": 1,
    "entity_type": "inventory_item",
    "entity_id": "INV-…",
    "previous_value": { "quantity_total": 10, "quantity_available": 8 },
    "new_value": { "quantity_total": 12, "quantity_available": 10 }
  }
}
```

---

## Guidelines: adding a future event type

1. Add the constant to `EVENT_TYPES` in `inventoryEventSystem.js`
2. Add `EVENT_DISPLAY_NAMES` (required) and optional `EVENT_UI`
3. Add any legacy aliases if migrating old data
4. Write using `EVENT_TYPES.NEW_TYPE` + `createEventEnvelope` / `recordDomainEvent` / `recordInventoryQuantityEvent`
5. Update this guide and `inventory-event-system.md` if inventory-specific
6. Prefer **one event per user action** (no duplicate noise)

Do **not** hardcode the new type string across UI switch/case blocks — extend `getEventUi` / display maps instead.

---

## Entity types (`ENTITY_TYPES`)

| Constant | Value |
|----------|--------|
| `INVENTORY_ITEM` | `inventory_item` |
| `ASSET` | `asset` |
| `PROJECT` | `project` |
| `PROCUREMENT` | `procurement` |
| `ZOHO` | `zoho` |

Add new entity constants here when a new domain starts writing events.
