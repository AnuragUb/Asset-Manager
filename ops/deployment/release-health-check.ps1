#Requires -Version 5.1
<#
.SYNOPSIS
  Release health check for an AssetEngine environment.

.OUTPUTS
  Lines tagged PASS / WARNING / FAIL and an overall exit code (0=PASS, 1=WARNING, 2=FAIL).

.EXAMPLE
  .\ops\deployment\release-health-check.ps1 -Port 9090 -DbName asset_manager_test -Container asset-manager-test
  .\ops\deployment\release-health-check.ps1 -Port 8080 -DbName asset_manager -Container asset-manager-prod
#>
param(
    [string]$RepoRoot = '',
    [int]$Port = 9090,
    [string]$BaseUrl = '',
    [string]$Container = 'asset-manager-test',
    [string]$DbContainer = 'asset-manager-db',
    [string]$DbName = 'asset_manager_test',
    [string]$RedisContainer = 'asset-manager-cache'
)

$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot '_DeployCommon.ps1')

if (-not $RepoRoot) { $RepoRoot = Get-RepoRoot }
if (-not $BaseUrl) { $BaseUrl = "http://127.0.0.1:$Port" }

$results = New-Object System.Collections.Generic.List[object]

function Add-Result {
    param([ValidateSet('PASS','WARNING','FAIL')][string]$Status, [string]$Check, [string]$Detail)
    $results.Add([pscustomobject]@{ Status = $Status; Check = $Check; Detail = $Detail })
    $color = switch ($Status) { 'PASS' { 'Green' } 'WARNING' { 'Yellow' } default { 'Red' } }
    Write-Host ("[{0}] {1}: {2}" -f $Status, $Check, $Detail) -ForegroundColor $color
}

Write-Host "AssetEngine release-health-check  BaseUrl=$BaseUrl  Repo=$RepoRoot" -ForegroundColor Cyan

# Git status
Push-Location $RepoRoot
try {
    if (-not (Test-Path '.git')) {
        Add-Result FAIL 'Git Status' 'Not a git repository'
    } else {
        $branch = (git rev-parse --abbrev-ref HEAD 2>$null)
        $sha = (git rev-parse --short HEAD 2>$null)
        $full = (git rev-parse HEAD 2>$null)
        $dirty = git status --porcelain
        Add-Result PASS 'Current Commit' ("{0} ({1}) {2}" -f $sha, $branch, (git log -1 --pretty=%s))
        if ($dirty) {
            Add-Result WARNING 'Git Status' 'Working tree dirty'
        } else {
            Add-Result PASS 'Git Status' 'Clean'
        }
        git fetch origin --quiet 2>$null
        if ($LASTEXITCODE -eq 0) {
            $counts = (git rev-list --left-right --count origin/main...HEAD 2>$null)
            if ($counts) {
                $parts = $counts -split '\s+'
                $behind = [int]$parts[0]; $ahead = [int]$parts[1]
                if ($behind -gt 0) {
                    Add-Result WARNING 'Git vs origin/main' ("Behind by $behind / ahead by $ahead")
                } elseif ($ahead -gt 0) {
                    Add-Result WARNING 'Git vs origin/main' ("Ahead by $ahead (not pushed)")
                } else {
                    Add-Result PASS 'Git vs origin/main' 'In sync'
                }
            }
        } else {
            Add-Result WARNING 'Git fetch' 'Could not fetch origin'
        }
    }
} finally { Pop-Location }

# Docker container
$st = docker inspect -f '{{.State.Status}}' $Container 2>$null
if ($st -eq 'running') {
    Add-Result PASS 'Docker Containers' "$Container running"
} elseif ($st) {
    Add-Result FAIL 'Docker Containers' "$Container status=$st"
} else {
    Add-Result FAIL 'Docker Containers' "$Container not found"
}

# Backend / frontend reachability
try {
    $homeResp = Invoke-WebRequest -Uri "$BaseUrl/" -UseBasicParsing -TimeoutSec 12
    if ($homeResp.StatusCode -eq 200) { Add-Result PASS 'Frontend Reachability' "GET / -> $($homeResp.StatusCode)" }
    else { Add-Result WARNING 'Frontend Reachability' "GET / -> $($homeResp.StatusCode)" }
} catch {
    Add-Result FAIL 'Frontend Reachability' $_.Exception.Message
}

