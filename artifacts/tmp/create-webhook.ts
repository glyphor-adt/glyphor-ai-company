/**
 * Create a Power Automate Workflow-based Incoming Webhook for a Teams channel.
 * 
 * This uses the "Post to a channel when a webhook request is received" 
 * workflow template in Teams via the Power Automate Management API.
 *
 * If this doesn't work programmatically (requires user consent flow),
 * we'll create them manually through the Teams UI.
 */

async function main() {
  const tenantId = process.env.AZURE_TENANT_ID!.trim();
  const clientId = process.env.AZURE_CLIENT_ID!.trim();
  const clientSecret = process.env.AZURE_CLIENT_SECRET!.trim();

  // Try to get a token for Power Automate / Flow Management API
  const scopes = [
    'https://service.flow.microsoft.com/.default',
    'https://management.azure.com/.default',
  ];

  for (const scope of scopes) {
    console.log(`\nTrying scope: ${scope}`);
    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope,
    });

    const res = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() },
    );

    if (!res.ok) {
      const err = await res.json();
      console.log(`  FAILED: ${err.error} - ${err.error_description?.substring(0, 100)}`);
      continue;
    }

    const data = await res.json() as { access_token: string };
    console.log(`  Token acquired!`);

    // Try to list flows so we know the API works
    const environments = ['Default-' + tenantId];
    for (const env of environments) {
      const flowsUrl = `https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/${encodeURIComponent(env)}/flows?api-version=2016-11-01`;
      const flowsRes = await fetch(flowsUrl, {
        headers: { Authorization: `Bearer ${data.access_token}` },
      });
      console.log(`  List flows: ${flowsRes.status} ${flowsRes.statusText}`);
      if (flowsRes.ok) {
        const flows = await flowsRes.json() as { value: Array<{ name: string; properties: { displayName: string } }> };
        console.log(`  Found ${flows.value?.length ?? 0} flows`);
      } else {
        console.log(`  ${await flowsRes.text().then(t => t.substring(0, 200))}`);
      }
    }
  }

  console.log('\n--- Alternative: Check if classic incoming webhooks are still available ---');
  // Classic Incoming Webhooks use a different endpoint
  console.log('Classic incoming webhooks are deprecated by Microsoft.');
  console.log('Power Automate Workflows must be created via the Teams UI:');
  console.log('  1. Open Teams → Go to the target channel');
  console.log('  2. Click ⋯ next to the channel name → "Manage channel"');
  console.log('  3. Or: Click ⋯ → "Workflows" → "Post to a channel when a webhook request is received"');
  console.log('  4. Name it (e.g., "Glyphor Bot") → Select the channel → Create');
  console.log('  5. Copy the webhook URL');
}

main().catch(console.error);
