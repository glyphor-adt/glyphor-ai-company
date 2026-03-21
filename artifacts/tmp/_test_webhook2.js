const tenantId = process.env.AZURE_TENANT_ID?.trim();
const clientId = process.env.AZURE_CLIENT_ID?.trim();
const clientSecret = process.env.AZURE_CLIENT_SECRET?.trim();
const webhookUrl = process.env.TEAMS_WEBHOOK_BRIEFINGS?.trim();

// Extract the environment URL from the webhook URL
// URL: https://default19ab7456f160416da50357298ab192.a2.environment.api.powerplatform.com:443/...
// Environment scope: https://default19ab7456f160416da50357298ab192.a2.environment.api.powerplatform.com/.default
const url = new URL(webhookUrl);
const envScope = `${url.protocol}//${url.hostname}/.default`;
console.log('Environment scope:', envScope);

const scopes = [
  envScope,
  'https://service.flow.microsoft.com/.default',
  'https://api.powerplatform.com/.default',
];

(async () => {
  for (const scope of scopes) {
    console.log(`\nTrying scope: ${scope}`);
    const params = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret, scope });
    const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
    if (res.ok) {
      const data = await res.json();
      console.log(`  TOKEN_OK (len=${data.access_token.length})`);
      // Test the webhook
      const payload = {
        type: 'message',
        attachments: [{
          contentType: 'application/vnd.microsoft.card.adaptive',
          contentUrl: null,
          content: {
            "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
            type: 'AdaptiveCard',
            version: '1.5',
            body: [{ type: 'TextBlock', text: 'Webhook test - should appear as bot identity', wrap: true, weight: 'Bolder' }]
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
      if (wRes.ok) {
        console.log('\nSUCCESS! Check #briefings channel.');
        return;
      }
    } else {
      const text = await res.text();
      console.log(`  TOKEN_FAILED: ${res.status} ${text.substring(0, 200)}`);
    }
  }
  console.log('\nALL FAILED');
})();
