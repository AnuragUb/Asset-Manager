# Phase 5 — Legacy Break / Split / Unsplit Cutover Plan

**Status:** PLAN ONLY. No code written. No migration created. No schema applied. No production mutation.  
**Date:** 28 August 2026  
**Scope:** Contain, redirect, and eventually deprecate the pre-Phase-2 Split / Unsplit / quantity-split / project-unassign-delete paths so that `breakService.js` is the only Break engine.  
**Environment audited:** Source on this repository after Phase 1 (Product), Phase 2 (quantity / Break / QR), Phase 3 (reservation), and Phase 4 (conversion). Production database `asset_manager` as last verified in Phase 4 (4 assets, 1 inventory item, 1 `parentid` row). No Break / Split / Unsplit was executed for this plan.

**This document authorizes no implementation.**

---

## Authoritative inputs

- `docs/ASSETENGINE_CANONICAL_ARCHITECTURE.md` (§12–§13, §28–§29, §36 rules 26–30 / 46–49)
- `docs/ARCHITECTURE_GAP_ANALYSIS.md` (GAP-207, GAP-208, GAP-401, GAP-402, GAP-404 stale vs Phase 2, GAP-405)
- `docs/QUANTITY_PHYSICAL_IDENTITY_PHASE2_PLAN.md` (§7 unsplit, B-1 parentid)
- `docs/RESERVATION_PHASE3_PLAN.md` (available-only Break)
- `docs/CONVERSION_PHASE4_PLAN.md` (conversion lineage; inactivate guard)
- `docs/PRODUCT_PHASE1_IMPLEMENTATION_PLAN.md` (`product_id` copy invariant)
- `docs/ASSETENGINE_COMPLETE_ARCHITECTURE_AUDIT.md`
- Live `server.js`, `breakService.js`, `conversionService.js`, `reservationService.js`, `IdGenerator.js`, `dashboard.js`, `projects.js`, `asset-view.js`, `index.html` as of this date

**Fact the gap analysis is stale on:** GAP-404 (“Make Individual does not exist”) is **closed by Phase 2**. `POST /api/break` with `mode=MAKE_INDIVIDUAL` exists. Phase 5 is the remaining **cutover of legacy callers**, not the invention of Break.

**Fact that is not stale:** GAP-207 (hard-delete unsplit / unassign) and GAP-401 (`parentid` overload) are still live.

---

## 1. Executive summary

Phases 1–4 shipped a canonical Break engine **alongside** the old Split engine. Operators can now do the same physical job two incompatible ways:

| | Canonical (Phase 2) | Legacy (pre-Phase 2) |
|---|---|---|
| Routes | `POST /api/break`, `POST /api/break/inactivate`, `GET /api/break/tree/...` | `POST /api/assets/split`, `POST /api/quantity/split`, `POST /api/assets/unsplit`, `DELETE /api/projects/:id/unassign-asset/:assetId` |
| Auth | JWT + `superuser`/`admin`/`manager` | Split and quantity-split: **none**. Unsplit and unassign: JWT |
| Lineage | `quantity_parent_id` / `quantity_root_id`. **`parentid` is not written** | Split writes **`parentid` only**. Quantity-split writes **both**. Unsplit **reads `parentid`** |
| Identity | `generateModernAssetId` | Split: modern ID. Quantity-split / issue / consume: `generateSplitAssetId` → `{parent}-NaN` |
| QR | Always generated | Quantity split: `qrcode: null` |
| Product | Copied | Split: **not copied**. Quantity-split: **not copied** |
| Reservation | Available only; inactivate blocked if ACTIVE reservation | No reservation API. Quantity split happens to use `quantity_available` (partial accident). Serial split **overwrites totals from serial count** |
| Conversion | Inactivate blocked if unreturned conversion | Unsplit / unassign **hard-delete** the row, destroying conversion lineage |
| Merge | Inactivate: child **kept**, `lineage_status=INACTIVE` | Unsplit / unassign: child **hard-deleted** |

The goal of Phase 5 is **not** to delete legacy code on day one. It is:

```
CURRENT LEGACY PATHS
        ↓  CONTAIN (refuse destruction of canonical / protected rows)
        ↓  REDIRECT UI (quantity Break → breakService)
        ↓  SHIM remaining quantity Split (optional, after UI)
        ↓  REPLACE destructive Unsplit/Unassign with Inactivate / unassign-only
        ↓  DEPRECATE
        ↓  REMOVE only after production proof
```

**Recommended strategy (not A-only, not B-only):**

- **Contain first**, without waiting for a feature flag, because dual UI is already live and Unsplit of the one production `parentid` row would be catastrophic.
- **Quantity-mode `/api/assets/split`** eventually becomes a **thin shim** around `breakService` (option A) *after* UI no longer calls it.
- **Serial-mode `/api/assets/split`** is **not Break**. Do not shove serial-blob extraction into `breakService`. Contain it; leave serial redesign out of Phase 5.
- **`/api/quantity/split`** is unused and already broken. **Disable / retire** (option B) once caller search remains empty. Do not independently “fix” `-NaN` IDs or the missing `await`.
- **Unsplit / project-unassign hard-delete** is the most dangerous behaviour. Replace with **inactivate** for canonical Break children, and **never delete** the classified LEGACY `parentid` row.

**No automatic `parentid` data migration.** Classify the one production row; freeze it; do not guess.

---

## 2. Current legacy route inventory

Evidence is from live `server.js` line numbers as of 28 August 2026.

### 2.1 `POST /api/assets/split` — `server.js:11673`

