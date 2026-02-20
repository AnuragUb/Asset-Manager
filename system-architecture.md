## Asset Manager – System Architecture Overview

### 1. High-Level System View

- **Type:** Single-page web application with a Node.js/Express backend and SQLite database.
- **Primary domains:**
  - Asset inventory, hierarchy, and dashboard
  - Projects and BOM/BOQ
  - Employees
  - OCR and document processing
  - Warranty and lifecycle reporting
- **Runtime:**
  - Backend: Node.js server (`asset-manager-backend/server.js`) running on a LAN host (e.g. `http://localhost:8080`).
  - Frontend: `asset-manager-frontend` static bundle served by the backend (or a static file server), main entry `index.html` (and built `dist/index.html`).
  - Database: SQLite file `database_v2.db` located in `web-app/asset-manager-backend/`.

At a high level:

1. Browser loads the SPA shell (`index.html`) and front-end JS.
2. Frontend makes JSON requests to `/api/*` endpoints and uses HTML/CSS for all rendering.
3. Backend uses `better-sqlite3` for all DB access; there is no separate DB server.

---

### 2. Frontend Architecture

**Location:** `web-app/asset-manager-frontend/`

#### 2.1. Structure

- `index.html`
  - Hosts the main dashboard shell (`#dashboardView`) and all view containers:
    - `#dashboardView` – asset dashboard and most functional views.
    - Sub-views inside `#dashboardView`:
      - `#home-view` – main asset overview.
      - `#projects-view` – projects Kanban board.
      - `#employee-view` – employees listing/cards.
      - `#dc-view` – delivery challans.
      - `#warranty-view` – warranty reports.
      - `#ocr-view` – OCR client.
      - `#settings-view` – settings.
    - Global modals:
      - Create/Initialize Project modal (`#createProjectModal`).
      - Project Details modal (`#projectDetailsModal`).
      - Assign Asset modal, Add Temporary Asset modal, etc.
  - Left sidebar with navigation links (Assets, Employees, Projects, Warranty, OCR, etc.).

- Core JS files:
  - `js/main.js`
    - Initializes application on page load.
    - Manages navigation and view switching based on sidebar clicks.
    - Maintains a `views` mapping that associates nav IDs (`nav-projects`, `nav-employees`, etc.) with:
      - Which main view to show (usually `dashboardView`).
      - Which sub-view to show (`projects-view`, `employee-view`, etc.).
      - An `init` function to run when that view is activated.
  - `js/dashboard.js`
    - Renders the main asset dashboard (cards, grid, Kanban).
    - Contains global behavior for asset filtering, scrolling, and some shared UI.
    - Defines additional helpers related to projects and BOM integration.
  - `js/projects.js`
    - Owns the Projects Kanban board and related UI logic.
    - Handles:
      - Loading projects from `/api/projects`.
      - Rendering Kanban columns (Planning, Active, On Hold, Completed).
      - Wiring up the Create Project modal.
      - Showing the Project Details modal and loading its tabs (assets, temp assets, BOM).
      - Inline editing of project Location via `PATCH /api/projects/:id`.
  - Additional domain scripts:
    - `js/employees.js` – employees list/pagination.
    - `js/ocr.js` – OCR client (uploads and displays results).
    - `js/utils.js` – shared utilities (view switching, Tabulator redraw, toast notifications, etc.).

#### 2.2. View Navigation and Lifecycle

- Navigation is driven by the sidebar links (`#nav-dashboard`, `#nav-projects`, etc.).
- `main.js` attaches click handlers to nav links, sets the active link, and:
  - Hides all views.
  - Shows the target `view` and `subView`.
  - Calls the mapped `init` function once the view is shown.

For example, when the **Projects** tab is selected:

1. `main.js` selects view `dashboardView` and sub-view `projects-view`.
2. It calls `initProjectsView()` from `projects.js`.
3. `initProjectsView()`:
   - Wires the Create Project button and search box.
   - Adds a Refresh button.
   - Calls `loadProjects()` to fetch data from `/api/projects` and render the Kanban board.

#### 2.3. Projects View

Key elements in `projects.js`:

