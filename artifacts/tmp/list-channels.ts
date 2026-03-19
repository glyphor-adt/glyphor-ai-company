/**
 * List all channels in the Glyphor Teams team.
 */
import { ConfidentialClientApplication } from '@azure/msal-node';

async function main() {
  const msalApp = new ConfidentialClientApplication({
    auth: {
      clientId: process.env.AZURE_CLIENT_ID!.trim(),
      clientSecret: process.env.AZURE_CLIENT_SECRET!.trim(),
      authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID!.trim()}`,
    },
  });

  const result = await msalApp.acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  });

  const teamId = process.env.TEAMS_TEAM_ID!.trim();
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(teamId)}/channels?$select=id,displayName,description,membershipType`,
    { headers: { Authorization: `Bearer ${result!.accessToken}` } },
  );

  if (!res.ok) {
    console.error(`Failed: ${res.status} ${await res.text()}`);
    return;
  }

  const data = (await res.json()) as { value: Array<{ id: string; displayName: string; description: string | null; membershipType: string }> };
  
  console.log(`Team ID: ${teamId}`);
  console.log(`\nChannels (${data.value.length}):\n`);
  
  for (const ch of data.value.sort((a, b) => a.displayName.localeCompare(b.displayName))) {
    console.log(`  ${ch.displayName}`);
    console.log(`    ID: ${ch.id}`);
    console.log(`    Type: ${ch.membershipType}`);
    if (ch.description) console.log(`    Desc: ${ch.description}`);
    console.log('');
  }

  // Also check what channel IDs are configured in secrets
  console.log('--- Configured channel ID secrets ---');
  const channelSecrets = [
    'TEAMS_CHANNEL_DECISIONS_ID',
    'TEAMS_CHANNEL_GENERAL_ID',
    'TEAMS_CHANNEL_ENGINEERING_ID',
    'TEAMS_CHANNEL_BRIEFING_KRISTINA_ID',
    'TEAMS_CHANNEL_BRIEFING_ANDREW_ID',
    'TEAMS_CHANNEL_GROWTH_ID',
    'TEAMS_CHANNEL_FINANCIALS_ID',
    'TEAMS_CHANNEL_PRODUCT_FUSE_ID',
    'TEAMS_CHANNEL_PRODUCT_PULSE_ID',
  ];

  for (const envVar of channelSecrets) {
    const val = process.env[envVar]?.trim();
    if (val) {
      const match = data.value.find(ch => ch.id === val);
      console.log(`  ${envVar}: ${match ? match.displayName : '⚠️ NO MATCHING CHANNEL'} (${val.substring(0, 30)}...)`);
    }
  }
}
main();
