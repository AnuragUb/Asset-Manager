# Asset Manager Backend

This document outlines the architecture, setup, and deployment considerations for the Asset Manager Backend.

## Table of Contents
1.  [Architecture Overview](#architecture-overview)
2.  [Project Structure](#project-structure)
3.  [Setup and Installation](#setup-and-installation)
4.  [Running the Application](#running-the-application)
5.  [API Endpoints](#api-endpoints)
6.  [Frontend Integration](#frontend-integration)
7.  [Production Readiness](#production-readiness)
8.  [Server Migration (Local/GCP)](#server-migration-localgcp)
9.  [Code Invisibility (F12 Protection)](#code-invisibility-f12-protection)

## 1. Architecture Overview
The Asset Manager application follows a clear separation of concerns with a distinct frontend and backend. The backend is responsible for:
-   Serving static frontend files.
-   Handling API requests for data management (login, asset management, user management).
-   Providing legacy module access patterns for utility functions.

## 2. Project Structure

```
asset-manager-backend/
├── node_modules/
├── utils.js             # Modularized utility functions
├── server.js            # Main backend server logic
├── package.json
└── package-lock.json
```

## 3. Setup and Installation

1.  **Navigate to the backend directory:**
    ```bash
    cd web-app/asset-manager-backend
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```

## 4. Running the Application

To start the backend server:

```bash
npm start
```

The server will typically run on `http://localhost:8080`.

## 5. API Endpoints

The backend exposes the following API endpoints:

-   `POST /api/login`: Handles user authentication.
-   `GET /api/assets`: Retrieves asset data.
-   `GET /api/users`: Retrieves user data (admin/superuser only).
-   `GET /api/qr/:id`: Generates QR codes for asset IDs.
-   *(Further API endpoints for asset creation, update, deletion, etc., can be added here)*

## 6. Frontend Integration

The backend serves the static frontend files located in `../asset-manager-frontend/dist`. The `server.js` is configured to serve these minified files.

## 7. Production Readiness

To prepare the application for production:

-   **Environment Variables:** Manage sensitive information (e.g., database credentials, API keys) using environment variables.
-   **Error Handling:** Implement robust error logging and handling mechanisms.
-   **Security:** Ensure all API endpoints are secured with appropriate authentication and authorization.
-   **Performance:** Optimize database queries and API responses.
-   **Monitoring:** Set up monitoring and alerting for server health and application performance.

## 8. Server Migration (Local/GCP)

The current architecture with a clear frontend/backend separation facilitates easy migration.

### Local Server Migration
-   Ensure Node.js and npm are installed on the target local server.
-   Copy the `asset-manager-backend` directory to the server.
-   Install dependencies (`npm install`).
-   Start the application (`npm start`).
-   Configure a reverse proxy (e.g., Nginx, Apache) to serve the frontend and proxy API requests to the backend if needed.

### GCP (Google Cloud Platform) Migration
-   **App Engine/Cloud Run:** Deploy the backend as a service on App Engine or Cloud Run for scalable and managed hosting.
-   **Cloud Storage:** Host static frontend files (from `asset-manager-frontend/dist`) on Google Cloud Storage and serve them via a CDN (e.g., Cloud CDN) for global distribution and performance.
-   **Cloud SQL/Firestore:** Migrate data to a managed database service like Cloud SQL (for relational databases) or Firestore (for NoSQL).
-   **Load Balancing:** Use Google Cloud Load Balancing to distribute traffic and ensure high availability.
-   **CI/CD:** Implement Continuous Integration/Continuous Deployment pipelines using Cloud Build for automated deployments.

## 9. Code Invisibility (F12 Protection)

To make the frontend code less visible via browser F12 developer tools:

-   **Minification:** Frontend JavaScript files are minified using `terser` during the build process. The `package.json` in `asset-manager-frontend` contains a `build` script for this purpose.
-   **Obfuscation (Future Consideration):** For enhanced protection, consider adding a JavaScript obfuscator to further obscure the code. However, complete "invisibility" is not achievable as browser always needs to execute the code. The goal is to make it harder to read and understand.
