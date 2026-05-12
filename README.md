# Asset Management Tool (Web Version)

This is the web-based version of the Asset Management system. The local PowerShell and Electron versions are now deprecated in favor of this web application.

## Quick Start (Web App)

1. **Navigate to the web app directory**:
   ```bash
   cd web-app/asset-manager-backend
   ```
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Start the server**:
   ```bash
   node server.js
   ```
4. **Access the app**: Open your browser and go to `http://localhost:8080`

## Features

- **Modern Web UI**: Responsive dashboard and asset management interface.
- **Atomic Sync**: Assets, components, and warranty details are updated synchronously in a single request.
- **QR Code Integration**: Automatic QR code generation for asset tracking.
- **IT-Specific Fields**: Specialized tracking for MAC addresses, IP addresses, and network details.
- **Employee Management**: Assign assets directly to employees from a global directory.
- **Audit Logging**: Comprehensive change tracking for all asset modifications.

## Core Ground Rules

- **Web App Only**: We are currently and for the foreseeable future only working on the web app. The local app versions are deprecated.
- **Simplified Version Control**: Changes are automatically pushed to the GitHub repository.

## Project Structure

- `web-app/asset-manager-backend`: Express.js server and SQLite database.
- `web-app/asset-manager-frontend`: HTML/JS frontend (Vanilla JS with ES Modules).
- `web-app/asset-manager-frontend/dist`: Production-ready frontend assets.

## Deprecated Versions

- `electron-app/`: The Electron-based desktop wrapper is deprecated.
- `asset_manager.ps1` & `asset_manager.bat`: The PowerShell-based local GUI is deprecated.

---

Every action is logged with:
- **Timestamp**: When the action occurred
- **User**: Who performed the action
- **Action**: Type of action (CREATE, UPDATE, DELETE, LOGIN, LOGOUT)
- **Asset ID**: Which asset was affected
- **Details**: Description of the change
- **Old Value**: Previous asset data (for updates)
- **New Value**: New asset data (for creates/updates)

## Customization

### Adding New Asset Types
Edit `asset_manager.ps1` and modify the ComboBox items in the Add Asset section.

### Adding New Status Options
Edit `asset_manager.ps1` and modify the Status ComboBox items.

### Changing User Credentials
Edit `users.json` directly or modify the default user creation in `Load-Users` function.

## Requirements

- Windows 7 or later
- PowerShell 3.0 or later
- No additional dependencies

