# Inventory Event System

**Purpose:** Single source of truth for inventory (and reusable quantity) audit history — event types, display labels, structured metadata, and logging rules.

**Code:** [`web-app/shared/inventoryEventSystem.js`](../../web-app/shared/inventoryEventSystem.js)  
**Backend consumers:** `recordInventoryQuantityEvent` in `server.js`  
**Frontend consumers:** `js/inventory-event-system.js`, `js/inventory.js`, `js/quantity-history-modal.js`

---

## Design rules

1. **Never** hardcode event type strings at write sites — use `EVENT_TYPES.*`.
2. **Never** show the internal type as user-facing text — use `getEventDisplayName()` / `display_name`.
3. History is for **meaningful operational** changes only (not description/make/model/notes/cosmetic edits).
4. One logical save → **at most one** history event (combined metadata; primary type by precedence).
5. Existing DB rows keep working via `LEGACY_TYPE_ALIASES` + `presentEvent()` — no manual DB rewrite.

---

## Structured event fields

Stored primarily in `inventory_quantity_events` (+ optional lines in `inventory_quantity_event_lines`).

| Field | Where | Notes |
|-------|--------|--------|
| Event type | `type` column | Canonical `EVENT_TYPES` value |
| Timestamp | `timestamp` | ISO string |
| User | `actor` | Username / user id |
| Optional notes | `note` | Human note |
| Entity type | `metadata_json.entity_type` | e.g. `inventory_item` |
| Entity ID | `metadata_json.entity_id` | Item id |
| Previous value | `metadata_json.previous_value` | Snapshot object |
| New value | `metadata_json.new_value` | Snapshot object |

API responses also expose `display_name`, normalized `type`, `previous_value`, `new_value` via `presentEvent()`.

---

## Event types

### Current (actively written for inventory)

| Type | Display | When created |
|------|---------|----------------|
| `INIT` | Quantity Tracking Initialized | Create qty-tracked item, or enable tracking on edit |
| `ADJUST` | Quantity Adjusted | Total and/or available quantity change (or tracking disabled) |
| `STATUS_CHANGE` | Status Changed | Status change with no qty/batch delta |
| `BATCH_ENABLED` | Batch / Serial Number Tracking Enabled | `is_batch` 0→1 |
| `BATCH_DISABLED` | Batch / Serial Number Tracking Disabled | `is_batch` 1→0 |
| `DELETE` | Inventory Deleted | Soft-delete (`POST .../delete`) |
| `RESTORE` | Inventory Restored | Restore (`POST .../restore`) |

### Defined for reuse / upcoming flows

| Type | Display |
|------|---------|
| `CONSUME` | Quantity Consumed |
| `RETURN` | Quantity Returned |
| `TRANSFER` | Transferred |
| `RESERVE` / `UNRESERVE` | Reserved / Unreserved |
| `CHECKOUT` / `CHECKIN` | Checked Out / Checked In |
| `REPAIR` / `MAINTENANCE` / `CALIBRATION` | Repair / Maintenance / Calibration |
| `IMPORT` / `EXPORT` | Imported / Exported |
| `AUDIT_CORRECTION` | Audit Correction |

### Compatibility (legacy aliases → canonical)

Examples: `STATUS` → `STATUS_CHANGE`, `BATCH_ENABLE` → `BATCH_ENABLED`, `QTY_ADJUST` → `ADJUST`, `SOFT_DELETE` → `DELETE`.

Asset-side legacy names (`ISSUE`, `SPLIT`, `RECEIVE`) remain in the catalog for shared UI mapping.

---

## Logging rules (SHOULD / SHOULD NOT)

**Record history for:** quantity total, available quantity, enable/disable qty tracking, status change, batch enable/disable, delete, restore, consume/return (when those inventory paths write events).

**Do not record for:** description, manufacturer/make, model, display name, notes/remarks, folder/kind cosmetics, price/warranty/network fields, idempotent re-saves with no operational delta.

**Anti-duplicate:** if several operational fields change in one PUT, emit **one** event. Precedence: `INIT` → `DELETE`/`RESTORE` → `ADJUST` → `BATCH_*` → `STATUS_CHANGE`.

---

## UI representation

- Timeline / modal show **display name**, not the raw constant (raw type may appear as `title` tooltip).
- Colors/icons/badges come from `EVENT_UI` / `getEventUi()`.
- Unknown future types humanize via word-split fallback so the UI does not break.

---

## Extending

1. Add the constant to `EVENT_TYPES` in `inventoryEventSystem.js`.
2. Add `EVENT_DISPLAY_NAMES` (required) and optional `EVENT_UI`.
3. Call `recordInventoryQuantityEvent({ type: EVENT_TYPES.NEW_TYPE, ... })` from the write path.
4. Update this document’s table.

No call-site string literals; no multi-file search/replace of type names.

---

## Related APIs

| Method | Route | Event |
|--------|-------|--------|
| POST | `/api/inventory/items` | `INIT` when qty-tracked |
| PUT | `/api/inventory/items/:id` | meaningful types above |
| POST | `/api/inventory/items/:id/delete` | `DELETE` |
| POST | `/api/inventory/items/:id/restore` | `RESTORE` |
| GET | `/api/inventory/quantity/events/:rootId` | read + present |
| GET | `/api/inventory/item-details/:id` | includes presented `quantityEvents` |
