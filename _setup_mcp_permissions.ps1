Write-Host ""
Write-Host "=== AGENT 365 MCP PERMISSIONS SETUP ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "This will sign you in and configure MCP permissions on the agent blueprint." -ForegroundColor White
Write-Host "A browser window will open - please sign in with your admin account." -ForegroundColor Yellow
Write-Host ""
Write-Host "Press Enter to start..." -ForegroundColor Green
Read-Host

Set-Location "C:\Users\KristinaDenney\source\repos\glyphor-ai-company"
a365 setup permissions mcp --verbose

Write-Host ""
Write-Host "=== VERIFYING ===" -ForegroundColor Cyan
a365 query-entra blueprint-scopes

Write-Host ""
Write-Host "Done! Press Enter to close this window." -ForegroundColor Green
Read-Host
