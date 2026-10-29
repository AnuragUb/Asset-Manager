# RBAC V2 — Implementation Report

**Date:** 2026-09-23  
**Migrations (scratch):**  
- `20260923120000_rbac_v2_permission_hardening.js`  
- `20260923140000_rbac_v2_role_authority_model.js` (Phase 19 canonical role authority)  
**Scratch DB:** `asset_manager_rbac_scratch`  
**Production:** unchanged (37 permissions / 138 grants / 0 `manage.hierarchy` rows)

ADR: [`docs/Architecture_and_ADRs/01_adrs/RBAC_V2_RESOURCE_ACTION_ADR.md`](./Architecture_and_ADRs/01_adrs/RBAC_V2_RESOURCE_ACTION_ADR.md)  
Role matrix: [`docs/RBAC_ROLE_MATRIX.md`](./RBAC_ROLE_MATRIX.md)  
Effective access: [`docs/rbac-v2/EFFECTIVE_ACCESS_COMPARISON.md`](./rbac-v2/EFFECTIVE_ACCESS_COMPARISON.md)

---

## 1. Current RBAC findings (pre-V2)

- 37 catalog keys, 9 roles, 138 grants, 5 active users
- Frontend: admin + superuser bypassed permission checks
- Backend: superuser bypass only; admin depended on stored ticks
- `manage.hierarchy` in catalog but not stored; injected at login for admin/superuser
- Most modules were `view.*` only; mutations gated by `authorizeRoles('superuser','admin','manager')`
- VIEW could effectively authorize mutation when FE showed controls and BE used role triad

## 2. Permission taxonomy

```
module.*.access  →  enter workspace
resource.view    →  read / open page
resource.action  →  mutate / transition
```

Canonical views: `asset.view`, `inventory.view`, `product.view`, `purchase_order.view`, `purchase_book.view`, `receipt_note.view`, `physical_intake.view`, `reservation.view`, `set.view`, `dc.view`, `project.view`, `warranty.view`, `dashboard.view`, `history.view`, `settings.view`, `recovery.view`, `scanner.view`, `admin.view`, `release.view`

Actions added only where routes exist (see matrix). No Zoho Books permissions.

## 3. Old → new mapping

See [`docs/RBAC_PERMISSION_MATRIX.md`](./RBAC_PERMISSION_MATRIX.md). All legacy `view.*` → `resource.view` via `VIEW_ALIASES` dual-resolve in backend + frontend.

## 4. Permissions added

All keys in `NEW_PERMISSIONS` inside `services/permissionCatalog.js` (canonical views + action keys including `settings.edit`, `manage.hierarchy`, RN/PO/PB/set/DC/reservation/intake/asset lifecycle, network credential/contact manage, `zoho.oauth.manage`, `zoho.sync`, `role.manage`, …).

Scratch after migration: **108** permissions.

## 5. Permissions deprecated

Legacy `view.*` keys marked `category=deprecated`. Still present for dual-resolve. **Not deleted.**

## 6. Permissions removed

None in this migration.

## 7. Role matrix after Phase 19 (scratch)

| Role | Grants | Mutation posture |
|------|--------|------------------|
| superuser | 108 | Centralized bypass + full stored catalog; sole `category.delete` |
| admin | 107 | Full ops + hierarchy + `role.manage` + OAuth/network/settings; **no** `category.delete` |
| manager | 84 | Operational lifecycle (RN/DC/sets/intake/…); **no** user/role/network/OAuth/hierarchy |
| Logistics Executive | 26 | Execution: RN create/edit/post, PB create/edit, PO refresh, reservation create/release, DC create; **no** reverse/void/price |
| user | 14 | Views/search only |
| it_manager | 27 | Technical admin; `asset.edit` (serials); **no** `asset.create` / procurement |
| it_user | 10 | Read + network modules; **no** credential mutation |
| client | 4 | Asset view/search only |
| HR | 4 | `user.manage` + employees module |
| Accounts Executive / Manager | — | **FUTURE** — not created |

See [`RBAC_ROLE_MATRIX.md`](./RBAC_ROLE_MATRIX.md) for ALLOW/DENY/FUTURE per permission.

## 8. User impact (prod BEFORE → scratch AFTER)

| User | Role | Before | After | Lost | Notes |
|------|------|--------|-------|------|-------|
| admin | superuser | 36 | 108 | 0 | Bypass retained; catalog expanded |
| SwapnilM | manager | 23 | 84 | 0 | Logistics actions now explicit ticks |
| nandagopal… | it_manager | 15 | 27 | `asset.create` | Deliberate containment |
| sudhir… | it_manager | 15 | 27 | `asset.create` | Deliberate containment |
| Nadagopal | user | 6 | 14 | 0 | Canonical views only |

No production role/user rows modified. Full diff: `docs/rbac-v2/EFFECTIVE_ACCESS_COMPARISON.md`.

## 9. Route / action coverage

