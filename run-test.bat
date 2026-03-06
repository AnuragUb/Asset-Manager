@echo off
echo Starting Asset Manager (TESTING) on port 9090...
set PORT=9090
set DATA_DIR=..\..\data\test
set DB_PATH=..\..\data\test\database_v2.db
cd web-app\asset-manager-backend
npm start
pause