try {
    $login = Invoke-WebRequest -Uri "$BaseUrl/api/auth/login" -Method POST -ContentType 'application/json' -Body '{"username":"__healthcheck_missing__","password":"x"}' -UseBasicParsing -TimeoutSec 12
    # Unexpected success
    Add-Result WARNING 'Authentication Endpoint' "Unexpected HTTP $($login.StatusCode)"
} catch {
    $code = $null
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    if ($code -eq 401 -or $code -eq 400 -or $code -eq 403) {
        Add-Result PASS 'Authentication Endpoint' "POST /api/auth/login reachable (HTTP $code)"
    } elseif ($code) {
        Add-Result WARNING 'Authentication Endpoint' "HTTP $code"
    } else {
        Add-Result FAIL 'Authentication Endpoint' $_.Exception.Message
    }
}

# Backend health via recovery + movement endpoints (JWT cookie optional — expect 401)
foreach ($path in @('/api/recovery-center/summary','/api/inventory/movements/types')) {
    try {
        Invoke-WebRequest -Uri ($BaseUrl + $path) -UseBasicParsing -TimeoutSec 10 | Out-Null
        Add-Result WARNING $path 'Returned success without auth (check auth middleware)'
    } catch {
        $code = $null
        if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
        if ($code -eq 401 -or $code -eq 403) {
            Add-Result PASS $path "Protected (HTTP $code)"
        } elseif ($code -eq 404) {
            Add-Result WARNING $path 'HTTP 404 — route missing or feature disabled'
        } elseif ($code) {
            Add-Result WARNING $path "HTTP $code"
        } else {
            Add-Result FAIL $path $_.Exception.Message
        }
    }
}

# Shared event system static
try {
    $ev = Invoke-WebRequest -Uri "$BaseUrl/shared/inventoryEventSystem.js" -UseBasicParsing -TimeoutSec 10
    if ($ev.StatusCode -eq 200) { Add-Result PASS 'Inventory Events' 'shared/inventoryEventSystem.js served' }
    else { Add-Result WARNING 'Inventory Events' "HTTP $($ev.StatusCode)" }
} catch {
    Add-Result FAIL 'Inventory Events' $_.Exception.Message
}

try {
    $lc = Invoke-WebRequest -Uri "$BaseUrl/shared/lifecycleModel.js" -UseBasicParsing -TimeoutSec 10
    if ($lc.StatusCode -eq 200) { Add-Result PASS 'Lifecycle Model' 'shared/lifecycleModel.js served' }
    else { Add-Result WARNING 'Lifecycle Model' "HTTP $($lc.StatusCode)" }
} catch {
    Add-Result WARNING 'Lifecycle Model' $_.Exception.Message
}

# Database
$dbPing = docker exec $DbContainer pg_isready -U postgres 2>$null
if ($LASTEXITCODE -eq 0) {
    Add-Result PASS 'Database Connectivity' ($dbPing | Out-String).Trim()
} else {
    Add-Result FAIL 'Database Connectivity' "pg_isready failed on $DbContainer"
}

$mig = Get-MigrationTip -Container $DbContainer -Database $DbName
if ($mig) {
    Add-Result PASS 'Migration Status' "tip=$mig"
    $count = docker exec $DbContainer psql -U postgres -d $DbName -t -A -c "SELECT COUNT(*) FROM knex_migrations;" 2>$null
    if ($count) { Add-Result PASS 'Migration Count' ($count.Trim()) }
} else {
    Add-Result WARNING 'Migration Status' "Could not read knex_migrations for $DbName"
}

# Redis
$pong = docker exec $RedisContainer redis-cli ping 2>$null
if (($pong | Out-String).Trim() -eq 'PONG') {
    Add-Result PASS 'Redis Connectivity' 'PONG'
} else {
    Add-Result WARNING 'Redis Connectivity' 'No PONG (app may use memory fallback)'
}

# Application version marker
$ver = Get-FrontendVersionMarker -RepoRoot $RepoRoot
if ($ver -ne 'unknown') {
    Add-Result PASS 'Application Version' "frontend cache marker v$ver"
} else {
    Add-Result WARNING 'Application Version' 'Could not parse main.js?v= from index.html'
}

# Summary
$fail = @($results | Where-Object Status -eq 'FAIL').Count
$warn = @($results | Where-Object Status -eq 'WARNING').Count
$pass = @($results | Where-Object Status -eq 'PASS').Count
Write-Host ""
Write-Host ("Totals: PASS={0} WARNING={1} FAIL={2}" -f $pass, $warn, $fail) -ForegroundColor Cyan
if ($fail -gt 0) { exit 2 }
if ($warn -gt 0) { exit 1 }
exit 0
