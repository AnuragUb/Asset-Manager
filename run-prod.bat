@echo off
echo Starting Asset Manager (PRODUCTION) on port 8080...
set PORT=8080
set DATA_DIR=..\..\data\prod
set DB_PATH=..\..\data\prod\database_v2.db
cd web-app\asset-manager-backend
npm start
pause