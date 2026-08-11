# Architecture Proposal: Modular Asset Management System

## Overview
This document outlines the architectural strategy to transition the Asset Manager from a monolithic application into a **Workspace-Based Architecture**. This approach separates "In-House" internal operations from "External (Cineom)" revenue-generating operations while maintaining a single, unified database core.

**Core Concept:** Two Portals, One Truth.

---

## 1. Database Strategy (Shared Core)
The `assets` table remains the single source of truth, enabling seamless cross-referencing between modules. Data scoping will be enforced via the `Module` field in `asset_kinds` and dynamic context tags.

### Shared Infrastructure
*   **Tables:** `assets`, `users`, `asset_kinds`, `audit_log`.
*   **Authentication:** Unified login system with role-based access control (RBAC) determining module access.

### Logical Data Separation
| Scope | Criteria | Description |
| :--- | :--- | :--- |
| **In-House** | `Category/Module` IN ('IT', 'General', 'Office') | Assets used for internal operations (laptops, furniture). |
| **External** | `Category/Module` IN ('Rental', 'Production') | Revenue-generating assets (cameras, lights, rental gear). |

### Cross-Referencing Protocol
*   **Primary Ownership:** An asset belongs to *one* primary module (e.g., a Camera is 'External').
*   **Inter-Module Visibility:** 
    *   **Repair Flow:** If an 'External' asset breaks, it can be flagged for 'Internal Repair', appearing in the In-House Maintenance view.
    *   **Project Assignment:** If an 'In-House' laptop is assigned to a client project, it appears in the External Project Assets view as an "Internal Loan".

---

## 2. Module Definitions

### Module A: In-House Assets (Internal Ops)
**Target Audience:** IT Administrators, HR, Office Managers.

#### Included Features (Tabs)
*   **Dashboard:** Operational health of internal infrastructure (Device uptime, warranty alerts).
*   **Employees:** Full directory integration, asset assignment history, onboarding/offboarding workflows.
*   **Network Scanner:** Tools for auditing internal IP/MAC addresses and network discovery.
*   **Maintenance:** Warranty tracking, AMC management, repair logs.

#### Excluded Features
*   Projects & Client Management.
*   Delivery Challans (DC) & Logistics.
*   Commercial Rentals.

### Module B: Cineom Assets (External Ops)
**Target Audience:** Project Managers, Logistics Team, Sales, Warehouse Staff.

#### Included Features (Tabs)
*   **Dashboard:** Project status, equipment availability, utilization metrics.
*   **Projects:** Full project lifecycle management, BOM creation, cost estimation.
*   **Logistics:** Delivery Challans (DC) generation, dispatch tracking, return reconciliation.
*   **Rentals:** Availability calendar, conflict checking, booking management.

#### Excluded Features
*   **Employees Directory:** Hidden to protect sensitive HR data.
*   **Network Scanner:** Irrelevant for rental inventory management.

---

## 3. Implementation Plan

### Phase 1: Frontend Routing & Workspaces
Implement strict routing to load module-specific configurations.
*   **Route `/in-house/`**: Loads In-House Sidebar (Employees, Scanner) and Dashboard.
*   **Route `/external/`**: Loads External Sidebar (Projects, DC) and Dashboard.
*   **App Switcher:** A global navigation element allowing users with sufficient permissions to toggle between workspaces.

### Phase 2: Context-Aware Backend APIs
Refactor `server.js` to support scoped data retrieval.
*   **`GET /api/assets?scope=in-house`**:
    *   Filters by In-House categories.
    *   Joins with `employees` table for detailed assignment info.
*   **`GET /api/assets?scope=external`**:
    *   Filters by External categories.
    *   Joins with `projects` table for status (e.g., "On Site", "In Transit").

### Phase 3: The "Cross-Over" Features
1.  **Unified Search:** A global search bar accessible from either module that can find *any* asset ID. 
    *   *Example:* IT Admin searches for a rental camera -> Result: "Asset found in External Module (Status: On Project X)."
2.  **Asset Transfer Actions:** Specific workflows to move custody of an asset from one scope to another (e.g., "Transfer to Project" action on an IT asset).

---

## Summary of Impact
*   **User Experience:** Simplified interfaces focused on the user's specific role (IT vs. Logistics).
*   **Data Integrity:** Reduced risk of accidental cross-assignment (e.g., assigning a server to a movie production).
*   **Security:** HR data (Employees) is physically segregated from the view of Project Managers.