| Attribute | Current |
|---|---|
| Auth | **None** |
| Roles | None |
| Callers | `dashboard.js` (edit-modal serial split, split-assign employee, split-assign project, qty split); `projects.js` (Split & Assign) |
| Input | `{ parentId, serials?, quantity?, autoAssign?, projectId? }` |
| Output | `{ success, count, assets }` |
| Quantity | If `quantity` and no serials: decrement parent `quantity_total` and `quantity_available` by requested qty; create or **merge into** an existing `parentid` child on the same project / assignee. Else serial path: set parent totals to **remaining serial count** (ignores reserved / converted) |
| Identity | `generateModernAssetId` for new children |
| QR | **`qrcode: null`** on both quantity and serial children |
| Product | **`product_id` not copied** |
| Lineage | **`parentid = parentId` only.** No `quantity_parent_id` / `quantity_root_id` |
| History | `asset_history`: `SPLIT_CHILD_CREATED`, `QUANTITY_REDUCED`, `QUANTITY_INCREASED` (merge), `SPLIT_PARENT_UPDATED` |
| Reservation | No `reservation` table read. Quantity path uses `quantity_available` (Phase 3 already reduced available by reserved). Serial path can desync reserved vs total |
| Conversion | No conversion columns written or checked. Can split a converted Asset as if it were a native batch |
| Sets | Merge lookup is `assets.parentid` + `project_assets`. Can merge into a Set member if that member has `parentid` |
| Projects | Optional insert into `project_assets`; sets status `Project`, `assignedto`, `client_label` |
| Failure | 400 missing ids; 404 parent; 500 invalid qty / serials not in blob |
| Destructive | Parent qty reduced. Merge mutates existing child. Serials rewritten on parent. **Does not delete** |
| Production usage | No live split-children observed in the Phase 4 four-asset production set. Route is still reachable unauthenticated |

### 2.2 `POST /api/quantity/split` — `server.js:6855`

| Attribute | Current |
|---|---|
| Auth | **None** |
| Callers | **None in frontend** (repo search: backend only) |
| Input | `{ parentId, amount, note?, child? }` |
| Output | `{ success, childId }` |
| Defects | (1) `const parent = getQuantityAsset(parentId)` **missing `await`** — parent is a Promise; typical result is 400 “Parent is not a quantity asset”. (2) `generateSplitAssetId(parentId)` with no index → ID `{parentId}-NaN`. (3) Child inserted with `quantity_total: 0` / `quantity_available: 0`; actual qty applied later via `applyQuantityEvent` |
| Lineage | Writes **both** `parentid` and `quantity_parent_id` / `quantity_root_id` |
| QR | Generated unless `NoQR`; uses `PORT \|\| 9090` (wrong public host on 8080) |
| Product | Not copied |
| Reservation | Unaware |
| Verdict | Effectively dead + unsafe if repaired. **Retire, do not fix.** |

### 2.3 `POST /api/assets/unsplit` — `server.js:11966`

| Attribute | Current |
|---|---|
| Auth | JWT (any logged-in role — **not** role-gated like Break) |
| Callers | `dashboard.js` (`btnUnsplitBatch`); `asset-view.js` (`btnUnsplitAssetView`); `projects.js` (`handleUnsplit`) |
| Input | `{ childIds[] }` or `{ assetId }` plus optional `parentId` |
| Parent lookup | `providedParentId \|\| child.parentid` — **does not read `quantity_parent_id`** |
| Quantity parent | If parent `is_batch` or `is_quantity_tracked`: restore parent total+available from child total (or 1); **hard-DELETE** child from `assets` and `components`; DELETE `project_assets` for the child |
| Set parent | Else: clear `parentid`, status `In Store`, location hardcoded `Mumbai`, `assignedto` null. Child **kept**. History `BREAK_SET` |
| QR / Product / conversion / reservation | None checked. Delete destroys QR, Product link, conversion lineage, reservations pointing at the child (FK RESTRICT may 500 — GAP-208) |
| Production usage | UI shows Unsplit whenever `parentid` is set — including the one production row `APP-MUM-0526-MMKBX9-W` |

### 2.4 `DELETE /api/projects/:id/unassign-asset/:assetId` — `server.js:8877`

| Attribute | Current |
|---|---|
| Auth | JWT |
| Callers | `dashboard.js` `unassignAsset`, sale-flow unassign; `projects.js` unassign |
| Quantity/`parentid` child of batch parent | Restore qty to parent; **hard-DELETE child**; return `isSplitChild: true` (frontend skips inspection modal) |
| Set-component `parentid` | Preserve identity; status `Under Inspection` |
| Canonical Break child (`parentid` null) | Treated as a normal project asset: **not deleted**, moved to Under Inspection. Qty is **not** restored to Break parent |
| Temporary assets | Soft-delete temp row; converted-permanent → Under Inspection |

### 2.5 Adjacent paths that are not the Break engine (must not be “fixed into Break”)

| Path | File | Why it is in this audit |
|---|---|---|
| `POST /api/quantity/issue` | `server.js:7266` | Unauthenticated. Uses `generateSplitAssetId` (`-NaN`). Writes `parentid` + quantity lineage. Not a UI Break |
| `POST /api/quantity/consume` | `server.js:7398` | Same ID generator. Creates a consumed child. Not conversion, not Break |
| `POST /api/assets/make-set` batch segment | `server.js:7015-7047` | Creates `{parent}-{timestamp}` “Set Head”, writes `quantity_parent_id` **and** `is_set=1`, decrements parent qty. Hybrid Set+Break |
| `POST /api/assets/break-set` | `server.js:7183` | JWT. Set membership, may `promoteToAsset`. **Not** quantity Break. Must stay out of `breakService` |
| Dashboard unit conversion | `index.html` `btnApplyConversion` | Renames unit. Unrelated |

