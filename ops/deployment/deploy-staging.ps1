#Requires -Version 5.1
<#
.SYNOPSIS
  Deploy / refresh AssetEngine Staging environment (59:8080).

.DESCRIPTION
  Same Git checkout as Development on host 59 (shared bind mount).
  Restarts container asset-manager-prod (Staging app — name is historical).

.EXAMPLE
  .\ops\deployment\deploy-staging.ps1
#>
param(
    [string]$RepoRoot = '',
    [string]$Remote = 'origin',
    [string]$Branch = 'main',
    [string]$Container = 'asset-manager-prod',
    [string]$DbName = 'asset_manager',
    [int]$Port = 8080,
    [switch]$SkipNpmInstall
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_DeployCommon.ps1')

if (-not $RepoRoot) { $RepoRoot = Get-RepoRoot }

Write-Host "AssetEngine deploy-staging" -ForegroundColor Cyan
Write-Host "Repo: $RepoRoot"
Write-Host "NOTE: Container '$Container' is Staging on port $Port (not Production 118)." -ForegroundColor Yellow
Write-Host "NOTE: Shared bind-mount with Dev — git pull updates code for 9090 as well." -ForegroundColor Yellow

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
Write-DeploySummary -Environment 'Staging' -Commit $commit -VersionMarker $ver -MigrationTip $mig -Port $Port
