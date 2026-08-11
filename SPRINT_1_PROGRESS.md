# AssetEngine Sprint 1 Progress

**Sprint:** AssetEngine Sprint 1 — Stabilization & User Experience Improvements  
**Targets:** Dev `59:9090`, Staging `59:8080`  
**Production `118:8080`:** Must not be modified

Approved analysis modifications:

- Add `users.email` migration; password reset uses stored email
- Category cards: Total Assets primary; Total Quantity labeled secondary if retained
- Deleted Assets: existing soft-delete + restore until purge
- Consumed Inventory: existing status model (no new entity)
- Lifecycle: incremental only — no full refactor this sprint

---

## Issue 1 — Password Reset Workflow

Status:
- [x] Investigation
- [x] Implementation
- [x] Testing
- [x] Commit

Commit: `fix(auth): repair password reset workflow` on `main` (`git log -1 --grep=password reset`)

Regression: None observed (login, home pages, reset happy/error paths verified on 9090 and 8080)

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

SMTP in `dynamic.json` currently returns Gmail BadCredentials; reset still completes via Dev/Staging link fallback. Production host was not touched.

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
