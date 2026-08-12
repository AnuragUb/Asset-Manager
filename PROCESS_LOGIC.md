# Asset Manager: Core Process Documentation (Production 8080)

This document outlines the operational logic, process flows, and technical implementation of the core features currently active on the Asset Manager production environment (Port 8080).

**Platform lifecycle (Sprint 1):** Canonical states, transitions, and operational status aliases live in [`docs/architecture/LIFECYCLE_MODEL.md`](./docs/architecture/LIFECYCLE_MODEL.md) and [`web-app/shared/lifecycleModel.js`](./web-app/shared/lifecycleModel.js). Import from there for new work.

---

## 1. Asset Lifecycle & Status Transitions

### **Overview**
The system manages the physical and logical state of assets as they move between the warehouse and various project sites.

### **Working Logic**
- **Centralized Helper**: Every status change is handled by the `updateAssetStatus` helper in `server.js`. This function ensures that when a status is updated, it isn't just a database change—it's a lifecycle event.
- **Status Hierarchy**:
    1. **In Store**: Asset is verified, in the Mumbai hub, and available for assignment.
    2. **Project**: Asset is locked to a specific project and location is updated to "On Site".
    3. **Under Inspection**: Asset has been unassigned but not yet verified. It is hidden from available inventory.
- **Recursive Propagation**: If a "Set" or "Superset" changes status, the helper recursively finds all children (linked by `parentid`) and applies the same status, location, and project assignment to them.

### **Process Flow**
1. **Assignment**: User selects an asset -> API updates status to `Project` -> Project ID linked in `project_assets`.
2. **Unassignment**: User clicks unassign -> API updates status to `Under Inspection` -> Project link remains until inspection is cleared (to maintain traceability).
3. **Restoration**: Passing inspection -> API updates status to `In Store` -> Location reset to `Mumbai`.

---

## 2. Set & Hierarchy Management

### **Overview**
Manages the relationship between "Parent" sets (like a Camera Kit) and their "Child" components (like lenses or SFPs).

### **Working Logic**
- **No-QR to Full Asset Promotion**: Components without a QR code can be "upgraded" to full assets. This involves an atomic move from the `components` table to the `assets` table.
- **Set Persistence**: The `parentid` field acts as the glue. Unlike previous versions, unassigning an item does **not** clear its `parentid`, ensuring the kit stays together even when returned to the warehouse.
- **Unsplit Logic**: 
    - **Batch Items**: Merges quantity back into the parent and deletes the child record.
    - **Set Items**: Breaks the link to the parent (`parentid = null`) but keeps the child as a standalone "In Store" asset.

### **Process Flow**
1. **Promotion**: `promoteToAsset(id)` -> Transaction: `INSERT INTO assets` -> `DELETE FROM components`.
2. **Break Set**: User selects "Detach" -> `parentid` cleared -> Asset remains in database but shows as a standalone item in the inventory.

---

## 3. Inward Inspection & Unassignment Flow

### **Overview**
A "Smart" process that ensures no asset returns to inventory without being checked for condition.

### **Working Logic**
- **Atomic Chain**: The frontend triggers a chained process:
    1. Call `/unassign-asset`: Moves asset to `Under Inspection`.
    2. Open Modal: User provides Condition (Good/Damaged) and Remarks.
    3. Call `/release-to-store`: Finalizes the return.
- **Visibility Control**: Assets in `Under Inspection` status are filtered out of the dashboard `assetGrid` and `project-workspace` inventory list to prevent re-assignment before inspection.

### **Process Flow**
1. **Trigger**: User clicks "Unassign" in Project View.
2. **Modal**: Inward Inspection modal pops up.
3. **Submit**: Form sends condition/remarks -> Backend updates status to `In Store` -> History logged with `INSPECTION_PASSED`.

---

## 4. Data Integrity & Synchronization Logic

### **Overview**
The "Safety Net" that prevents data loss, duplication, and UI lag.

### **Working Logic**
- **Database Triggers**: A PostgreSQL trigger `trg_check_assets_dup` prevents an ID from ever existing in both `assets` and `components` tables. This is the "Hard Truth" of the system.
- **Cache Invalidation**: The system uses a "Delete-on-Write" strategy for Redis. Any change to an asset status or project link triggers `invalidateAssetsCache()`, forcing the next dashboard load to fetch fresh data from the DB.
- **Cross-Table API**: The `asset-details` API uses a `Map` to merge data from both tables. If a duplicate somehow exists, the `assets` table record is given absolute priority.

### **Process Flow**
1. **Update Request**: Backend receives change.
2. **Database Execution**: Triggers verify no ID conflict.
3. **Cache Flush**: Redis keys are deleted.
4. **UI Refresh**: Frontend receives `success`, triggers `window.loadAssets()`.

---

**Documentation Meta-Data**
- **Environment**: 59:8080 (Production)
- **Last Updated**: 2026-05-30
- **Status**: Verified via manual database inspection and Playwright setup.