- `initProjectsView()`
  - Sets up event listeners (Create Project, search, refresh).
  - Populates the `allProjects` array with normalized data from `/api/projects`.

- `loadProjects()`
  - Calls `GET /api/projects`.
  - Populates `allProjects` with objects like:
    - `ID, Name, ClientName, Location, Currency, Description, Status, StartDate, EndDate, ...`
  - Updates a small count label (`#projectCount`).
  - Calls `renderProjectsKanban(allProjects)`.

- `renderProjectsKanban(projects)`
  - Groups projects by `Status` into four columns: Planning, Active, On Hold, Completed.
  - Renders each project as a card showing:
    - Status pill.
    - Project Name.
    - Client Name.
    - Footer with:
      - `📍 Location` (from `p.Location`).
      - Start Date summary.
  - Cards are:
    - Clickable → `showProjectDetails(ID)` opens the Project Details modal.
    - Draggable between columns to change Status (used alongside logic in `dashboard.js`).

- `handleCreateProject(e)`
  - Reads values from the Create Project modal fields:
    - `sideProjectName`, `sideProjectClient`, `sideProjectLocation`,
      `sideProjectStatus`, `sideProjectCurrency`, `sideProjectDesc`,
      `sideProjectStartDate`, `sideProjectEndDate`.
  - Validates required fields (name + location).
  - Sends `POST /api/projects` with a JSON body:
    - `{ name, client, location, status, currency, description, startDate, endDate }`.
  - On success:
    - Closes the Create Project modal.
    - Reloads the projects Kanban.
    - Clears the form.

- `showProjectDetails(id)`
  - Locates the project in `allProjects` or fetches `/api/projects/:id`.
  - Populates:
    - `#modalProjectTitle` with the project name.
    - `#projectClientInfo` with Client Name and Description.
    - `#projectStats` with:
      - Location (with inline Edit button).
      - Status.
      - Currency.
      - Start Date.
  - Shows `#projectDetailsModal`.
  - Calls `loadProjectAssets(id)` to fill the Project Assets tab.

- Inline Location editing
  - The stats panel renders Location with an Edit button.
  - Clicking Edit:
    - Prompts for a new location string.
    - Sends `PATCH /api/projects/:id` with `{ Location: "<new>" }`.
    - On success:
      - Updates `project.Location` in memory.
      - Updates the visible text.
      - Calls `loadProjects()` to refresh the Kanban.

#### 2.4. Project Details Tabs

Inside `#projectDetailsModal` (in `index.html`):

- Tabs:
  - **Project Assets**
    - Displays permanent assigned assets.
    - Uses `loadProjectAssets(projectId)` and `GET /api/projects/:id/assets`.
  - **Temporary Assets**
    - Shows project-specific temporary items (rental/service/BOM items).
    - Uses `GET /api/projects/:id/temporary-assets` and POST/DELETE endpoints for management.
  - **BOM / Export**
    - Uses a consolidated endpoint `GET /api/projects/:id/assets`.
    - Renders a BOM/BOQ table (ID, Item Name, Make, Model, Status, Category, Type, Qty, pricing columns).
    - Supports print and placeholder for export.

---

### 3. Backend Architecture

**Location:** `web-app/asset-manager-backend/`

#### 3.1. Core Components

- `server.js`
  - Single Express app entry point.
  - Sets up:
    - JSON parsing and basic middleware.
    - Static file serving for the frontend bundle.
    - All `/api/*` REST endpoints:
      - Assets, Projects, Employees, Delivery Challans, OCR proxy, etc.
  - Initializes database connection via `better-sqlite3`.
  - Runs lightweight migrations such as:
    - Adding `QRCode` column to `projects` if missing.
    - Ensuring `project_history` table exists.
    - Adding extra columns like `OwnerEmail` and `CoordinatorEmail`.

- `utils.js`
  - Reusable helper functions:
    - `locCode(location)` – converts locations into code segments for IDs.
    - `generateProjectId(location)` – creates a unique project ID string.
    - `getLocalIP()` – finds LAN IP for QR payloads.
    - `generateProjectQRPayload(project, ip, port)` – builds QR destination information.
  - Also holds helpers for other integrations (e.g. Tally payloads).

