@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "PS_SCRIPT=%SCRIPT_DIR%asset_manager.ps1"
powershell.exe -ExecutionPolicy Bypass -STA -File "%PS_SCRIPT%"
endlocal