See [`docs/RBAC_ROUTE_COVERAGE.md`](./RBAC_ROUTE_COVERAGE.md).

| Metric | Count |
|--------|-------|
| Mutation routes | 165 |
| With `requirePermission` | 135 |
| authorizeRoles-only | 0 |
| JWT-only | 2 (service portal job-cards/customers) |
| Unauthed | 28 (auth public + OCR/arri/uploads/tally/quotas/dynamic/external — documented gaps) |

Core lifecycle mutations (RN, intake, reservations, sets, products, PO import/refresh, purchase books, DC, inventory, assets, projects, hierarchy, employees, network) now require explicit action keys.

## 10. Frontend authorization changes

- `hasPermission` / `can()` — superuser bypass only; alias dual-resolve
- `APP_VIEW_PERMISSIONS` → canonical `*.view`
- `applyRbacUiRestrictions` — price/users/nav use permissions only
- `canLogistics()` — action permissions only (no role triad)
- `conversions.js`, `asset-view.js`, `dashboard.js`, `contextMenu.js` — role-name gates removed

## 11. Backend authorization changes

- `hasPermission` — superuser-only bypass; `permissionEquivalents`
- Login — permissions from cache only (**no hierarchy injection**)
- Mutation routes — `authorizeRoles` logistics triad replaced with `requirePermission(<action>)`
- Employees / folders / quantity issue|consume|adjust — auth + permissions added

## 12. Admin / superuser behavior

| Role | Frontend | Backend |
|------|----------|---------|
| superuser | Centralized `hasPermission` bypass | Same |
| admin | Stored ticks only | Stored ticks only |

## 13. `manage.hierarchy` fix

- Stored for **admin** and **superuser** in scratch (`2` rows)
- Login injection removed
- Folder/kind create/delete routes require `manage.hierarchy`

## 14. Scratch migration names

1. `20260923120000_rbac_v2_permission_hardening.js`  
2. `20260923140000_rbac_v2_role_authority_model.js`  

Both present in scratch `knex_migrations`.

## 15. Scratch test results

- Policy tests: **PASS** (`scripts/tests/rbac-v2-policy.test.js`)
- Scratch: **108** perms; role grants: superuser 108 / admin 107 / manager 84 / Logistics Executive 26 / …
- Hierarchy: admin+superuser; `category.delete`: **superuser only**
- Logistics Executive has `receipt_note.post`
- Prod still **37** / **138** / hierarchy **0**

## 16. BEFORE vs AFTER (effective)

| Check | Before (prod) | After (scratch Phase 19) |
|-------|---------------|---------------------------|
| Permission keys | 37 | 108 |
| Role grant rows | 138 | ~386 (role-dependent) |
| `manage.hierarchy` | Not stored | admin + superuser |
| `category.delete` | admin historically via triad | **superuser only** |
| Logistics Executive mutations | Blocked by role triad | Explicit execution actions |
| Mutation gate | Role triad | `requirePermission(action)` |
| Admin FE bypass | Yes | No |

## 17. Intentional privilege changes

| Change | Direction | Reason |
|--------|-----------|--------|
| Logistics Executive: RN/PB/PO refresh/reservation/DC create | **GRANT** | Phase 19 execution role (was triad-blocked) |
| Logistics Executive: reverse/void/price/adjust | **DENY** | Not approval/admin |
| admin: `category.delete` | **REVOKE** | Superuser-only destructive admin |
| admin: `role.manage` | **GRANT** | Company admin role mgmt via stored tick |
| manager: hierarchy / user / OAuth / network / settings.edit | **DENY** | Ops manager ≠ system admin |
| it_manager: `asset.create` | **REVOKE** | Lifecycle containment (keep `asset.edit` for serials) |
| it_user: network credential mutation | **REVOKE** | Read/support only |
| Accounts roles | **NOT CREATED** | No Books functionality yet |

## 18. Unresolved authorization gaps

- OCR, Arri/service portal, uploads, tally, quotas, dynamic, external — pre-existing unauthed surfaces
- Legacy `view.*` still in DB
- FUTURE keys (`dc.ready`, `physical_intake.correct`, `books.*`, …) documented only
- HTTP E2E against scratch-bound app process still manual

## 19. Production rollout recommendation

**Do not auto-apply.** When ready:

1. Backup prod `permissions` / `role_permissions`
2. Deploy code (aliases, action `requirePermission`, FE `can()`)
3. Run named migrations **in order** against prod (not blanket `migrate:latest`):  
   - `20260923120000_rbac_v2_permission_hardening.js`  
   - `20260923140000_rbac_v2_role_authority_model.js`
4. Smoke: admin, manager, Logistics Executive (execution), user, it_manager (confirm no asset create / no procurement)
5. Confirm IT managers accept `asset.create` removal (serials use `asset.edit`)
6. Later: remove deprecated `view.*` after zero references

**Production database was not modified by this workstream.**
