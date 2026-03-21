const tenantId = process.env.AZURE_TENANT_ID?.trim();
const clientId = process.env.AZURE_CLIENT_ID?.trim();
const clientSecret = process.env.AZURE_CLIENT_SECRET?.trim();
console.log('tenantId:', tenantId ? 'SET' : 'MISSING');
console.log('clientId:', clientId || 'MISSING');
console.log('clientSecret:', clientSecret ? `SET (len=${clientSecret.length})` : 'MISSING');

const scopes = ['https://service.flow.microsoft.com/.default', 'https://api.powerplatform.com/.default'];
(async () => {
  for (const scope of scopes) {
    const params = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret, scope });
    const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
    if (res.ok) {
      const data = await res.json();
      console.log('TOKEN_SUCCESS for', scope, '- token length:', data.access_token.length);
      // Test the webhook with this token
      const webhookUrl = process.env.TEAMS_WEBHOOK_BRIEFINGS?.trim();
      if (webhookUrl) {
        const payload = {
          type: 'message',
          attachments: [{
            contentType: 'application/vnd.microsoft.card.adaptive',
            contentUrl: null,
            content: {
              "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
              type: 'AdaptiveCard',
              version: '1.5',
              body: [{ type: 'TextBlock', text: 'Webhook auth test - this should appear as bot, not Kristina', wrap: true, weight: 'Bolder' }]
            }
          }]
        };
        const wRes = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${data.access_token}` },
          body: JSON.stringify(payload)
        });
        const wText = await wRes.text();
        console.log('WEBHOOK_RESPONSE:', wRes.status, wText.substring(0, 300));
      } else {
        console.log('NO_WEBHOOK_URL');
      }
      return;
    } else {
      const text = await res.text();
      console.log('TOKEN_FAILED for', scope, '-', res.status, text.substring(0, 300));
    }
  }
  console.log('ALL_SCOPES_FAILED');
})();
