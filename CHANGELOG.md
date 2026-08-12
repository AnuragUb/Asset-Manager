# Changelog

All notable changes to this repository are documented in this file.

Format inspired by [Keep a Changelog](https://keepachangelog.com/).  
Version labels below mix **product UI versions** (e.g. v7.00) and **repository modernization** phases.

---

## [Unreleased]

### Added

- *(none — Sprint 1 complete)*

### Fixed

- *(none — Sprint 1 complete)*

---

## [Sprint 1] Issue 7 — Platform Lifecycle Consolidation (2026-08) ✅ COMPLETE

**Status:** Shared lifecycle model on Dev/Staging path. No new product features. Production untouched.

### Added

- `web-app/shared/lifecycleModel.js` — canonical states, operational aliases, transitions
- Frontend adapter `js/lifecycle-model.js`
- Docs: `docs/architecture/LIFECYCLE_MODEL.md`

### Changed

- Inventory Movement + Recovery Center import lifecycle constants (no parallel `"Consumed"` / soft-delete labels)
- Cross-links from Event System, Recovery Center, Movement, `PROCESS_LOGIC.md`
- Cache-bust `v=7.09`

---

## [Sprint 1] Issue 6 — Inventory Movement Foundation / Consumed Inventory (2026-08) ✅ COMPLETE

**Status:** Movement registry + CONSUME on Dev/Staging path. Production untouched. Recovery Center unchanged.

### Added

- `inventoryMovementService` — Movement Type registry (RECEIVE…FOUND); only **CONSUME** enabled
- APIs: `/api/inventory/movements`, `/api/inventory/movements/types`, `/api/inventory/consumed`
- Consumed Inventory workspace UI (search, filter, history, CSV report, Consume action)
- Docs: `docs/architecture/INVENTORY_MOVEMENT_SYSTEM.md`
- Shared event types: `DISPOSE`, `LOST`, `FOUND` (reserved)

### Changed

- `GET /api/inventory/items` excludes `status=Consumed` by default
- Consume writes through shared Event System (`EVENT_TYPES.CONSUME`)
- Cache-bust `v=7.08`

---

## [Sprint 1] Issue 5b — Global Recovery Center (2026-08) ✅ COMPLETE

**Status:** Recycle Bin promoted to platform **Recovery Center** under SYSTEM nav. Production untouched.

### Changed

- Removed Assets-toolbar Recycle Bin; Recovery Center lives in SYSTEM (Admin → Settings → Recovery Center → Releases)
- Generic `recoveryCenterService` entity registry (Assets enabled; future types stubbed)
- APIs: `/api/recovery-center/entity-types|items|:entityType/:id/restore`
- Admin table UI: search, entity/date/user filters, sort, bulk restore (permanent delete disabled)
- Docs: `EVENT_SYSTEM_GUIDE.md` + `RECOVERY_CENTER.md`
- Cache-bust `v=7.06`

---

## [Sprint 1] Issue 5 — Soft Delete & Recovery / Recycle Bin (2026-08) ✅ COMPLETE

**Status:** Soft Delete & Recovery foundation on Dev/Staging. Production untouched.

### Added

- Recycle Bin UI (Assets toolbar) with Restore, deleted metadata, search
- `GET /api/assets/recycle-bin`, `POST /api/assets/:id/restore`
- Migration `20260812120000_assets_soft_delete_recovery` (`assets.deleted_by`, `domain_events`)
- `docs/architecture/EVENT_SYSTEM_GUIDE.md` (shared Event System developer reference)
- Soft-delete / restore emit `DELETE` / `RESTORE` via shared `EVENT_TYPES` into `domain_events`

### Changed

- Soft delete preserves relationships (no component hard-delete / parent unlink)
- Automatic 30-day hard purge disabled (foundation only; no permanent delete this sprint)
- Delete confirm copy → Recycle Bin language
- Frontend cache-bust `v=7.05`

---

## [Sprint 1] Issue 4 — Inventory Quantity History / event system (2026-08) ✅ COMPLETE

**Status:** Meaningful inventory audit history on Dev/Staging. Production untouched.

### Added

- Shared reusable event system: `web-app/shared/inventoryEventSystem.js` (types, display map, legacy aliases, structured metadata helpers)
- Architecture doc: `docs/architecture/inventory-event-system.md`
- Soft-delete / restore APIs: `POST /api/inventory/items/:id/delete|restore` with `DELETE` / `RESTORE` events
- Frontend ESM adapter + display-name timeline/modal (`v=7.04`)

### Fixed

- History only for operational changes (qty / available / status / batch / delete / restore) — not description/make/notes
- One event per save (anti-duplicate); Available no longer false-triggers ADJUST when omitted
- UI shows display labels (e.g. “Quantity Adjusted”), not raw constants
- Legacy event names still present via compatibility mapping (no DB rewrite)

---

## [Sprint 1] Issue 3 — Category counts & quantity terminology (2026-08) ✅ COMPLETE

**Status:** UI terminology consistency on Dev/Staging. Production untouched.

### Fixed

- Assets hierarchy cards: **Total Assets** primary; **Total Quantity** explicitly labeled (mixed units noted)
- Inventory hierarchy/overview/cards/tables: Total Items / Total Quantity / Available Quantity
- Projects assign/bulk labels: Total Quantity / Available Quantity (BULK no longer mislabels available as Qty)
- Asset detail + assets tables: Total Quantity / Available Quantity
- Qty history summary: **Latest event Δ Total** (replaces misleading “Current Batch Total”)
- Frontend cache-bust `v=7.03` (`dashboard`, `inventory`, `projects`, `asset-view`, `main`)

---

## [Sprint 1] Issue 2 — Assets Card/Table toggle (2026-08) ✅ COMPLETE (approved)

**Status:** UI-only. Verified on Dev `59:9090` and Staging `59:8080`. Production untouched.

### Fixed

- Assets Cards/Table switch now appears only on asset listings (leaf kinds, search results, direct-asset views), matching Inventory — hidden on root/category/manufacturer/model hierarchy levels
- Dashboard cache-bust `dashboard.js?v=7.02`

---

## [Sprint 1] Issue 1 — Password reset / authentication (2026-08) ✅ COMPLETE

**Status:** Approved and complete on Dev `59:9090` and Staging `59:8080`. Production `118:8080` untouched.

### Added

- Migration `20260811180000_add_users_email` — nullable `users.email` for reset delivery
- `SPRINT_1_PROGRESS.md` sprint tracker (includes post-issue docs → smoke → commit gate)

### Fixed

- Password reset workflow end-to-end: token persistence (`storeResetToken`), lookup by username or stored email, delivery to **stored** `users.email` only, Dev/Staging `devResetLink` fallback UX, reset-form token handling
- Auth module cache-bust `auth.js?v=7.01`

### Commits

- `26c9f0b` `fix(auth): repair password reset workflow`
- `68dfc32` `docs(sprint1): record Issue 1 status gate and SMTP debt`

### Known debt

- Gmail SMTP credentials require production configuration (Medium / Known) — `docs/08_TECHNICAL_DEBT.md`

## [Repo] 2026-08 — Phase 3 repository presentation

### Added

- Repository presentation: `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, `AGENTS.md`, `PROJECT_STATUS.md`
- Documentation index and architecture navigation under `docs/`
- Integrated historical root docs into `docs/runbooks/` and `docs/archive/`
- `resources/` placeholder for branding / diagrams
- Permanent Cursor engineering standards under `.cursor/rules/`

### Changed

- Root `README.md` rewritten for current web + Postgres product (removed stale PowerShell-first guidance)
- Engineering and repository philosophy documented for humans and agents

---

## [Repo] 2026-08 — Operational tooling layout

### Changed

- Organized host scripts under `ops/deployment`, `ops/replication`, `ops/health`, `ops/sql` (`8256d27`)
- Path fixes so replication and launch scripts resolve repo-root `backups/` and working directories correctly

---

## [Repo] 2026-08 — Phase 1 hygiene

### Changed

- Improved `.gitignore` (tokens, uploads, reports, corrupt backup index paths) (`567f440`)
- Moved curated operational SQL into `ops/sql/`
- Added `input/.gitkeep`, `export/.gitkeep`

---

## [Product] v7.00 — Dashboard / inventory UX

Notable recent product commits (summarized from git history):

- **v7.00** — Consistent category creation drill-in (Assets + Inventory)
- **v6.99** — Cards/Table toggle always in dashboard header
- **v6.98** — Blank dashboard fix (`directAssets` TDZ)
- **v6.97** — Assets dashboard Cards/Table + on-page table for leaf kinds
- **v6.96–v6.90** — Inventory table/QR/history fixes; quantity INIT block removed from PUT edit path

---

## Notes

- Older root architecture documents that mentioned SQLite as primary store are **archived** under `docs/archive/` and are not the source of truth.  
- Prefer [`docs/02_ARCHITECTURE.md`](./docs/02_ARCHITECTURE.md) and [`PROCESS_LOGIC.md`](./PROCESS_LOGIC.md) for current behavior.
