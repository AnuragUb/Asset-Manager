# --- NVMe PC Failover Restore ---
# This script should be run on your PRIMARY PC (NVMe machine) ONLY if the other server goes down.
# It restores the latest synced data into your local Backup Production instance.

# CONFIGURATION
$DB_CONTAINER = "asset-manager-db-prod"
$DB_NAME = "asset_manager"
$DB_USER = "postgres"
$BACKUP_DIR = "E:\AssetManager_Backups" # Your local NVMe backup folder

# SCRIPT
Write-Host "[FAILOVER] Locating latest synced data on NVMe..." -ForegroundColor Yellow

$latest = Get-ChildItem $BACKUP_DIR -Filter "*.sql" | Sort-Object LastWriteTime -Descending | Select-Object -First 1

if ($null -eq $latest) {
    Write-Host "[ERROR] No backup files found in $BACKUP_DIR" -ForegroundColor Red
    exit
}

Write-Host "[FAILOVER] Restoring from: $($latest.Name)" -ForegroundColor Cyan

# 1. Copy file into the local docker container
docker cp $latest.FullName "$($DB_CONTAINER):/restore.sql"

# 2. Run the restore command
docker exec $DB_CONTAINER psql -U $DB_USER -d $DB_NAME -f /restore.sql

if ($LASTEXITCODE -eq 0) {
    Write-Host "[SUCCESS] Failover complete. This PC is now the active Production server." -ForegroundColor Green
} else {
    Write-Host "[ERROR] Restore failed." -ForegroundColor Red
}
