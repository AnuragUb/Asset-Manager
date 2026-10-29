# Auth infrastructure implementation

Operator-facing authentication for AssetEngine: sign up, sign in, Remember Me, logout, forgot/reset password.

This does **not** change Product, Procurement, Receipt, Asset, Inventory, Reservation, Conversion, Break, Set, Projects, DC, Rentals, Zoho, or OAuth engines.

Related: [`07_SECURITY.md`](./07_SECURITY.md).

---

## Signup

`POST /api/signup` and `POST /api/auth/signup`

1. Require JSON `Content-Type`.
2. Validate email (if present) and password (min 8, max 128, optional confirm).
3. Username is the provided username, otherwise the email.
4. Duplicate username/email returns a generic **400** `Could not create this account.`
5. Password is bcrypt-hashed (cost 12). Never stored or returned in plaintext.
6. Role is always `user`. Client `role` is ignored. Privileged roles cannot be self-assigned.
7. Account status is `ACTIVE` when `users.status` exists.
8. Success does not log the user in; they must sign in.

UI: Sign Up modal on the existing login page (email, name, optional phone, password, confirm password).

---

## Login

`POST /api/auth/login`

- Generic failure: **Invalid username or password.**
- Empty/malformed credentials use the same generic copy (400/401). Disabled / inactive users fail the same way.
- Lookup by username **or** stored email.
- Module selector (`IT` / `Service` / `Rental` / `Inventory`) only chooses the existing dual-DB category. It does not authenticate, does not grant roles, and unknown values fall back to `IT`.
- Legacy plaintext passwords still upgrade to bcrypt on success; passwords are never logged.

---

## Session and Remember Me

| Mode | `auth_token` (JWT) | `remember_token` |
|------|--------------------|------------------|
| Remember Me **unchecked** (default) | Session cookie (no Max-Age). Browser restart logs the user out. JWT still expires in `JWT_EXPIRES_IN_SECONDS` (default 1 hour). | Not set / cleared |
| Remember Me **checked** | Session JWT (same 1-hour JWT lifetime) | Persistent httpOnly cookie, hashed in `auth_tokens`, default **30 days** (`AUTH_REMEMBER_DAYS`) |

`GET /api/auth/me` can mint a new session JWT from a valid remember token. That is the restore path after a browser restart when Remember Me was checked.

JWT is not stored in `localStorage`. Remember Me is not inferred from cookies and is never pre-checked.

---

## Cookie security

`getAuthCookieOptions`:

- `httpOnly: true`
- `sameSite: 'lax'`
- `path: '/'`
- `secure`: `NODE_ENV=production`, `COOKIE_SECURE=true`, HTTPS, or `x-forwarded-proto=https`

Local HTTP (dev/test) may omit `Secure` so the session cookie can be set. Production behavior is not weakened for convenience.

---

## Logout

`POST /api/auth/logout`

- Invalidates the remember token row when present
- Clears both cookies (`Max-Age=0`)
- Subsequent `/api/auth/me` is **401**

JWT itself is stateless; outstanding session JWTs remain valid until expiry unless the cookie is gone. Password reset invalidates **all** remember tokens for that user.

---

## Forgot / reset password

`POST /api/auth/forgot-password`

- Always the same success copy when delivery is possible: **If an account exists for that address, a reset link has been sent.**
- Does not say whether the account exists.
- Token: 32 cryptographically random bytes, stored as SHA-256, 60-minute expiry, single-use (`used_at` when the column exists).
- Email uses existing `emailService` / `dynamic.json` `email_settings`. Credentials stay in config, not source.
- Production never returns `devResetLink` (port **8080 is not treated as dev**).
- If SMTP is not configured **and** this is not a permitted development fallback: **503** `FORGOT_PASSWORD_EMAIL_DELIVERY_NOT_CONFIGURED` for every caller (no enumeration).
- Development fallback (`NODE_ENV !== production` plus `AUTH_EXPOSE_RESET_LINK=true` or host `9090` / localhost): may include `devResetLink` and `reasonCode` so operators can test without pretending mail was delivered.

First login with a temporary / default password (`users.must_change_password`):

- Valid credentials do **not** issue a session cookie.
- Response includes `mustChangePassword: true` and a one-hour `setupToken` so the login screen can collect a new password immediately (they already proved the temporary password).
- The same token is emailed when SMTP in Settings works. Forgot-password still requires email delivery and never returns a token in the JSON.
- Completing `POST /api/auth/reset-password` clears the flag. The new password must differ from the current one.
- Admin-created accounts start with `must_change_password = true`. Public signup does not.

