# 07 — Security

## Current auth model

1. User submits username / password / category / rememberMe to `POST /api/auth/login`.
2. Password verified with **bcrypt** when hash looks like bcrypt; **plaintext compare still accepted** and then upgraded to bcrypt.
3. JWT issued and set as httpOnly cookie `auth_token` (Bearer also supported).
4. Optional `remember_token` stored hashed in `auth_tokens` (≈30 days).
5. `GET /api/auth/me` restores session; may mint a new JWT from remember token.
6. Role permissions loaded into an in-memory cache from `role_permissions`.
7. Middleware: `authenticateJWT`, `authorizeRoles`, `requirePermission`.

Frontend: `auth.js` + `fetchWithAuth` (single 401 retry).

---

## What is working reasonably well

- httpOnly cookies for session token
- bcrypt hashing path for modern passwords
- RBAC tables and some admin/tenant routes properly gated
- Zoho sync routes generally require JWT
- Inventory mutating routes generally require JWT + roles
- External API uses a shared API key middleware (conceptually separate from user JWT)

---

## Critical / high issues

### 1. Large unauthenticated API surface

Many routes lack `authenticateJWT`, including mutating ones in places, for example domains such as:

- Delivery challans (`/api/dc*`)
- Employees / quotas
- Audit log reads/exports
- Email / Tally settings
- OCR upload/process/export
- Several ARRI routes
- Asset bulk create, asset split, temp→permanent in some paths
- Asset details / history (data exposure)
- Debug endpoints

**Risk:** Anyone who can reach the host can read/modify operational data.

### 2. Open signup

`POST /api/signup` creates users with role `user` without invite/admin approval.

### 3. Default secrets in code

Fallbacks such as:

- `JWT_SECRET` default string if env missing
- `EXTERNAL_API_KEY` default string if env missing
- Encryption key fallback in `encryptionService`

**Rule:** Never hardcode secrets; always use environment variables; rotate if defaults were ever used in a reachable environment.

### 4. Secrets and tokens in the tree

Observed risks (hygiene):

- `.env` on disk with DB/Zoho/encryption material (gitignored — good — but must stay that way)
- `zoho_tokens.txt` has been present in the repo tree / tracking history risk
- Uploads under `input/` sometimes tracked
- Zoho SDK resource dumps under `zoho_resources/`

### 5. Cookie flags

`secure: false` on auth cookies — problematic if served over HTTPS without tightening.

### 6. Network credentials storage

IT network credential APIs can store device passwords. Encryption helpers exist; verify encrypt-at-rest is actually applied on write paths before assuming safety.

### 7. Debug and scan endpoints

Unauthenticated diagnose/cookie echo and LAN `/api/scan` increase exposure if the service is reachable beyond a trusted LAN.

### 8. Oversized JSON body limit

`express.json({ limit: '100mb' })` widens DoS / memory abuse risk.

### 9. Auth logging

Login paths have historically logged comparison context; ensure production logs do not print passwords or sensitive tokens.

### 10. Duplicate route registrations

Weaker handlers registered alongside stricter ones can leave the effective auth surface surprising (first match wins).

---

## Medium issues

- Plaintext password login still supported (upgrade path is good; indefinite support is not)
- Public asset endpoints may expose more fields than intended
- No evident rate limiting / lockout on login or signup
- No helmet / strict CORS posture apparent in bootstrap
- Multi-instance memory cache fallback is not a security boundary (stale authz caches possible if permissions change and process not refreshed)

---

## Hard rules going forward

From permanent engineering standards:

1. **Never hardcode secrets.**
2. **Never modify production configuration** without explicit ask.
3. **Never remove APIs without checking references** (but *do* plan to lock down unauthenticated writes).
4. **If uncertain, ask** — especially auth and lifecycle.

When adding routes:

- Default to `authenticateJWT`
- Add `authorizeRoles` / `requirePermission` for mutations and admin data
- Explicitly document any public exception (QR, login, true public asset view)

---

## Recommended security sequence (see also Next Phase)

1. Inventory all `None`-auth mutating routes; lock the worst first.
2. Disable or gate signup.
3. Rotate JWT / DB / Zoho / encryption / external API keys; purge tokens from git history if needed.
4. Remove debug routes from non-dev environments.
5. Set `secure` cookies appropriately for real HTTPS deployments.
6. Resolve duplicate route auth mismatches.
7. Ensure network credential encrypt-on-write.
8. Add rate limits on auth endpoints.

---

## Public-by-design endpoints (keep intentional)

These can remain public **if** payloads are minimized:

- Login / logout / password reset (with abuse controls)
- QR image generation for IDs that are already capability-URLs
- Narrow public asset view by label
- Health ping (non-sensitive)

Everything else should require authentication unless product explicitly says otherwise.
