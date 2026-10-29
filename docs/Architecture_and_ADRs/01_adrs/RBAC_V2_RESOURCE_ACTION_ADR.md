# RBAC V2 — Resource-and-Action Authorization

**Status:** ACCEPTED (implementation in progress on scratch; production not migrated)  
**Date:** 2026-09-23  
**Scope:** AssetEngine authorization model — permissions catalog, role grants, backend enforcement, frontend UX gates

## Reading rule

Claims about current production behavior are evidence-backed. Claims about the V2 model are locked decisions for this workstream.

## 1. Problem

AssetEngine RBAC evolved as page `view.*` grants plus role-name triad checks (`superuser`/`admin`/`manager`). Consequences:

1. **VIEW implied mutation** — operators with page access could mutate if the frontend showed controls and backend used `authorizeRoles` or only JWT.
2. **Admin dual policy** — frontend bypassed all checks for `admin`; backend required stored ticks (except superuser).
3. **`manage.hierarchy` injection** — granted at login for admin/superuser without a `role_permissions` row.
4. **Catalog lag** — lifecycle actions (RN post/cancel, intake, reservations, DC, sets) were not first-class permissions.

## 2. Decision

**AssetEngine authorization is resource-and-action based.**

| Layer | Meaning | Does NOT grant |
|-------|---------|----------------|
| `module.*.access` | Enter/use a workspace | Read or mutate records |
| `resource.view` | Read records / open page | Any state change |
| `resource.action` | Perform a named mutation | Broader module rights |

Additional locked rules:

1. **Backend is authoritative.** Every state-changing route uses `requirePermission(<action>)`.
2. **Frontend is UX only.** `can()` / `hasPermission()` hide or disable controls; never the sole security boundary.
3. **Superuser** may retain a **single centralized bypass** in `hasPermission` (backend + frontend). No scattered `if (role === 'admin')` allow-alls.
4. **Admin** uses **stored `role_permissions` only** — no hidden frontend privilege set.
5. **`manage.hierarchy` is a normal stored grant** (admin + superuser); never injected at login.
6. **Legacy `view.*` keys** remain temporarily as deprecated aliases dual-resolved to `resource.view`; removal is a later named migration after zero code references.
7. **Do not invent** Zoho Books / Accounts permissions in this ADR.
8. **Do not weaken** Receipt Note, Physical Intake, Reservation, Set, DC, or Asset/Inventory containment rules — RBAC gates who may call lifecycle APIs; lifecycle services still enforce domain invariants.

## 3. Naming

Prefer:

- `asset.view`, `receipt_note.post`, `dc.create`, `physical_intake.link_po`

Retain existing module keys (`module.assets.access`, `module.network.access`, …) until a dedicated cleanup.

## 4. Migration posture

- Named migration only: `20260923120000_rbac_v2_permission_hardening.js`
- Verify on `asset_manager_rbac_scratch` first
- **Do not** run `migrate:latest` against production for this workstream without explicit ops approval
- Preserve effective access per role; document any deliberate reductions

## 5. Non-goals

- Rewriting lifecycle engines
- Introducing Books/Accounts permission domains
- Removing legacy `view.*` rows in the same PR as enforcement
- Opening previously closed physical-creation paths via new `inventory.create` misuse

## 6. Evidence / artifacts

- `web-app/asset-manager-backend/services/permissionCatalog.js`
- `web-app/asset-manager-backend/migrations/20260923120000_rbac_v2_permission_hardening.js`
- `docs/RBAC_PERMISSION_MATRIX.md`
- `docs/RBAC_ROUTE_COVERAGE.md`
- Snapshots: `docs/rbac-v2/snapshot_*.csv`

## 5. Decision log

| Date | Decision |
|------|----------|
| 2026-09-23 | Adopt resource-and-action RBAC; admin stored ticks; superuser centralized bypass; hierarchy stored; view≠action |
| 2026-09-23 | Phase 19 role authority: Logistics Executive execution grants; category.delete superuser-only; IT asset.create revoked; Accounts roles deferred |
