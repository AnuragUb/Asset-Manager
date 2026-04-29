# --- Asset Manager DB Restore Script ---
# Use this script to restore the LATEST replication file received from another machine.

# CONFIGURATION
$DB_CONTAINER = "asset-manager-db"
$DB_NAME = "asset_manager"
$DB_USER = "postgres"
$BACKUP_RECEIVE_PATH = "C:\AssetManager_Backups" # Where replication files are received (Shared Folder)

Write-Host "[CHECK] Looking for latest replication file in $BACKUP_RECEIVE_PATH..." -ForegroundColor Cyan

if (!(Test-Path $BACKUP_RECEIVE_PATH)) {
    Write-Host "[ERROR] Backup path $BACKUP_RECEIVE_PATH does not exist." -ForegroundColor Red
    exit
}

$latestBackup = Get-ChildItem $BACKUP_RECEIVE_PATH -Filter "*.sql" | Sort-Object LastWriteTime -Descending | Select-Object -First 1

if ($null -eq $latestBackup) {
    Write-Host "[ERROR] No SQL backup files found in $BACKUP_RECEIVE_PATH." -ForegroundColor Red
    exit
}

Write-Host "[RESTORE] Using latest backup: $($latestBackup.Name)" -ForegroundColor Yellow

# Confirm before destructive action
$confirmation = Read-Host "Are you sure you want to RESTORE this backup? This will OVERWRITE the current database on THIS machine (y/n)"
if ($confirmation -ne 'y') {
    Write-Host "Restore cancelled."
    exit
}

# 1. Stop app container to prevent locks (optional but safer)
# docker stop asset-manager-app-prod

# 2. Restore
Write-Host "[RESTORE] Injecting SQL into $DB_CONTAINER..." -ForegroundColor Yellow
Get-Content $latestBackup.FullName | docker exec -i $DB_CONTAINER psql -U $DB_USER -d $DB_NAME

if ($LASTEXITCODE -eq 0) {
    Write-Host "[SUCCESS] Database restored successfully from $($latestBackup.Name)" -ForegroundColor Green
} else {
    Write-Host "[ERROR] Database restore failed." -ForegroundColor Red
}

# 3. Start app container again
# docker start asset-manager-app-prod
