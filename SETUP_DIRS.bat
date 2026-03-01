@echo off
REM Automated Smoketest Package Setup Script
cd /d C:\Users\KristinaDenney\source\repos\glyphor-ai-company

echo Creating smoketest directory structure...
mkdir "packages\smoketest" 2>nul
mkdir "packages\smoketest\src" 2>nul
mkdir "packages\smoketest\src\layers" 2>nul
mkdir "packages\smoketest\src\utils" 2>nul

echo.
echo Directories created. Structure:
dir /s /b packages\smoketest

echo.
echo Now run: node setup_smoketest_files.js
pause
