# --- Primary Server to NVMe Backup Sync (Zero Data Loss Version) ---
# This script should be placed on the PRIMARY SERVER workstation.
# It creates a local backup first (Black Box), then attempts to sync to the NVMe machine.
# If the network fails, it will retry continuously until successful.

# CONFIGURATION
$DB_CONTAINER = "asset-manager-db-prod"
$DB_NAME = "asset_manager"
$DB_USER = "postgres"
$NVME_TARGET_PATH = "\\YOUR-NVME-PC-IP\NVMe_Share\Backups" # Remote path
$LOCAL_BACKUP_PATH = "C:\AssetManager_Local_Backups"       # Local Black Box

# Ensure local path exists
if (!(Test-Path -Path $LOCAL_BACKUP_PATH)) { New-Item -ItemType Directory -Path $LOCAL_BACKUP_PATH | Out-Null }

# SCRIPT
$timestamp = Get-Date -Format "yyyyMMdd_HHmm"
$filename = "prod_sync_$timestamp.sql"
$localFile = Join-Path $LOCAL_BACKUP_PATH $filename
$remoteFile = Join-Path $NVME_TARGET_PATH $filename

Write-Host "[STEP 1] Creating Local Black Box Snapshot..." -ForegroundColor Cyan

# 1. ALWAYS save a local copy first (in case network is down)
docker exec $DB_CONTAINER pg_dump -U $DB_USER $DB_NAME > $localFile

if ($LASTEXITCODE -ne 0) {
    Write-Host "[CRITICAL] Docker failed to create local snapshot. Database may be down!" -ForegroundColor Red
    exit
}

Write-Host "[STEP 2] Attempting to push to NVMe Server..." -ForegroundColor Yellow

# 2. Try to push to the NVMe machine (Retry Loop)
$maxRetries = 12 # Try every 5 mins for 1 hour
$retryCount = 0
$synced = $false

while (-not $synced -and $retryCount -lt $maxRetries) {
    try {
        if (Test-Path $NVME_TARGET_PATH) {
            Copy-Item -Path $localFile -Destination $remoteFile -Force
            Write-Host "[SUCCESS] Backup safely pushed to NVMe SSD: $remoteFile" -ForegroundColor Green
            $synced = $true
        } else {
            throw "Network path unreachable"
        }
    } catch {
        $retryCount++
        Write-Host "[WARNING] NVMe Server Unreachable. Attempt $retryCount of $maxRetries. Retrying in 5 minutes..." -ForegroundColor DarkYellow
        Start-Sleep -Seconds 300
    }
}

if (-not $synced) {
    Write-Host "[CRITICAL ERROR] Failed to push to NVMe after 1 hour. Local backup exists at $localFile" -ForegroundColor Red
    # Here you could add code to send an email/Slack alert
}

# Optional: Clean up backups older than 7 days
Get-ChildItem $LOCAL_BACKUP_PATH -Filter "*.sql" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } | Remove-Item
try { Get-ChildItem $NVME_TARGET_PATH -Filter "*.sql" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } | Remove-Item } catch {}
