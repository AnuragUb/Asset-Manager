# Debug Session: asset-parentid-118

Status: [OPEN]

## Symptom

- On `118:8080`, saving an asset fails with:
  - `insert or update on table "assets" violates foreign key constraint "fk_assets_parentid_assets"`

## Scope

- Environment: `118` production app
- Affected flow: asset edit/save, including employee assignment flows that trigger asset update

## Falsifiable Hypotheses

1. The live `118` prod container is still running older backend/frontend code that submits or persists an invalid `ParentId`.
2. The browser is serving stale frontend JS, so the request payload still sends an empty-string or invalid `ParentId`.
3. The request payload contains a non-empty invalid `ParentId` copied from the form state, even though the stored DB row is currently clean.
4. A second code path on the backend rewrites `parentid` after sanitization and reintroduces an invalid value before the update query executes.
5. The failure is triggered by a specific asset/form state where the modal pre-fills `ParentId` with a non-asset identifier.

## Evidence Collected

- `118` database check:
  - `bad_parent_rows = 0`
- This means the FK violation is likely caused by the incoming update payload or live runtime code path, not by already-persisted bad data.

## Next Steps

1. Verify the running `asset-manager-prod` container is on the expected commit/content.
2. Inspect the live code inside the running container for the `ParentId` sanitization patch.
3. If needed, add temporary instrumentation around the asset update route to capture incoming `ParentId` and the final normalized value.
4. Reproduce once and compare evidence before applying any further logic fix.
