# --- Asset Manager DB Replication Script (118 -> 59) ---
# RUN THIS ON THE .118 SERVER AS ADMINISTRATOR

# CONFIGURATION
$DB_CONTAINER = "asset-manager-db"
$DB_NAME = "asset_manager"
$DB_USER = "postgres"

# The IP of the machine you want to SEND the data TO (.59 server)
$TARGET_IP = "192.168.6.59" 
$TARGET_SHARE = "\\$TARGET_IP\AssetManager_Backups"
# Repo-root backups/ (script lives in ops/replication/)
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$LOCAL_BACKUP_PATH = Join-Path $RepoRoot "backups\replication"

# Ensure local path exists
if (!(Test-Path -Path $LOCAL_BACKUP_PATH)) { 
    Write-Host "[INIT] Creating local backup directory..." -ForegroundColor Gray
    New-Item -ItemType Directory -Path $LOCAL_BACKUP_PATH | Out-Null 
}

# SCRIPT
$timestamp = Get-Date -Format "yyyyMMdd_HHmm"
$filename = "replication_118_to_59_$timestamp.sql"
$localFile = Join-Path $LOCAL_BACKUP_PATH $filename
$remoteFile = Join-Path $TARGET_SHARE $filename

Write-Host "--------------------------------------------------" -ForegroundColor White
Write-Host "DB REPLICATION: 118 -> 59" -ForegroundColor Magenta
Write-Host "Started at: $(Get-Date)" -ForegroundColor White
Write-Host "--------------------------------------------------" -ForegroundColor White

# STEP 1: Verify Container
Write-Host "[STEP 1/3] Checking Docker container status..." -ForegroundColor Cyan
$containerStatus = docker inspect -f '{{.State.Running}}' $DB_CONTAINER 2>$null
if ($containerStatus -ne "true") {
    Write-Host "[ERROR] Container '$DB_CONTAINER' is not running. Please start it first." -ForegroundColor Red
    exit
}
Write-Host "✅ Container is running." -ForegroundColor Green

# STEP 2: Create Snapshot
Write-Host "[STEP 2/3] Creating PostgreSQL snapshot (pg_dump)..." -ForegroundColor Cyan
try {
    # Using cmd /c to ensure clean redirection without PowerShell encoding issues
    # Use -O to omit ownership for easier restore on different servers
    cmd /c "docker exec $DB_CONTAINER pg_dump -U $DB_USER -O $DB_NAME > ""$localFile"""
    
    if (Test-Path $localFile) {
        $size = (Get-Item $localFile).Length / 1KB
        Write-Host "SUCCESS: Snapshot created successfully ($([math]::Round($size, 2)) KB)." -ForegroundColor Green
    } else {
        throw "Snapshot file was not created."
    }
} catch {
    Write-Host "[ERROR] Failed to create snapshot: $_" -ForegroundColor Red
    exit
}

# STEP 3: Push to .59
Write-Host "[STEP 3/3] Pushing to .59 Machine ($TARGET_IP)..." -ForegroundColor Cyan
Write-Host "Checking connectivity to $TARGET_SHARE..." -ForegroundColor Gray

# RETRY LOGIC (Automated Sync)
$maxRetries = 12 # Try every 5 mins for 1 hour
$retryCount = 0
$synced = $false

while (-not $synced -and $retryCount -lt $maxRetries) {
    try {
        if (Test-Path $TARGET_SHARE) {
            Copy-Item -Path $localFile -Destination $remoteFile -Force -ErrorAction Stop
            Write-Host "✅ Data successfully replicated to .59 shared folder." -ForegroundColor Green
            Write-Host "   Target: $remoteFile" -ForegroundColor Gray
            Write-Host "`nNext Step: Run 'ops/replication/restore_replication.ps1' on the .59 server." -ForegroundColor Yellow
            $synced = $true
        } else {
            throw "Target share $TARGET_SHARE is not reachable."
        }
    } catch {
        $retryCount++
        if ($retryCount -lt $maxRetries) {
            Write-Host "[WARNING] .59 Server Unreachable. Attempt $retryCount of $maxRetries. Retrying in 5 minutes..." -ForegroundColor DarkYellow
            Start-Sleep -Seconds 300 # Wait 5 minutes
        } else {
            Write-Host "[ERROR] Max retries reached. Replication failed: $_" -ForegroundColor Red
        }
    }
}

# Cleanup old local backups (keep last 5)
Write-Host "`n[CLEANUP] Cleaning up old local snapshots..." -ForegroundColor Gray
Get-ChildItem $LOCAL_BACKUP_PATH -Filter "replication_118_to_59_*.sql" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 5 | Remove-Item -ErrorAction SilentlyContinue

Write-Host "--------------------------------------------------" -ForegroundColor White
Write-Host "Replication process finished." -ForegroundColor Magenta
