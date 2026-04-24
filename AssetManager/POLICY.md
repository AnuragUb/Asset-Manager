# AssetManager Development Policy

This document outlines the development and production environments for the AssetManager application to ensure a structured and safe development workflow.

## Environments

### 1. Development / Testing Environment
- **Name:** `AssetManager_Dev`
- **Purpose:** Sandbox for coding, testing new features, and debugging.
- **Remote Repository:** [https://github.com/AnuragUb/Asset-Manager/tree/dev](https://github.com/AnuragUb/Asset-Manager/tree/dev)
- **Branch:** `dev`

### 2. Production Environment
- **Name:** `AssetManager_Prod`
- **Purpose:** Stable, live environment for end-users.
- **Remote Repository:** [https://github.com/AnuragUb/Asset-Manager/tree/main](https://github.com/AnuragUb/Asset-Manager/tree/main)
- **Branch:** `main`

## Development Workflow

1.  **Code & Test:** All development work must be performed in the **AssetManager_Dev** environment.
2.  **Commit & Push:** Changes should be committed and pushed to the `dev` branch.
3.  **Review:** Ensure all features are working as expected in the development environment.
4.  **Deploy:** Only stable and tested code should be merged/promoted to the **AssetManager_Prod** environment (`main` branch).

---
*This policy is established to prevent direct changes to production and ensure a reliable deployment pipeline.*
