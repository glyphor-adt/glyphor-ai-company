const tenantId = process.env.AZURE_TENANT_ID?.trim();
const clientId = process.env.AZURE_CLIENT_ID?.trim();
const clientSecret = process.env.AZURE_CLIENT_SECRET?.trim();
const webhookUrl = process.env.TEAMS_WEBHOOK_BRIEFINGS?.trim();

const attempts = [
  // v1.0 endpoint with resource (not scope)
  { endpoint: 'v1', resource: 'https://service.flow.microsoft.com/' },
  { endpoint: 'v1', resource: 'https://api.powerplatform.com/' },
  // Try with standard scope but v1.0 token endpoint
  { endpoint: 'v1', resource: 'https://service.flow.microsoft.com' },
];

(async () => {
  for (const { endpoint, resource } of attempts) {
    console.log(`\nTrying v1.0: resource=${resource}`);
    const params = new URLSearchParams({ 
      grant_type: 'client_credentials', 
      client_id: clientId, 
      client_secret: clientSecret, 
      resource: resource,
    });
    const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/token`;
    const res = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
    if (res.ok) {
      const data = await res.json();
      console.log(`  TOKEN_OK (len=${data.access_token.length})`);
      const payload = {
        type: 'message',
        attachments: [{
          contentType: 'application/vnd.microsoft.card.adaptive',
          contentUrl: null,
          content: {
            "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
            type: 'AdaptiveCard',
            version: '1.5',
            body: [{ type: 'TextBlock', text: 'Webhook v1 token test', wrap: true, weight: 'Bolder' }]
          }
        }]
      };
      const wRes = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${data.access_token}` },
        body: JSON.stringify(payload)
      });
      const wText = await wRes.text();
      console.log(`  WEBHOOK: ${wRes.status} ${wText.substring(0, 300)}`);
      if (wRes.ok) { console.log('\nSUCCESS!'); return; }
    } else {
      const text = await res.text();
      console.log(`  TOKEN_FAILED: ${res.status} ${text.substring(0, 200)}`);
    }
  }
  
  // Also try delegated token (refresh_token) with Flow audience
  console.log('\n--- DELEGATED TOKEN ATTEMPTS ---');
  const refreshToken = process.env.GRAPH_DELEGATED_REFRESH_TOKEN?.trim();
  if (!refreshToken) { console.log('No refresh token'); return; }
  
  const delegatedScopes = [
    'https://service.flow.microsoft.com/Flows.Read.All https://service.flow.microsoft.com/Flows.Manage.All offline_access',
    'https://service.flow.microsoft.com/.default offline_access',
    'https://api.powerplatform.com/.default offline_access',
  ];
  
  for (const scope of delegatedScopes) {
    console.log(`\nTrying delegated: scope=${scope.substring(0, 60)}...`);
    const params = new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken, scope });
    const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
    if (res.ok) {
      const data = await res.json();
      console.log(`  TOKEN_OK (len=${data.access_token.length})`);
      const payload = {
        type: 'message',
        attachments: [{
          contentType: 'application/vnd.microsoft.card.adaptive',
          contentUrl: null,
          content: {
            "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
            type: 'AdaptiveCard',
            version: '1.5',
            body: [{ type: 'TextBlock', text: 'Webhook delegated token test', wrap: true, weight: 'Bolder' }]
          }
        }]
      };
      const wRes = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${data.access_token}` },
        body: JSON.stringify(payload)
      });
      const wText = await wRes.text();
      console.log(`  WEBHOOK: ${wRes.status} ${wText.substring(0, 300)}`);
      if (wRes.ok) { console.log('\nSUCCESS!'); return; }
    } else {
      const text = await res.text();
      console.log(`  FAILED: ${res.status} ${text.substring(0, 200)}`);
    }
  }
  console.log('\nALL FAILED');
})();
