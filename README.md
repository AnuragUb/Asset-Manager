# Asset Management Tool

A comprehensive asset management system with user roles and change tracking.

## Features

- **User Authentication**: Login system with roles (User and Super User)
- **Asset Management**: Create, Read, Update, Delete assets
- **Change Tracking**: Complete audit log of all changes
- **Role-Based Access**: Super users can view audit logs
- **Asset Fields**: Name, Type, Status, Location, Assigned To, Notes

## Quick Start

1. **Launch the tool**: Double-click `asset_manager.bat`
2. **Login**: Use default credentials:
   - **Super User**: `admin` / `admin123`
   - **Regular User**: `user` / `user123`

## Default Credentials



- **Super User** (can view audit logs):
  - Username: `admin`
  - Password: `admin123`

- **Regular User** (can manage assets):
  - Username: `user`
  - Password: `user123`

## Asset Fields

- **ID**: Auto-generated unique identifier (AST-YYYYMMDDHHMMSS)
- **Name**: Asset name/description
- **Type**: Computer, Printer, Monitor, Phone, Tablet, Other
- **Status**: Available, In Use, Repair, Retired, Lost
- **Location**: Physical location of the asset
- **Assigned To**: Person/department using the asset
- **Notes**: Additional information
- **Last Updated**: Timestamp of last modification

## User Roles

### Regular User
- View assets
- Add new assets
- Update asset details (edit directly in the grid)
- Delete assets
- Cannot view audit logs

### Super User
- All regular user permissions
- **View Audit Log**: Complete change history with:
  - Timestamp
  - User who made the change
  - Action (CREATE, UPDATE, DELETE, LOGIN, LOGOUT)
  - Asset ID
  - Details of changes

## Files

- `asset_manager.bat` - Launcher script
- `asset_manager.ps1` - Main application script
- `assets.json` - Asset data storage
- `users.json` - User accounts and passwords
- `audit_log.json` - Complete change history (super users only)

## How to Use

### Adding Assets
1. Click "Add Asset"
2. Fill in asset details
3. Click "Save"

### Updating Assets
1. Select an asset in the grid
2. Edit directly in the grid cells
3. Click "Update Selected"
4. Changes are logged automatically

### Deleting Assets
1. Select an asset in the grid
2. Click "Delete Selected"
3. Confirm deletion

### Viewing Audit Log (Super Users Only)
1. Click "View Audit Log"
2. See complete history of all changes
3. Includes who, what, when, and details

## Security Notes

- Passwords are stored in plain text in `users.json`
- Consider implementing encryption for production use
- Super users should change default passwords
- Keep `users.json` and `audit_log.json` secure

## Audit Log Details

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

