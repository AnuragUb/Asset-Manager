# Inventory Movement System

**Service:** [`web-app/asset-manager-backend/services/inventoryMovementService.js`](../../web-app/asset-manager-backend/services/inventoryMovementService.js)  
**Events:** [`EVENT_SYSTEM_GUIDE.md`](./EVENT_SYSTEM_GUIDE.md) · shared catalog [`inventoryEventSystem.js`](../../web-app/shared/inventoryEventSystem.js)  
**UI:** Inventory workspace → **Consumed Inventory** ([`inventory.js`](../../web-app/asset-manager-frontend/js/inventory.js))

## Purpose

Platform foundation for inventory stock movements. Sprint 1 Issue 6 ships **CONSUME** only. Other movement types are registered but disabled so future work is configuration + a handler, not a redesign.

## Architecture

```
Movement Type Registry
        ↓
Movement Handler (enabled types only)
        ↓
Shared Event System (inventory_quantity_events)
        ↓
Existing inventory_items.status model
```

### Constraints (approved)

- **No separate consumed entity table** — use `inventory_items.status = 'Consumed'`
- **No independent movement log** — write through shared `EVENT_TYPES` / `recordInventoryQuantityEvent`
- **Do not hardcode “Consumed” branches** at API/UI call sites — use `MOVEMENT_TYPES` / `applyMovement({ type })`

## Movement Types

| Code | Label | Event Type | Enabled (Sprint 1) |
|------|-------|------------|--------------------|
| `RECEIVE` | Receive | `RECEIVE` | No |
| `ADJUST` | Adjust | `ADJUST` | No |
| `TRANSFER` | Transfer | `TRANSFER` | No |
| `CONSUME` | Consume | `CONSUME` | **Yes** |
| `RETURN` | Return | `RETURN` | No |
| `RESERVE` | Reserve | `RESERVE` | No |
| `UNRESERVE` | Unreserve | `UNRESERVE` | No |
| `DISPOSE` | Dispose | `DISPOSE` | No |
| `LOST` | Lost | `LOST` | No |
| `FOUND` | Found | `FOUND` | No |

Enable a future type by flipping `enabled: true` and implementing its handler inside `applyMovement` (same registry pattern as CONSUME).

## CONSUME behavior

1. Validate item exists, not deleted, not already Consumed  
2. Require `amount > 0` and `amount ≤ available` when quantity-tracked  
3. Reduce `quantity_available` and `quantity_total`  
4. When available reaches 0 → set `status = 'Consumed'` (existing status model)  
5. Emit `EVENT_TYPES.CONSUME` with previous/new quantity snapshots + note  
6. Audit action `INV_MOVE_CONSUME`

Partial consume leaves prior status (e.g. In Store) and remains in the active inventory list. Full deplete moves the row into **Consumed Inventory**.

## Movement history fields

Every movement event presents:

| Field | Source |
|-------|--------|
| Movement Type | registry / `event.type` |
| Timestamp | `timestamp` |
| User | `actor` |
| Entity | `entity_id` / root |
| Previous Quantity | `metadata.previous_value` (total + available) |
| New Quantity | `metadata.new_value` |
| Notes | `note` |

## APIs

| Method | Route | Auth | Purpose |
|--------|-------|------|---------|
| GET | `/api/inventory/movements/types` | JWT | Registry |
| POST | `/api/inventory/movements` | JWT + roles | Apply movement (`type: CONSUME`) |
| GET | `/api/inventory/movements` | JWT | Movement history (filterable) |
| GET | `/api/inventory/consumed` | JWT | Browse `status = Consumed` |

`GET /api/inventory/items` excludes Consumed by default (`?includeConsumed=1` to include).

Legacy asset path `POST /api/quantity/consume` is unchanged (asset quantity children). Inventory consume uses the movement service.

## UI

Inventory toolbar: **Consumed Inventory** (same workspace language as Inventory / Refresh).

- Search + location filter  
- Reuses inventory table/cards patterns  
- Consume action on quantity-tracked rows  
- Consume Movement History panel  
- CSV **Report** of consumed items  

## Future registration checklist

1. Ensure `EVENT_TYPES.*` exists in the shared catalog  
2. Set `enabled: true` on the movement registry entry  
3. Implement handler branch in `applyMovement` (status / qty rules)  
4. UI: reuse Consumed/history patterns or add a filter chip — avoid a new module shell  

## Out of scope this sprint

- RECEIVE / ADJUST / TRANSFER / RETURN / RESERVE / … handlers  
- Lifecycle consolidation  
- Recovery Center changes  
- Production `118:8080` deploy  
