# 10 — Next Phase

## Goal of the next phase

Make AssetEngine **safe to operate and safe to change** without rewriting it.

Order of impact (from lead-engineer assessment):

1. Security perimeter  
2. Secrets hygiene  
3. Asset lifecycle stability  
4. Auth consistency  
5. Inventory product decision  
6. Minimal automated tests  
7. Controlled modularization  
8. Environment/deploy contract  
9. Repository hygiene  
10. Living docs (this folder — keep updated)

**Do not start with:** framework rewrites, microservices, or mega cleanups.

---

## Phase A — Stop the bleeding (security)

**Outcomes**

- Mutating APIs require authentication by default
- Public allowlist documented and minimal
- Signup gated or disabled
- Debug routes disabled outside local/dev

**Suggested increments**

1. Inventory all `None`-auth `POST/PUT/PATCH/DELETE` routes  
2. Lock DC, employees, settings, OCR writes, ARRI writes, bulk/split as priority  
3. Fix duplicate route registrations so the stricter handler wins (or remove duplicates)  
4. Add rate limiting on login/signup/reset  

**Constraint:** Preserve functionality; do not remove APIs without grepping references.

---

## Phase B — Secrets and configuration

**Outcomes**

- No secrets in git  
- Rotated credentials where exposure was possible  
- Prod config changes only on explicit request  

**Suggested increments**

1. Ensure `.env`, `zoho_tokens.txt`, uploads, backups stay untracked  
2. Rotate Zoho / JWT / DB / encryption / external API keys if they ever lived in repo or shared folders  
3. Remove code default secrets or fail closed when env missing in production  
4. Document required env vars in docs (names only, never values)  

---

## Phase C — Protect the domain heart

**Outcomes**

- All status transitions go through one lifecycle path  
- Kit/component promotion cannot create cross-table duplicates  
- Assign → inspect → release is regression-tested  

**Suggested increments**

1. Document and enforce use of `updateAssetStatus` / `promoteToAsset`  
2. Add a small Playwright/API suite for lifecycle happy path + one set recursion case  
3. Only then consider extracting lifecycle helpers to a dedicated module **without behavior change**  

---

## Phase D — Auth model cleanup

**Outcomes**

- One clear user-admin story  
- bcrypt-only verification  
- Cookie flags correct for deployment mode  
- Permissions cache invalidation understood  

**Suggested increments**

1. Collapse or clearly document `/api/users*` vs `/api/tenant/users*` vs `/api/rbac*`  
2. Remove plaintext password accept path after confirming no remaining plaintext users  
3. Align `secure` cookie flag with HTTPS termination reality  

---

## Phase E — Inventory decision

Pick one:

| Option | Meaning |
|--------|---------|
| **Promote** | Run inventory migrations on all envs; feature flag for rollout only |
| **Quarantine** | Keep test-only; hide UI unless flag on; document clearly |

Ambiguity is more expensive than either choice.

---

## Phase F — Make change safe (tests + modularization)

**Outcomes**

- Confidence to edit `server.js` / `dashboard.js`  
- Smaller PRs  

**Suggested increments**

1. Expand tests only around auth + lifecycle + bulk import smoke  
2. Mechanically split `server.js` into domain routers **after** tests (no behavior change)  
3. Peel DC / bulk import out of `dashboard.js` similarly  

**Requires approval:** any large architectural extraction.

---

## Phase G — Operate like one product

**Outcomes**

- Single answer to “what is production?”  
- Branch/port/DB/feature-flag matrix written and followed  

**Suggested increments**

1. Confirm canonical remote (`origin` vs `official`)  
2. Retire or revive `dev` branch intentionally  
3. Align `WORKFLOW.md` with reality  
4. Standardize how migrations run on 8080 vs 9090  

---

## Phase H — Hygiene pass

**Outcomes**

- Repo is a source tree, not a workstation dump  

**Suggested increments**

1. Move curated ops scripts to `tools/` or keep `scripts/` with a README index  
2. Untrack artifacts (uploads, reports, weights, tokens)  
3. Archive deprecated clients (`asset_manager.ps1`, QRCoder, old `public/`)  
4. Delete or quarantine orphan frontend modules after reference checks  

---

## Phase I — Keep docs honest

- Update `docs/09_CURRENT_STATE.md` when major posture changes  
- Update `docs/06_API.md` when routes are locked or added  
- Keep `PROCESS_LOGIC.md` aligned with lifecycle code  

---

## Definition of done for “next phase”

The next phase is successful when:

1. A stranger on the LAN cannot mutate inventory without a session  
2. Secrets are not in git and defaults cannot silently run in prod  
3. Lifecycle has automated smoke coverage  
4. Inventory’s prod/test story is unambiguous  
5. Engineers use `docs/` + permanent rules instead of tribal memory  
6. Still **no** unnecessary rewrite of working modules  

---

## Immediate first ticket ideas (safe)

1. Document public API allowlist (read-only doc PR)  
2. Add auth to one clearly unauthenticated write route with frontend still working  
3. Fix or remove `/api/all-orders` caller mismatch  
4. Bump and verify OCR nav wiring (enable properly or hide nav)  
5. Inventory: print “which DB / which tables exist” diagnostic for 8080 vs 9090  

When uncertain: **ask instead of assuming.**
