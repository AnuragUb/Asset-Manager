#Requires -Version 5.1
<#
.SYNOPSIS
  Shared helpers for AssetEngine deployment scripts.
#>

function Get-RepoRoot {
    param([string]$StartDir = $PSScriptRoot)
    return (Resolve-Path (Join-Path $StartDir '..\..')).Path
}

function Assert-CleanWorkingTree {
    param([string]$RepoRoot)
    Push-Location $RepoRoot
    try {
        $porcelain = git status --porcelain
        if ($porcelain) {
            Write-Host "ABORT: Working tree is dirty. Commit, stash, or discard changes before deploy." -ForegroundColor Red
            Write-Host $porcelain
            Write-Host "Refusing to overwrite local work." -ForegroundColor Yellow
            exit 2
        }
    } finally {
        Pop-Location
    }
}

function Update-MainBranch {
    param(
        [string]$RepoRoot,
        [string]$Remote = 'origin',
        [string]$Branch = 'main'
    )
    Push-Location $RepoRoot
    try {
        Write-Host "==> git fetch $Remote"
        git fetch $Remote
        if ($LASTEXITCODE -ne 0) { throw "git fetch failed" }

        $current = (git rev-parse --abbrev-ref HEAD).Trim()
        if ($current -ne $Branch) {
            Write-Host "==> git checkout $Branch"
            git checkout $Branch
            if ($LASTEXITCODE -ne 0) { throw "git checkout $Branch failed" }
        }

        Write-Host "==> git pull $Remote $Branch"
        git pull $Remote $Branch
        if ($LASTEXITCODE -ne 0) { throw "git pull failed" }

        $sha = (git rev-parse HEAD).Trim()
        $short = (git rev-parse --short HEAD).Trim()
        $subject = (git log -1 --pretty=%s).Trim()
        return [pscustomobject]@{ Sha = $sha; Short = $short; Subject = $subject }
    } finally {
        Pop-Location
    }
}

function Install-BackendDependenciesIfNeeded {
    param([string]$RepoRoot)
    $backend = Join-Path $RepoRoot 'web-app\asset-manager-backend'
    if (-not (Test-Path (Join-Path $backend 'package.json'))) {
        Write-Host "WARNING: backend package.json missing" -ForegroundColor Yellow
        return
    }
    Write-Host "==> npm install (backend, omit optional noise)"
    Push-Location $backend
    try {
        npm install --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
    } finally {
        Pop-Location
    }
}

function Restart-DockerContainer {
    param([Parameter(Mandatory)][string]$Name)
    Write-Host "==> docker restart $Name"
    docker restart $Name
    if ($LASTEXITCODE -ne 0) { throw "docker restart $Name failed" }
    Start-Sleep -Seconds 8
    $status = docker inspect -f '{{.State.Status}}' $Name 2>$null
    if ($status -ne 'running') {
        throw "Container $Name is not running (status=$status)"
    }
    Write-Host "Container $Name is running." -ForegroundColor Green
}

function Get-FrontendVersionMarker {
    param([string]$RepoRoot)
    $index = Join-Path $RepoRoot 'web-app\asset-manager-frontend\index.html'
    if (-not (Test-Path $index)) { return 'unknown' }
    $m = Select-String -Path $index -Pattern 'main\.js\?v=([0-9.]+)' | Select-Object -First 1
    if ($m) { return $m.Matches[0].Groups[1].Value }
    return 'unknown'
}

function Get-MigrationTip {
    param(
        [string]$Container = 'asset-manager-db',
        [string]$Database
    )
    if (-not $Database) { return $null }
    $q = "SELECT name FROM knex_migrations ORDER BY id DESC LIMIT 1;"
    $out = docker exec $Container psql -U postgres -d $Database -t -A -c $q 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return ($out | Out-String).Trim()
}

function Test-HttpOk {
    param([string]$Url, [int]$TimeoutSec = 10)
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec
        return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400)
    } catch {
        return $false
    }
}

function Write-DeploySummary {
    param(
        [string]$Environment,
        [object]$Commit,
        [string]$VersionMarker,
        [string]$MigrationTip,
        [int]$Port
    )
    Write-Host ""
    Write-Host "======== DEPLOY SUMMARY ($Environment) ========" -ForegroundColor Cyan
    Write-Host ("Commit:     {0} {1}" -f $Commit.Short, $Commit.Subject)
    Write-Host ("Full SHA:   {0}" -f $Commit.Sha)
    Write-Host ("App marker: v{0}" -f $VersionMarker)
    Write-Host ("Port:       {0}" -f $Port)
    if ($MigrationTip) { Write-Host ("Migration:  {0}" -f $MigrationTip) }
    Write-Host "=============================================="
}
