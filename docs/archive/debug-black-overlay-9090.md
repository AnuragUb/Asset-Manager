# Debug Session: black-overlay-9090

Status: [OPEN]

## Symptom

- On `59:9090`, after reloading the page, a black filter/overlay sits on top of the app.
- The overlay blocks clicks across the UI.

## Scope

- Environment: local test app on `59:9090`
- Trigger: page reload
- Impact: app becomes non-interactive

## Falsifiable Hypotheses

1. A modal/backdrop element remains visible after reload because its initial state is wrong or a close/reset routine does not run.
2. A loading overlay or splash screen is left active because an initialization promise fails and the cleanup path never executes.
3. CSS class toggling after reload leaves a full-screen element with `position: fixed` and high `z-index` over the app.
4. A browser-restored state path reopens a modal or dark overlay from local/session storage.
5. A recent frontend change introduced an element whose default display is visible until JS hides it, and the hiding logic is not running on `9090`.

## Next Steps

1. Inspect the frontend for full-screen overlays, modals, backdrops, and loading masks.
2. Check reload/init paths that toggle modal visibility or overlay classes.
3. Identify the most likely top-layer element and then instrument or patch minimally.
