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

---

## Issue 1 — Password Reset Workflow ✅ COMPLETE (approved)

Status:
- [x] Investigation
- [x] Implementation
- [x] Testing
- [x] Docs (`SPRINT_1_PROGRESS` / `PROJECT_STATUS` / `CHANGELOG`)
- [x] Smoke test
- [x] Commit
- [x] Approved

Commits:
- `26c9f0b` `fix(auth): repair password reset workflow`
- `68dfc32` `docs(sprint1): record Issue 1 status gate and SMTP debt`

Regression: None observed (login, home pages, reset happy/error paths verified on 9090 and 8080)

### Authentication outcome
Password reset is repaired on Dev and Staging. Resets use stored `users.email`. SMTP production credentials remain Known/Medium debt.

### What changed
- Migration `20260811180000_add_users_email.js` adds nullable `users.email` + lower(email) index
- Forgot-password looks up by username or stored email; sends only to stored `users.email`
- Frontend shows `devResetLink` when mail cannot be sent; reset form no longer drops token via clone bug
- Dev/Staging app containers restarted so `tokenService` reload picked up `storeResetToken`

### Verification
| Check | 59:9090 | 59:8080 |
|-------|---------|---------|
| Migration applied | Yes | Yes (`asset_manager`) |
| Forgot → token persist | Pass | Pass |
| SMTP fail → stored-email + link fallback | Pass | Pass |
| Reset password → login with new password | Pass | Pass |
| Old password rejected | Pass | Pass |
| Lookup by stored email | Pass | Pass |
| No email on file → link + message | Pass (9090) | — |
| Unknown user anti-enumeration | Pass | Pass |
| Home page 200 | Pass | Pass |

### Post-issue smoke (checklist)
| Check | 59:9090 | 59:8080 |
|-------|---------|---------|
| Home / login page loads | Pass (200) | Pass (200) |
| `POST /api/auth/forgot-password` (unknown user) | Pass | Pass |
| Auth JS served (`v=7.01`, includes `devResetLink`) | Pass | Pass |
| Bogus login rejected | Pass (401) | Pass (401) |

SMTP in `dynamic.json` currently returns Gmail BadCredentials; reset still completes via Dev/Staging link fallback. Production host was not touched.

**Technical debt (Known / Medium):** Gmail SMTP credentials require production configuration — see `docs/08_TECHNICAL_DEBT.md`.

---

## Issue 2 — Assets Card/Table Toggle


Status:
- [x] Investigation
- [ ] Implementation
- [ ] Testing
- [ ] Commit

Commit: Pending

Regression: None

---

## Issue 3 — Inventory Quantity History

Status:
- [x] Investigation
- [ ] Implementation
- [ ] Testing
- [ ] Commit

Commit: Pending

Regression: None

---

## Issue 4 — Category Quantity Bug

Status:
- [x] Investigation
- [ ] Implementation
- [ ] Testing
- [ ] Commit

Commit: Pending

Regression: None

---

## Issue 5 — Deleted Assets

Status:
- [x] Investigation
- [ ] Implementation
- [ ] Testing
- [ ] Commit

Commit: Pending

Regression: None

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
