# Frontend stack — Architecture Decision Record

**Status:** ACCEPTED as owner direction (2026-09-08). **React is deferred.** This document does **not** authorize a React rewrite, Vite/bundler work, Express template conversion, or production frontend changes.
**Date:** 8 September 2026
**ID:** `ADR-FRONTEND-001`
**Related:** [`04_FRONTEND.md`](./04_FRONTEND.md) · [`02_ARCHITECTURE.md`](./02_ARCHITECTURE.md) · [`Repository_Modernization_Plan.md`](./Repository_Modernization_Plan.md)

---

## Reading rule

- **Locked now** means the live UI stays the vanilla JS SPA served by Express.
- **Deferred** means React is the intended later frontend for UI logic, after the owner is happy with how the current product behaves.
- **Does not authorize** means do not start React, a new frontend server, or an Express EJS/Pug UI until a follow-up implementation plan is approved.

---

## Current stack (what is live)

AssetEngine is one Node process. Express is already the app server.

```text
Browser — vanilla JS SPA (index.html + js/*.js + CSS)
        │
        │  same origin: /  and  /api/...
        ▼
Express (web-app/asset-manager-backend/server.js)
        ├── REST API
        ├── static files from asset-manager-frontend/
        ├── PostgreSQL (Knex)
        └── Redis (cache; memory fallback)
```

| Layer | Choice today |
|--------|----------------|
| Backend | Express 5 + Knex + Postgres + Redis |
| Frontend | Modular vanilla JS SPA — **no React, Vue, or Angular** |
| How the UI is delivered | Express `express.static` of `asset-manager-frontend/` (source, not a React build) |

This is a normal Express + static SPA. It is **not** “we are not on Express.” Express does not render dashboard HTML with templates. The browser runs the UI; Express serves files and JSON.

---

## Why there is no React today

This was not a rejection of React. The product grew here:

1. PowerShell GUI + SQLite
2. Electron (historical)
3. Express web app — UI moved into the browser the cheapest way: one `index.html`, scripts, then ES modules

At that point React would have meant a bundler, JSX, and rewriting screens that already worked. Internal ops needed assets, kits, QR, projects, receipts, and Zoho more than a frontend framework.

It stayed because:

- Domain truth lives in Express (lifecycle, quantity, receipts, holdings). React would not have made those safer.
- Live still serves **source**, not `dist/` — there was never a committed frontend toolchain.
- `index.html` and `dashboard.js` are now large. A rewrite would freeze product work and risk live warehouse flows.

Vanilla was the right shortcut early. It is a tax now. That tax is accepted **until** the current product is stable enough to change the UI layer without breaking meaning.

---

## ADR-FRONTEND-001

**Title:** Keep the vanilla SPA until the product is stable; then add React as frontend logic. Express stays the server.
**Problem:** The live UI is a large vanilla SPA (HTML strings, `window.*`, cache-bust `?v=`). Layout and state work is painful. It is easy to confuse that with “we are not on Express,” or to start a React rewrite while lifecycle, receipts, holdings, and Zoho are still settling.
**Options:** (a) Big-bang rewrite to React now. (b) Replace the SPA with Express-rendered templates (EJS/Pug). (c) Stay vanilla forever. (d) Stay vanilla **now**; adopt React later for frontend logic after the owner is happy with current behaviour; keep Express as the API and static host.
**Decision:** (d).

### Now (locked)

- Keep `web-app/asset-manager-frontend/` as the vanilla JS SPA.
- Keep Express as the only app server (API + static UI).
- Do not introduce React, Vue, Angular, Next, or a second frontend process.
- Do not convert the UI to Express templates.
- New screens stay vanilla unless a later implementation plan is approved.

### Later (intent, not a start order)

When the owner is **happy with how things are** — domain behaviour, lifecycle (Sourced / Adopted), receipts, holdings, and operations flows stable enough that a UI-layer change is not a product rewrite — **add React as the frontend logic**.

That later step means:

- React owns UI composition and client state.
- Express remains the backend (REST, auth, Knex, Zoho). Express may serve the React build the same way it serves today’s static files.
- Prefer a **strangler / island** path (one screen at a time, starting with a bounded surface such as Operations/Dashboard) over a freeze-the-product rewrite.
- Leave working vanilla modules in place until a screen is actually migrated.

“Happy with how things are” is an **owner call**, not an engineer convenience. A follow-up implementation plan is required before any React code, Vite/bundler, or production serve-path change.

### What this ADR must not be used for

- Starting React in the current tree
- Stopping feature work on the vanilla SPA
- Introducing Nest, Next, micro-frontends, or a separate UI host as a side effect
- Treating “add React later” as permission to rewrite `dashboard.js` or `index.html` wholesale
- Skipping the vanilla Chart.js vendor (`js/vendor/chart.umd.js`) in favour of a React chart stack before React is approved

Vendoring Chart.js UMD into `js/vendor/` **is allowed now**. It is a static file Express already knows how to serve. It is not a bundler, not Vite, and not React.

---

## Consequences

- Engineers and agents keep shipping UI in vanilla JS and bumping `?v=` until the later plan exists.
- Docs that say “not React” mean **not React in the live app today**, not “React is forbidden forever.”
- When React is approved, the first PR should be a sequenced plan (island vs strangler, what stays vanilla, how Express serves the build) — not a surprise framework dump.