#### 3.2. Project-related Endpoints

Located in `server.js` under the “Project Management Endpoints” section.

- `GET /api/projects`
  - Optional query `projectId`.
  - Returns a list of projects:
    - `ID, Name (alias of ProjectName), ClientName, Location, Currency, Description, Status, StartDate, EndDate, OwnerEmail, CoordinatorEmail, Timestamp, QRCode`.

- `POST /api/projects`
  - Accepts JSON body:
    - `{ name, client, location, currency, description, status, startDate, endDate, createdBy, ownerEmail, coordinatorEmail }`.
  - Uses `generateProjectId(location || "MUMBAI")` to create an ID.
  - Uses `generateProjectQRPayload` + `qrcode` library to generate a QR image.
  - Inserts into `projects` table, including Location and Currency.
  - Inserts an initial row into `project_history`:
    - Status: `status || 'Planning'`.
    - Note: `"Project initialized"`.

- `GET /api/projects/:id`
  - Returns a single project by ID with all core fields and `QRCode`.

- `GET /api/projects/:id/history`
  - Returns all rows from `project_history` for the project ordered by `Timestamp`.

- `PATCH /api/projects/:id`
  - Accepts partial updates (JSON):
    - Any combination of `ProjectName, ClientName, Status, Description, StartDate, EndDate, Location, Currency, OwnerEmail, CoordinatorEmail`.
  - Internally allows `status` as a shortcut that maps to `Status`.
  - If `Status` has changed:
    - Inserts a new `project_history` row with a textual note about the change.
  - If key fields (name, client, location, etc.) changed:
    - Regenerates the stored QRCode for the project.

- `GET /api/projects/:id/assets`
  - Returns a consolidated list of items for a project BOM:
    - Permanent assets linked via `project_assets`.
    - Temporary assets from `temporary_assets`.

- `POST /api/projects/:id/assign-asset`
  - Takes `{ AssetID, Type }`.
  - Validates that the asset is not already assigned in a conflicting way.
  - Inserts into `project_assets`.

- `DELETE /api/projects/:id/unassign-asset/:assetId`
  - Removes a permanent asset assignment.

- `GET /api/projects/:id/temporary-assets`, `POST /api/projects/:id/temporary-assets`
  - Manage temporary project items used to build BOM/BOQ.

#### 3.3. QR Endpoint

- `GET /api/qr/:id`
  - If `id` is a project ID (`projects` row exists):
    - Builds URL `http://<localIP>:<port>/project/<id>`.
    - Generates PNG and base64 QR image.
    - Updates `projects.QRCode` and serves PNG.
  - If `id` is an asset ID:
    - Performs a similar flow for `/asset/:id`.
  - If neither exists:
    - Generates a QR of the raw `id` text.

This allows all project and asset labels to be scanned on the LAN and opens appropriate detail pages.

---

### 4. Database Layer and Schema

**Database:** `database_v2.db` (SQLite, accessed via `better-sqlite3`).

Main relevant tables (summarized):

- `projects`
  - `ID TEXT PRIMARY KEY`
  - `ProjectName TEXT NOT NULL`
  - `ClientName TEXT NOT NULL`
  - `Description TEXT`
  - `Status TEXT DEFAULT 'Planning'`
  - `StartDate TEXT`
  - `EndDate TEXT`
  - `CreatedBy TEXT`
  - `Timestamp TEXT`
  - `Location TEXT`
  - `Currency TEXT`
  - `OwnerEmail TEXT`
  - `CoordinatorEmail TEXT`
  - `QRCode TEXT`

- `project_history`
  - `ID INTEGER PRIMARY KEY AUTOINCREMENT`
  - `ProjectID TEXT`
  - `Status TEXT`
  - `Note TEXT`
  - `Timestamp TEXT`

- `temporary_assets`
  - `ID TEXT PRIMARY KEY`
  - `ItemName TEXT NOT NULL`
  - `Type TEXT`
  - `Category TEXT`
  - `Make TEXT`
  - `Model TEXT`
  - `EstimatedPrice REAL`
  - `Quantity INTEGER DEFAULT 1`
  - `ProjectId TEXT`
  - `Status TEXT DEFAULT 'Temporary'`
  - `IsPermanent INTEGER DEFAULT 0`
  - `PermanentAssetId TEXT`
  - `Timestamp TEXT`