### 2.6 `generateSplitAssetId`

```41:43:web-app/asset-manager-backend/IdGenerator.js
    static generateSplitAssetId(parentId, index) {
        return `${parentId}-${index + 1}`;
    }
```

Callers pass **one argument**. `index` is `undefined`. Result: `HAR-MUM-…-NaN`. Used by quantity-split, quantity-issue, quantity-consume. Canonical Break does **not** call this.

### 2.7 Dashboard / UI action → route map (do not change UI in this task)

| UI label | Where | Backend |
|---|---|---|
| **Break** | Asset modal + Inventory modal (`setupBreakLineageUI`) | `POST /api/break` JWT |
| **Make Individual** | Same | `POST /api/break` `MAKE_INDIVIDUAL` |
| **Inactivate** (child row) | Break children list | `POST /api/break/inactivate` JWT |
| **Split Selected S/N** | Asset edit batch list | `POST /api/assets/split` **no JWT** |
| Quick split & assign employee | Same | `/api/assets/split` + `autoAssign` |
| Split & assign project | Same + `projects.js` | `/api/assets/split` + `projectId` |
| Quantity split & assign | `projects.js` bulk split modal | `/api/assets/split` + `quantity` |
| **Unsplit: Merge to Parent** | Asset edit, asset-view, project workspace | `POST /api/assets/unsplit` JWT |
| **Unassign** (project) | Project workspace / dashboard | `DELETE /api/projects/:id/unassign-asset/:assetId` JWT |
| **Break from Set** | `asset-view.js` | `/api/assets/break-set` (Set, not Break) |
| Restore | Recovery Center | Soft-delete restore — not unsplit |
| Remove | Various deletes | Soft-delete except unsplit/unassign |

**Cutover vocabulary (eventual, not now):** BREAK, MAKE INDIVIDUAL, INACTIVATE. Stop using Split/Unsplit for quantity granularity. Keep “Break from Set” as a Set word.

---

## 3. Current destructive behaviours

Ranked by harm:

1. **`POST /api/assets/unsplit` hard-delete** of any child whose parent is quantity-tracked / batch — including, if an operator clicks Unsplit on `APP-MUM-0526-MMKBX9-W`, **deleting the production MacBook** and adding its quantity onto `HAR-MUM-0726-55QOFA-R` (HAR is quantity-tracked). History rows for APP become orphans. GAP-207.
2. **`DELETE …/unassign-asset` hard-delete** of `parentid` children of quantity parents. Same delete semantics, triggered by a routine “Unassign from project” click.
3. **Serial `/api/assets/split`** rewriting parent `srno` and forcing `quantity_total = remaining serial count`, which can desync `quantity_reserved` / `quantity_converted`.
4. **Quantity `/api/assets/split`** creating `qrcode: null` children without `product_id` or Break lineage, then **merging** later splits into that child (hides identity).
5. **Unauthenticated split** — any network client can create incompatible lineage.
6. **`generateSplitAssetId` `-NaN`** on quantity-split / issue / consume if those routes are ever repaired or awaited.

Canonical Break / inactivate does **not** hard-delete.

---

## 4. Parentid classification problem

### 4.1 Two graphs (do not collapse)

| Graph | Columns | Meaning | Phase 5 rule |
|---|---|---|---|
| **NEW BREAK LINEAGE** | `quantity_parent_id`, `quantity_root_id`, `lineage_status` | Intra-domain granularity. Written only by `breakService` (and Phase 4 copies conversion lineage separately) | Source of truth for Break / Inactivate |
| **LEGACY RELATIONSHIP** | `parentid` | May be Set membership, sub-assembly, **or** old split | Never globally reinterpreted. Never auto-migrated onto `quantity_parent_id` |

`is_set` / `is_batch` are **hints**, not a discriminator. `updateAssetStatus` still walks `parentid` as if it were a Set tree (GAP-401).

### 4.2 How the application must decide (classification procedure)

For **each** asset (and inventory item) with any of `parentid`, `quantity_parent_id`, `is_set`, `is_batch`:

```
IF quantity_parent_id IS NOT NULL
   AND id matches generateModernAssetId
   AND parentid IS NULL
   → BREAK (canonical). Inactivate only via /api/break/inactivate.

IF quantity_parent_id IS NOT NULL
   AND parentid IS NOT NULL
   → AMBIGUOUS (quantity-split / make-set segment / issue). Escalate. Do not auto-fix.

IF parentid IS NOT NULL
   AND quantity_parent_id IS NULL
   AND parent.is_set = 1
   → SET-LIKE. Unsplit/break-set may clear parentid; never treat as Break.

IF parentid IS NOT NULL
   AND quantity_parent_id IS NULL
   AND parent.is_quantity_tracked = 1
   AND child created by /api/assets/split (history SPLIT_CHILD_CREATED, qrcode null, no product_id)
   → BREAK-LIKE (legacy split). Contain: do not hard-delete; optional later move onto quantity_* only with owner sign-off per row.

IF parentid IS NOT NULL
   AND quantity_parent_id IS NULL
   AND child is a distinct commercial/physical identity (different type/name/product, own history)
   → SUBASSEMBLY or LEGACY. Freeze. Never Break-inactivate. Never add quantity to parent.

IF none of the above is unique
   → AMBIGUOUS. Escalate. Do not guess.
```

### 4.3 The one production row (must be protected)

| ID | `parentid` | `quantity_parent_id` | `is_set` | Notes |
|---|---|---|---|---|
| `APP-MUM-0526-MMKBX9-W` | `HAR-MUM-0726-55QOFA-R` | null | 0 | Distinct MacBook vs Trimble HAR. **Not** a Break child. **Not** a managed-set component of HAR as `is_set` (HAR is not `is_set`; `HAR-MUM-0826-IEIZP5-U` is the `is_set=1` row) |

