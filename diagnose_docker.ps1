# --- Docker Diagnostic Script for Asset Manager ---
# Run this on the machine having issues (e.g., .118)

Write-Host "--- Starting Docker Diagnostics ---" -ForegroundColor Cyan

# 1. Check if Docker is running
Write-Host "[1/5] Checking Docker Service..." -ForegroundColor Yellow
docker version >$null 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Docker is NOT running or not in PATH. Please start Docker Desktop." -ForegroundColor Red
    exit
}
Write-Host "[SUCCESS] Docker is running." -ForegroundColor Green

# 2. Check for Port Conflicts
Write-Host "[2/5] Checking for Port Conflicts (8080, 5432, 6379)..." -ForegroundColor Yellow
$ports = @(8080, 5432, 6379)
foreach ($port in $ports) {
    $conn = Test-NetConnection -ComputerName localhost -Port $port -InformationLevel Quiet
    if ($conn) {
        $process = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -First 1
        if ($process) {
            $procName = (Get-Process -Id $process).ProcessName
            Write-Host "[WARNING] Port $port is ALREADY IN USE by '$procName'. This will prevent Docker from starting." -ForegroundColor Yellow
        }
    } else {
        Write-Host "[OK] Port $port is free." -ForegroundColor Gray
    }
}

# 3. Check for existing containers
Write-Host "[3/5] Checking for existing Asset Manager containers..." -ForegroundColor Yellow
$containers = docker ps -a --filter "name=asset-manager" --format "{{.Names}}: {{.Status}}"
if ($containers) {
    Write-Host "[INFO] Found containers:" -ForegroundColor Cyan
    $containers | foreach { Write-Host " - $_" }
} else {
    Write-Host "[INFO] No asset-manager containers found." -ForegroundColor Gray
}

# 4. Check Docker Logs if containers exist but aren't running
Write-Host "[4/5] Checking logs for 'asset-manager-dev'..." -ForegroundColor Yellow
$logs = docker logs asset-manager-dev --tail 20 2>&1
if ($logs) {
    Write-Host "[LOGS] Last 20 lines:" -ForegroundColor Cyan
    $logs | foreach { Write-Host "   $_" }
} else {
    Write-Host "[INFO] No logs found for asset-manager-dev." -ForegroundColor Gray
}

# 5. Suggest Action
Write-Host "[5/5] Recommendation:" -ForegroundColor Yellow
Write-Host "If ports are conflicted, stop the local services (Postgres/Redis/IIS)." -ForegroundColor Cyan
Write-Host "To force a clean start, run: docker compose down; docker compose up -d --build" -ForegroundColor Cyan

Write-Host "--- Diagnostics Complete ---" -ForegroundColor Cyan