- `project_assets`
  - `ProjectID TEXT`
  - `AssetID TEXT`
  - `AssignedDate TEXT`
  - `Type TEXT DEFAULT 'Permanent'`
  - Primary key `(ProjectID, AssetID)`.

- `assets`
  - Main asset inventory; includes:
    - `ID, ItemName, Type, Category, Make, Model, Status, CurrentLocation, AssignedTo, QRCode`, etc.

- Other tables:
  - `employees`, `users`, `delivery_challans`, and others used by different views.

All DB access is done synchronously using `db.prepare(...).get()/all()/run()`.

---

### 5. Key Data Flows (for Architecture Diagrams)

#### 5.1. Project Creation Flow

1. User opens Projects view → `initProjectsView()` → `loadProjects()`.
2. User clicks `+ Create Project` → opens `#createProjectModal`.
3. User fills fields and presses Initialize:
   - Frontend:
     - Validates fields.
     - Sends `POST /api/projects` with project JSON.
   - Backend:
     - Generates ID using `generateProjectId(location)`.
     - Generates QR code via `qrcode` library.
     - Inserts row into `projects`.
     - Inserts an initial row into `project_history`.
   - Frontend:
     - Closes modal.
     - Calls `loadProjects()` to refresh Kanban.

#### 5.2. Asset Assignment and BOM

1. User opens Project Details modal (clicks a Kanban card).
2. In Project Assets tab:
   - Frontend calls `GET /api/projects/:id/assets`.
   - Shows permanent assignments and temporary items in different tabs.
3. To assign a permanent asset:
   - User clicks “+ Assign Asset”.
   - Selects an asset.
   - Frontend posts `POST /api/projects/:id/assign-asset`.
   - Backend validates asset’s current assignment state and inserts into `project_assets`.
4. BOM tab:
   - Frontend calls `GET /api/projects/:id/assets`.
   - Merges permanent and temporary rows into a single BOM table.

#### 5.3. Status Timeline

1. User changes Project Status (e.g. via drag-and-drop in Kanban).
2. Frontend sends `PATCH /api/projects/:id` with `{ status: 'Active' }`.
3. Backend:
   - Updates `Status` field in `projects`.
   - Inserts a new `project_history` row with a note describing the change.
4. Timeline views:
   - Dashboard project details and `project-view.html` both call `GET /api/projects/:id/history` and render a chronological timeline.

#### 5.4. QR Scan to Project View

1. Label for project includes QR image from `/api/qr/:id`.
2. On scan:
   - Browser opens `http://<ip>:<port>/project/<id>`.
3. `project-view.html`:
   - Extracts `id` from the path.
   - Fetches:
     - `GET /api/projects/:id` → core metadata.
     - `GET /api/projects/:id/assets` → BOM/assignments.
     - `GET /api/projects/:id/history` → timeline.
   - Renders a standalone detailed view of the project, with timeline and assets.

---

### 6. Summary for System Architecture Design

When drawing an architecture diagram or system design document, the key points are:

- **Frontend:** Single-page app, modular JS (main, dashboard, projects, etc.), DOM-driven navigation, no heavy framework. Communicates with backend via REST APIs.
- **Backend:** Single Node.js/Express process. Contains all API endpoints, file serving, QR generation, and DB access logic. No separate microservices.
- **Database Layer:** Single SQLite database. Direct SQL in the backend with minimal abstraction. Tables represent core domains (assets, projects, history, temporary items, etc.).
- **Integration points:**
  - OCR / Document AI: backend acts as a proxy to an external service.
  - QR: backend generates QR codes pointing to frontend detail pages.
- **Main workflows:** Asset lifecycle, project lifecycle (creation → asset assignment → BOM → QR/timeline), OCR document processing, warranty reports, and employee management.

This file can be used as the backbone for a more visual System Architecture Design (e.g. C4 diagrams, sequence diagrams, ER diagrams, or high-level architecture slides).

