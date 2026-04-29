# --- Asset Manager DB Replication Script ---
# Use this script to replicate the database from the current machine to another machine.

# CONFIGURATION
$DB_CONTAINER = "asset-manager-db"
$DB_NAME = "asset_manager"
$DB_USER = "postgres"

# The IP of the machine you want to SEND the data TO
$TARGET_IP = "192.168.6.118" 
$TARGET_SHARE = "\\$TARGET_IP\AssetManager_Backups"
$LOCAL_BACKUP_PATH = "C:\AssetManager_Replication_Backups"

# Ensure local path exists
if (!(Test-Path -Path $LOCAL_BACKUP_PATH)) { New-Item -ItemType Directory -Path $LOCAL_BACKUP_PATH | Out-Null }

# SCRIPT
$timestamp = Get-Date -Format "yyyyMMdd_HHmm"
$filename = "replication_sync_$timestamp.sql"
$localFile = Join-Path $LOCAL_BACKUP_PATH $filename
$remoteFile = Join-Path $TARGET_SHARE $filename

Write-Host "[STEP 1] Creating Local Snapshot..." -ForegroundColor Cyan
docker exec $DB_CONTAINER pg_dump -U $DB_USER $DB_NAME > $localFile

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Docker failed to create snapshot." -ForegroundColor Red
    exit
}

Write-Host "[STEP 2] Pushing to Target Machine ($TARGET_IP)..." -ForegroundColor Yellow
try {
    if (Test-Path $TARGET_SHARE) {
        Copy-Item -Path $localFile -Destination $remoteFile -Force
        Write-Host "[SUCCESS] Data replicated to $TARGET_IP" -ForegroundColor Green
    } else {
        Write-Host "[ERROR] Target share $TARGET_SHARE is not reachable. Ensure the folder is shared on the other machine." -ForegroundColor Red
    }
} catch {
    Write-Host "[ERROR] Replication failed: $_" -ForegroundColor Red
}

# Cleanup: Keep only last 5 replication files
Get-ChildItem $LOCAL_BACKUP_PATH -Filter "replication_sync_*.sql" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 5 | Remove-Item
