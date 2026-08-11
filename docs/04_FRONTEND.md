# 04 — Frontend

## Stack

| Item | Choice |
|------|--------|
| Framework | **None** — Vanilla JS ES Modules |
| Shell | `index.html` (almost all views/modals in one document) |
| Entry | `js/main.js` |
| Tables/grids | Tabulator (CDN) |
| Excel | SheetJS / xlsx (CDN) |
| Charts | Chart.js (CDN) |
| QR in browser | qrcode / html5-qrcode (CDN) |
| Build | Optional copy/minify to `dist/` (`package.json` scripts); **live server currently serves SOURCE** |

Path: `web-app/asset-manager-frontend/`

---

## Boot sequence

1. Browser loads `index.html`.
2. CDN scripts + `sidebar-raul.js` (classic script) load.
3. `main.js` loads as `type="module"`.
4. `auth.js` → `GET /api/auth/me` restores session (cookie).
5. On success: load folders/kinds/assets, init nav, show dashboard home.
6. Module/category from login stored in `localStorage.selectedAssetCategory`.

Cache busting: imports use query strings, e.g. `./dashboard.js?v=7.00`.  
**After JS changes, bump `?v=` on importers / `index.html` or users keep stale modules.**

---

## Module map

| File | Responsibility | Approx size |
|------|----------------|-------------|
| `main.js` | Router, bootstrap, hierarchy load, tenant user admin wiring | ~70KB |
| `dashboard.js` | Assets home, cards/table, CRUD, DC UI, bulk import, sets | ~472KB |
| `projects.js` | Kanban, assign/unassign, orders, temp assets | ~175KB |
| `inventory.js` | Inventory tree, items, Zoho catalog mode | ~97KB |
| `employees.js` | Employee directory, quotas, bulk | ~43KB |
| `ocr.js` | OCR client UI | ~54KB |
| `warranty.js` | Warranty views | ~34KB |
| `networkScanner.js` | LAN scan + network creds UI | ~34KB |
| `asset-view.js` | Standalone asset detail + Zoho sync button | ~41KB |
| `servicePortal.js` | ARRI job cards / clients / sheets | ~28KB |
| `auth.js` | Login, logout, forgot/reset, `fetchWithAuth` | ~13KB |
| `rbac.js` | Roles/permissions admin UI | ~12KB |
| `hierarchy.js` | Tree model + sidebar HTML | ~8KB |
| `dataProcessor.js` | Excel column fuzzy mapping | ~7KB |
| `contextMenu.js` | Right-click create folder/kind; Zoho status | ~16KB |
| `quantity-history-modal.js` | Quantity event history modal | ~17KB |
| `integration_client.js` | OCR API client helpers | ~8KB |
| `settings.js` | Email settings UI | ~6KB |
| `companyTemplates.js` | Company templates CRUD | ~8KB |
| `dcProjectFetcher.js` | DC ↔ project search helpers | ~11KB |
| `formAutosave.js` | Form draft restore | ~5KB |
| `loginAnimations.js` | Login UX + signup modal | ~7KB |
| `utils.js` | showView, toasts, Tabulator helpers, RBAC UI helpers | ~9KB |
| `itAssets.js` | Legacy IT assets view helper | small |

### Likely unused / orphaned modules

| File | Notes |
|------|-------|
| `arri.js` | No imports; live ARRI UI is `servicePortal.js` |
| `admin.js` | No imports; admin/RBAC via `rbac.js` |
| `qr.js` | No imports; QR via CDN + `/api/qr*` |
| `assetsReport.js` | Missing; import already commented in `main.js` |

### Partially wired

| Feature | State |
|---------|-------|
| OCR | `setupOcr` import commented in `main.js`; nav may still reference it |
| Network scanner | Commented in `main.js`; still imported from `dashboard.js` |
| Inventory | Frontend always enabled; backend/DB may be gated |

---

## Views (nav → UI)

Driven from `main.js` (ids approximate):

| Nav / view | Module |
|------------|--------|
| Home / dashboard | `dashboard.js` |
| Sheet | dashboard/sheet |
| Inventory | `inventory.js` |
| Employees | `employees.js` |
| Projects | `projects.js` |
| DC | dashboard DC logic |
| Warranty | `warranty.js` |
| OCR | `ocr.js` (if wired) |
| Scanner | `networkScanner.js` |
| Settings | `settings.js` |
| Admin / RBAC | `rbac.js` |
| ARRI Service | `servicePortal.js` |
| Releases | inline in `main.js` |

Permission keys like `view.*` can hide nav items.

---

## Secondary pages

| HTML | Script | Purpose |
|------|--------|---------|
| `asset-view.html` | `asset-view.js` | Asset detail / QR deep link |
| `project-view.html` | inline/fetch | Project summary page |
| `public-view.html` | inline | Public asset by label |
| `dynamic.html` | inline | Dynamic short-code tool |
| `test_asset_view.html` | test | Dev helper |

Backend also serves paths like `/asset/:id`, `/inventory/:id`, `/project/:id`.

---

## How frontend talks to backend

1. **`fetch('/api/...')`** — most common (relies on cookie JWT).
2. **`fetchWithAuth`** (`auth.js`) — retries once on 401 via `/api/auth/me`.
3. **Image URLs** — `/api/qr/...` as `<img src>`.
4. **Globals** — `window.loadAssets`, `window.showView`, onclick handlers in HTML strings.

There is **no** centralized API client layer for the whole app (OCR has `integration_client.js`).

---

## UI patterns to respect

- **HierarchyManager** shared by Assets and Inventory sidebars.
- Cards vs table toggles (leaf kinds often default to table).
- After creating a folder/kind, UI may auto-drill into the new node (v7.00 behavior).
- Price fields may be RBAC-restricted (`canViewPrice` / `canEditPrice`).
- Many modals live in `index.html`; JS fills bodies dynamically.

---

## Build / dist

```text
npm run build  # in asset-manager-frontend — copies js/static/html to dist/, minifies main
```

Production *intent* was to serve `dist/` on 8080.  
**Current code forces source** for all ports. Do not assume minify/obfuscation is active.

---

## Guidance for changes

- Prefer editing the owning module, not stuffing more into `dashboard.js` when avoidable.
- Preserve `window.*` contracts if HTML/onclick depends on them.
- Bump `?v=` when shipping JS.
- Do not rewrite to React/Vue without an explicit architectural decision.
- Search for API string usage before renaming backend routes.