**Classification recommendation (not a migration):** **LEGACY / SUBASSEMBLY**. Do **not** copy `parentid` onto `quantity_parent_id`. Do **not** allow Unsplit CASE 1 (quantity merge-delete) against this pair.

Until that refuse-rule is implemented, the Unsplit button on APP is a production foot-gun.

`HAR-MUM-0826-IEIZP5-U` (`is_set=1`) has no `parentid` children in the four-row production set.

### 4.4 Inventory `parentid`

Inventory Break uses `quantity_parent_id` only. Inventory `parentid` remains a folder/set leftover. Phase 5 must not invent Inventory unsplit. There is no `/api/quantity/unsplit`.

---

## 5. New Break engine capabilities

`services/breakService.js` — **the only future Break source of truth.**

| Capability | Status after Phase 4 |
|---|---|
| Asset → Asset, Inventory → Inventory | Yes |
| Parent remains; child new modern ID + QR | Yes |
| `product_id` copied | Yes |
| `quantity_parent_id` / `quantity_root_id`; **`parentid` null** | Yes |
| Recursive; child qty ≤ parent available | Yes |
| Reserved qty cannot be broken (uses available) | Yes |
| Converted Assets: children copy conversion lineage | Yes |
| Inactivate: non-destructive, reservation + conversion guards | Yes |
| Inactivate: only if `quantity_parent_id` set | Yes — **will not see parentid-only split children** |
| Inactivate: project / assignedto / DC eligibility | **Gap** — not checked |
| Inactivate: managed-set membership | **Gap** — no explicit Set guard (hard-delete would FK-fail; inactivate does not delete) |
| Serial-blob extraction | **Not in scope** — correctly absent |
| Merge of two independent Assets | **Not in scope** — inactivate restores **to Break parent only** |

**Is inactivate sufficient to replace all destructive unsplit?** **No, not alone.** Gaps:

1. Legacy split children have no `quantity_parent_id` → inactivate returns 400 “Only Break children can be inactivated”.
2. Unsplit Set path is Set membership, not Break — must remain `break-set` / clear `parentid`, not inactivate.
3. Inactivate does not unlink `project_assets` or clear `assignedto`.
4. Inactivate restores **child `quantity_total`** to parent; a serial split child with `is_quantity_tracked=0` and implied qty 1 is a different record shape.
5. Protected LEGACY row must never be inactivated *or* deleted.

Inactivate **is** sufficient for **canonical Break children** created after Phase 2. That is the replacement for quantity Unsplit **once no new parentid-only children are created**.

---

## 6. Legacy Split strategy (`/api/assets/split`)

Treat as **LEGACY**. Do not remove immediately.

**Safest sequence:**

1. **Contain** (implementation later): reject if parent has ACTIVE reservation that the request would violate; reject if `lineage_status=INACTIVE`; reject converted Assets that should use Break then return, not serial/qty split-assign; **always copy `product_id` if shimmed**; stop writing new `qrcode: null` from UI.
2. **UI cutover for quantity granularity:** dashboard/projects quantity split → `POST /api/break` (already exists). Serial split-assign stays on this route until a serial phase exists.
3. **Quantity-mode route → thin shim** around `breakService.breakQuantity` (option A) *after* UI no longer needs merge-into-existing-project-child. Shim must **not** write `parentid`. Project assign after Break is a **separate** existing assign call — do not hide assign inside Break.
4. **Serial-mode:** option C — remain, feature-restricted, not a Break shim. Adding QR + `product_id` is a containment patch, not a serial redesign.
5. **Disable quantity-mode** on this route once shim + UI proven (or leave shim indefinitely as compatibility).
6. **Remove** only after production has zero new `parentid`-only split children for a defined window and scratch proof.

**Do not** implement merge-into-existing-child in `breakService`. That is project-assignment convenience, not Break.

---

## 7. Legacy Quantity Split strategy (`/api/quantity/split`)

Unused by frontend. Missing `await`. `-NaN` IDs. Inconsistent with primary UI.

**Action: DISABLE then REMOVE.** Do not independently fix defects. Confirm with a repo + access-log search that no external caller exists (likely none). Return **410/503 `LEGACY_QUANTITY_SPLIT_DISABLED`** in the disable step. Rollback = restore the route (it already fails closed for most inputs).

`/api/quantity/issue` and `/api/quantity/consume` share the ID generator; they are **out of Phase 5 Break cutover** except: do not start using `generateSplitAssetId` in new code; document them as adjacent hazards for a later containment slice.

---

## 8. Unsplit strategy

Canonical: Break is non-destructive. Replacement:

```
INACTIVATE CHILD
  → restore parent accounting
  → preserve child row, history, QR, lineage, Product, conversion columns
```

**Target behaviour of `/api/assets/unsplit` (future, not now):**

| Child class | Future action |
|---|---|
| Canonical Break (`quantity_parent_id` set, `parentid` null) | Delegate to `breakService.inactivateChild`. Stop deleting |
| Legacy BREAK-LIKE (`parentid` set, split history, quantity parent) | **Refuse hard-delete.** Either: (containment) 409 `USE_INACTIVATE` / `LEGACY_UNSPLIT_DISABLED`, or a later one-way per-row promote onto `quantity_parent_id` then inactivate. No automatic promote |
| SET-LIKE | Keep non-delete path (clear `parentid`) — this is Set, not Break. Prefer `/api/assets/break-set` long-term |
| LEGACY / SUBASSEMBLY (APP→HAR) | **409 `PROTECTED_LEGACY_RELATIONSHIP`**. Never merge qty. Never delete |
| AMBIGUOUS | 409 escalate |

