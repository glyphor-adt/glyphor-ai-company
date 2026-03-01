@echo off
REM ====================================================================
REM Glyphor Smoketest Package - Complete Setup Script
REM ====================================================================
cd /d C:\Users\KristinaDenney\source\repos\glyphor-ai-company

echo.
echo ============================================
echo Creating Smoketest Package Structure
echo ============================================
echo.

REM Step 1: Create directories
echo [1/2] Creating directories...
mkdir "packages\smoketest" 2>nul
mkdir "packages\smoketest\src" 2>nul
mkdir "packages\smoketest\src\layers" 2>nul
mkdir "packages\smoketest\src\utils" 2>nul
echo    ✓ Directory structure created

REM Step 2: Create files using Node.js
echo.
echo [2/2] Creating package files...
node setup_smoketest_files.js

echo.
echo ============================================
echo Setup Complete!
echo ============================================
echo.
echo Smoketest package created at:
echo   packages\smoketest\
echo.
echo To verify and build:
echo   1. cd packages\smoketest
echo   2. npm install
echo   3. npm run build
echo.
pause
