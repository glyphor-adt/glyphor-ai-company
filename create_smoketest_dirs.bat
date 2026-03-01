@echo off
setlocal enabledelayedexpansion
cd /d C:\Users\KristinaDenney\source\repos\glyphor-ai-company

REM Create main smoketest directory
if not exist "packages\smoketest" mkdir packages\smoketest
if exist "packages\smoketest" (
    echo Created: packages\smoketest
) else (
    echo Failed to create packages\smoketest
)

REM Create src directory
if not exist "packages\smoketest\src" mkdir packages\smoketest\src
if exist "packages\smoketest\src" (
    echo Created: packages\smoketest\src
) else (
    echo Failed to create packages\smoketest\src
)

REM Create src\layers directory
if not exist "packages\smoketest\src\layers" mkdir packages\smoketest\src\layers
if exist "packages\smoketest\src\layers" (
    echo Created: packages\smoketest\src\layers
) else (
    echo Failed to create packages\smoketest\src\layers
)

REM Create src\utils directory
if not exist "packages\smoketest\src\utils" mkdir packages\smoketest\src\utils
if exist "packages\smoketest\src\utils" (
    echo Created: packages\smoketest\src\utils
) else (
    echo Failed to create packages\smoketest\src\utils
)

echo.
echo Directory structure created successfully!
echo.
dir /s packages\smoketest