**Do not** implement the replacement in this planning task.

---

## 9. Project-unassign strategy

A Project unassignment must **not** silently destroy a physical child.

**Target:**

1. Always remove `project_assets` (and temp rows as today).
2. **Never** `DELETE FROM assets`.
3. If the asset is a canonical Break child still representing qty, leave the Asset in store / Under Inspection **without** restoring qty to the Break parent (unassign ≠ inactivate). Operator inactivates separately if they meant merge-back.
4. If the asset is a **legacy split child created specifically to park qty on a project**, containment: unassign + 409 or unassign-only leaving an orphaned `parentid` child — **owner must choose**. Recommended default: **unassign-only, no delete, no auto-merge**, because auto-merge is what destroys identity today.
5. `isSplitChild` frontend flag must stop meaning “row was deleted”.

Do not redesign Projects.

---

## 10. Reservation safety

Canonical Break is reservation-aware (available only; inactivate blocked).

Legacy quantity split uses `quantity_available`, so it **usually cannot consume reserved qty** after Phase 3. That is an accident, not a guarantee:

- Mixed `quantity_available` vs `QuantityAvailable` after `normalizeResult` could read 0 or the wrong field.
- Serial split **does not consult reserved**.
- Unsplit/unassign delete a reserved child → reservation FK RESTRICT (409/500) or orphaned reservation if ON DELETE is not RESTRICT on `resource_id` (reservations are not FK’d to assets — **ledger can point at a deleted ID**).

**Containment (future):**

- Split: if `quantity_reserved > 0`, only allow qty ≤ available; serial split **409 `RESERVED_QUANTITY_NOT_SPLITTABLE`** until serial phase.
- Unsplit/unassign: `reservationService.assertNoActiveReservations` before any qty restore; **never delete** a reserved resource.
- Do not duplicate reservation math inside split. Call `reservationService`.

Do not redesign Reservation.

---

## 11. Conversion safety

Phase 4 Assets have `conversion_source_id` / `conversion_id`. Unsplit delete would:

- Remove the Asset while `conversion` ACTIVE still accounts `quantity_converted` on Inventory → **ledger mismatch**.
- Destroy QR and identity the return path needs.

`breakService.inactivateChild` already calls `conversionService.assertNoUnreturnedConversions`.

**Containment (future):** unsplit and unassign must refuse (`UNRETURNED_CONVERSION` / `CONVERSION_LINEAGE_PROTECTED`) if `conversion_id` or `conversion_source_id` is set, **or** if `quantity_converted > 0`. Operators return via conversion, or inactivate only after conversion remainder is 0.

Do not allow legacy deletion to destroy conversion history. Do not modify conversionService in this plan’s implementation slice beyond **calling** the existing guard from legacy routes (when implementation is approved).

---

## 12. Product propagation

| Path | Copies `product_id`? |
|---|---|
| `breakService` child insert | **Yes** |
| `/api/assets/split` quantity child | **No** (`childRecord` at `server.js:11806-11839`) |
| `/api/assets/split` serial child | **No** (`server.js:11903-11933`) |
| `/api/quantity/split` | **No** |
| `/api/quantity/issue` / `consume` | **No** |
| `make-set` segment | **No** |

Every “No” is a Phase 5 identification item. Implementation later: shim/containment copies `product_id`. Do not modify Product entity or Zoho.

---

## 13. QR safety

| Path | QR |
|---|---|
| Canonical Break | `qrcode.toDataURL` public asset/inventory URL |
| `/api/assets/split` | **`qrcode: null`** |
| `/api/quantity/split` | Generated, but host uses port **9090** fallback |

Cutover must stop the **UI** from creating new non-QR quantity children. Serial split containment should generate QR the same way Break does (host from request), without becoming a QR-architecture project.

Do not redesign QR.

---

## 14. Serial safety

Do **not** redesign serials. Do **not** parse production serial blobs as a Break feature.

| Path | Serial behaviour |
|---|---|
| Break | `srno: ''` on Asset children; Inventory `srno` not copied (Phase 2/4 rule) |
| Split serial mode | Decrypts parent blob, removes selected S/Ns, encrypts remainder onto parent, encrypts each child S/N |
| Split quantity mode | Copies **parent `srno` wholesale** onto the child (`srno: parent.SrNo`) — can duplicate ciphertext |
| Unsplit delete | Child serial gone; parent blob not restored |

Future Break must not duplicate that blob logic. Serial split stays a contained legacy operation.

---

## 15. Set safety

Do not implement Sets in Phase 5.

- Do not treat every `parentid` as quantity lineage.
- `make-set` / `break-set` / `kitSetService` stay. Unsplit CASE 2 (clear `parentid`) is Set-shaped; moving it to `break-set` is a later tidy, not Break cutover.
- Managed Set `ON DELETE RESTRICT` (GAP-208) is a backstop against hard-delete, not a design. Containment should 409 before hitting Postgres.
- Canonical Break children have `parentid` null — they will not appear in `kitSetService` legacy `WHERE parentid = ?` membership. That is correct.

---

## 16. Project safety

Do not redesign Projects.

- Split-assign to project is a **composition of Break (or legacy split) + `project_assets` insert**. After cutover, UI should Break first, then assign the child ID.
- Unassign must not delete (see §9).
- Canonical Break child on a project: unassign → inspection/store; physical qty stays on the child until inactivate or conversion return.

---

## 17. Data classification / migration strategy

**Do not automatically migrate `parentid`.**

### Capture before any future cutover (scratch + production read-only)

