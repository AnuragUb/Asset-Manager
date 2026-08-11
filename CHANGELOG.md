# Changelog

All notable changes to this repository are documented in this file.

Format inspired by [Keep a Changelog](https://keepachangelog.com/).  
Version labels below mix **product UI versions** (e.g. v7.00) and **repository modernization** phases.

---

## [Unreleased]

### Added

- *(none yet — next Sprint 1 issues)*

### Fixed

- *(none yet — next Sprint 1 issues)*

---

## [Sprint 1] Issue 1 — Password reset (2026-08)

### Added

- Migration `20260811180000_add_users_email` — nullable `users.email` for reset delivery
- `SPRINT_1_PROGRESS.md` sprint tracker (includes post-issue docs → smoke → commit gate)

### Fixed

- Password reset workflow: token persistence, stored-email delivery, Dev/Staging link fallback UX, reset-form token handling

### Known debt

- Gmail SMTP credentials require production configuration (Medium / Known) — `docs/08_TECHNICAL_DEBT.md`
---

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
