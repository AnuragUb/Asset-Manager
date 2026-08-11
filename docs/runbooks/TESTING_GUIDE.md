# Asset Manager - Full System Verification & Testing Guide (v2.5)

This document outlines the manual testing procedures to verify the recent infrastructure upgrades (PostgreSQL migration, Redis integration) and functional logic fixes (Split/Unsplit, Workspace visibility).

---

## **1. Core Asset Management**
**Goal:** Verify database write/read integrity for all asset types.

- [ ] **Create Standard Asset**: Add a new asset with basic fields (Name, Make, Model, Serial).
- [ ] **Create IT Asset**: Add an asset and fill in the **Network/IT** section (MAC, IP, VLAN). 
    - *Verifies: `asset_it_details` lowercase column mapping.*
- [ ] **Edit & Save**: Open any existing asset, change its **Location** or **Status**, and click **Save**.
    - *Verifies: Patch logic and PostgreSQL case-sensitivity.*
- [ ] **Delete Asset**: Move an asset to "Deleted" and verify it no longer appears in active lists.

## **2. Batch & Split Workflows**
**Goal:** Verify complex quantity math and child-parent linkage.

- [ ] **Split Batch**: Select a batch asset (Qty > 1), split a single unit, and assign it to a project.
    - *Verifies: Child ID generation and parent quantity subtraction.*
- [ ] **Unsplit (Merge)**: Open the newly created child asset and click **"🔗 Unsplit & Merge back to Parent"**.
    - *Verifies: Atomic deletion of child, restoration of S/N, and precise quantity syncing.*
- [ ] **Quantity History**: Open the parent asset's **Quantity History** popup.
    - *Check: Do you see the `SPLIT` and `SYNC` (unsplit) events? Is the total correct?*

## **3. Project & Workspace Integration**
**Goal:** Verify project-specific logic and UI synchronization.

- [ ] **Create Project**: Create a new project from scratch.
    - *Verifies: `projects` table lowercase column mapping.*
- [ ] **Assign to Project**: Assign multiple assets (Standard and Batch) to your new project.
- [ ] **Workspace Staging**: Open the project and navigate to the **Workspace** tab.
    - *Check: Do the assigned assets appear automatically in the "Shipping" area?*
- [ ] **Workspace Unsplit**: Try unsplitting an asset directly from the Workspace list using the **🔗 icon**.

## **4. Infrastructure & Performance**
**Goal:** Verify Redis caching and container stability.

- [ ] **Redis Population**: Open **Redis Insight** while browsing the app.
    - *Check: Do keys like `employees:all` and `asset:kinds` appear?*
- [ ] **Cache Speed**: Visit the "Employees" tab twice. The second visit should be near-instant.
- [ ] **Server Persistence**: Perform a `docker compose restart app-dev`.
    - *Check: Can you still browse assets immediately after restart without errors?*

## **5. User Interface & Security**
**Goal:** Verify page rendering and permission-based views.

- [ ] **Standalone Asset View**: Click the "View" (Eye) icon for any asset.
    - *Verifies: Fix for "html is not defined" and history formatting.*
- [ ] **Guest/Public Access**: Open an asset view URL in an **Incognito Window**.
    - *Check: Can you see specifications? Is sensitive pricing/history hidden?*
- [ ] **Hard Refresh Check**: Press `Ctrl + F5` to ensure the latest `dist` files are loaded.

---
**Status:** Ready for Testing. 
*Note: If any popup errors occur, please capture the exact text for immediate fixing.*