Asset/Inventory IDs; `parentid`; `quantity_parent_id`; `quantity_root_id`; `lineage_status`; quantities including reserved/converted; `product_id`; QR presence; `is_set`; `is_batch`; `is_quantity_tracked`; `assignedto`; `sentagainstdc`; `asset_history` counts + max timestamp; `quantity_events` / `inventory_quantity_events` counts; `reservation` counts; `conversion` counts; `managed_sets` / components; `project_assets` for production IDs.

### Classification buckets

`LEGACY` | `BREAK-LIKE` | `SET-LIKE` | `SUBASSEMBLY` | `AMBIGUOUS`

Production today (four assets): APP→HAR is **SUBASSEMBLY/LEGACY**. No canonical Break children. No conversion rows. Classify formally in the implementation phase with a read-only script; **escalate anything that is not unique**.

Historical orphans: `asset_history.assetid` pointing at IDs no longer in `assets` (from past unsplit). **Do not auto-reconstruct rows.** Report counts; leave orphans queryable.

---

## 18. UI cutover strategy

Do **not** change UI in this task. Eventual points:

| Stage | UI |
|---|---|
| Today | Break/Make Individual/Inactivate **and** Split/Unsplit both visible on the Asset modal |
| After containment | Unsplit on protected LEGACY rows hidden or confirm-blocked **by API 409** even if button remains |
| Quantity cutover | Hide or relabel quantity Split & Assign to “Break then assign”; wire to `/api/break` |
| Serial | Keep Split Selected S/N until serial phase; still unauthenticated today — wrap fetch with JWT when route is contained |
| Unsplit | For Break children, button becomes “Inactivate / restore to parent” → `/api/break/inactivate`. For `parentid` Set members, “Remove from Set” → `break-set` |
| Vocabulary | BREAK, MAKE INDIVIDUAL, INACTIVATE. Retire “Unsplit: Merge to Parent” for quantity |

Inventory already has Break only (no Split). Keep it that way.

---

## 19. API cutover strategy

| Path | Keep / Shim / Deprecate / Disable / Remove |
|---|---|
| `/api/break*` | **KEEP** — canonical |
| `/api/assets/split` quantity mode | **CONTAIN** → **SHIM** to `breakService` → **DEPRECATE** merge behaviour |
| `/api/assets/split` serial mode | **KEEP** contained until serial phase |
| `/api/quantity/split` | **DISABLE** then **REMOVE** |
| `/api/assets/unsplit` | **CONTAIN** (no delete) → quantity children **SHIM** to inactivate → Set path **DEPRECATE** toward `break-set` |
| project unassign | **KEEP** route; **REMOVE** delete branch |
| `generateSplitAssetId` | **DEPRECATE**; stop new callers; remove with quantity-split/issue/consume cleanup |
| `parentid` column | **KEEP** forever in Phase 5; no rename |

Rollback of API shim: route body restored to previous function; Break UI still works independently.

---

## 20. Authorization

Canonical Break is JWT + operational roles.

| Route | Today | Phase 5 recommendation |
|---|---|---|
| `/api/break*` | JWT + roles | Unchanged |
| `/api/assets/split` | **Open** | Do **not** “blindly” auth as a drive-by. When UI cutover sends JWT (dashboard already can), add `authenticateJWT` + same roles as Break **on this route only**, because it mutates holdings. Until then, containment rejects are still required (unauthenticated attackers exist) |
| `/api/quantity/split` | Open | Disable entirely — auth wrapping a broken unused route is wasted work |
| `/api/assets/unsplit` | JWT, **any role** | Align to Break roles (`superuser`/`admin`/`manager`) when shimming to inactivate |
| project unassign | JWT | Keep project JWT; delete branch removed |

Do not authenticate `/api/dc`, `make-permanent`, or unrelated open routes as a Phase 5 side effect.

---

## 21. Feature flag decision

**Yes, for UI/API *exposure* of legacy quantity Split — not for safety containment.**

| Flag (proposed name only) | Scope | Default | Rollback |
|---|---|---|---|
| `LEGACY_QUANTITY_SPLIT_UI` | Dashboard/projects quantity split buttons still POST `/api/assets/split` | `true` until UI points at Break | Set `true` |
| `LEGACY_UNSPLIT_HARD_DELETE` | Allow unsplit/unassign DELETE of quantity `parentid` children | **`false` as soon as containment ships** | Set `true` only as emergency compatibility, never default |

**Safety containment (refuse delete of APP, canonical Break children, conversions, reservations) must not default to “allow delete”.** A flag that can re-enable hard-delete is a rollback tool, not a launch default.

Do not implement flags in this planning task.

---

## 22. History preservation

- Canonical Break: `quantity_events` / `inventory_quantity_events` types `BREAK` / `BREAK_INACTIVATE` plus `asset_history`.
- Legacy: `SPLIT_*`, `QUANTITY_REDUCED`, `SPLIT_CHILD_RESTORED`, `BREAK_SET`.
- After hard-delete, `asset_history.assetid` can reference missing assets. **Leave those rows.** Do not auto-insert ghost assets.
- Inactivate must remain the merge write; do not add a second `SPLIT_CHILD_RESTORED` that implies deletion.

---

## 23. Compatibility matrix

See also §31 decision matrix.

