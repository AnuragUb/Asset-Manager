# Platform Lifecycle Model

**Shared module:** [`web-app/shared/lifecycleModel.js`](../../web-app/shared/lifecycleModel.js)  
**Frontend adapter:** [`web-app/asset-manager-frontend/js/lifecycle-model.js`](../../web-app/asset-manager-frontend/js/lifecycle-model.js)  
**Related:** [`EVENT_SYSTEM_GUIDE.md`](./EVENT_SYSTEM_GUIDE.md) · [`RECOVERY_CENTER.md`](./RECOVERY_CENTER.md) · [`INVENTORY_MOVEMENT_SYSTEM.md`](./INVENTORY_MOVEMENT_SYSTEM.md) · [`PROCESS_LOGIC.md`](../../PROCESS_LOGIC.md)

## Purpose

One consistent lifecycle philosophy for AssetEngine — Assets, Inventory, Projects, Recovery Center, Events, and future modules.

This is **architectural consolidation**, not a rewrite of every status call site. New and updated modules must import from the shared definition instead of inventing local status constants.

## Lifecycle States

Canonical codes (`LIFECYCLE_STATES`) and display labels:

| Code | Display | Purpose |
|------|---------|---------|
| `ACTIVE` | Active | Normal operational use / available stock |
| `RETIRED` | Retired | Left active service (sold, scraped, or flagged `is_retired`) |
| `DELETED` | Deleted | Soft-deleted; recoverable via Recovery Center |
| `CONSUMED` | Consumed | Fully consumed (inventory status model) |
| `RESERVED` | Reserved | Held for future assignment (future) |
| `CHECKED_OUT` | Checked Out | Issued to user / site (future) |
| `CHECKED_IN` | Checked In | Returned from checkout (future) |
| `MAINTENANCE` | Maintenance | Planned maintenance (future) |
| `REPAIR` | Repair | Under repair (future) |
| `ARCHIVED` | Archived | Long-term retention (future) |
| `DISPOSED` | Disposed | Permanent disposal outcome (future; ≠ soft-delete) |

Add a future state by extending `LIFECYCLE_STATES`, display names, purpose text, and `LIFECYCLE_TRANSITIONS` in the shared module — no parallel enums.

## Operational Status Aliases

Historical UI / DB strings (`assets.status`, `inventory_items.status`) remain for compatibility. They map into the platform model via `OPERATIONAL_STATUS` + `OPERATIONAL_TO_LIFECYCLE`:

| Stored status (examples) | Lifecycle |
|--------------------------|-----------|
| In Store, In Use, Project, Under Inspection, … | `ACTIVE` |
| Sold, Scraped, Retired | `RETIRED` |
| Consumed | `CONSUMED` |
| In-Repair | `REPAIR` |

Flags:

| Flag | Lifecycle |
|------|-----------|
| `is_deleted = 1` | `DELETED` (wins over status string) |
| `is_retired = 1` | `RETIRED` |

Resolve with `resolveLifecycle(row)`.

## Transitions

Directed graph in `LIFECYCLE_TRANSITIONS` / helpers `canTransition` · `assertTransition`.

### Valid state changes (summary)

```
ACTIVE ──────► RETIRED | DELETED | CONSUMED | RESERVED | CHECKED_OUT
               | MAINTENANCE | REPAIR | ARCHIVED | DISPOSED
ACTIVE ◄────── (operational moves stay within ACTIVE, e.g. In Store ↔ Project)

RESERVED ────► ACTIVE | CHECKED_OUT | DELETED
CHECKED_OUT ─► CHECKED_IN | ACTIVE | MAINTENANCE | REPAIR | DELETED
CHECKED_IN ──► ACTIVE | CHECKED_OUT | MAINTENANCE | REPAIR | DELETED
MAINTENANCE ─► ACTIVE | REPAIR | DELETED
REPAIR ──────► ACTIVE | MAINTENANCE | RETIRED | DISPOSED | DELETED
RETIRED ─────► ACTIVE | ARCHIVED | DISPOSED | DELETED
DELETED ─────► ACTIVE          (Recovery Center restore)
CONSUMED ────► (none this sprint; RETURN may reopen later)
DISPOSED ────► (terminal)
ARCHIVED ────► ACTIVE | DELETED
```

Call sites that enforce transitions should use `assertTransition` — do not hardcode pairwise if/else lists.

## How domains align

| Domain | Mechanism | Lifecycle philosophy |
|--------|-----------|----------------------|
| **Assets** | `status` + `is_retired` + `is_deleted` | Active operational strings; Retired browse; soft-delete → Deleted |
| **Inventory** | `status` + soft-delete flags | Same aliases; Consumed via Movement System |
| **Projects** | project `status` + soft-delete stubs | Soft-delete reserved for Recovery Center registry |
| **Recovery Center** | `is_deleted` browse / restore | Platform surface for **Deleted** → restore to Active |
| **Event System** | `DELETE` / `RESTORE` / `CONSUME` / `STATUS_CHANGE`… | Audits transitions; does not redefine states |
| **Movements** | CONSUME → `OPERATIONAL_STATUS.CONSUMED` | Uses lifecycle constants, not literal `"Consumed"` |

## Future expansion

1. Add code to `LIFECYCLE_STATES` + display + purpose  
2. Extend `LIFECYCLE_TRANSITIONS`  
3. Optionally add operational alias strings  
4. Wire UI filters / RBAC to `resolveLifecycle`  
5. Prefer Event System types already reserved (`RESERVE`, `CHECKOUT`, `REPAIR`, …)

Do **not** create a second lifecycle enum in a feature module.

## Import examples

```js
// Backend
const { LIFECYCLE_STATES, OPERATIONAL_STATUS, resolveLifecycle, canTransition } =
  require('../shared/lifecycleModel');

// Frontend (ESM)
import { OPERATIONAL_STATUS, isConsumed, resolveLifecycle } from './lifecycle-model.js';
```

## Out of scope (this consolidation)

- Rewriting every dashboard status dropdown string in one pass  
- Enforcing `assertTransition` on all legacy `updateAssetStatus` paths  
- New lifecycle APIs or UI screens  
- Hard purge / permanent dispose workflows  
