# 05 — Backend

## Stack

| Item | Choice |
|------|--------|
| Runtime | Node.js (Docker: 20) |
| Framework | Express 5.x |
| ORM/QB | Knex + `pg` |
| Auth | JWT (cookie + Bearer) + bcryptjs |
| Cache | ioredis / redis with memory fallback |
| Files | multer → `input/` |
| Integrations | Zoho CRM SDK, googleapis, nodemailer, Tally XML helpers |
| Docs/export | pdf-lib, docx, xlsx, qrcode, tesseract.js |

Path: `web-app/asset-manager-backend/`  
Entry: `server.js` (`npm start` → `node server.js`)

---

## Process responsibilities

`server.js` currently owns:

- Middleware (`express.json` limit often 100mb)
- Auth helpers (`authenticateJWT`, `authorizeRoles`, `requirePermission`)
- Domain helpers (`updateAssetStatus`, `promoteToAsset`, `normalizeResult`, cache invalidation)
- ~100–160 HTTP route registrations
- Static frontend hosting
- Periodic backup / cron-related behavior
- Debug endpoints

This is a **god-process**. Prefer surgical edits; large extractions need approval.

---

## Key files

| File | Role |
|------|------|
| `server.js` | Almost all HTTP + core business logic |
| `utils.js` | Knex `db` / `dbService`, ID helpers, Tally, JSON/audit helpers |
| `IdGenerator.js` | ID schemes for assets/projects |
| `knexfile.js` | Env-based Postgres configs |
| `services/cacheService.js` | Redis + memory Map fallback |
| `services/tokenService.js` | Remember-me tokens |
| `services/passwordService.js` | Reset flows |
| `services/emailService.js` | SMTP |
| `services/encryptionService.js` | AES field encrypt/decrypt |
| `services/zohoService.js` | Zoho CRM sync |
| `services/googleSheetsService.js` | Sheets sync (ARRI) |
| `migrations/` | Schema changes |

---

## Auth middleware (summary)

```text
authenticateJWT
  → Bearer token OR auth_token cookie
  → jwt.verify → req.user { user_id, role, company_id, ... }

authorizeRoles('admin', ...)
  → superuser bypasses
  → else role must be listed

requirePermission('user.manage')
  → checks in-memory role_permissions cache (loaded from DB)
```

Login also supports **plaintext password compare** with auto-upgrade to bcrypt — legacy behavior; do not expand it.

Cookies today often use `httpOnly: true`, `sameSite: 'lax'`, `secure: false`.

Details and risks: [07_SECURITY.md](./07_SECURITY.md).

---

## Core business helpers

### `normalizeResult(data)`

Maps lowercase DB keys to PascalCase/CamelCase expected by the UI. Also normalizes some dates/types. **Required contract** when adding fields.

### `updateAssetStatus(...)`

Atomic status transition:

- Updates `assets.status` (+ extra fields)
- Optional `project_assets` link/unlink
- Writes history
- Recurses into set children when appropriate

### `promoteToAsset(...)`

Moves a row from `components` → `assets` (or updates if already present), deletes component row, logs `PROMOTED`. Respects cross-table ID uniqueness.

### Cache invalidation

`invalidateAssetsCache()` / kind / employee helpers delete Redis key patterns after writes.

---

## Dual DB routing

`getDbForCategory(category)`:

- `In-House` or `SERVICE` → `dbService`
- else → `db`

Used for users and some category-scoped operations.

---

## Static hosting

```text
forceSource = true  → serve asset-manager-frontend/js and /static
(useDist path exists for 8080 but is currently bypassed)
```

Uploads: `../../input` relative to backend.  
Exports: `../../export`.

---

## Feature flags

| Flag | Effect |
|------|--------|
| `FEATURE_INVENTORY_ENABLED=false` | Inventory API returns 404 |
| `PORT` / `NODE_ENV` | Affects backup subdir and env labeling |
| `JWT_SECRET`, `EXTERNAL_API_KEY`, `DB_ENCRYPTION_KEY` | Security-sensitive env |

Inventory migrations may also gate on database name `asset_manager_test`.

---

## Integration surfaces

| Integration | Entry |
|-------------|-------|
| Zoho | `zohoService` + `/api/zoho/*` |
| Google Sheets | `googleSheetsService` + ARRI sync / external sheets-sync |
| Email / warranty cron-ish checks | email settings + run-check |
| Tally | `/api/tally/sync` + utils XML helpers |
| External systems | `/api/external/*` + API key middleware |

---

## Scripts adjacent to backend

- `web-app/asset-manager-backend/scripts/` — parity / FK audit helpers  
- Repo `scripts/` and root `check_*.js` — manual ops, not imported at runtime  

Do not confuse ops scripts with the live server.

---

## Guidance for changes

1. Find the existing route before adding a parallel one (duplicates already exist).
2. Mutating routes should use `authenticateJWT` (+ roles when appropriate).
3. Lifecycle changes go through `updateAssetStatus` / `promoteToAsset` when possible.
4. After schema changes → Knex migration + `normalizeResult` if needed.
5. Never hardcode secrets; never casually edit production `.env` / compose prod overrides.
6. Large extractions from `server.js` require explicit approval ([engineering standards](../.cursor/rules/assetengine-engineering-standards.mdc)).