| Legacy path | KEEP | SHIM | DEPRECATE | DISABLE | REMOVE | When | Why | Replaces | Rollback |
|---|---|---|---|---|---|---|---|---|---|
| Break API | ✓ | | | | | Now | Canonical | — | Revert service |
| Split quantity | | later | after shim | | last | After UI | Dual lineage | `POST /api/break` | Un-shim route |
| Split serial | ✓ contained | no | serial phase | | unknown | After QR/product patch | Not Break | Serial phase | Revert patch |
| quantity/split | | | | first | after proof unused | Immediate next impl | Dead+NaN | `/api/break` | Re-enable route |
| Unsplit delete | | inactivate | | delete branch | last | After inactivate proven | GAP-207 | `/api/break/inactivate` | Flag re-enable delete (emergency only) |
| Unassign delete | | | | delete branch | | With unsplit contain | Same | Unassign-only | Flag |
| generateSplitAssetId | | | ✓ | | with qty-split | After unused | `-NaN` | `generateModernAssetId` | Restore helper |
| parentid | ✓ | never migrate globally | | | never in P5 | — | GAP-401 | quantity_* for Break only | — |

---

## 24. Implementation phases (future; not this task)

**Stage 0 — Containment (highest value, smallest behaviour change for happy path)**  
Refuse hard-delete and refuse Unsplit-merge for: protected production pair APP/HAR; any `quantity_parent_id` child; any conversion-sourced Asset; any ACTIVE reservation. Disable `/api/quantity/split`. No UI redesign.

**Stage 1 — UI quantity → Break**  
Projects/dashboard quantity Split & Assign calls `/api/break` then existing assign. Legacy split remains for serial.

**Stage 2 — Legacy quantity split unused by UI**  
Optional shim of quantity-mode `/api/assets/split` to `breakService` (no `parentid`, with QR + product).

**Stage 3 — Unsplit no longer deletes**  
Quantity/`quantity_parent_id` → inactivate. Set `parentid` → keep clear-parentid. LEGACY pair → 409.

**Stage 4 — Unassign never deletes**

**Stage 5 — Proof then remove**  
Scratch + production baselines; no new `parentid`-only split children; then delete dead code (`quantity/split`, delete branches).

Do not skip Stage 0.

---

## 25. Test strategy

Scratch first, restored from production dump. Refuse `--run-*-tests` against `asset_manager`. Disposable IDs only.

Must include:

1. Canonical Break creates `quantity_parent_id` / `quantity_root_id`, `parentid` null, QR, `product_id`.
2. After UI cutover, quantity Split no longer creates `parentid`-only children.
3. Compatibility: quantity-mode shim (if built) matches Break conservation.
4. Inactivate restores parent available/total; child INACTIVE, QR kept, row queryable.
5. Unsplit **cannot** delete canonical Break children (409 or inactivate).
6. Project unassign **cannot** delete canonical Break children.
7. Reserved qty cannot be split/broken; unsplit/unassign of reserved child 409.
8. Converted Asset cannot be destroyed by unsplit/unassign.
9. Product ID preserved on new Break (and on shim).
10. New children have QR; Inventory QR unchanged.
11. `APP-MUM-0526-MMKBX9-W.parentid` unchanged by all tests.
12. `quantity_parent_id` correct on Break trees.
13. `quantity_root_id` correct recursively.
14. Recursive Break + inactivate conservation.
15. History not hard-deleted; orphan report only.
16. `managed_sets` / `is_set` production row unchanged.
17. Production `project_assets` for HAR/APP unchanged.
18. Concurrent Break (Phase 2 pattern).
19. Break is not idempotent by (parent, qty); two clicks = two children if available allows — document; UI confirm remains.
20. Unauthenticated `/api/break` 401; after containment, unauthenticated quantity split either 401 or still open but rejected on protected resources — **test the chosen containment**.
21. Role `user` cannot Break; Unsplit role alignment when implemented.
22. Phase 1 Product verify green.
23. Phase 2 Break tests green.
24. Phase 3 reservation tests green.
25. Phase 4 conversion tests green.
26. Data-safety baseline: IDs, parentid, quantities, Product, QR, history counts, reservations, conversions, Sets, Projects.

Also: Unsplit of APP must 409 (once Stage 0 exists). Serial split still functions until serial phase (compatibility).

---

## 26. Rollback

| Layer | First rollback | Not first |
|---|---|---|
| UI cutover | Point buttons back at `/api/assets/split`; Break UI can stay | DB restore |
| API shim | Restore previous handler in `server.js` | DB restore |
| Feature flag | `LEGACY_QUANTITY_SPLIT_UI=true` | — |
| Unsplit inactivate | Route calls old function **only if** Stage 0 refuse-delete remains for protected rows | Re-enabling hard-delete |
| Disable quantity/split | Re-register route | — |
| Stage 0 containment | Revert refuse rules (emergency). Protected APP/HAR refuse should be last to revert | `pg_dump` restore if a delete already happened |

**Do not recommend database restore as the normal first rollback.** Prefer reversible application rollback. If a hard-delete already executed against production, restore from dump is the only identity recovery — that is why Stage 0 exists.

---

## 27. Exact files that would change (future implementation)

| File | Why |
|---|---|
| `server.js` | Contain/shim/disable split, unsplit, unassign, quantity/split |
| `services/breakService.js` | Possible inactivate eligibility gaps (project/assignment) — surgical |
| `js/dashboard.js` | Quantity split/unsplit cutover |
| `js/projects.js` | Split & Assign / handleUnsplit |
| `js/asset-view.js` | Unsplit button |
| `index.html` | Labels only if vocabulary cutover |
| Verify script `scripts/phase5-break-cutover-verify.js` | Scratch tests |
| This plan | Status update when implementation is approved |

Optional later: `IdGenerator.js` deprecate `generateSplitAssetId`.

---

## 28. Exact files that must NOT change (Phase 5)

- `zohoService.js`, OAuth, `zoho_catalog`
- Product create/sync; `product` table
- `conversionService.js` engine (call guards only)
- `reservationService.js` engine (call guards only)
- `kitSetService.js` / managed-set schema (except not deleting components)
- DC routes, PO, Receipt Note
- `promoteToAsset`, `make-permanent`
- Unit-conversion UI
- Production compose / ports
- Global rename or drop of `parentid`

