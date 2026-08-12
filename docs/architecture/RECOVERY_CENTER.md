# Recovery Center

**Module:** Global SYSTEM navigation (not Assets toolbar)  
**Service:** [`web-app/asset-manager-backend/services/recoveryCenterService.js`](../../web-app/asset-manager-backend/services/recoveryCenterService.js)  
**UI:** [`web-app/asset-manager-frontend/js/recovery-center.js`](../../web-app/asset-manager-frontend/js/recovery-center.js)  
**Events:** [`EVENT_SYSTEM_GUIDE.md`](./EVENT_SYSTEM_GUIDE.md)

## Purpose

Central soft-delete recovery for AssetEngine — analogous to a platform Recycle Bin / Deleted Items folder. Phase 1 recovers **Assets**; the registry is multi-entity from day one.

## Navigation

SYSTEM → Admin → Settings → **Recovery Center** → Releases

## Adding an entity (checklist)

1. Soft-delete columns on the table  
2. `registerEntityType` / enable adapter in `recoveryCenterService.js`  
3. Soft-delete path emits `EVENT_TYPES.DELETE` via `recordDomainEvent`  
4. Implement `restore` strategy (preserve relationships)  
5. Leave permanent delete disabled until product enables it  

No need to redesign the Recovery Center UI for each new type.
