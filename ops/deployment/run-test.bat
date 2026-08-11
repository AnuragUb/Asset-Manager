@echo off
echo Starting Asset Manager (TESTING) on port 9090...
set PORT=9090
REM Paths are relative to web-app/asset-manager-backend after cd below
set DATA_DIR=..\..\data\test
set DB_PATH=..\..\data\test\database_v2.db
cd /d "%~dp0..\..\web-app\asset-manager-backend"
npm start
pause
