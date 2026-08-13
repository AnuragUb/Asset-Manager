#Requires -Version 5.1
<#
.SYNOPSIS
  Deploy / refresh AssetEngine Development environment (59:9090).

.DESCRIPTION
  - Aborts if working tree is dirty (will not overwrite local work)
  - Fetches and pulls origin/main
  - Restarts container asset-manager-test
  - Prints commit, version marker, migration tip

  NOTE: On host 59, Dev and Staging share F:\AssetManager\AssetManager_Dev bind mounts.
  Pulling main updates code visible to both ports; this script only restarts the Dev container.

.EXAMPLE
  .\ops\deployment\deploy-dev.ps1
#>
param(
    [string]$RepoRoot = '',
    [string]$Remote = 'origin',
    [string]$Branch = 'main',
    [string]$Container = 'asset-manager-test',
    [string]$DbName = 'asset_manager_test',
    [int]$Port = 9090,
    [switch]$SkipNpmInstall
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_DeployCommon.ps1')

if (-not $RepoRoot) { $RepoRoot = Get-RepoRoot }

Write-Host "AssetEngine deploy-dev" -ForegroundColor Cyan
Write-Host "Repo: $RepoRoot"
Write-Host "NOTE: Shared bind-mount with Staging on host 59 — git pull affects both code trees." -ForegroundColor Yellow

Assert-CleanWorkingTree -RepoRoot $RepoRoot
$commit = Update-MainBranch -RepoRoot $RepoRoot -Remote $Remote -Branch $Branch

if (-not $SkipNpmInstall) {
    Install-BackendDependenciesIfNeeded -RepoRoot $RepoRoot
}

Restart-DockerContainer -Name $Container

$ok = Test-HttpOk -Url ("http://127.0.0.1:{0}/" -f $Port)
if (-not $ok) {
    Write-Host "WARNING: Home page did not return success on port $Port" -ForegroundColor Yellow
} else {
    Write-Host "Home page OK on port $Port" -ForegroundColor Green
}

$ver = Get-FrontendVersionMarker -RepoRoot $RepoRoot
$mig = Get-MigrationTip -Database $DbName
Write-DeploySummary -Environment 'Development' -Commit $commit -VersionMarker $ver -MigrationTip $mig -Port $Port
