# Contributing to AssetEngine / CineEAM

Thank you for helping improve this product. This repository powers live warehouse and project operations — prefer **small, reviewable changes** over large rewrites.

---

## Engineering philosophy

AssetEngine is a long-lived commercial product.

Every change should improve one or more of:

- Maintainability
- Documentation
- Stability
- Security
- Developer Experience

Never change architecture solely because a different architecture exists.

Business value always outweighs architectural purity.

---

## Repository philosophy

One pull request should solve one problem.

Avoid combining:

- Refactoring
- Features
- Documentation
- Infrastructure

into one review.

---

## Before you start

1. Read [`README.md`](./README.md) and [`docs/01_PROJECT_OVERVIEW.md`](./docs/01_PROJECT_OVERVIEW.md).  
2. Read [`PROCESS_LOGIC.md`](./PROCESS_LOGIC.md) before changing asset lifecycle, quantity, sets, or promote flows.  
3. Read [`AGENTS.md`](./AGENTS.md) if you use AI assistance (same rules apply to humans).  
4. Confirm which environment you are targeting:

| Environment | Host intent |
|-------------|-------------|
| Dev / test | `59:9090` |
| Staging | `59:8080` |
| Production | `118:8080` |

Do **not** change production configuration casually. Propose and get approval first.

---

## Development setup

```bash
cd web-app/asset-manager-backend
npm install
# Copy/adapt .env locally — never commit secrets or tokens
node server.js
```

Frontend is served by the backend (SOURCE path in current setup). See [`docs/04_FRONTEND.md`](./docs/04_FRONTEND.md) and [`docs/05_BACKEND.md`](./docs/05_BACKEND.md).

Ops scripts (deploy helpers, replication, health): [`ops/README.md`](./ops/README.md).

---

## Branching & pull requests

- Default integration branch: **`main`** (verify with `git branch -a` / GitHub — older `WORKFLOW.md` notes about `dev` may be stale).  
- Prefer short-lived feature branches: `feat/…`, `fix/…`, `chore/…`, `docs/…`.  
- **One PR = one problem.** Do not mix refactoring, features, documentation, and infrastructure in the same review (see Repository philosophy above).  
- Open a PR with:
  - **What** changed (files / behavior)
  - **Why** (ticket, bug, or goal)
  - **How tested** (env, steps, risk)
  - Note any migration or ops follow-up

Do not push secrets, Zoho tokens, DB dumps, or `input/` upload contents.

---

## Coding guidelines

- **Preserve behavior** unless the change explicitly intends a behavior change.  
- **No large architecture rewrites** without an agreed plan.  
- Check API / frontend references **before removing** routes, columns, or modules.  
- Prefer maintainability and clear names over cleverness.  
- Propose schema migrations; do not hand-edit production data as “the fix.”  
- Backend is concentrated in `web-app/asset-manager-backend/server.js` — touch carefully; prefer extracting only when approved.  
- Match existing style in the files you edit; avoid drive-by refactors.

---

## Testing

- Manual verification on the intended environment is expected for domain changes.  
- Playwright exists but coverage is thin — add tests when practical; do not claim full coverage.  
- See [`docs/runbooks/TESTING_GUIDE.md`](./docs/runbooks/TESTING_GUIDE.md) (may need updates; verify against current ports).

---

## Documentation

- Update the relevant `docs/0x_*.md` file when behavior or architecture changes meaningfully.  
- Keep [`CHANGELOG.md`](./CHANGELOG.md) entries for user-visible or ops-visible changes.  
- Keep [`PROCESS_LOGIC.md`](./PROCESS_LOGIC.md) aligned when lifecycle semantics change.

---

## Commit messages

Prefer concise, purposeful messages:

- `feat(inventory): …`  
- `fix(dashboard): …`  
- `chore(repo): …`  
- `docs: …`  

Explain **why** when the diff is not obvious.

---

## What not to do

- Commit `.env`, token files, or production dumps  
- Force-push `main`  
- Skip review for production-affecting config  
- “Clean up” unrelated files in the same PR without asking  

Questions or ambiguity: ask before merging risky changes.
