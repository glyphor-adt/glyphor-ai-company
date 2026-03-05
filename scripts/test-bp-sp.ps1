Import-Module Microsoft.Graph.Authentication
Connect-MgGraph -Scopes 'Application.ReadWrite.All','AgentIdentityBlueprintPrincipal.Create' -TenantId '19ab7456-f160-416d-a503-57298ab192a2' -NoWelcome
Write-Host "Connected as $($(Get-MgContext).Account)"

$body = @{ appId = '5604df3b-a3a3-4c7e-a8c4-e6f9ed04ad6a' } | ConvertTo-Json
Write-Host "Body: $body"

try {
    $r = Invoke-MgGraphRequest -Method POST -Uri 'https://graph.microsoft.com/beta/serviceprincipals/graph.agentIdentityBlueprintPrincipal' -Headers @{'OData-Version'='4.0'} -Body $body -ContentType 'application/json'
    Write-Host "SUCCESS:"
    $r | ConvertTo-Json -Depth 5
} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
    Write-Host "STATUS: $($_.Exception.Response.StatusCode)"
    Write-Host "DETAILS: $($_.ErrorDetails.Message)"
    # Try to get response body
    if ($_.Exception.Response) {
        try {
            $stream = $_.Exception.Response.Content.ReadAsStringAsync().Result
            Write-Host "RESPONSE BODY: $stream"
        } catch {}
    }
}
