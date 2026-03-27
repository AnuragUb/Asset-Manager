# Infrastructure Upgrade & Migration Research Plan

This document outlines the strategic plan for upgrading the Asset Manager infrastructure from a local SQLite setup to a robust, scalable, containerized architecture using PostgreSQL, Redis, and Google Cloud Storage (GCS).

## 1. Database Migration: SQLite to PostgreSQL

**Objective:** Transition from the file-based SQLite database (`database_v2.db`) to a server-based PostgreSQL database to support concurrent writes, strict typing, and higher data volume.

### Benefits
- **Concurrency:** PostgreSQL handles multiple simultaneous users/writes significantly better than SQLite (which locks the file).
- **Data Types:** Richer data types (JSONB, Arrays) which are useful for dynamic asset attributes.
- **Scalability:** Can be hosted on a dedicated server or managed cloud instance (e.g., AWS RDS, Google Cloud SQL).

### Migration Steps
1.  **Schema Dump:** Export the current SQLite schema.
2.  **Schema Conversion:** Adapt SQLite-specific syntax to PostgreSQL (e.g., `INTEGER PRIMARY KEY AUTOINCREMENT` -> `SERIAL PRIMARY KEY`, `TEXT` dates -> `TIMESTAMPTZ`).
3.  **Data Export:** Write a script to export SQLite data to CSV or JSON.
4.  **Data Import:** Use `COPY` command or a Node.js script to insert data into PostgreSQL, respecting foreign key constraints.
5.  **Code Adaptation:**
    -   Replace `better-sqlite3` driver with `pg` (node-postgres).
    -   Refactor SQL queries (replace `?` placeholders with `$1`, `$2`).
    -   *Recommendation:* Implement a **Database Adapter Pattern** in the code to switch between SQLite (dev) and Postgres (prod) if desired, or fully commit to Postgres (recommended for consistency).

## 2. Caching & Performance: Redis Implementation

**Objective:** Introduce Redis to reduce database load and handle volatile data.

### Use Cases
- **Session Management:** Store user sessions in Redis instead of memory/file to allow the backend server to restart without logging users out.
- **Data Caching:** Cache heavy read operations (e.g., the global employee lookup list or hierarchy trees) with a TTL (Time To Live).
- **Rate Limiting:** Protect API endpoints (like login or OCR) from abuse.

### Implementation Steps
1.  **Infrastructure:** Spin up a Redis container (see Docker section).
2.  **Integration:** Install `redis` or `ioredis` npm package.
3.  **Logic Update:**
    -   Wrap expensive `db.prepare(...).all()` calls with a "Check Cache -> Return if Hit -> Query DB -> Store in Cache" pattern.
    -   Invalidate relevant cache keys when Data is created/updated/deleted (CRUD hooks).

## 3. Environment Separation & Containerization (Docker)

**Objective:** Ensure "it works on my machine" translates to production by using Docker.

### Strategy
- **Development (`docker-compose.dev.yml`):**
    -   Runs Node.js app with `nodemon` for hot-reloading.
    -   Runs local PostgreSQL and Redis containers.
    -   Exposes ports locally (e.g., 8080, 5432, 6379).
- **Production (`docker-compose.prod.yml`):**
    -   Runs optimized Node.js app (built, no dev dependencies).
    -   PostgreSQL/Redis data stored in named Docker volumes for persistence (or connects to managed cloud databases).
    -   Restart policies set to `always`.

### Data Integrity & Safety
- **Volumes:** Database files must be mounted to Docker Volumes (`postgres_data`), NOT inside the container's ephemeral file system.
- **Env Vars:** Use `.env` files to inject credentials. Never commit `.env` to GitHub.

## 4. Version Control: GitHub Workflow

**Objective:** Safe code evolution without breaking production.

### Branching Strategy
- **`main` / `master`:** Production-ready code. NEVER push directly here.
- **`develop`:** Staging area for next release.
- **`feature/feature-name`:** Short-lived branches for specific tasks (e.g., `feature/postgres-migration`).

### Workflow
1.  Developer pulls `develop`.
2.  Creates `feature/new-login`.
3.  Pushes to GitHub.
4.  Opens **Pull Request (PR)** to merge into `develop`.
5.  CI/CD (optional future step) runs tests.
6.  Once tested, `develop` is merged to `main` for deployment.

## 5. Asset Storage Migration: Local Disk to Google Cloud Storage (GCS)

**Objective:** Stop storing uploaded files (images, PDFs) on the local server disk. This allows the backend to be stateless (essential for scaling).

### Architecture
- **Current:** Files saved to `/uploads` folder.
- **Target:** Files uploaded to a GCS Bucket. Database stores the GCS Object URL or Path.

### Implementation Steps
1.  **Setup:** Create GCS Bucket (e.g., `asset-manager-uploads`). Create Service Account with "Storage Object Admin" role.
2.  **Backend Update:**
    -   Install `@google-cloud/storage`.
    -   Replace `fs.writeFile` logic with GCS Stream Upload.
3.  **Access Control (Signed URLs):**
    -   **Private Bucket:** Best for security.
    -   **Read:** Generate "Signed URLs" (valid for 15-60 mins) when the frontend requests an image. This ensures only authenticated users with correct RBAC permissions can view files.
4.  **Migration Script:**
    -   Iterate through local `/uploads`.
    -   Upload each file to GCS.
    -   Update database records to point to cloud path.

## 6. Summary of Technologies

| Component | Current | Target | Purpose |
| :--- | :--- | :--- | :--- |
| **Database** | SQLite (File) | PostgreSQL | Data Integrity, Concurrency |
| **Caching** | None (Memory) | Redis | Speed, Session Persistence |
| **File Storage** | Local Disk | Google Cloud Storage | Scalability, Stateless Server |
| **Runtime** | Node.js (Local) | Docker Container | Consistency across Dev/Prod |
| **Version Control** | Local | GitHub | History, Collaboration, Rollback |