`POST /api/auth/reset-password`

- Enforces the same password rules
- Consumes the token
- Invalidates remember sessions
- Clears `must_change_password`
- Copy: expired vs no-longer-valid vs **Your password has been reset. Please sign in.**

---

## CSRF

Auth write endpoints require `Content-Type: application/json` and, when `Origin` is present, that it match `Host`. Combined with `SameSite=Lax` this blocks classic cross-site form posts from setting a session. A full CSRF-token framework was not added.

Global `Access-Control-Allow-Origin: *` remains a broader app concern; browsers reject credentialed CORS with `*`. Same-origin SPA fetches are unaffected.

---

## Rate limiting

In-memory, per-IP, auth routes only:

- login: 20 / 15 minutes
- signup: 10 / 15 minutes
- forgot-password: 8 / 15 minutes

Disable with `AUTH_RATE_LIMIT_DISABLED=true`. This is not a full WAF.

---

## Roles

Unchanged. `authenticateJWT` / `authorizeRoles` / `requirePermission` are the same gates. Public registration cannot assign `admin`, `manager`, or `superuser`.

Account status: `users.status` `ACTIVE` (default) / `DISABLED` / `INACTIVE`. Disabled users cannot log in or restore via Remember Me. Outstanding JWTs issued before disable remain valid until expiry (stateless JWT).

---

## Module selector

IT Assets / Service / Rental / Inventory is the existing category switch for dual-DB (`SERVICE` → service database). It is not an authentication bypass.

---

## Database

Additive migration `20260901120000_auth_infrastructure_hardening.js`:

- `users.status` `VARCHAR(16)` default `ACTIVE` (if missing)
- `password_resets.used_at` nullable (if missing)

Startup `initializeAuthTables()` also ensures those columns so environments that do not run `migrate:latest` on production still pick them up. **Do not run `migrate:latest` on production as a shortcut.**

Existing tables reused: `users`, `auth_tokens`, `password_resets`.

---

## Tests

```text
node scripts/auth-infrastructure-verify.js --database-name asset_manager_auth_scratch --run-tests --http-base http://127.0.0.1:9099
node scripts/auth-infrastructure-verify.js --database-name asset_manager --http-base http://127.0.0.1:8080
```

`--run-tests` is refused against `asset_manager`.

Browser restart is simulated in HTTP tests by dropping the session `auth_token` while keeping `remember_token`.

## Test results

Scratch (`asset_manager_auth_scratch`, HTTP `http://127.0.0.1:9099` against new code):

`node scripts/auth-infrastructure-verify.js --database-name asset_manager_auth_scratch --run-tests --http-base http://127.0.0.1:9099`

**79 passed, 0 failed.**

Browser (scratch 9099): login page loads with Remember Me **unchecked** by default; Sign Up / Forgot Password / Reset Password screens present; existing visual identity kept. Credential entry in the automated browser was not used; signup/login/reset were exercised by the HTTP suite.

Production `8080` was **not restarted**. Unauthenticated `GET /api/auth/me` remains **401**. No production users were created or reset.

Startup of the scratch process wrote a Postgres dump of `asset_manager_auth_scratch` under `backups/9090_dev/` (automatic backup on that code path). Production `asset_manager` was not migrated via `migrate:latest`.

---

## Environment

| Variable | Purpose |
|----------|---------|
| `JWT_SECRET` | Signing key (must be set in production) |
| `JWT_EXPIRES_IN_SECONDS` | JWT lifetime (default 3600) |
| `COOKIE_SECURE` | Force Secure cookie on/off |
| `AUTH_REMEMBER_DAYS` | Remember-Me lifetime (default 30) |
| `AUTH_EXPOSE_RESET_LINK` | Dev-only reset link in JSON |
| `AUTH_RATE_LIMIT_DISABLED` | Disable auth rate limits |

---

## Known remaining auth issues

- Large unauthenticated API surface outside the lifecycle engines (see `07_SECURITY.md`). This task did not open or close those routes.
- Stateless JWT is not revoked on logout/password reset except by clearing cookies and remember rows.
- Disabling a user does not immediately kill an already-issued JWT.
- CORS `Access-Control-Allow-Origin: *` is still set application-wide.
- `/api/debug/cookies` remains a diagnose endpoint.
- Default `JWT_SECRET` fallback in source if env is missing — do not rely on it in production.

Phase 10 was not started.
