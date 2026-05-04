# --- Asset Manager DB Replication Script (118 -> 59) ---
# RUN THIS ON THE .118 SERVER

# CONFIGURATION
$DB_CONTAINER = "asset-manager-db"
$DB_NAME = "asset_manager"
$DB_USER = "postgres"

# The IP of the machine you want to SEND the data TO (.59 server)
$TARGET_IP = "192.168.6.59" 
$TARGET_SHARE = "\\$TARGET_IP\AssetManager_Backups"
$LOCAL_BACKUP_PATH = "C:\AssetManager_Backups"

# Ensure local path exists
if (!(Test-Path -Path $LOCAL_BACKUP_PATH)) { New-Item -ItemType Directory -Path $LOCAL_BACKUP_PATH | Out-Null }

# SCRIPT
$timestamp = Get-Date -Format "yyyyMMdd_HHmm"
$filename = "replication_$timestamp.sql"
$localFile = Join-Path $LOCAL_BACKUP_PATH $filename
$remoteFile = Join-Path $TARGET_SHARE $filename

Write-Host "[STEP 1] Creating Snapshot on .118..." -ForegroundColor Cyan
docker exec $DB_CONTAINER pg_dump -U $DB_USER $DB_NAME > $localFile

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Docker failed to create snapshot on .118." -ForegroundColor Red
    exit
}

Write-Host "[STEP 2] Pushing to .59 Machine ($TARGET_IP)..." -ForegroundColor Yellow
try {
    if (Test-Path $TARGET_SHARE) {
        Copy-Item -Path $localFile -Destination $remoteFile -Force
        Write-Host "[SUCCESS] Data replicated to .59 shared folder." -ForegroundColor Green
    } else {
        Write-Host "[ERROR] Target share $TARGET_SHARE is not reachable." -ForegroundColor Red
        Write-Host "Ensure C:\AssetManager_Backups is shared on .59 and accessible from .118." -ForegroundColor Yellow
    }
} catch {
    Write-Host "[ERROR] Replication failed: $_" -ForegroundColor Red
}

# Cleanup old local backups (keep last 10)
Get-ChildItem $LOCAL_BACKUP_PATH -Filter "replication_*.sql" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 10 | Remove-Item
