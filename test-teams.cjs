// Quick test: Graph API token acquisition + Teams channel message send
const { ConfidentialClientApplication } = require('@azure/msal-node');

async function main() {
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  const teamId = process.env.TEAMS_TEAM_ID;
  const channelId = process.env.TEAMS_CHANNEL_GENERAL_ID;

  console.log('Config check:');
  console.log('  tenantId:', tenantId ? `${tenantId.substring(0,8)}...` : 'MISSING');
  console.log('  clientId:', clientId ? `${clientId.substring(0,8)}...` : 'MISSING');
  console.log('  clientSecret:', clientSecret ? `${clientSecret.substring(0,8)}...` : 'MISSING');
  console.log('  teamId:', teamId ? `${teamId.substring(0,8)}...` : 'MISSING');
  console.log('  channelId:', channelId ? `${channelId.substring(0,8)}...` : 'MISSING');

  // Validate all required env vars are present
  const missing = [];
  if (!tenantId) missing.push('AZURE_TENANT_ID');
  if (!clientId) missing.push('AZURE_CLIENT_ID');
  if (!clientSecret) missing.push('AZURE_CLIENT_SECRET');
  if (!teamId) missing.push('TEAMS_TEAM_ID');
  if (!channelId) missing.push('TEAMS_CHANNEL_GENERAL_ID');

  if (missing.length > 0) {
    console.error(`\n❌ FAILED: Missing required environment variables: ${missing.join(', ')}`);
    console.error('Set these environment variables before running this test.');
    process.exit(1);
  }

  const msalApp = new ConfidentialClientApplication({
    auth: { clientId, clientSecret, authority: `https://login.microsoftonline.com/${tenantId}` },
  });

  console.log('\n--- Step 1: Acquiring token ---');
  let token;
  try {
    const result = await msalApp.acquireTokenByClientCredential({ scopes: ['https://graph.microsoft.com/.default'] });
    if (!result?.accessToken) { console.error('FAILED: No access token'); process.exit(1); }
    token = result.accessToken;
    console.log('✅ SUCCESS: Token acquired, expires:', result.expiresOn);
  } catch (err) {
    console.error('❌ FAILED to acquire token:', err.message);
    process.exit(1);
  }

  const textUrl = `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages`;
  console.log('Graph API URL:', textUrl.substring(0, 120) + '...');

  console.log('\n--- Step 2: Sending text message ---');
  try {
    const resp = await fetch(textUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: { contentType: 'text', content: '[Test] Graph API connectivity check.' } }),
    });
    const body = await resp.text();
    console.log(`Response: ${resp.status} ${resp.statusText}`);
    if (!resp.ok) {
      console.error('❌ FAILED:', body);
      process.exit(1);
    }
    console.log('✅ SUCCESS');
  } catch (err) { console.error('❌ FAILED:', err.message); process.exit(1); }

  console.log('\n--- Step 3: Sending Adaptive Card ---');
  const card = {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard', version: '1.5',
    body: [
      { type: 'TextBlock', text: 'Teams Integration Test', size: 'large', weight: 'bolder', wrap: true },
      { type: 'TextBlock', text: 'Diagnostic test from Glyphor scheduler.', wrap: true },
    ],
  };
  try {
    const resp = await fetch(textUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body: { contentType: 'html', content: '<attachment id="ac"></attachment>' },
        attachments: [{ id: 'ac', contentType: 'application/vnd.microsoft.card.adaptive', content: JSON.stringify(card) }],
      }),
    });
    const body = await resp.text();
    console.log(`Response: ${resp.status} ${resp.statusText}`);
    if (!resp.ok) {
      console.error('❌ FAILED:', body);
      process.exit(1);
    }
    console.log('✅ SUCCESS');
  } catch (err) { console.error('❌ FAILED:', err.message); process.exit(1); }

  console.log('\n✅ All tests passed!');
}
main().catch(console.error);
