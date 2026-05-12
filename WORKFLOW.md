# Asset Manager - Development Workflow

This repository uses a branch-based workflow to separate Production (stable) from Development (testing).

## Branches

*   **`main`**: The Production branch. Code here is deployed to the live environment (Port 8080).
*   **`dev`**: The Test/Development branch. Code here is deployed to the test environment (Port 9090).

## Workflow

1.  **Develop & Fix:**
    *   Make all changes, bug fixes, and new features on the `dev` branch.
    *   Test these changes on the Test Server (Port 9090).

2.  **Verify:**
    *   Ensure the Test environment works as expected.
    *   Check logs and functionality.

3.  **Deploy to Prod:**
    *   Switch to the `main` branch: `git checkout main`
    *   Merge changes from `dev`: `git merge dev`
    *   Push to remote: `git push origin main`
    *   Restart the Prod Server (Port 8080) to apply changes.

## Environment Configuration

*   **Prod (`main`):**
    *   Port: 8080
    *   Database: `database_v2.db` (Prod DB)
    *   Data Dir: `data/prod`

*   **Test (`dev`):**
    *   Port: 9090
    *   Database: `database_v2.db` (Test DB - separate copy)
    *   Data Dir: `data/test`

## Switching Branches

```bash
# To work on Test/Dev
git checkout dev

# To deploy to Prod
git checkout main
git merge dev
```
