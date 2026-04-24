# AssetManager Project Documentation

## 1. Overview: What is it and what is it for?
**AssetManager** is a comprehensive, enterprise-grade inventory and lifecycle management system designed to track physical and quantity-based assets from procurement to decommissioning.

### Core Purpose:
- **Centralized Tracking:** Eliminates fragmented spreadsheets by providing a single source of truth for all hardware and inventory.
- **Project Lifecycle Management:** Specifically designed for project-based organizations to allocate resources efficiently across multiple locations.
- **Traceability:** Provides a complete audit trail of where an asset has been, who used it, and which project it was assigned to.
- **Compliance & Auditing:** Built-in QR code scanning and quantity history tracking for rapid physical audits and financial reporting.

---

## 2. System Architecture (The Layers)

### **Frontend (The User Interface)**
- **Tech Stack:** Vanilla JavaScript (ES6 Modules), HTML5, CSS3.
- **Key Components:** Uses **Tabulator** for high-performance data grids, **Chart.js** for reporting, and **Html5-Qrcode** for scanning.
- **Communication:** Communicates with the backend via a RESTful JSON API using the `fetch` API.

### **Backend (The Logic Engine)**
- **Tech Stack:** Node.js, Express.
- **Responsibility:** Handles authentication, business logic for asset splitting/assignment, OCR processing, Tally synchronization, and document generation (PDF/Excel/Word).
- **Security:** Implements JWT-based authentication and BCrypt password hashing for secure user access.

### **Database (The Data Layer)**
- **Tech Stack:** SQLite3 (via `better-sqlite3`).
- **Structure:** A relational schema optimized for speed and reliability. Key tables include:
    - `assets`: Current state and metadata of all items.
    - `quantity_events`: Immutable audit log of all quantity changes and splits.
    - `project_assets`: Real-time allocation mapping.
    - `delivery_challans`: Legal manifests for shipping.

---

## 3. Top Bar Navigation & Interconnectivity

### **🏠 Dashboard**
- **Function:** The primary interactive view for managing individual assets and categories.
- **Features:** Kanban board for status tracking, QR scanning, and the "Managed Batch" module for selectable serial numbers.
- **Interconnection:** Gateway to the "Edit Modal," where assets are split, assigned, or updated.

### **📊 Sheet (Excel View)**
- **Function:** A tabular, high-density view for bulk management and reporting.
- **Features:** Direct export to Excel, Tally Prime synchronization, and Graph API integration.

### **👥 Employees**
- **Function:** Management of personnel and their assigned hardware.
- **Features:** Bulk upload via Excel, department quotas, and assignment history.

### **🚚 Create DC**
- **Function:** Generates legal shipping manifests (Delivery Challans).
- **Features:** Auto-populating company templates, QR-coded manifests, and automated status "stamping" (`SentAgainstDC`).

### **🏗️ Projects**
- **Function:** Central command for project-based inventory allocation.
- **Features:** Track asset movement per project and manage project-specific orders.

### **📦 Consignments & 📅 Rentals**
- **Function:** Specialized modules for tracking items sent out on consignment or temporary rental basis.

### **📡 Network Scanner**
- **Function:** Automated discovery of network-connected devices (via IP/MAC scanning).
- **Interconnection:** Discovered devices can be converted into tracked assets.

### **📄 Document OCR**
- **Function:** Uses AI (Tesseract.js) to extract text and tables from physical documents (Invoices, POs).
- **Interconnection:** Extracted data can be exported to Excel or Word to streamline data entry.

### **🛡️ Warranty**
- **Function:** Proactive tracking of warranty and AMC expirations.
- **Features:** Visual timelines and automated alerts for expiring contracts.

### **⚙️ Settings & Admin**
- **Function:** System configuration, user role management (RBAC), and audit log viewing.

---

## 4. The "Version 1" Framework: Asset Lifecycle

The system is built around a streamlined 3-step lifecycle:

### **Step 1: Adding Assets (The Intake)**
- **Single/Batch Entry:** Assets enter the system individually or as bulk batches.
- **Metadata Stamping:** On entry, assets are stamped with procurement details (`BoughtAgainstPO`).
- **QR Generation:** A unique QR code is instantly generated for physical tagging.

### **Step 2: Assigning to Projects (The Allocation)**
- **One-Click Split:** Using the "Selectable Serial Number Module," an individual unit (e.g., one laptop) is "carved out" of a bulk batch.
- **Project Linkage:** The unit is instantly moved to "Project" status and linked to a Project ID in the `project_assets` table.
- **Real-time Sync:** The parent batch quantity decreases automatically, ensuring inventory integrity.

### **Step 3: Creating the DC (The Dispatch)**
- **Manifest Generation:** Assets assigned to a project are selected in the DC module.
- **Traceability Stamping:** The system "stamps" the unique DC number onto each asset row (`SentAgainstDC`).
- **Legal Output:** A professional, QR-coded PDF manifesto is generated for logistics and compliance.

---
*Documentation Version: 1.1 | Date: 2026-03-23*
