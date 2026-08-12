# Recovery Center

**Module:** Global SYSTEM navigation (not Assets toolbar)  
**Service:** [`web-app/asset-manager-backend/services/recoveryCenterService.js`](../../web-app/asset-manager-backend/services/recoveryCenterService.js)  
**UI:** [`web-app/asset-manager-frontend/js/recovery-center.js`](../../web-app/asset-manager-frontend/js/recovery-center.js)  
**Events:** [`EVENT_SYSTEM_GUIDE.md`](./EVENT_SYSTEM_GUIDE.md)

## Purpose

Central soft-delete recovery for AssetEngine — a platform Recycle Bin / Deleted Items service. Phase 1 recovers **Assets**; the registry is multi-entity from day one so later modules plug in without redesigning the UI.

## Navigation

SYSTEM → Admin → Settings → **Recovery Center** → Releases

Nav label shows a recoverable count badge when `total > 0`, e.g. `Recovery Center (14)`. The total comes from `GET /api/recovery-center/summary` and sums every **enabled** entity type (future types contribute automatically once enabled).

---

## Architecture

```
Entity Registry
      ↓
Recovery Strategy
      ↓
(future) Permission Layer
```

### Entity Registry

`registerEntityType(definition)` stores metadata and adapters per entity:

| Field | Role |
|-------|------|
| `type` / `label` | Identity in API + UI |
| `enabled` | Listed / restorable only when true |
| `list` / `count` | Soft-deleted browse + badge contribution |
| `permissions` | Keys + interim role allow-list (not full RBAC) |
| `strategy` | Recovery Strategy for that type |

Built-ins include Assets (enabled) and stubs (Inventory, Project, Employee, …) that stay disabled until soft-delete + strategy exist.

### Recovery Strategy

Each entity type restores through a **Recovery Strategy**, not ad-hoc routes:

```text
Asset      → restoreAsset()      (registered today)
Inventory  → restoreInventory()  (future)
Project    → restoreProject()    (future)
Employee   → restoreEmployee()   (future)
```

API:

- `createRecoveryStrategy({ name, restore, canRestore? })`
- `registerRecoveryStrategy(entityType, strategy)`
- `getRecoveryStrategy(entityType)`

`setAssetRestoreHandler(fn)` remains a thin alias that registers the Asset strategy (avoids a circular require with `server.js`).

Restore flow:

1. Resolve entity from registry  
2. `assertCanRestore(user, entityType)`  
3. Call strategy `restore(id, ctx)`  

### Permission foundation (not RBAC yet)

Recovery Center **must not** assume every authenticated user can restore every entity.

- Restore routes use JWT only; **authorization lives in the service** (`canRestoreEntity` / `assertCanRestore`).
- Default check: entity `permissions.restoreRoles` (Assets: `superuser` | `admin` | `manager`). Empty roles → **deny**.
- Optional hooks for later RBAC:
  - `setPermissionResolver(async ({ user, entityType, action, item }) => boolean)`
  - strategy-level `canRestore(user, item, entityDef)`
  - permission keys such as `recovery.asset.restore` / `recovery.asset.view`

Do **not** hardcode “everyone can restore” on routes. Do **not** implement full RBAC in this phase.

### Future entity registration

Checklist when enabling a new type:

1. Soft-delete columns on the table (`is_deleted`, `deleted_at`, `deleted_by`, …)  
2. `registerEntityType` / enable table adapter (`enabled: true`)  
3. Soft-delete path emits `EVENT_TYPES.DELETE` via `recordDomainEvent`  
4. `registerRecoveryStrategy(type, { restore, canRestore? })` — preserve relationships  
5. Leave permanent delete disabled until product enables it  

No Recovery Center UI rewrite required per type; badge totals pick up the new `count()`.

### Future permission layer

Planned (not implemented):

- Map `restorePermission` / `viewPermission` to real RBAC grants  
- Per-entity and per-item rules (e.g. only restore what you deleted; department scope)  
- UI hide/disable Restore when `canRestore` is false  

Until then, interim role lists on the entity definition keep current behavior without implying “any logged-in user.”

### Future retention policies

Soft delete keeps relationships; automatic 30-day hard purge is **disabled**.

Later options (registry / policy config, not hardcoded UI):

- Retention windows per entity type  
- Scheduled hard purge only after policy + permanent-delete product approval  
- Audit of purge actions via domain events  

Permanent delete remains unavailable in the UI and API until explicitly enabled.

---

## APIs

| Method | Route | Auth | Purpose |
|--------|-------|------|---------|
| GET | `/api/recovery-center/entity-types` | JWT | Registry metadata |
| GET | `/api/recovery-center/items` | JWT | Soft-deleted items (filters) |
| GET | `/api/recovery-center/summary` | JWT | `{ total, byEntityType }` for badge |
| POST | `/api/recovery-center/:entityType/:id/restore` | JWT + service assert | Restore via strategy |

Legacy: `GET /api/assets/recycle-bin`, `POST /api/assets/:id/restore` delegate to the same service.
