@echo off
REM Asset Management Tool - Launcher
REM Manages assets with user roles and change tracking

setlocal enabledelayedexpansion

REM Get the directory where this batch file is located
set "SCRIPT_DIR=%~dp0"
set "PS_SCRIPT=%SCRIPT_DIR%asset_manager.ps1"

REM Check if PowerShell script exists
if not exist "%PS_SCRIPT%" (
    echo Error: PowerShell script asset_manager.ps1 not found!
    echo Expected location: %PS_SCRIPT%
    pause
    exit /b 1
)

REM Launch Asset Manager GUI
powershell.exe -ExecutionPolicy Bypass -File "%PS_SCRIPT%"

endlocal

