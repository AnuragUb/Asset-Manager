# AssetEngine Sprint 1 Progress

**Sprint:** AssetEngine Sprint 1 — Stabilization & User Experience Improvements  
**Targets:** Dev `59:9090`, Staging `59:8080`  
**Production `118:8080`:** Must not be modified

## After every issue (required)

1. Update `SPRINT_1_PROGRESS.md`
2. Update `PROJECT_STATUS.md`
3. Update `CHANGELOG.md`
4. Run a smoke test (Dev `59:9090`, then Staging `59:8080`)
5. **Only then** commit (one commit per issue)

Approved analysis modifications:

- Add `users.email` migration; password reset uses stored email
- Category cards: Total Assets primary; Total Quantity labeled secondary if retained
- Deleted Assets: existing soft-delete + restore until purge
- Consumed Inventory: existing status model (no new entity)
- Lifecycle: incremental only — no full refactor this sprint
- **Issue 4:** Meaningful inventory audit history only — verify events are created **and** that metadata-only edits do **not** create events; no duplicate events for a single meaningful change

---

## Issue 1 — Password Reset Workflow ✅ COMPLETE (approved)

Status:
- [x] Investigation
- [x] Implementation
- [x] Testing
- [x] Docs
- [x] Smoke test
- [x] Commit
- [x] Approved

Commits: `26c9f0b`, `68dfc32`, `2385228`

---

## Issue 2 — Assets Card/Table Toggle ✅ COMPLETE (approved)

Status:
- [x] Investigation
- [x] Implementation
- [x] Testing
- [x] Docs
- [x] Smoke test
- [x] Commit
- [x] Approved

Commit: `adc9f0b` / `07bcae2` family — `fix(ui): asset card/table visibility`

---

## Issue 3 — Category counts & quantity terminology ✅ COMPLETE

Status:
- [x] Investigation (Quantity Terminology Audit)
- [x] Analysis
- [x] Implementation
- [x] Testing
- [x] Docs
- [x] Smoke test
- [x] Commit

Commit: `9041e08` `fix(ui): consistent quantity terminology`

Regression: None expected — UI label / hierarchy presentation only; no schema or API contract changes

### Canonical vocabulary applied
| Label | Meaning |
|-------|---------|
| Total Assets | Asset record count (Assets hierarchy) |
| Total Items | Inventory record count (Inventory hierarchy) |
| Total Quantity | `quantity_total` (row or same-unit aggregate) |
| Available Quantity | `quantity_available` |
| Latest event Δ Total | Qty-history header (was misleading “Current Batch Total”) |

### What changed
- Assets hierarchy cards: primary **Total Assets**; secondary **Total Quantity** (explicit); mixed units called out
- Inventory hierarchy cards: **Total Items** + labeled Total/Available Quantity
- Inventory overview + item cards + table header aligned
- Assets table: Total Quantity / Available Quantity wording
- Projects: Total/Available Quantity; BULK shows Available Quantity
- Asset detail page: Available Quantity / Total Quantity
- Cache-bust `dashboard` / `inventory` / `projects` → `v=7.03`

### Post-issue smoke (checklist)
| Check | 59:9090 | 59:8080 |
|-------|---------|---------|
| Home 200 | Pass | Pass |
| `dashboard.js?v=7.03` has Total Assets | Pass | Pass |
| `inventory.js?v=7.03` has Total Items | Pass | Pass |
| Auth forgot still OK | Pass | Pass |

---

## Issue 4 — Inventory Quantity History ✅ COMPLETE

Status:
- [x] Investigation
- [x] Analysis (reusable event system + matrix approved)
- [x] Implementation
- [x] Testing
- [x] Commit

Commit: `5c4d3ca` `feat(inventory): reusable quantity event system`

Regression: None observed (home 200 on 9090/8080; shared event system served; inventory history helpers PASS)

### What shipped

- SSOT: `web-app/shared/inventoryEventSystem.js` (types, display names, UI chrome, legacy aliases, detect/resolve helpers, `presentEvent`)
- Backend inventory POST/PUT use constants + structured metadata; soft-delete/restore APIs emit `DELETE`/`RESTORE`
- Frontend timeline + inventory history modal show **display labels**, not raw types (`v=7.04`)
- Docs: `docs/architecture/inventory-event-system.md`, API table updates

### Product rules (locked)

Meaningful operational history only; no metadata noise; no duplicate events per save; display ≠ type constant; extensible future types; legacy aliases without DB rewrite.

### Event matrix — SHOULD record

| Operation | Type |
|-----------|------|
| Create / enable qty tracking | `INIT` |
| Total / Available qty change | `ADJUST` (one event if both) |
| Status change | `STATUS_CHANGE` |
| Batch enable / disable | `BATCH_ENABLED` / `BATCH_DISABLED` |
| Delete / Restore | `DELETE` / `RESTORE` |

### Event matrix — SHOULD NOT record

Description · Make/Manufacturer · Model · Notes/Remarks · other metadata-only · idempotent re-save

### Smoke / verification (2026-08-12)

| Check | 9090 | 8080 |
|-------|------|------|
| Home 200 | Pass | Pass |
| `/shared/inventoryEventSystem.js` | Pass | Pass |
| `main.js?v=7.04` / inventory display helpers | Pass | Pass |
| DB script: meta not meaningful; ADJUST/STATUS/BATCH/DELETE/RESTORE; legacy present | Pass (test DB) | n/a |

---

## Issue 5 — Soft Delete & Recovery → Global Recovery Center ✅ COMPLETE

Status:
- [x] Investigation
- [x] Architecture Review
- [x] Implementation (soft delete + **Global Recovery Center**)
- [x] Testing
- [x] Commit

Commit: `142ecb9` `feat(platform): promote Recovery Center to SYSTEM navigation`

### Product naming

- Internal: Soft Delete & Recovery  
- UI / nav: **Recovery Center** (SYSTEM module — not Assets)

### What shipped (final)

- SYSTEM nav: Admin → Settings → Recovery Center → Releases
- Entity registry (`recoveryCenterService.js`) — Assets enabled; other types stubbed for future
- Generic APIs under `/api/recovery-center/*` (+ legacy asset recycle-bin/restore wrappers)
- Admin table: search, filters, sort, restore, view details; permanent delete disabled
- Soft delete preserves relationships; `DELETE`/`RESTORE` via shared Event System
- Docs: `EVENT_SYSTEM_GUIDE.md`, `RECOVERY_CENTER.md`

### Smoke

| Check | 9090 | 8080 |
|-------|------|------|
| Home 200 | Pass | Pass |
| Recovery Center module (`v=7.06`) | Pass | Pass |
| Entity registry + items API | Pass | Pass |

---

## Issue 6 — Consumed Inventory

Status:
- [x] Investigation
- [ ] Implementation
- [ ] Testing
- [ ] Commit

Commit: Pending

Regression: None

---

## Issue 7 — Lifecycle Review (incremental)

Status:
- [x] Investigation
- [ ] Implementation
- [ ] Testing
- [ ] Commit

Commit: Pending

Regression: None

Scope note: incremental only this sprint — no full lifecycle refactor.