---

## 29. Blockers

| # | Blocker | Why it blocks implementation |
|---|---|---|
| B-1 | Dual UI already live | Operators can Split (incompatible) or Break (canonical) **today** |
| B-2 | Unsplit of APP→HAR | Quantity-parent merge-delete would destroy the MacBook. Stage 0 must ship before encouraging more Unsplit use |
| B-3 | `parentid` has no discriminator | Cannot migrate; can only classify |
| B-4 | Serial split ≠ Break | Shim-everything-to-breakService is wrong |
| B-5 | Inactivate does not cover `parentid`-only children | Unsplit cannot be a one-line delegate yet |
| B-6 | Unauthenticated split | Containment must not assume “logged-in UI” |
| B-7 | Abandoned knex `20260824120000` | Still unsafe to `migrate:latest` (no Phase 5 schema should be required; if a flag table is proposed, named `migrate:up` only) |
| B-8 | `make-set` hybrid segment | Out of scope but still writes mixed lineage; do not “fix Sets” inside Phase 5 |

**Phase 5 should not need a schema migration** if containment is application-level. That is preferred.

---

## 30. Open decisions

| # | Decision | Default recommendation | Blocks |
|---|---|---|---|
| **P5-1** | Quantity-mode `/api/assets/split`: shim vs disable after UI cutover | Shim briefly, then disable merge-into-child | Stage 2 |
| **P5-2** | Serial-mode split: contain in Phase 5 or freeze until serial phase | Contain QR + product + reservation reject; no blob redesign | Stage 1 UI completeness |
| **P5-3** | Unassign of legacy split child: unassign-only vs inactivate | **Unassign-only, never delete, never auto-merge** | Stage 4 |
| **P5-4** | Unsplit Set path: leave on `/api/assets/unsplit` CASE 2 vs force `break-set` | Leave CASE 2 until Set phase | Not a Break blocker |
| **P5-5** | Formal classification of APP→HAR | **SUBASSEMBLY / LEGACY**, freeze | Stage 0 wording |
| **P5-6** | Auth-wrap `/api/assets/split` in the same PR as Stage 0 | Yes if UI already can send JWT; still contain unauthenticated | Security |
| **P5-7** | Whether inactivate should reject assigned/project/DC children | Yes — align with conversion/reservation eligibility | Stage 3 completeness |
| **P5-8** | quantity/issue and consume in Phase 5 | **No** — document only | Later slice |

---

## 31. Mandatory decision matrix

| Legacy path | Current risk | Target replacement | Action | Cutover condition | Rollback |
|---|---|---|---|---|---|
| `/api/assets/split` | Unauthenticated; `parentid`-only; `qrcode: null`; no `product_id`; serial desync; merge-into-child | Quantity → `breakService`. Serial → contained legacy | CONTAIN now; UI redirect quantity; SHIM quantity later; KEEP serial contained | Scratch: no new parentid-only qty children from UI | Un-shim; UI back to split |
| `/api/quantity/split` | Unused; missing await; `-NaN` ID; dual lineage | None — use `/api/break` | DISABLE then REMOVE | Repo+logs show zero callers | Re-register route |
| `/api/assets/unsplit` | **Hard-delete** quantity children; can destroy APP | Inactivate for Break children; 409 for LEGACY pair; Set path non-delete | CONTAIN delete; SHIM to inactivate | Inactivate proven; APP 409 | Emergency flag only; prefer keep refuse-delete |
| Project unassign | Hard-delete split children | Unassign-only | Remove delete branch | Same as unsplit Stage 0/4 | Restore branch (emergency) |
| `generateSplitAssetId` | `{id}-NaN` | `generateModernAssetId` | DEPRECATE with quantity-split/issue/consume | Those routes disabled or rewritten | Restore helper |
| `parentid` | Three meanings; one prod row | Unchanged column; Break uses `quantity_*` | KEEP; classify; **no global migrate** | Classification signed off | N/A |
| Destructive child deletion | GAP-207 identity loss | Inactivate / unassign-only | DISABLE delete | Stage 0 | Dump restore if already deleted |
| `qrcode: null` child creation | Unprintable / non-canonical identity | Break QR rules | Stop UI quantity split; patch serial if kept | UI cutover | Revert UI |
| Product propagation | Split drops `product_id` | Copy like Break | Shim/containment | Product verify still green | Revert copy (must not drop on existing children) |
| Serial manipulation | Blob rewrite; duplicate srno on qty split | Serial phase; Break does not parse blobs | Do not move into `breakService` | Serial phase (not P5) | Revert serial split only |

---

## Appendix A — Why option A/B/C for `/api/assets/split`

- **A (shim everything)** is right for **quantity mode** after UI cutover, wrong for **serial mode**.
- **B (disable after UI cutover)** is right for **quantity mode** if no external API clients exist; keep a 410 message.
- **C (feature flag)** is right for **serial UI** and for rolling back quantity UI; wrong as the only control on hard-delete.

**Recommended mix:** Stage 0 containment (no flag, refuse delete) + C for quantity Split UI + A or B for the quantity API after UI is dark + serial remains C/contained.

---

## Appendix B — Production proof bar (when implementation is later approved)

Same pattern as Phases 1–4: `pg_dump` → scratch restore → named work only → scratch tests → production **containment** with **zero** split/unsplit/unassign deletes of live IDs → HTTP 401/403 → data-safety compare.

No production Split, Unsplit, Break, or Unassign is authorized by **this** document.

---

*End of Phase 5 plan. This document authorizes no implementation.*
