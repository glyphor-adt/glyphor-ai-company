// Test that the Adaptive Card renders (not raw JSON) when content is stringified
const tenantId = process.env.AZURE_TENANT_ID?.trim();
const clientId = process.env.AZURE_CLIENT_ID?.trim();
const clientSecret = process.env.AZURE_CLIENT_SECRET?.trim();
const webhookUrl = process.env.TEAMS_WEBHOOK_BRIEFINGS?.trim();

(async () => {
  // Get token via v1.0 endpoint
  const params = new URLSearchParams({ 
    grant_type: 'client_credentials', 
    client_id: clientId, 
    client_secret: clientSecret, 
    resource: 'https://service.flow.microsoft.com/',
  });
  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/token`;
  const res = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
  if (!res.ok) { console.error('Token failed:', res.status, await res.text()); return; }
  const { access_token } = await res.json();

  // Build payload with content as STRING (the fix)
  const card = {
    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
    type: "AdaptiveCard",
    version: "1.5",
    body: [
      { type: "TextBlock", text: "Webhook Card Render Test", wrap: true, weight: "Bolder", size: "Medium" },
      { type: "TextBlock", text: "If you see this as a **formatted card** (not raw JSON), the fix works!", wrap: true },
      { type: "FactSet", facts: [
        { title: "Status", value: "Content stringified" },
        { title: "Time", value: new Date().toLocaleTimeString() }
      ]}
    ]
  };

  const payload = {
    type: "message",
    attachments: [{
      contentType: "application/vnd.microsoft.card.adaptive",
      contentUrl: null,
      content: JSON.stringify(card)  // <-- KEY FIX: string, not object
    }]
  };

  const wRes = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${access_token}` },
    body: JSON.stringify(payload)
  });
  console.log(`Webhook: ${wRes.status} ${await wRes.text()}`);
})();
