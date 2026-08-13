#Requires -Version 5.1
<#
.SYNOPSIS
  Deploy / refresh AssetEngine Production (118:8080).

.DESCRIPTION
  REQUIRES -ConfirmProduction.

  Defaults to F:\AssetManager\AssetManager_Prod when present; override with -RepoRoot.
  Aborts if the path has no .git or working tree is dirty.
  Does NOT run automatically against the Dev shared tree.

.EXAMPLE
  .\ops\deployment\deploy-production.ps1 -ConfirmProduction -RepoRoot 'D:\AssetManager\AssetManager_Prod'
#>
param(
    [switch]$ConfirmProduction,
    [string]$RepoRoot = 'F:\AssetManager\AssetManager_Prod',
    [string]$Remote = 'origin',
    [string]$Branch = 'main',
    [string]$Container = 'asset-manager-app-prod',
    [string]$ComposeFile = 'docker-compose.yml',
    [string]$DbContainer = 'asset-manager-db-prod',
    [string]$DbName = 'asset_manager',
    [int]$Port = 8080,
    [switch]$SkipNpmInstall,
    [switch]$UseComposeUp
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_DeployCommon.ps1')

Write-Host "AssetEngine deploy-production" -ForegroundColor Cyan

if (-not $ConfirmProduction) {
    Write-Host "ABORT: Refusing to touch Production without -ConfirmProduction." -ForegroundColor Red
    Write-Host "Example: .\deploy-production.ps1 -ConfirmProduction -RepoRoot '<prod-git-checkout>'"
    exit 3
}

if (-not (Test-Path $RepoRoot)) {
    Write-Host "ABORT: Production repo path not found: $RepoRoot" -ForegroundColor Red
    exit 3
}

if (-not (Test-Path (Join-Path $RepoRoot '.git'))) {
    Write-Host "ABORT: Path is not a Git repository: $RepoRoot" -ForegroundColor Red
    Write-Host "Production must be a clone of AnuragUb/Asset-Manager tracking main — not a loose folder copy."
    exit 3
}

# Safety: refuse if operator pointed at the Dev shared tree without an extra override
$devTree = 'F:\AssetManager\AssetManager_Dev'
if ((Resolve-Path $RepoRoot).Path -eq (Resolve-Path $devTree -ErrorAction SilentlyContinue).Path) {
    Write-Host "ABORT: Refusing to run Production deploy against Dev tree $devTree" -ForegroundColor Red
    Write-Host "Use a dedicated Production checkout on host 118."
    exit 3
}

Write-Host "Repo: $RepoRoot" -ForegroundColor Yellow
Write-Host "This will pull $Remote/$Branch and restart Production containers." -ForegroundColor Yellow

Assert-CleanWorkingTree -RepoRoot $RepoRoot
$commit = Update-MainBranch -RepoRoot $RepoRoot -Remote $Remote -Branch $Branch

if (-not $SkipNpmInstall) {
    Install-BackendDependenciesIfNeeded -RepoRoot $RepoRoot
}

if ($UseComposeUp) {
    Push-Location $RepoRoot
    try {
        Write-Host "==> docker compose -f $ComposeFile up -d --build"
        docker compose -f $ComposeFile up -d --build
        if ($LASTEXITCODE -ne 0) { throw "docker compose up failed" }
        Start-Sleep -Seconds 12
    } finally {
        Pop-Location
    }
} else {
    Restart-DockerContainer -Name $Container
}

$ok = Test-HttpOk -Url ("http://127.0.0.1:{0}/" -f $Port)
if (-not $ok) {
    # Production may not be local — try without failing hard
    Write-Host "WARNING: Local home check on port $Port failed (expected if script is not run on 118)." -ForegroundColor Yellow
}

$ver = Get-FrontendVersionMarker -RepoRoot $RepoRoot
$mig = Get-MigrationTip -Container $DbContainer -Database $DbName
Write-DeploySummary -Environment 'Production' -Commit $commit -VersionMarker $ver -MigrationTip $mig -Port $Port
Write-Host "Remember: verify SMTP/Zoho/JWT secrets on Production before announcing release." -ForegroundColor Yellow
