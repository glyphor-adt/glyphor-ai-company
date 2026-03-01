@echo off
echo ================================
echo Glyphor Smoke Test Setup
echo ================================
echo.
echo Step 1: Creating directory structure...
mkdir "packages\smoketest\src\layers" 2>nul
mkdir "packages\smoketest\src\utils" 2>nul
echo ✓ Directories created
echo.
echo Step 2: Copying package files...

REM Check if session files exist
if not exist "%USERPROFILE%\.copilot\session-state\06040fa0-bc43-4187-9ea9-4d15b3a48e51\files\smoketest-package.json" (
    echo ✗ Session files not found. Please run the Copilot agent to generate them first.
    pause
    exit /b 1
)

copy "%USERPROFILE%\.copilot\session-state\06040fa0-bc43-4187-9ea9-4d15b3a48e51\files\smoketest-package.json" "packages\smoketest\package.json"
copy "%USERPROFILE%\.copilot\session-state\06040fa0-bc43-4187-9ea9-4d15b3a48e51\files\smoketest-tsconfig.json" "packages\smoketest\tsconfig.json"
copy "%USERPROFILE%\.copilot\session-state\06040fa0-bc43-4187-9ea9-4d15b3a48e51\files\smoketest-README.md" "packages\smoketest\README.md"
copy "%USERPROFILE%\.copilot\session-state\06040fa0-bc43-4187-9ea9-4d15b3a48e51\files\types.ts" "packages\smoketest\src\types.ts"
copy "%USERPROFILE%\.copilot\session-state\06040fa0-bc43-4187-9ea9-4d15b3a48e51\files\http-client.ts" "packages\smoketest\src\utils\http-client.ts"
copy "%USERPROFILE%\.copilot\session-state\06040fa0-bc43-4187-9ea9-4d15b3a48e51\files\sql-client.ts" "packages\smoketest\src\utils\sql-client.ts"
copy "%USERPROFILE%\.copilot\session-state\06040fa0-bc43-4187-9ea9-4d15b3a48e51\files\gcp-client.ts" "packages\smoketest\src\utils\gcp-client.ts"

echo ✓ Files copied
echo.
echo Step 3: Installing dependencies...
cd packages\smoketest
call npm install
cd ..\..

echo.
echo ================================
echo ✓ Setup complete!
echo ================================
echo.
echo Next steps:
echo   1. npm run build --workspace=@glyphor/smoketest
echo   2. node packages/smoketest/dist/cli.js --help
echo.
pause
