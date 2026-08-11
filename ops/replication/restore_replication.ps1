# --- Asset Manager DB Restore Script (Apply Replication) ---
# RUN THIS ON THE .59 SERVER

# CONFIGURATION
$DB_CONTAINER = "asset-manager-db"
$DB_NAME = "asset_manager" # or "asset_manager_test" if applying to dev
$DB_USER = "postgres"
# Repo-root backups/ (script lives in ops/replication/)
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$BACKUP_PATH = Join-Path $RepoRoot "backups\replication"

# Find the latest replication file
$latestFile = Get-ChildItem $BACKUP_PATH -Filter "replication_*.sql" | Sort-Object LastWriteTime -Descending | Select-Object -First 1

if ($latestFile -eq $null) {
    Write-Host "[ERROR] No replication files found in $BACKUP_PATH" -ForegroundColor Red
    exit
}

Write-Host "[STEP 1] Stopping Application Containers..." -ForegroundColor Yellow
docker stop asset-manager-dev asset-manager-test

Write-Host "[STEP 2] Applying Snapshot: $($latestFile.Name)..." -ForegroundColor Cyan
# Clear existing DB and restore
docker exec $DB_CONTAINER dropdb -U $DB_USER --if-exists $DB_NAME
docker exec $DB_CONTAINER createdb -U $DB_USER $DB_NAME
Get-Content $latestFile.FullName | docker exec -i $DB_CONTAINER psql -U $DB_USER $DB_NAME

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Restore failed." -ForegroundColor Red
} else {
    Write-Host "[SUCCESS] Database updated to latest production snapshot." -ForegroundColor Green
}

Write-Host "[STEP 3] Restarting Application Containers..." -ForegroundColor Yellow
docker start asset-manager-dev asset-manager-test
